import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
	type DeviceInfo,
	type IPlatformBridge,
	accessibilityNodesToElements,
	hitTestElement,
	isIosSimulatorId,
	lookupIosScreenSize,
	mergeElements,
	parseAccessibilityOutput,
	parseUiAutomatorXml,
	parseWmSize,
} from "@agentation-mobile/bridge-core";
import type { MobileElement } from "@agentation-mobile/core";
import WebSocket from "ws";

const execFile = promisify(execFileCb);

const METRO_HOST = "localhost";
const METRO_PORT = 8081;
const METRO_STATUS_URL = `http://${METRO_HOST}:${METRO_PORT}/status`;
const METRO_JSON_URL = `http://${METRO_HOST}:${METRO_PORT}/json`;

const ADB_TIMEOUT_MS = 10_000;
const METRO_TIMEOUT_MS = 5_000;
const CDP_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isMetroRunning(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), METRO_TIMEOUT_MS);
		const res = await fetch(METRO_STATUS_URL, { signal: controller.signal });
		clearTimeout(timer);
		return res.ok;
	} catch {
		return false;
	}
}

async function isAdbAvailable(): Promise<boolean> {
	try {
		await execFile("adb", ["version"], { timeout: ADB_TIMEOUT_MS });
		return true;
	} catch {
		return false;
	}
}

async function isXcrunAvailable(): Promise<boolean> {
	try {
		await execFile("xcrun", ["simctl", "help"], { timeout: ADB_TIMEOUT_MS });
		return true;
	} catch {
		return false;
	}
}

interface AdbDevice {
	id: string;
	name: string;
	isEmulator: boolean;
	model: string;
}

async function listAdbDevices(): Promise<AdbDevice[]> {
	try {
		const { stdout } = await execFile("adb", ["devices", "-l"], {
			timeout: ADB_TIMEOUT_MS,
		});

		const lines = stdout.split("\n").slice(1); // skip header
		const devices: AdbDevice[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("*")) continue;

			const parts = trimmed.split(/\s+/);
			const id = parts[0];
			const status = parts[1];
			if (!id || status !== "device") continue;

			const modelMatch = trimmed.match(/model:(\S+)/);
			const model = modelMatch?.[1] ?? "Unknown";
			const isEmulator = id.startsWith("emulator-") || id.includes("localhost");

			devices.push({
				id,
				name: model.replace(/_/g, " "),
				isEmulator,
				model,
			});
		}

		return devices;
	} catch {
		return [];
	}
}

async function getAdbScreenSize(deviceId: string): Promise<{ width: number; height: number }> {
	try {
		const { stdout } = await execFile("adb", ["-s", deviceId, "shell", "wm", "size"], {
			timeout: ADB_TIMEOUT_MS,
		});
		return parseWmSize(stdout);
	} catch {
		return { width: 0, height: 0 };
	}
}

async function getAdbOsVersion(deviceId: string): Promise<string> {
	try {
		const { stdout } = await execFile(
			"adb",
			["-s", deviceId, "shell", "getprop", "ro.build.version.release"],
			{ timeout: ADB_TIMEOUT_MS },
		);
		return stdout.trim() || "unknown";
	} catch {
		return "unknown";
	}
}

// ---------------------------------------------------------------------------
// iOS Simulator helpers
// ---------------------------------------------------------------------------

/**
 * iOS simulator UDIDs are 36-character UUID strings with dashes,
 * e.g. "A1B2C3D4-E5F6-7890-ABCD-EF1234567890".
 * Android device IDs are like "emulator-5554" or "192.168.x.x:5555".
 */
interface SimctlDevice {
	udid: string;
	name: string;
	state: string;
	isAvailable?: boolean;
	deviceTypeIdentifier?: string;
}

interface SimctlRuntime {
	[runtimeId: string]: SimctlDevice[];
}

interface SimctlListOutput {
	devices: SimctlRuntime;
}

function extractIosVersion(runtimeId: string): string {
	// Runtime IDs look like "com.apple.CoreSimulator.SimRuntime.iOS-17-4"
	const match = runtimeId.match(/iOS[- ](\d+)[- .](\d+)/i);
	if (match) return `iOS ${match[1]}.${match[2]}`;
	// Try a simpler match for "iOS-17-4" or similar
	const simple = runtimeId.match(/(\d+)[.-](\d+)$/);
	if (simple) return `iOS ${simple[1]}.${simple[2]}`;
	return "iOS unknown";
}

interface IosSimDevice {
	id: string;
	name: string;
	osVersion: string;
	screenWidth: number;
	screenHeight: number;
}

async function listIosSimulators(): Promise<IosSimDevice[]> {
	try {
		const { stdout } = await execFile("xcrun", ["simctl", "list", "devices", "-j"], {
			timeout: ADB_TIMEOUT_MS,
		});

		const parsed = JSON.parse(stdout) as SimctlListOutput;
		const devices: IosSimDevice[] = [];

		for (const [runtimeId, runtimeDevices] of Object.entries(parsed.devices)) {
			for (const sim of runtimeDevices) {
				if (sim.state !== "Booted") continue;
				// Skip unavailable simulators (isAvailable can be false or missing)
				if (sim.isAvailable === false) continue;

				const screen = lookupIosScreenSize(sim.name);
				devices.push({
					id: sim.udid,
					name: sim.name,
					osVersion: extractIosVersion(runtimeId),
					screenWidth: screen.width,
					screenHeight: screen.height,
				});
			}
		}

		return devices;
	} catch {
		return [];
	}
}

async function captureIosSimulatorScreen(deviceId: string): Promise<Buffer> {
	const { stdout } = await execFile(
		"xcrun",
		["simctl", "io", deviceId, "screenshot", "--type=png", "/dev/stdout"],
		{
			timeout: ADB_TIMEOUT_MS,
			maxBuffer: 50 * 1024 * 1024,
			encoding: "buffer" as unknown as string,
		},
	);
	return stdout as unknown as Buffer;
}

// ---------------------------------------------------------------------------
// CDP / React DevTools helpers
// ---------------------------------------------------------------------------

interface CdpTarget {
	webSocketDebuggerUrl?: string;
	title?: string;
	id?: string;
}

async function getCdpTargets(): Promise<CdpTarget[]> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), METRO_TIMEOUT_MS);
		const res = await fetch(METRO_JSON_URL, { signal: controller.signal });
		clearTimeout(timer);
		if (!res.ok) return [];
		return (await res.json()) as CdpTarget[];
	} catch {
		return [];
	}
}

function pickCdpTarget(targets: CdpTarget[]): CdpTarget | null {
	// Prefer a target whose title references React Native or Hermes
	const preferred = targets.find(
		(t) =>
			t.webSocketDebuggerUrl &&
			(t.title?.includes("React") || t.title?.includes("Hermes") || t.title?.includes("Metro")),
	);
	if (preferred) return preferred;
	// Fall back to first target with a ws URL
	return targets.find((t) => t.webSocketDebuggerUrl) ?? null;
}

interface CdpMessage {
	id: number;
	result?: {
		result?: {
			type?: string;
			value?: unknown;
			subtype?: string;
			description?: string;
		};
		exceptionDetails?: unknown;
	};
	error?: { message: string };
}

function sendCdpCommand(
	ws: WebSocket,
	method: string,
	params: Record<string, unknown>,
	id: number,
): Promise<CdpMessage> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.off("message", handler);
			reject(new Error(`CDP command ${method} timed out`));
		}, CDP_TIMEOUT_MS);

		const handler = (data: WebSocket.Data) => {
			try {
				const msg = JSON.parse(data.toString()) as CdpMessage;
				if (msg.id === id) {
					clearTimeout(timer);
					ws.off("message", handler);
					resolve(msg);
				}
			} catch {
				// ignore non-JSON or mismatched messages
			}
		};

		ws.on("message", handler);
		ws.send(JSON.stringify({ id, method, params }));
	});
}

function connectWebSocket(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timer = setTimeout(() => {
			ws.terminate();
			reject(new Error("WebSocket connection timed out"));
		}, CDP_TIMEOUT_MS);

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

// ---------------------------------------------------------------------------
// Fiber tree walking script — injected via Runtime.evaluate
// ---------------------------------------------------------------------------

/**
 * This script is evaluated inside the React Native JS context via CDP.
 * It walks the React fiber tree exposed by __REACT_DEVTOOLS_GLOBAL_HOOK__
 * and returns a serialisable array of element descriptors.
 */
const FIBER_WALK_SCRIPT = `
(function () {
	var hook = typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined"
		? __REACT_DEVTOOLS_GLOBAL_HOOK__
		: null;
	if (!hook) return JSON.stringify({ error: "no_hook" });

	var renderers = hook.renderers;
	if (!renderers || renderers.size === 0) return JSON.stringify({ error: "no_renderers" });

	var elements = [];
	var idCounter = 0;
	var activeRoute = null;

	// Extract the focused route from React Navigation's state tree
	function getFocusedRoute(state) {
		if (!state || !state.routes) return null;
		var idx = typeof state.index === "number" ? state.index : state.routes.length - 1;
		var focused = state.routes[idx];
		if (!focused) return null;
		// Recurse into nested navigators
		if (focused.state) return getFocusedRoute(focused.state) || focused.name;
		return focused.name;
	}

	function getComponentName(fiber) {
		if (!fiber || !fiber.type) return null;
		if (typeof fiber.type === "string") return fiber.type;
		if (fiber.type.displayName) return fiber.type.displayName;
		if (fiber.type.name) return fiber.type.name;
		if (fiber.type.render && fiber.type.render.displayName)
			return fiber.type.render.displayName;
		if (fiber.type.render && fiber.type.render.name)
			return fiber.type.render.name;
		return null;
	}

	function extractStyle(props) {
		if (!props || !props.style) return undefined;
		var s = props.style;
		if (Array.isArray(s)) {
			var merged = {};
			for (var i = 0; i < s.length; i++) {
				if (s[i] && typeof s[i] === "object") {
					var keys = Object.keys(s[i]);
					for (var k = 0; k < keys.length; k++) {
						merged[keys[k]] = s[i][keys[k]];
					}
				}
			}
			return merged;
		}
		if (typeof s === "object") return s;
		return undefined;
	}

	function findHostFiber(fiber) {
		if (!fiber) return null;
		// tag 5 = HostComponent in React reconciler
		if (fiber.tag === 5) return fiber;
		var child = fiber.child;
		while (child) {
			if (child.tag === 5) return child;
			var found = findHostFiber(child);
			if (found) return found;
			child = child.sibling;
		}
		return null;
	}

	function extractBoundingBox(fiber) {
		// Only measure host fibers (tag 5 = HostComponent) directly.
		// Non-host fibers (function/class components) don't own a native view,
		// so walking down to find a child host would return the wrong bounds
		// (e.g. a full-screen wrapper). Leave them as zeros so hit-testing
		// skips wrappers and finds the actual native view under the cursor.
		if (fiber.tag !== 5) {
			return { x: 0, y: 0, width: 0, height: 0 };
		}

		// Strategy 1: Use Fabric's native measurement API (RN 0.84+)
		try {
			var mgr = typeof nativeFabricUIManager !== "undefined" ? nativeFabricUIManager : null;
			if (mgr && typeof mgr.getBoundingClientRect === "function") {
				if (fiber.stateNode && fiber.stateNode.node) {
					var rect = mgr.getBoundingClientRect(fiber.stateNode.node, true);
					if (rect) {
						// Handle both array [x,y,w,h] and object {x,y,width,height} formats
						if (Array.isArray(rect) && rect.length >= 4) {
							var w = rect[2], h = rect[3];
							if (w > 0 || h > 0) {
								return { x: Math.round(rect[0]), y: Math.round(rect[1]), width: Math.round(w), height: Math.round(h) };
							}
						} else if (typeof rect === "object" && rect.width !== undefined) {
							if (rect.width > 0 || rect.height > 0) {
								return { x: Math.round(rect.x || 0), y: Math.round(rect.y || 0), width: Math.round(rect.width), height: Math.round(rect.height) };
							}
						}
					}
				}
			}
		} catch (e) {
			// Fall through to style-based extraction
		}

		// Strategy 2: Fall back to inline style reading (Paper arch or absolute-position elements)
		var props = fiber.memoizedProps || {};
		var style = extractStyle(props);
		if (style) {
			return {
				x: typeof style.left === "number" ? style.left : 0,
				y: typeof style.top === "number" ? style.top : 0,
				width: typeof style.width === "number" ? style.width : 0,
				height: typeof style.height === "number" ? style.height : 0,
			};
		}
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	function getTextContent(fiber) {
		if (typeof fiber.memoizedProps === "string") return fiber.memoizedProps;
		if (fiber.memoizedProps && typeof fiber.memoizedProps.children === "string")
			return fiber.memoizedProps.children;
		var child = fiber.child;
		while (child) {
			if (typeof child.memoizedProps === "string") return child.memoizedProps;
			if (child.memoizedProps && typeof child.memoizedProps.children === "string")
				return child.memoizedProps.children;
			child = child.sibling;
		}
		return undefined;
	}

	function buildPath(fiber, parts) {
		parts = parts || [];
		if (fiber.return) {
			var parentName = getComponentName(fiber.return);
			if (parentName) parts.unshift(parentName);
			buildPath(fiber.return, parts);
		}
		return parts;
	}

	function detectAnimations(fiber) {
		var anims = [];
		var props = fiber.memoizedProps || {};
		var style = extractStyle(props);
		if (!style) return anims;

		var animProps = ["opacity", "transform", "backgroundColor", "width", "height",
			"marginTop", "marginBottom", "marginLeft", "marginRight",
			"paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
			"top", "left", "right", "bottom", "fontSize", "borderRadius",
			"scaleX", "scaleY", "translateX", "translateY", "rotate"];

		for (var i = 0; i < animProps.length; i++) {
			var prop = animProps[i];
			var val = style[prop];
			if (val && typeof val === "object" && val._animation !== undefined) {
				var animType = "unknown";
				var anim = val._animation;
				if (anim) {
					if (anim._useNativeDriver !== undefined) {
						if (anim._toValue !== undefined) animType = "timing";
						if (anim._tension !== undefined) animType = "spring";
						if (anim._deceleration !== undefined) animType = "decay";
					}
				}
				var status = "completed";
				if (val._animation && val._animation.__active) status = "running";
				else if (val._listeners && Object.keys(val._listeners).length > 0) status = "running";
				anims.push({
					type: animType,
					property: prop,
					status: status,
					duration: anim && anim._duration ? anim._duration : undefined,
				});
			}
		}

		// Check for transform array with animated values
		if (Array.isArray(style.transform)) {
			for (var t = 0; t < style.transform.length; t++) {
				var transformEntry = style.transform[t];
				if (transformEntry && typeof transformEntry === "object") {
					var tKeys = Object.keys(transformEntry);
					for (var k = 0; k < tKeys.length; k++) {
						var tVal = transformEntry[tKeys[k]];
						if (tVal && typeof tVal === "object" && tVal._animation !== undefined) {
							anims.push({
								type: "unknown",
								property: "transform." + tKeys[k],
								status: tVal._animation && tVal._animation.__active ? "running" : "completed",
							});
						}
					}
				}
			}
		}

		return anims.length > 0 ? anims : undefined;
	}

	function walkFiber(fiber, depth) {
		if (!fiber || depth > 200) return;

		var name = getComponentName(fiber);

		// Skip frozen screens — React Navigation uses Freeze/DelayedFreeze to hide
		// inactive screens in NativeStack. When freeze=true, the screen is off-screen.
		if ((name === "Freeze" || name === "DelayedFreeze") && fiber.memoizedProps && fiber.memoizedProps.freeze === true) {
			return;
		}

		if (name) {
			// Detect active route from SceneView — only use it if its navigation is focused
			if (name === "SceneView" && fiber.memoizedProps) {
				var sv = fiber.memoizedProps;
				if (sv.route && sv.route.name && sv.navigation && typeof sv.navigation.isFocused === "function") {
					if (sv.navigation.isFocused()) {
						activeRoute = sv.route.name;
					}
				}
			}
			// Fallback: Route(name) pattern (only if no focused SceneView found yet)
			if (!activeRoute) {
				var routeMatch = name.match(/^Route\((.+)\)$/);
				if (routeMatch) {
					activeRoute = routeMatch[1];
				}
			}

			var props = fiber.memoizedProps || {};
			var source = fiber._debugSource;
			var pathParts = buildPath(fiber, [name]);
			var animations = detectAnimations(fiber);

			elements.push({
				id: "rn-" + (idCounter++),
				componentName: name,
				componentPath: pathParts.join("/"),
				componentFile: source
					? source.fileName + ":" + source.lineNumber
					: undefined,
				boundingBox: extractBoundingBox(fiber),
				styleProps: extractStyle(props),
				textContent: getTextContent(fiber),
				animations: animations,
				accessibility: {
					label: props.accessibilityLabel || props["aria-label"] || undefined,
					role: props.accessibilityRole || props.role || undefined,
					hint: props.accessibilityHint || undefined,
					value:
						props.accessibilityValue && props.accessibilityValue.text
							? props.accessibilityValue.text
							: undefined,
					traits: props.accessibilityTraits
						? [].concat(props.accessibilityTraits)
						: undefined,
				},
			});
		}

		var child = fiber.child;
		while (child) {
			walkFiber(child, depth + 1);
			child = child.sibling;
		}
	}

	renderers.forEach(function (renderer) {
		var roots = hook._fiberRoots;
		if (roots) {
			roots.forEach(function (root) {
				if (root && root.current) {
					walkFiber(root.current, 0);
				}
			});
		}
	});

	if (elements.length === 0) {
		renderers.forEach(function (renderer, rendererId) {
			var roots = hook.getFiberRoots ? hook.getFiberRoots(rendererId) : null;
			if (roots) {
				roots.forEach(function (root) {
					if (root && root.current) {
						walkFiber(root.current, 0);
					}
				});
			}
		});
	}

	// Compute actual viewport extent from element bounding boxes
	var maxR = 0, maxB = 0;
	for (var vi = 0; vi < elements.length; vi++) {
		var vbb = elements[vi].boundingBox;
		if (vbb) {
			var r = vbb.x + vbb.width;
			var b = vbb.y + vbb.height;
			if (r > maxR) maxR = r;
			if (b > maxB) maxB = b;
		}
	}

	return JSON.stringify({ elements: elements, viewportWidth: maxR, viewportHeight: maxB, activeRoute: activeRoute });
})()
`;

// ---------------------------------------------------------------------------
// UIAutomator fallback
// ---------------------------------------------------------------------------

async function getUiAutomatorTree(deviceId: string): Promise<MobileElement[]> {
	try {
		await execFile(
			"adb",
			["-s", deviceId, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"],
			{ timeout: ADB_TIMEOUT_MS },
		);

		const { stdout } = await execFile(
			"adb",
			["-s", deviceId, "shell", "cat", "/sdcard/window_dump.xml"],
			{ timeout: ADB_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
		);

		return parseUiAutomatorXml(stdout, "react-native");
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// ReactNativeBridge
// ---------------------------------------------------------------------------

export class ReactNativeBridge implements IPlatformBridge {
	readonly platform = "react-native" as const;
	private lastActiveRoute: string | null = null;

	async isAvailable(): Promise<boolean> {
		const [metro, adb, xcrun] = await Promise.all([
			isMetroRunning(),
			isAdbAvailable(),
			isXcrunAvailable(),
		]);
		return metro || adb || xcrun;
	}

	async listDevices(): Promise<DeviceInfo[]> {
		const [adbDevices, iosSimDevices, metroUp] = await Promise.all([
			listAdbDevices(),
			listIosSimulators(),
			isMetroRunning(),
		]);

		const devices: DeviceInfo[] = [];

		// --- Android devices (via ADB) ---
		const enriched = await Promise.all(
			adbDevices.map(async (dev) => {
				const [screen, osVersion] = await Promise.all([
					getAdbScreenSize(dev.id),
					getAdbOsVersion(dev.id),
				]);
				return { ...dev, screen, osVersion };
			}),
		);

		for (const dev of enriched) {
			devices.push({
				id: dev.id,
				name: dev.name,
				platform: "react-native",
				isEmulator: dev.isEmulator,
				osVersion: `Android ${dev.osVersion}`,
				screenWidth: dev.screen.width,
				screenHeight: dev.screen.height,
			});
		}

		// --- iOS simulators (via xcrun simctl) ---
		for (const sim of iosSimDevices) {
			devices.push({
				id: sim.id,
				name: sim.name,
				platform: "react-native",
				isEmulator: true,
				osVersion: sim.osVersion,
				screenWidth: sim.screenWidth,
				screenHeight: sim.screenHeight,
			});
		}

		// If Metro is running but no devices found at all, report a virtual Metro device
		if (metroUp && devices.length === 0) {
			devices.push({
				id: `metro-${METRO_HOST}:${METRO_PORT}`,
				name: "Metro Bundler (no device attached)",
				platform: "react-native",
				isEmulator: false,
				osVersion: "unknown",
				screenWidth: 0,
				screenHeight: 0,
			});
		}

		return devices;
	}

	async captureScreen(deviceId: string): Promise<Buffer> {
		if (deviceId.startsWith("metro-")) {
			throw new Error(
				"Cannot capture screen from Metro-only device. Connect an emulator, simulator, or device.",
			);
		}

		// iOS simulator — use xcrun simctl
		if (isIosSimulatorId(deviceId)) {
			try {
				return await captureIosSimulatorScreen(deviceId);
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown screencap error";
				throw new Error(`Failed to capture screen for iOS simulator ${deviceId}: ${message}`);
			}
		}

		// Android device — use ADB
		try {
			const { stdout } = await execFile("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
				timeout: ADB_TIMEOUT_MS,
				maxBuffer: 50 * 1024 * 1024,
				encoding: "buffer" as unknown as string,
			});
			return stdout as unknown as Buffer;
		} catch (err) {
			const message = err instanceof Error ? err.message : "Unknown screencap error";
			throw new Error(`Failed to capture screen for device ${deviceId}: ${message}`);
		}
	}

	async getScreenId(_deviceId: string): Promise<string | null> {
		return this.lastActiveRoute;
	}

	async getElementTree(deviceId: string): Promise<MobileElement[]> {
		// Get fiber tree via CDP (has component names/files but bounding boxes may be zeros)
		const cdpResult = await this.getElementTreeViaCdp();
		this.lastActiveRoute = cdpResult.activeRoute;
		let cdpElements = cdpResult.elements;

		// Filter out elements from non-active routes (React Navigation keeps frozen
		// screens in the fiber tree). Keep root elements and active route elements.
		if (cdpResult.activeRoute) {
			const activeRouteTag = `Route(${cdpResult.activeRoute})`;
			cdpElements = cdpElements.filter((el) => {
				const path = el.componentPath;
				// Keep elements with no route in their path (root layout, shared UI)
				if (!path.includes("Route(")) return true;
				// Keep if the LAST Route(...) in the path matches the active route
				const routeMatches = path.match(/Route\(([^)]+)\)/g);
				if (!routeMatches) return true;
				const lastRoute = routeMatches[routeMatches.length - 1];
				return lastRoute === activeRouteTag;
			});
		}

		// Note: getBoundingClientRect (Fabric) already returns screen-absolute
		// coordinates in logical points. No normalization/scaling is needed —
		// viewportWidth/Height only represent the content extent, not a
		// different coordinate space.

		if (isIosSimulatorId(deviceId)) {
			// iOS: get accessibility tree via xcrun for accurate bounding boxes
			const accessibilityElements = await this.getIosAccessibilityTree(deviceId);
			if (accessibilityElements.length > 0 && cdpElements.length > 0) {
				return mergeElements(accessibilityElements, cdpElements);
			}
			// Fall back to whichever source has data
			return accessibilityElements.length > 0 ? accessibilityElements : cdpElements;
		}

		// Android ADB devices: merge fiber tree with UIAutomator
		if (!deviceId.startsWith("metro-")) {
			const uiAutomatorElements = await getUiAutomatorTree(deviceId);
			if (uiAutomatorElements.length > 0 && cdpElements.length > 0) {
				return mergeElements(uiAutomatorElements, cdpElements);
			}
			// Fall back to whichever source has data
			return uiAutomatorElements.length > 0 ? uiAutomatorElements : cdpElements;
		}

		// Metro-only: return CDP elements as-is
		return cdpElements;
	}

	async inspectElement(deviceId: string, x: number, y: number): Promise<MobileElement | null> {
		const tree = await this.getElementTree(deviceId);
		return hitTestElement(tree, x, y);
	}

	async pauseAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		if (deviceId.startsWith("metro-")) {
			return {
				success: false,
				message: "Cannot control animations on Metro-only virtual device",
			};
		}

		try {
			if (isIosSimulatorId(deviceId)) {
				// iOS Simulator: set UIAnimationDragCoefficient to freeze animations
				await execFile(
					"xcrun",
					[
						"simctl",
						"spawn",
						deviceId,
						"defaults",
						"write",
						"com.apple.UIKit",
						"UIAnimationDragCoefficient",
						"-float",
						"999",
					],
					{ timeout: ADB_TIMEOUT_MS },
				);
				return {
					success: true,
					message: "Animations paused on iOS simulator",
				};
			}

			// Android: disable all animation scales via ADB in parallel
			await Promise.all([
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "animator_duration_scale", "0"],
					{ timeout: ADB_TIMEOUT_MS },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "transition_animation_scale", "0"],
					{ timeout: ADB_TIMEOUT_MS },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "window_animation_scale", "0"],
					{ timeout: ADB_TIMEOUT_MS },
				),
			]);
			return { success: true, message: "All animations disabled on Android device" };
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async resumeAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		if (deviceId.startsWith("metro-")) {
			return {
				success: false,
				message: "Cannot control animations on Metro-only virtual device",
			};
		}

		try {
			if (isIosSimulatorId(deviceId)) {
				await execFile(
					"xcrun",
					[
						"simctl",
						"spawn",
						deviceId,
						"defaults",
						"write",
						"com.apple.UIKit",
						"UIAnimationDragCoefficient",
						"-float",
						"1",
					],
					{ timeout: ADB_TIMEOUT_MS },
				);
				return {
					success: true,
					message: "Animations restored on iOS simulator",
				};
			}

			await Promise.all([
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "animator_duration_scale", "1"],
					{ timeout: ADB_TIMEOUT_MS },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "transition_animation_scale", "1"],
					{ timeout: ADB_TIMEOUT_MS },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "window_animation_scale", "1"],
					{ timeout: ADB_TIMEOUT_MS },
				),
			]);
			return { success: true, message: "All animations restored on Android device" };
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async sendTap(deviceId: string, x: number, y: number): Promise<void> {
		if (isIosSimulatorId(deviceId)) {
			await execFile(
				"xcrun",
				["simctl", "io", deviceId, "input", "tap", String(Math.round(x)), String(Math.round(y))],
				{ timeout: ADB_TIMEOUT_MS },
			);
		} else {
			await execFile(
				"adb",
				["-s", deviceId, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))],
				{ timeout: ADB_TIMEOUT_MS },
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
				{ timeout: ADB_TIMEOUT_MS },
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
				{ timeout: ADB_TIMEOUT_MS },
			);
		}
	}

	async sendText(deviceId: string, text: string): Promise<void> {
		if (isIosSimulatorId(deviceId)) {
			// Pasteboard approach for iOS
			const { execFile: execFileCb } = await import("node:child_process");
			await new Promise<void>((resolve, reject) => {
				const child = execFileCb(
					"xcrun",
					["simctl", "pbcopy", deviceId],
					{ timeout: ADB_TIMEOUT_MS },
					(err) => (err ? reject(err) : resolve()),
				);
				child.stdin?.write(text);
				child.stdin?.end();
			});
			await execFile("xcrun", ["simctl", "io", deviceId, "sendkey", "command-v"], {
				timeout: ADB_TIMEOUT_MS,
			});
		} else {
			const escaped = text.replace(/([\\'"$ `!&|;(){}[\]<>?*#~])/g, "\\$1").replace(/ /g, "%s");
			await execFile("adb", ["-s", deviceId, "shell", "input", "text", escaped], {
				timeout: ADB_TIMEOUT_MS,
			});
		}
	}

	async sendKeyEvent(deviceId: string, keyCode: string): Promise<void> {
		if (isIosSimulatorId(deviceId)) {
			await execFile("xcrun", ["simctl", "io", deviceId, "sendkey", keyCode], {
				timeout: ADB_TIMEOUT_MS,
			});
		} else {
			await execFile("adb", ["-s", deviceId, "shell", "input", "keyevent", keyCode], {
				timeout: ADB_TIMEOUT_MS,
			});
		}
	}

	// -----------------------------------------------------------------------
	// Private: CDP element tree retrieval
	// -----------------------------------------------------------------------

	private async getElementTreeViaCdp(): Promise<{
		elements: MobileElement[];
		viewportWidth: number;
		viewportHeight: number;
		activeRoute: string | null;
	}> {
		const empty = { elements: [], viewportWidth: 0, viewportHeight: 0, activeRoute: null };
		let ws: WebSocket | null = null;

		try {
			const targets = await getCdpTargets();
			const target = pickCdpTarget(targets);
			if (!target?.webSocketDebuggerUrl) return empty;

			ws = await connectWebSocket(target.webSocketDebuggerUrl);

			// Enable Runtime domain
			await sendCdpCommand(ws, "Runtime.enable", {}, 1);

			// Evaluate the fiber-walk script
			const evalResult = await sendCdpCommand(
				ws,
				"Runtime.evaluate",
				{
					expression: FIBER_WALK_SCRIPT,
					returnByValue: true,
					awaitPromise: false,
				},
				2,
			);

			if (evalResult.error) {
				return empty;
			}

			const resultValue = evalResult.result?.result?.value;
			if (typeof resultValue !== "string") {
				return empty;
			}

			const parsed = JSON.parse(resultValue) as
				| { error: string }
				| {
						elements: RawFiberElement[];
						viewportWidth?: number;
						viewportHeight?: number;
						activeRoute?: string | null;
				  };

			if ("error" in parsed) {
				return { elements: [], viewportWidth: 0, viewportHeight: 0, activeRoute: null };
			}

			return {
				elements: parsed.elements.map((el) => toMobileElement(el)),
				viewportWidth: parsed.viewportWidth ?? 0,
				viewportHeight: parsed.viewportHeight ?? 0,
				activeRoute: parsed.activeRoute ?? null,
			};
		} catch {
			return empty;
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
	 * Get iOS accessibility tree via `xcrun simctl ui` for accurate bounding boxes.
	 */
	private async getIosAccessibilityTree(deviceId: string): Promise<MobileElement[]> {
		// Strategy 1: Try classic xcrun simctl ui accessibility (works on older Xcode)
		try {
			const { stdout } = await execFile("xcrun", ["simctl", "ui", deviceId, "accessibility"], {
				timeout: ADB_TIMEOUT_MS,
				maxBuffer: 25 * 1024 * 1024,
			});

			if (stdout && stdout.trim().length > 0) {
				const nodes = parseAccessibilityOutput(stdout);
				if (nodes.length > 0) {
					return accessibilityNodesToElements(nodes, "react-native");
				}
			}
		} catch {
			// Command not supported on this Xcode version, try next strategy
		}

		// Strategy 2: Try xcrun simctl accessibility_audit (Xcode 15+)
		try {
			const { stdout } = await execFile(
				"xcrun",
				["simctl", "accessibility_audit", deviceId, "--json"],
				{
					timeout: ADB_TIMEOUT_MS,
					maxBuffer: 25 * 1024 * 1024,
				},
			);

			if (stdout && stdout.trim().length > 0) {
				const nodes = parseAccessibilityOutput(stdout);
				if (nodes.length > 0) {
					return accessibilityNodesToElements(nodes, "react-native");
				}
			}
		} catch {
			// Not available
		}

		return [];
	}
}

// ---------------------------------------------------------------------------
// Type for raw fiber elements returned from the injected script
// ---------------------------------------------------------------------------

interface RawFiberElement {
	id: string;
	componentName: string;
	componentPath: string;
	componentFile?: string;
	boundingBox: { x: number; y: number; width: number; height: number };
	styleProps?: Record<string, unknown>;
	textContent?: string;
	animations?: Array<{
		type: string;
		property: string;
		status?: string;
		duration?: number;
	}>;
	accessibility?: {
		label?: string;
		role?: string;
		hint?: string;
		value?: string;
		traits?: string[];
	};
}

function parseSourceLocation(
	componentFile?: string,
): { file: string; line: number; column?: number } | undefined {
	if (!componentFile) return undefined;
	// Format: "fileName:lineNumber" or "fileName:lineNumber:column"
	const lastColon = componentFile.lastIndexOf(":");
	if (lastColon <= 0) return undefined;
	const beforeLastColon = componentFile.substring(0, lastColon);
	const afterLastColon = componentFile.substring(lastColon + 1);
	const num = Number(afterLastColon);
	if (Number.isNaN(num)) return undefined;
	// Check for a second colon (column)
	const secondColon = beforeLastColon.lastIndexOf(":");
	if (secondColon > 0) {
		const maybeLine = Number(beforeLastColon.substring(secondColon + 1));
		if (!Number.isNaN(maybeLine)) {
			return {
				file: beforeLastColon.substring(0, secondColon),
				line: maybeLine,
				column: num,
			};
		}
	}
	return { file: beforeLastColon, line: num };
}

function toMobileElement(raw: RawFiberElement): MobileElement {
	const sourceLocation = parseSourceLocation(raw.componentFile);
	return {
		id: raw.id,
		platform: "react-native",
		componentName: raw.componentName,
		componentPath: raw.componentPath,
		componentFile: raw.componentFile,
		sourceLocation,
		boundingBox: raw.boundingBox,
		styleProps: raw.styleProps,
		textContent: raw.textContent,
		nearbyText: undefined,
		animations: raw.animations?.map((a) => ({
			type:
				(a.type as "timing" | "spring" | "decay" | "transition" | "keyframe" | "unknown") ??
				"unknown",
			property: a.property,
			status: a.status as "running" | "paused" | "completed" | undefined,
			duration: a.duration,
		})),
		accessibility: raw.accessibility
			? {
					label: raw.accessibility.label,
					role: raw.accessibility.role,
					hint: raw.accessibility.hint,
					value: raw.accessibility.value,
					traits: raw.accessibility.traits,
				}
			: undefined,
	};
}
