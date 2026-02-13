import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
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
		const match = stdout.match(/(\d+)x(\d+)/);
		if (match) {
			return { width: Number(match[1]), height: Number(match[2]) };
		}
	} catch {
		// fall through
	}
	return { width: 0, height: 0 };
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
const IOS_UDID_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

function isIosSimulatorId(deviceId: string): boolean {
	return IOS_UDID_REGEX.test(deviceId);
}

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

/**
 * Common iOS simulator screen sizes keyed by device name substrings.
 * Used as a fallback when dynamic detection is not available.
 */
const IOS_SCREEN_SIZES: Record<string, { width: number; height: number }> = {
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
	iPad: { width: 810, height: 1080 },
};

function lookupIosScreenSize(deviceName: string): { width: number; height: number } {
	for (const [key, size] of Object.entries(IOS_SCREEN_SIZES)) {
		if (deviceName.includes(key)) return size;
	}
	// Fallback for unknown devices
	return { width: 390, height: 844 };
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

	function extractBoundingBox(fiber) {
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

	function walkFiber(fiber, depth) {
		if (!fiber || depth > 60) return;

		var name = getComponentName(fiber);
		if (name) {
			var props = fiber.memoizedProps || {};
			var source = fiber._debugSource;
			var pathParts = buildPath(fiber, [name]);

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

	return JSON.stringify({ elements: elements });
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

		return parseUiAutomatorXml(stdout);
	} catch {
		return [];
	}
}

function parseUiAutomatorXml(xml: string): MobileElement[] {
	const elements: MobileElement[] = [];
	let idCounter = 0;

	const nodeRegex = /<node\s([^>]+)\/?>/g;
	let match: RegExpExecArray | null = nodeRegex.exec(xml);

	while (match !== null) {
		const attrs = match[1];
		const className = extractAttr(attrs, "class") ?? "Unknown";
		const text = extractAttr(attrs, "text");
		const contentDesc = extractAttr(attrs, "content-desc");
		const bounds = extractAttr(attrs, "bounds");

		const bbox = parseBounds(bounds);

		const shortName = className.includes(".")
			? (className.split(".").pop() ?? className)
			: className;

		elements.push({
			id: `ua-${idCounter++}`,
			platform: "react-native",
			componentName: shortName,
			componentPath: className,
			componentFile: undefined,
			boundingBox: bbox,
			styleProps: undefined,
			textContent: text || undefined,
			nearbyText: contentDesc || undefined,
			accessibility: {
				label: contentDesc || undefined,
				role: undefined,
				hint: undefined,
				value: text || undefined,
				traits: undefined,
			},
		});

		match = nodeRegex.exec(xml);
	}

	return elements;
}

function extractAttr(attrs: string, name: string): string | null {
	const regex = new RegExp(`${name}="([^"]*)"`, "i");
	const m = attrs.match(regex);
	return m ? m[1] : null;
}

function parseBounds(bounds: string | null): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	if (!bounds) return { x: 0, y: 0, width: 0, height: 0 };
	const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
	if (!m) return { x: 0, y: 0, width: 0, height: 0 };
	const left = Number(m[1]);
	const top = Number(m[2]);
	const right = Number(m[3]);
	const bottom = Number(m[4]);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

// ---------------------------------------------------------------------------
// ReactNativeBridge
// ---------------------------------------------------------------------------

export class ReactNativeBridge implements IPlatformBridge {
	readonly platform = "react-native" as const;

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

	async getElementTree(deviceId: string): Promise<MobileElement[]> {
		// Attempt CDP / React DevTools first — works for both Android and iOS
		// since Metro runs on the host and serves both platforms
		const cdpElements = await this.getElementTreeViaCdp();
		if (cdpElements.length > 0) {
			return cdpElements;
		}

		// Fall back to UIAutomator for Android ADB devices only.
		// UIAutomator is not available for iOS simulators or Metro-only devices.
		if (!deviceId.startsWith("metro-") && !isIosSimulatorId(deviceId)) {
			return getUiAutomatorTree(deviceId);
		}

		return [];
	}

	async inspectElement(deviceId: string, x: number, y: number): Promise<MobileElement | null> {
		const tree = await this.getElementTree(deviceId);
		return hitTestElement(tree, x, y);
	}

	// -----------------------------------------------------------------------
	// Private: CDP element tree retrieval
	// -----------------------------------------------------------------------

	private async getElementTreeViaCdp(): Promise<MobileElement[]> {
		let ws: WebSocket | null = null;

		try {
			const targets = await getCdpTargets();
			const target = pickCdpTarget(targets);
			if (!target?.webSocketDebuggerUrl) return [];

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
				return [];
			}

			const resultValue = evalResult.result?.result?.value;
			if (typeof resultValue !== "string") {
				return [];
			}

			const parsed = JSON.parse(resultValue) as { error: string } | { elements: RawFiberElement[] };

			if ("error" in parsed) {
				return [];
			}

			return parsed.elements.map((el) => toMobileElement(el));
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
	accessibility?: {
		label?: string;
		role?: string;
		hint?: string;
		value?: string;
		traits?: string[];
	};
}

function toMobileElement(raw: RawFiberElement): MobileElement {
	return {
		id: raw.id,
		platform: "react-native",
		componentName: raw.componentName,
		componentPath: raw.componentPath,
		componentFile: raw.componentFile,
		boundingBox: raw.boundingBox,
		styleProps: raw.styleProps,
		textContent: raw.textContent,
		nearbyText: undefined,
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
