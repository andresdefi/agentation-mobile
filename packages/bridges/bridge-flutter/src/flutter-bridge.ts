import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
	type DeviceInfo,
	IOS_UDID_REGEX,
	type IPlatformBridge,
} from "@agentation-mobile/bridge-core";
import type { MobileElement } from "@agentation-mobile/core";
import WebSocket from "ws";

const execFile = promisify(execFileCb);

/** Maximum time (ms) to wait for CLI commands. */
const CLI_TIMEOUT = 15_000;

/** Maximum buffer size (bytes) for screenshot output (~25 MB). */
const MAX_BUFFER = 25 * 1024 * 1024;

/** Timeout (ms) for WebSocket connections and JSON-RPC calls. */
const WS_TIMEOUT = 8_000;

/** Common Dart VM Service ports to scan when discovery fails. */
const VM_SERVICE_PORTS = [8181, 8182, 8183, 8184, 8185];

// ---------------------------------------------------------------------------
// JSON-RPC helpers for Dart VM Service
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
	id: number;
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
}

/** Monotonically increasing JSON-RPC request ID. */
let rpcIdCounter = 1;

/**
 * Open a WebSocket connection to the given URL with a timeout.
 */
function connectToVmService(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timer = setTimeout(() => {
			ws.terminate();
			reject(new Error("VM Service WebSocket connection timed out"));
		}, WS_TIMEOUT);

		ws.on("open", () => {
			clearTimeout(timer);
			resolve(ws);
		});
		ws.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

/**
 * Send a JSON-RPC 2.0 request over the WebSocket and await the matching
 * response by ID.
 */
function callVmServiceMethod(
	ws: WebSocket,
	method: string,
	params: Record<string, unknown> = {},
): Promise<JsonRpcResponse> {
	const id = rpcIdCounter++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.off("message", handler);
			reject(new Error(`VM Service call '${method}' timed out`));
		}, WS_TIMEOUT);

		const handler = (data: WebSocket.Data) => {
			try {
				const msg = JSON.parse(data.toString()) as JsonRpcResponse;
				if (msg.id === id) {
					clearTimeout(timer);
					ws.off("message", handler);
					resolve(msg);
				}
			} catch {
				// ignore non-JSON or unrelated messages
			}
		};

		ws.on("message", handler);
		ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
	});
}

// ---------------------------------------------------------------------------
// VM Service URL discovery (with per-device cache)
// ---------------------------------------------------------------------------

/** Cached VM Service URLs per device. TTL 60s. */
const vmUrlCache = new Map<string, { url: string; expiresAt: number }>();
const VM_URL_CACHE_TTL = 60_000;

/**
 * Try multiple strategies to discover the Dart VM Service WebSocket URL
 * for the given device, using a cache to avoid repeated discovery.
 *
 * Strategy 1: Parse `flutter daemon` / logcat output for observatory URLs.
 * Strategy 2: Scan common ports on localhost.
 */
async function discoverVmServiceUrl(deviceId: string): Promise<string | null> {
	// Check cache first
	const cached = vmUrlCache.get(deviceId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.url;
	}
	const cacheAndReturn = (url: string): string => {
		vmUrlCache.set(deviceId, { url, expiresAt: Date.now() + VM_URL_CACHE_TTL });
		return url;
	};

	// Strategy 1: For Android devices, search adb logcat for the observatory URL
	if (!IOS_UDID_REGEX.test(deviceId)) {
		try {
			const { stdout } = await execFile(
				"adb",
				["-s", deviceId, "logcat", "-d", "-s", "flutter", "Observatory", "FlutterJNI"],
				{ timeout: CLI_TIMEOUT, maxBuffer: MAX_BUFFER },
			);
			const wsMatch = stdout.match(/(?:Observatory|Dart VM service).*?(wss?:\/\/\S+)/i);
			if (wsMatch) {
				return cacheAndReturn(normalizeVmServiceUrl(wsMatch[1]));
			}
			// Also look for http observatory URLs and convert to ws
			const httpMatch = stdout.match(
				/(?:Observatory|Dart VM service).*?(https?:\/\/127\.0\.0\.1:\d+\/\S*)/i,
			);
			if (httpMatch) {
				return cacheAndReturn(httpToWs(httpMatch[1]));
			}
		} catch {
			// fall through to port scanning
		}
	}

	// Strategy 2: Scan common ports
	for (const port of VM_SERVICE_PORTS) {
		const url = `ws://127.0.0.1:${port}/ws`;
		try {
			const ws = await connectToVmService(url);
			// Verify it's a Dart VM Service by requesting the version
			const resp = await callVmServiceMethod(ws, "getVersion");
			ws.close();
			if (resp.result && typeof resp.result.major === "number") {
				return cacheAndReturn(url);
			}
		} catch {
			// port not available, try next
		}
	}

	return null;
}

/**
 * Convert an HTTP observatory URL to a WebSocket URL.
 */
function httpToWs(httpUrl: string): string {
	let url = httpUrl.replace(/^http/, "ws");
	if (!url.endsWith("/ws") && !url.endsWith("/ws/")) {
		url = url.replace(/\/?$/, "ws");
	}
	return url;
}

/**
 * Ensure a VM Service URL ends with /ws for proper WebSocket connection.
 */
function normalizeVmServiceUrl(url: string): string {
	if (url.startsWith("http")) {
		return httpToWs(url);
	}
	if (!url.endsWith("/ws") && !url.endsWith("/ws/")) {
		return url.replace(/\/?$/, "/ws");
	}
	return url;
}

// ---------------------------------------------------------------------------
// Flutter device JSON from `flutter devices --machine`
// ---------------------------------------------------------------------------

interface FlutterDeviceJson {
	id: string;
	name: string;
	isSupported: boolean;
	targetPlatform: string;
	emulator: boolean;
	sdk: string;
	capabilities?: {
		hotReload?: boolean;
		hotRestart?: boolean;
		screenshot?: boolean;
		fastStart?: boolean;
		flutterExit?: boolean;
		hardwareRendering?: boolean;
		startPaused?: boolean;
	};
}

// ---------------------------------------------------------------------------
// Widget tree types from Dart VM Service
// ---------------------------------------------------------------------------

interface VmWidgetNode {
	description?: string;
	type?: string;
	creationLocation?: {
		file?: string;
		line?: number;
		column?: number;
	};
	children?: VmWidgetNode[];
	properties?: VmWidgetProperty[];
	renderObject?: {
		description?: string;
		properties?: VmWidgetProperty[];
	};
	hasChildren?: boolean;
	valueId?: string;
}

interface VmWidgetProperty {
	name?: string;
	description?: string;
	value?: unknown;
	type?: string;
	propertyType?: string;
}

// ---------------------------------------------------------------------------
// Helpers for parsing the widget tree
// ---------------------------------------------------------------------------

/**
 * Extract a bounding box from a renderObject's properties.
 * Looks for properties named "size" or "paintBounds" and parses them.
 */
function extractBoundingBox(node: VmWidgetNode): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	let x = 0;
	let y = 0;
	let width = 0;
	let height = 0;

	const renderProps = node.renderObject?.properties;
	if (!renderProps) return { x, y, width, height };

	for (const prop of renderProps) {
		if (!prop.description) continue;

		// Match "Size(width, height)" or similar
		if (prop.name === "size" || prop.name === "paintBounds") {
			const sizeMatch = prop.description.match(/Size\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/);
			if (sizeMatch) {
				width = Math.round(Number(sizeMatch[1]));
				height = Math.round(Number(sizeMatch[2]));
				continue;
			}

			// Match "Rect.fromLTRB(l, t, r, b)" pattern
			const rectMatch = prop.description.match(
				/Rect\.fromLTRB\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/,
			);
			if (rectMatch) {
				const l = Number(rectMatch[1]);
				const t = Number(rectMatch[2]);
				const r = Number(rectMatch[3]);
				const b = Number(rectMatch[4]);
				x = Math.round(l);
				y = Math.round(t);
				width = Math.round(r - l);
				height = Math.round(b - t);
				continue;
			}
		}

		// Match offset for position
		if (prop.name === "offset") {
			const offsetMatch = prop.description.match(
				/Offset\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/,
			);
			if (offsetMatch) {
				x = Math.round(Number(offsetMatch[1]));
				y = Math.round(Number(offsetMatch[2]));
			}
		}
	}

	return { x, y, width, height };
}

/**
 * Extract accessibility/semantics information from widget properties.
 */
function extractAccessibility(node: VmWidgetNode): MobileElement["accessibility"] | undefined {
	const props = node.properties;
	if (!props) return undefined;

	let label: string | undefined;
	let role: string | undefined;
	let hint: string | undefined;
	let value: string | undefined;
	const traits: string[] = [];

	for (const prop of props) {
		const name = prop.name?.toLowerCase() ?? "";
		const desc = prop.description ?? "";

		if (name === "semanticslabel" || name === "label") {
			label = desc || undefined;
		} else if (name === "role" || name === "semanticsrole") {
			role = desc || undefined;
		} else if (name === "hint" || name === "tooltip") {
			hint = desc || undefined;
		} else if (name === "value" || name === "semanticsvalue") {
			value = desc || undefined;
		} else if (name === "enabled" && desc === "false") {
			traits.push("disabled");
		} else if (name === "focusable" && desc === "true") {
			traits.push("focusable");
		} else if (name === "checked" && desc === "true") {
			traits.push("checked");
		} else if (name === "selected" && desc === "true") {
			traits.push("selected");
		}
	}

	if (!label && !role && !hint && !value && traits.length === 0) {
		return undefined;
	}

	return {
		label,
		role,
		hint,
		value,
		traits: traits.length > 0 ? traits : undefined,
	};
}

/**
 * Extract style-like properties from widget properties.
 */
function extractStyleProps(node: VmWidgetNode): Record<string, unknown> | undefined {
	const props = node.properties;
	if (!props || props.length === 0) return undefined;

	const styleNames = new Set([
		"padding",
		"margin",
		"alignment",
		"color",
		"backgroundColor",
		"decoration",
		"textStyle",
		"fontSize",
		"fontWeight",
		"fontFamily",
		"borderRadius",
		"border",
		"constraints",
		"width",
		"height",
		"flex",
		"mainAxisAlignment",
		"crossAxisAlignment",
		"mainAxisSize",
		"textAlign",
		"overflow",
		"opacity",
		"elevation",
		"shape",
	]);

	const result: Record<string, unknown> = {};
	for (const prop of props) {
		if (prop.name && styleNames.has(prop.name) && prop.description) {
			result[prop.name] = prop.description;
		}
	}

	return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract text content from known text-bearing widgets.
 */
function extractTextContent(node: VmWidgetNode): string | undefined {
	const textWidgets = new Set([
		"Text",
		"RichText",
		"SelectableText",
		"EditableText",
		"TextFormField",
		"TextField",
	]);

	const widgetName = node.description ?? "";
	if (!textWidgets.has(widgetName)) return undefined;

	const props = node.properties;
	if (!props) return undefined;

	for (const prop of props) {
		if (prop.name === "data" && typeof prop.description === "string") {
			return prop.description;
		}
	}

	return undefined;
}

/**
 * Detect if a widget is an animation widget and extract animation info.
 */
function detectFlutterAnimations(
	node: VmWidgetNode,
): Array<{ type: string; property: string; status?: string; duration?: number }> | undefined {
	const widgetName = node.description ?? "";

	// Map of animation widget names to their animated properties
	const animationWidgets: Record<string, { type: string; property: string }> = {
		AnimatedContainer: { type: "transition", property: "multiple" },
		AnimatedOpacity: { type: "timing", property: "opacity" },
		AnimatedPadding: { type: "timing", property: "padding" },
		AnimatedAlign: { type: "timing", property: "alignment" },
		AnimatedPositioned: { type: "timing", property: "position" },
		AnimatedDefaultTextStyle: { type: "timing", property: "textStyle" },
		AnimatedPhysicalModel: { type: "timing", property: "elevation" },
		AnimatedCrossFade: { type: "transition", property: "crossFade" },
		AnimatedSwitcher: { type: "transition", property: "child" },
		AnimatedSize: { type: "timing", property: "size" },
		FadeTransition: { type: "timing", property: "opacity" },
		ScaleTransition: { type: "timing", property: "transform.scale" },
		SlideTransition: { type: "timing", property: "transform.translate" },
		RotationTransition: { type: "timing", property: "transform.rotate" },
		SizeTransition: { type: "timing", property: "size" },
		DecoratedBoxTransition: { type: "timing", property: "decoration" },
		AlignTransition: { type: "timing", property: "alignment" },
		PositionedTransition: { type: "timing", property: "position" },
		RelativePositionedTransition: { type: "timing", property: "position" },
		AnimatedBuilder: { type: "unknown", property: "custom" },
		TweenAnimationBuilder: { type: "timing", property: "tween" },
		Hero: { type: "transition", property: "transform" },
	};

	const animInfo = animationWidgets[widgetName];
	if (!animInfo) return undefined;

	// Try to extract duration from properties
	let duration: number | undefined;
	const props = node.properties;
	if (props) {
		for (const prop of props) {
			if (prop.name === "duration" && prop.description) {
				// Parse "0:00:00.300000" format or "300ms"
				const msMatch = prop.description.match(/(\d+)ms/);
				if (msMatch) {
					duration = Number(msMatch[1]);
				} else {
					const timeMatch = prop.description.match(/0:00:(\d+)\.(\d+)/);
					if (timeMatch) {
						duration = Number(timeMatch[1]) * 1000 + Number(timeMatch[2].slice(0, 3));
					}
				}
			}
		}
	}

	return [
		{
			type: animInfo.type,
			property: animInfo.property,
			status: "running",
			duration,
		},
	];
}

/**
 * Collect all render object nodes into a map keyed by valueId.
 */
function collectRenderNodes(node: VmWidgetNode, map: Map<string, VmWidgetNode>): void {
	if (node.valueId) {
		map.set(node.valueId, node);
	}
	if (node.children) {
		for (const child of node.children) {
			collectRenderNodes(child, map);
		}
	}
}

/**
 * Walk the widget tree and enrich nodes that are missing renderObject data
 * by looking up their valueId in the render object tree map.
 */
function enrichWidgetTreeWithRenderData(
	node: VmWidgetNode,
	renderMap: Map<string, VmWidgetNode>,
): void {
	if (node.valueId && !node.renderObject) {
		const renderNode = renderMap.get(node.valueId);
		if (renderNode?.properties) {
			node.renderObject = {
				description: renderNode.description,
				properties: renderNode.properties,
			};
		}
	}
	if (node.children) {
		for (const child of node.children) {
			enrichWidgetTreeWithRenderData(child, renderMap);
		}
	}
}

/**
 * Recursively flatten the widget tree into a list of MobileElement objects.
 */
function flattenWidgetTree(
	node: VmWidgetNode,
	parentPath: string,
	counter: { value: number },
): MobileElement[] {
	const elements: MobileElement[] = [];
	const widgetName = node.description ?? "Unknown";
	const currentPath = parentPath ? `${parentPath}/${widgetName}` : widgetName;

	const id = `flutter-${counter.value}`;
	counter.value += 1;

	const boundingBox = extractBoundingBox(node);

	let componentFile: string | undefined;
	let sourceLocation: { file: string; line: number; column?: number } | undefined;
	if (node.creationLocation) {
		const loc = node.creationLocation;
		componentFile = loc.file ? `${loc.file}${loc.line != null ? `:${loc.line}` : ""}` : undefined;
		if (loc.file && loc.line != null) {
			sourceLocation = {
				file: loc.file,
				line: loc.line,
				column: typeof loc.column === "number" ? loc.column : undefined,
			};
		}
	}

	const animations = detectFlutterAnimations(node);

	const element: MobileElement = {
		id,
		platform: "flutter",
		componentPath: currentPath,
		componentName: widgetName,
		componentFile,
		sourceLocation,
		boundingBox,
		styleProps: extractStyleProps(node),
		accessibility: extractAccessibility(node),
		textContent: extractTextContent(node),
		animations: animations as MobileElement["animations"],
	};

	elements.push(element);

	if (node.children) {
		for (const child of node.children) {
			elements.push(...flattenWidgetTree(child, currentPath, counter));
		}
	}

	return elements;
}

// ---------------------------------------------------------------------------
// Hit-testing: find smallest element whose bounding box contains (x, y)
// ---------------------------------------------------------------------------

function hitTestElement(elements: MobileElement[], x: number, y: number): MobileElement | null {
	let best: MobileElement | null = null;
	let bestArea = Number.POSITIVE_INFINITY;

	for (const el of elements) {
		const bb = el.boundingBox;
		if (bb.width <= 0 || bb.height <= 0) continue;

		const inBounds = x >= bb.x && x <= bb.x + bb.width && y >= bb.y && y <= bb.y + bb.height;

		if (inBounds) {
			const area = bb.width * bb.height;
			if (area < bestArea) {
				bestArea = area;
				best = el;
			}
		}
	}

	return best;
}

// ---------------------------------------------------------------------------
// Helper: detect iOS simulator vs Android device
// ---------------------------------------------------------------------------

function isIosSimulatorId(deviceId: string): boolean {
	return IOS_UDID_REGEX.test(deviceId);
}

// ---------------------------------------------------------------------------
// FlutterBridge
// ---------------------------------------------------------------------------

export class FlutterBridge implements IPlatformBridge {
	readonly platform = "flutter" as const;

	/**
	 * Check if the Flutter CLI is available and whether any Dart VM Service
	 * endpoints are discoverable.
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await execFile("flutter", ["--version"], {
				timeout: CLI_TIMEOUT,
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Discover connected devices via `flutter devices --machine`.
	 * Parses the JSON output and enriches each entry with screen dimensions
	 * obtained through platform-specific commands.
	 */
	async listDevices(): Promise<DeviceInfo[]> {
		try {
			const { stdout } = await execFile("flutter", ["devices", "--machine"], {
				timeout: CLI_TIMEOUT,
				maxBuffer: MAX_BUFFER,
			});

			const raw = JSON.parse(stdout) as FlutterDeviceJson[];
			const devices: DeviceInfo[] = [];

			for (const dev of raw) {
				const isEmulator = dev.emulator;
				const isIos = dev.targetPlatform.includes("ios");
				const isAndroid = dev.targetPlatform.includes("android");

				let osVersion = dev.sdk || "unknown";
				let screenWidth = 0;
				let screenHeight = 0;

				if (isAndroid && !isIos) {
					const dims = await this.getAndroidScreenSize(dev.id);
					screenWidth = dims.width;
					screenHeight = dims.height;

					const ver = await this.getAndroidOsVersion(dev.id);
					if (ver !== "unknown") {
						osVersion = `Android ${ver}`;
					}
				} else if (isIos) {
					const dims = this.guessIosScreenSize(dev.name);
					screenWidth = dims.width;
					screenHeight = dims.height;
				}

				devices.push({
					id: dev.id,
					name: dev.name,
					platform: "flutter",
					isEmulator,
					osVersion,
					screenWidth,
					screenHeight,
				});
			}

			return devices;
		} catch {
			return [];
		}
	}

	/**
	 * Capture a screenshot as a PNG buffer.
	 * - Android devices: `adb exec-out screencap -p`
	 * - iOS simulators: `xcrun simctl io <id> screenshot --type=png /dev/stdout`
	 */
	async captureScreen(deviceId: string): Promise<Buffer> {
		if (isIosSimulatorId(deviceId)) {
			return this.captureIosSimulatorScreen(deviceId);
		}
		return this.captureAndroidScreen(deviceId);
	}

	/**
	 * Retrieve the widget tree from the Dart VM Service and flatten it
	 * into a list of MobileElement objects.
	 */
	async getElementTree(deviceId: string): Promise<MobileElement[]> {
		let ws: WebSocket | null = null;

		try {
			const vmUrl = await discoverVmServiceUrl(deviceId);
			if (!vmUrl) return [];

			ws = await connectToVmService(vmUrl);

			// First, get the list of isolates to find the Flutter isolate
			const vmResp = await callVmServiceMethod(ws, "getVM");
			if (vmResp.error || !vmResp.result) return [];

			const isolates = vmResp.result.isolates as Array<{ id: string; name: string }> | undefined;
			if (!isolates || isolates.length === 0) return [];

			// Pick the main isolate (prefer one named "main")
			const mainIsolate = isolates.find((iso) => iso.name === "main") ?? isolates[0];

			// Call the Flutter inspector extension to get the widget tree
			const treeResp = await callVmServiceMethod(
				ws,
				"ext.flutter.inspector.getRootWidgetSummaryTree",
				{
					isolateId: mainIsolate.id,
					groupName: "agentation-inspector",
				},
			);

			if (treeResp.error || !treeResp.result) return [];

			const rootNode = treeResp.result as unknown as VmWidgetNode;
			if (!rootNode) return [];

			// Optionally enrich with render object tree for better layout data
			try {
				const renderResp = await callVmServiceMethod(
					ws,
					"ext.flutter.inspector.getRenderObjectTree",
					{
						isolateId: mainIsolate.id,
						groupName: "agentation-inspector",
					},
				);
				if (!renderResp.error && renderResp.result) {
					const renderRoot = renderResp.result as unknown as VmWidgetNode;
					if (renderRoot) {
						const renderMap = new Map<string, VmWidgetNode>();
						collectRenderNodes(renderRoot, renderMap);
						enrichWidgetTreeWithRenderData(rootNode, renderMap);
					}
				}
			} catch {
				// Non-fatal: proceed with widget tree as-is
			}

			const counter = { value: 0 };
			return flattenWidgetTree(rootNode, "", counter);
		} catch {
			return [];
		} finally {
			if (ws) {
				try {
					ws.close();
				} catch {
					// ignore close errors
				}
			}
		}
	}

	/**
	 * Inspect the element at screen coordinates (x, y).
	 * Gets the full element tree and performs a hit-test to find
	 * the smallest bounding box containing the point.
	 */
	async inspectElement(deviceId: string, x: number, y: number): Promise<MobileElement | null> {
		const elements = await this.getElementTree(deviceId);
		return hitTestElement(elements, x, y);
	}

	async pauseAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		let ws: WebSocket | null = null;
		try {
			const vmUrl = await discoverVmServiceUrl(deviceId);
			if (!vmUrl) {
				return {
					success: false,
					message: "Could not discover Flutter VM Service",
				};
			}

			ws = await connectToVmService(vmUrl);
			const vmResp = await callVmServiceMethod(ws, "getVM");
			if (vmResp.error || !vmResp.result) {
				return { success: false, message: "Failed to connect to VM" };
			}

			const isolates = vmResp.result.isolates as Array<{ id: string; name: string }> | undefined;
			const mainIsolate = isolates?.find((iso) => iso.name === "main") ?? isolates?.[0];
			if (!mainIsolate) {
				return { success: false, message: "No Flutter isolate found" };
			}

			// Set timeDilation to a very high value to effectively freeze animations
			const resp = await callVmServiceMethod(ws, "ext.flutter.timeDilation", {
				isolateId: mainIsolate.id,
				timeDilation: 100.0,
			});

			if (resp.error) {
				return {
					success: false,
					message: `Failed to set timeDilation: ${JSON.stringify(resp.error)}`,
				};
			}

			return {
				success: true,
				message: "Animations paused (timeDilation set to 100x)",
			};
		} catch (err) {
			return { success: false, message: `${err}` };
		} finally {
			if (ws) {
				try {
					ws.close();
				} catch {
					// ignore
				}
			}
		}
	}

	async resumeAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		let ws: WebSocket | null = null;
		try {
			const vmUrl = await discoverVmServiceUrl(deviceId);
			if (!vmUrl) {
				return {
					success: false,
					message: "Could not discover Flutter VM Service",
				};
			}

			ws = await connectToVmService(vmUrl);
			const vmResp = await callVmServiceMethod(ws, "getVM");
			if (vmResp.error || !vmResp.result) {
				return { success: false, message: "Failed to connect to VM" };
			}

			const isolates = vmResp.result.isolates as Array<{ id: string; name: string }> | undefined;
			const mainIsolate = isolates?.find((iso) => iso.name === "main") ?? isolates?.[0];
			if (!mainIsolate) {
				return { success: false, message: "No Flutter isolate found" };
			}

			// Restore normal timeDilation
			const resp = await callVmServiceMethod(ws, "ext.flutter.timeDilation", {
				isolateId: mainIsolate.id,
				timeDilation: 1.0,
			});

			if (resp.error) {
				return {
					success: false,
					message: `Failed to restore timeDilation: ${JSON.stringify(resp.error)}`,
				};
			}

			return {
				success: true,
				message: "Animations restored to normal speed",
			};
		} catch (err) {
			return { success: false, message: `${err}` };
		} finally {
			if (ws) {
				try {
					ws.close();
				} catch {
					// ignore
				}
			}
		}
	}

	async sendTap(deviceId: string, x: number, y: number): Promise<void> {
		if (isIosSimulatorId(deviceId)) {
			await execFile(
				"xcrun",
				["simctl", "io", deviceId, "input", "tap", String(Math.round(x)), String(Math.round(y))],
				{ timeout: CLI_TIMEOUT },
			);
		} else {
			await execFile(
				"adb",
				["-s", deviceId, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))],
				{ timeout: CLI_TIMEOUT },
			);
		}
	}

	async sendSwipe(
		deviceId: string,
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		durationMs = 300,
	): Promise<void> {
		if (isIosSimulatorId(deviceId)) {
			await execFile(
				"xcrun",
				[
					"simctl",
					"io",
					deviceId,
					"input",
					"swipe",
					String(Math.round(fromX)),
					String(Math.round(fromY)),
					String(Math.round(toX)),
					String(Math.round(toY)),
				],
				{ timeout: CLI_TIMEOUT },
			);
		} else {
			await execFile(
				"adb",
				[
					"-s",
					deviceId,
					"shell",
					"input",
					"swipe",
					String(Math.round(fromX)),
					String(Math.round(fromY)),
					String(Math.round(toX)),
					String(Math.round(toY)),
					String(durationMs),
				],
				{ timeout: CLI_TIMEOUT },
			);
		}
	}

	async sendText(deviceId: string, text: string): Promise<void> {
		if (isIosSimulatorId(deviceId)) {
			await new Promise<void>((resolve, reject) => {
				const child = execFileCb(
					"xcrun",
					["simctl", "pbcopy", deviceId],
					{ timeout: CLI_TIMEOUT },
					(err) => (err ? reject(err) : resolve()),
				);
				child.stdin?.write(text);
				child.stdin?.end();
			});
			await execFile("xcrun", ["simctl", "io", deviceId, "sendkey", "command-v"], {
				timeout: CLI_TIMEOUT,
			});
		} else {
			const escaped = text.replace(/([\\'"$ `!&|;(){}[\]<>?*#~])/g, "\\$1").replace(/ /g, "%s");
			await execFile("adb", ["-s", deviceId, "shell", "input", "text", escaped], {
				timeout: CLI_TIMEOUT,
			});
		}
	}

	async sendKeyEvent(deviceId: string, keyCode: string): Promise<void> {
		if (isIosSimulatorId(deviceId)) {
			await execFile("xcrun", ["simctl", "io", deviceId, "sendkey", keyCode], {
				timeout: CLI_TIMEOUT,
			});
		} else {
			await execFile("adb", ["-s", deviceId, "shell", "input", "keyevent", keyCode], {
				timeout: CLI_TIMEOUT,
			});
		}
	}

	// -------------------------------------------------------------------
	// Private: Android helpers
	// -------------------------------------------------------------------

	private async captureAndroidScreen(deviceId: string): Promise<Buffer> {
		const { stdout } = await execFile("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
			timeout: CLI_TIMEOUT,
			maxBuffer: MAX_BUFFER,
			encoding: "buffer" as unknown as string,
		});

		const buf = stdout as unknown as Buffer;
		if (!buf || buf.length === 0) {
			throw new Error(`Screenshot returned empty buffer for device ${deviceId}`);
		}

		return buf;
	}

	private async captureIosSimulatorScreen(deviceId: string): Promise<Buffer> {
		const { stdout } = await execFile(
			"xcrun",
			["simctl", "io", deviceId, "screenshot", "--type=png", "/dev/stdout"],
			{
				timeout: CLI_TIMEOUT,
				maxBuffer: MAX_BUFFER,
				encoding: "buffer" as unknown as string,
			},
		);

		return stdout as unknown as Buffer;
	}

	private async getAndroidScreenSize(deviceId: string): Promise<{ width: number; height: number }> {
		try {
			const { stdout } = await execFile("adb", ["-s", deviceId, "shell", "wm", "size"], {
				timeout: CLI_TIMEOUT,
			});
			const match = stdout.match(/(\d+)x(\d+)/);
			if (match) {
				return {
					width: Number(match[1]),
					height: Number(match[2]),
				};
			}
		} catch {
			// fall through
		}
		return { width: 0, height: 0 };
	}

	private async getAndroidOsVersion(deviceId: string): Promise<string> {
		try {
			const { stdout } = await execFile(
				"adb",
				["-s", deviceId, "shell", "getprop", "ro.build.version.release"],
				{ timeout: CLI_TIMEOUT },
			);
			return stdout.trim() || "unknown";
		} catch {
			return "unknown";
		}
	}

	/**
	 * Best-effort screen size guess for iOS simulators based on name.
	 */
	private guessIosScreenSize(deviceName: string): { width: number; height: number } {
		const knownSizes: Record<string, { width: number; height: number }> = {
			"iPhone 16 Pro Max": { width: 440, height: 956 },
			"iPhone 16 Pro": { width: 402, height: 874 },
			"iPhone 16 Plus": { width: 430, height: 932 },
			"iPhone 16": { width: 393, height: 852 },
			"iPhone 15 Pro Max": { width: 430, height: 932 },
			"iPhone 15 Pro": { width: 393, height: 852 },
			"iPhone 15 Plus": { width: 430, height: 932 },
			"iPhone 15": { width: 393, height: 852 },
			"iPhone 14 Pro Max": { width: 430, height: 932 },
			"iPhone 14 Pro": { width: 393, height: 852 },
			"iPhone 14 Plus": { width: 428, height: 926 },
			"iPhone 14": { width: 390, height: 844 },
			"iPhone SE": { width: 375, height: 667 },
			"iPad Pro (12.9-inch)": { width: 1024, height: 1366 },
			"iPad Pro (11-inch)": { width: 834, height: 1194 },
			"iPad Air": { width: 820, height: 1180 },
			"iPad mini": { width: 744, height: 1133 },
		};

		for (const [key, size] of Object.entries(knownSizes)) {
			if (deviceName.includes(key)) return size;
		}

		return { width: 390, height: 844 };
	}
}
