import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	type DeviceInfo,
	type IPlatformBridge,
	lookupIosScreenSize,
	mergeElements,
} from "@agentation-mobile/bridge-core";
import type { MobileElement } from "@agentation-mobile/core";

const execFile = promisify(execFileCb);

/** Maximum time (ms) to wait for any single simctl command. */
const SIMCTL_TIMEOUT = 15_000;

/** Port used by the in-app introspection server (dylib or SDK). */
const INTROSPECTION_PORT = 4748;

/** Maximum buffer size (bytes) for screenshot output (~25 MB). */
const SIMCTL_MAX_BUFFER = 25 * 1024 * 1024;

/**
 * Extract the OS version string from a simctl runtime identifier.
 * e.g. "com.apple.CoreSimulator.SimRuntime.iOS-17-2" -> "17.2"
 * e.g. "iOS 17.2" -> "17.2"
 */
function parseOsVersion(runtime: string): string {
	// Handle "com.apple.CoreSimulator.SimRuntime.iOS-17-2" format
	const runtimeMatch = runtime.match(/iOS[- ](\d+[- .]\d+(?:[- .]\d+)?)/i);
	if (runtimeMatch) {
		return runtimeMatch[1].replace(/-/g, ".");
	}

	// Try to extract any version-like pattern
	const versionMatch = runtime.match(/(\d+\.\d+(?:\.\d+)?)/);
	if (versionMatch) {
		return versionMatch[1];
	}

	return runtime;
}

/**
 * Shape of the `xcrun simctl list devices -j` output.
 */
interface SimctlDeviceListOutput {
	devices: Record<
		string,
		Array<{
			udid: string;
			name: string;
			state: string;
			isAvailable?: boolean;
			deviceTypeIdentifier?: string;
		}>
	>;
}

interface DevicectlOutput {
	result?: {
		devices?: Array<{
			identifier: string;
			connectionProperties?: {
				transportType?: string;
			};
			deviceProperties?: {
				name?: string;
				osVersionNumber?: string;
			};
			hardwareProperties?: {
				udid?: string;
			};
		}>;
	};
}

/**
 * Represents a parsed line from the iOS accessibility hierarchy output.
 */
interface AccessibilityNode {
	label: string;
	role: string;
	value: string;
	traits: string[];
	frame: { x: number; y: number; width: number; height: number } | null;
	depth: number;
}

/**
 * Parse the output of `xcrun simctl ui <deviceId> accessibility` into
 * a flat list of AccessibilityNode objects.
 *
 * The output format is hierarchical text with indentation, e.g.:
 *   Element: <AXButton>
 *     Label: "Back"
 *     Traits: Button
 *     Frame: {{0, 44}, {100, 44}}
 */
function parseAccessibilityOutput(output: string): AccessibilityNode[] {
	const nodes: AccessibilityNode[] = [];
	const lines = output.split("\n");

	let currentNode: Partial<AccessibilityNode> | null = null;
	let currentDepth = 0;

	for (const line of lines) {
		const trimmed = line.trimEnd();
		if (!trimmed) continue;

		// Measure indentation depth
		const indent = line.length - line.trimStart().length;
		const depth = Math.floor(indent / 2);

		// Check for element/component start
		const elementMatch = trimmed.match(/^\s*(?:Element|SBElement|AX\w+):\s*(?:<(\w+)>)?/);
		if (elementMatch) {
			// Save previous node if it exists
			if (currentNode) {
				nodes.push(normalizeAccessibilityNode(currentNode, currentDepth));
			}

			currentNode = {
				role: elementMatch[1] ?? "Unknown",
			};
			currentDepth = depth;
			continue;
		}

		// Parse properties of the current node
		if (currentNode) {
			const labelMatch = trimmed.match(/^\s*Label:\s*"?([^"]*)"?/);
			if (labelMatch) {
				currentNode.label = labelMatch[1];
				continue;
			}

			const valueMatch = trimmed.match(/^\s*Value:\s*"?([^"]*)"?/);
			if (valueMatch) {
				currentNode.value = valueMatch[1];
				continue;
			}

			const traitsMatch = trimmed.match(/^\s*Traits?:\s*(.*)/);
			if (traitsMatch) {
				currentNode.traits = traitsMatch[1]
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean);
				continue;
			}

			// Frame: {{x, y}, {width, height}}
			const frameMatch = trimmed.match(
				/^\s*Frame:\s*\{\{([\d.]+),\s*([\d.]+)\},\s*\{([\d.]+),\s*([\d.]+)\}\}/,
			);
			if (frameMatch) {
				currentNode.frame = {
					x: Number.parseFloat(frameMatch[1]),
					y: Number.parseFloat(frameMatch[2]),
					width: Number.parseFloat(frameMatch[3]),
					height: Number.parseFloat(frameMatch[4]),
				};
			}
		}
	}

	// Don't forget the last node
	if (currentNode) {
		nodes.push(normalizeAccessibilityNode(currentNode, currentDepth));
	}

	return nodes;
}

/**
 * Normalize a partial accessibility node into a full AccessibilityNode.
 */
function normalizeAccessibilityNode(
	partial: Partial<AccessibilityNode>,
	depth: number,
): AccessibilityNode {
	return {
		label: partial.label ?? "",
		role: partial.role ?? "Unknown",
		value: partial.value ?? "",
		traits: partial.traits ?? [],
		frame: partial.frame ?? null,
		depth,
	};
}

/**
 * Map iOS accessibility roles to semantic roles.
 */
function mapIosRole(role: string): string {
	const roleMappings: Record<string, string> = {
		AXButton: "button",
		AXStaticText: "text",
		AXTextField: "textfield",
		AXSecureTextField: "textfield",
		AXTextView: "textfield",
		AXImage: "image",
		AXCheckBox: "checkbox",
		AXRadioButton: "radio",
		AXSwitch: "switch",
		AXSlider: "slider",
		AXProgressIndicator: "progressbar",
		AXPopUpButton: "combobox",
		AXTable: "list",
		AXCollectionView: "list",
		AXScrollView: "scrollbar",
		AXWebView: "web",
		AXTabBar: "tablist",
		AXTabButton: "tab",
		AXNavigationBar: "navigation",
		AXToolbar: "toolbar",
		AXLink: "link",
		AXCell: "cell",
		AXGroup: "group",
		AXWindow: "window",
		AXApplication: "application",
	};

	return roleMappings[role] ?? role.replace(/^AX/, "").toLowerCase();
}

/**
 * Map an iOS accessibility role to a SwiftUI / UIKit source type hint.
 * Returns a string like "SwiftUI.Button | UIButton" that an agent can use
 * to search the codebase for likely source definitions.
 */
function mapIosSourceType(role: string): string | undefined {
	const sourceMappings: Record<string, string> = {
		AXButton: "SwiftUI.Button | UIButton",
		AXStaticText: "SwiftUI.Text | UILabel",
		AXTextField: "SwiftUI.TextField | UITextField",
		AXSecureTextField: "SwiftUI.SecureField | UITextField",
		AXTextView: "SwiftUI.TextEditor | UITextView",
		AXImage: "SwiftUI.Image | UIImageView",
		AXCheckBox: "SwiftUI.Toggle | UISwitch",
		AXSwitch: "SwiftUI.Toggle | UISwitch",
		AXSlider: "SwiftUI.Slider | UISlider",
		AXProgressIndicator: "SwiftUI.ProgressView | UIProgressView",
		AXTable: "SwiftUI.List | UITableView",
		AXCollectionView: "SwiftUI.LazyVGrid | UICollectionView",
		AXScrollView: "SwiftUI.ScrollView | UIScrollView",
		AXTabBar: "SwiftUI.TabView | UITabBarController",
		AXTabButton: "SwiftUI.TabView | UITabBarItem",
		AXNavigationBar: "SwiftUI.NavigationStack | UINavigationController",
		AXToolbar: "SwiftUI.toolbar() | UIToolbar",
		AXLink: "SwiftUI.Link | UIButton",
		AXPopUpButton: "SwiftUI.Picker | UIPickerView",
		AXWebView: "WKWebView",
	};

	return sourceMappings[role];
}

/**
 * Check if a point (x, y) falls within a bounding box.
 */
function pointInBounds(
	x: number,
	y: number,
	box: { x: number; y: number; width: number; height: number },
): boolean {
	return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/**
 * Compute the area of a bounding box.
 */
function boundingBoxArea(box: { width: number; height: number }): number {
	return box.width * box.height;
}

// Exported for testing
export { parseAccessibilityOutput, mapIosRole, mapIosSourceType, pointInBounds, boundingBoxArea };
export type { AccessibilityNode };

export class IosBridge implements IPlatformBridge {
	readonly platform = "ios-native" as const;

	/**
	 * Check whether `xcrun simctl` is available on the system.
	 * This only works on macOS where Xcode command-line tools are installed.
	 */
	async isAvailable(): Promise<boolean> {
		// Only macOS supports iOS simulators
		if (process.platform !== "darwin") {
			return false;
		}

		try {
			await execFile("xcrun", ["simctl", "help"], {
				timeout: SIMCTL_TIMEOUT,
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Discover all booted iOS simulators via `xcrun simctl list devices -j`
	 * and physical devices via `xcrun devicectl list devices`.
	 */
	async listDevices(): Promise<DeviceInfo[]> {
		const devices: DeviceInfo[] = [];

		// 1. Simulators via simctl
		try {
			const { stdout } = await execFile("xcrun", ["simctl", "list", "devices", "-j"], {
				timeout: SIMCTL_TIMEOUT,
			});

			const parsed: SimctlDeviceListOutput = JSON.parse(stdout);

			for (const [runtime, deviceList] of Object.entries(parsed.devices)) {
				const osVersion = parseOsVersion(runtime);

				for (const device of deviceList) {
					if (device.state !== "Booted") continue;
					if (device.isAvailable === false) continue;

					const screenSize = lookupIosScreenSize(device.name);

					devices.push({
						id: device.udid,
						name: device.name,
						platform: "ios-native",
						isEmulator: true,
						osVersion,
						screenWidth: screenSize.width,
						screenHeight: screenSize.height,
					});
				}
			}
		} catch {
			// simctl not available
		}

		// 2. Physical devices via devicectl (Xcode 15+)
		try {
			const { stdout } = await execFile(
				"xcrun",
				["devicectl", "list", "devices", "--json-output", "/dev/stdout"],
				{ timeout: SIMCTL_TIMEOUT },
			);
			const parsed = JSON.parse(stdout) as DevicectlOutput;
			const deviceList = parsed?.result?.devices ?? [];

			for (const device of deviceList) {
				if (
					device.connectionProperties?.transportType !== "wired" &&
					device.connectionProperties?.transportType !== "localNetwork"
				)
					continue;

				const name = device.deviceProperties?.name ?? "Unknown iOS Device";
				const osVersion = device.deviceProperties?.osVersionNumber ?? "unknown";
				const udid = device.hardwareProperties?.udid ?? device.identifier;
				const screenSize = lookupIosScreenSize(name);

				if (devices.some((d) => d.id === udid)) continue;

				devices.push({
					id: udid,
					name,
					platform: "ios-native",
					isEmulator: false,
					osVersion,
					screenWidth: screenSize.width,
					screenHeight: screenSize.height,
				});
			}
		} catch {
			// devicectl not available (pre-Xcode 15)
		}

		return devices;
	}

	/**
	 * Capture a screenshot from the simulator as a PNG buffer.
	 * Uses `xcrun simctl io <deviceId> screenshot --type=png /dev/stdout`
	 * to stream raw PNG data directly to stdout.
	 */
	async captureScreen(deviceId: string): Promise<Buffer> {
		const { stdout } = await execFile(
			"xcrun",
			["simctl", "io", deviceId, "screenshot", "--type=png", "/dev/stdout"],
			{
				timeout: SIMCTL_TIMEOUT,
				maxBuffer: SIMCTL_MAX_BUFFER,
				encoding: "buffer",
			},
		);

		if (!stdout || stdout.length === 0) {
			throw new Error(`Screenshot capture returned empty buffer for simulator ${deviceId}`);
		}

		// Validate PNG magic bytes: 0x89 P N G
		if (stdout[0] !== 0x89 || stdout[1] !== 0x50 || stdout[2] !== 0x4e || stdout[3] !== 0x47) {
			throw new Error(
				`Screenshot data does not appear to be a valid PNG for simulator ${deviceId}`,
			);
		}

		return stdout;
	}

	/**
	 * Retrieve the UI accessibility tree for the current screen of the simulator.
	 *
	 * Attempts to use `xcrun simctl ui <deviceId> accessibility` to get the
	 * accessibility hierarchy. If the command is not available (older Xcode versions),
	 * returns an empty array. Full element inspection will be available via the
	 * in-app SDK in Phase 3.
	 */
	async getElementTree(deviceId: string): Promise<MobileElement[]> {
		try {
			// Try to get accessibility elements and SDK elements in parallel
			const [accessibilityElements, sdkElements] = await Promise.all([
				this.getAccessibilityTree(deviceId),
				this.querySdkElements(deviceId).catch(() => null),
			]);

			// Merge SDK source locations into accessibility elements
			if (sdkElements && sdkElements.length > 0) {
				return this.mergeElements(accessibilityElements, sdkElements);
			}

			return accessibilityElements;
		} catch {
			return this.buildFallbackRoot(deviceId);
		}
	}

	/**
	 * Get the raw accessibility element tree (without SDK enrichment).
	 */
	private async getAccessibilityTree(deviceId: string): Promise<MobileElement[]> {
		// Strategy 1: Try classic xcrun simctl ui accessibility (works on older Xcode)
		try {
			const { stdout } = await execFile("xcrun", ["simctl", "ui", deviceId, "accessibility"], {
				timeout: SIMCTL_TIMEOUT,
				maxBuffer: SIMCTL_MAX_BUFFER,
			});

			if (stdout && stdout.trim().length > 0) {
				const elements = this.parseAccessibilityTree(stdout);
				if (elements.length > 0) return elements;
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
					timeout: SIMCTL_TIMEOUT,
					maxBuffer: SIMCTL_MAX_BUFFER,
				},
			);

			if (stdout && stdout.trim().length > 0) {
				const parsed = JSON.parse(stdout);
				if (Array.isArray(parsed) && parsed.length > 0) {
					const elements = this.parseAccessibilityTree(stdout);
					if (elements.length > 0) return elements;
				}
			}
		} catch {
			// Not available, try next strategy
		}

		// Strategy 3: Use SDK elements directly if available
		try {
			const sdkElements = await this.querySdkElements(deviceId);
			if (sdkElements && sdkElements.length > 0) {
				return sdkElements;
			}
		} catch {
			// SDK not available
		}

		return this.buildFallbackRoot(deviceId);
	}

	/**
	 * Build a single fallback root element when the accessibility tree is
	 * empty or unavailable. This ensures callers always get at least one
	 * element representing the full screen.
	 */
	private async buildFallbackRoot(deviceId: string): Promise<MobileElement[]> {
		// Try to resolve device name for accurate screen size
		let screenSize = { width: 393, height: 852 };
		try {
			const { stdout } = await execFile("xcrun", ["simctl", "list", "devices", "-j"], {
				timeout: SIMCTL_TIMEOUT,
			});
			const parsed: SimctlDeviceListOutput = JSON.parse(stdout);
			for (const deviceList of Object.values(parsed.devices)) {
				for (const device of deviceList) {
					if (device.udid === deviceId) {
						screenSize = lookupIosScreenSize(device.name);
						break;
					}
				}
			}
		} catch {
			// Use default screen size
		}

		return [
			{
				id: `ios:root:${deviceId}`,
				platform: "ios-native",
				componentPath: "Application",
				componentName: "Application",
				boundingBox: { x: 0, y: 0, width: screenSize.width, height: screenSize.height },
				accessibility: {
					role: "application",
				},
			},
		];
	}

	async pauseAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		try {
			// Set simulator animation speed to 0 (frozen)
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
				{ timeout: SIMCTL_TIMEOUT },
			);
			return {
				success: true,
				message: "Animations paused (drag coefficient set to maximum)",
			};
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async resumeAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		try {
			// Restore normal animation speed
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
				{ timeout: SIMCTL_TIMEOUT },
			);
			return {
				success: true,
				message: "Animations restored to normal speed",
			};
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	/**
	 * Inspect a specific element at screen coordinates (x, y).
	 * Gets the full element tree and finds the smallest element whose
	 * bounding box contains the given point (hit-test).
	 */
	async inspectElement(deviceId: string, x: number, y: number): Promise<MobileElement | null> {
		// Try SDK hit-test first (has source locations), fall back to accessibility
		const sdkElement = await this.querySdkElementAt(deviceId, x, y).catch(() => null);
		if (sdkElement?.sourceLocation) {
			return sdkElement;
		}

		const elements = await this.getElementTree(deviceId);

		let bestMatch: MobileElement | null = null;
		let bestArea = Number.POSITIVE_INFINITY;

		for (const element of elements) {
			if (pointInBounds(x, y, element.boundingBox)) {
				const area = boundingBoxArea(element.boundingBox);
				if (area < bestArea) {
					bestArea = area;
					bestMatch = element;
				}
			}
		}

		return bestMatch;
	}

	async sendTap(deviceId: string, x: number, y: number): Promise<void> {
		try {
			await execFile(
				"xcrun",
				["simctl", "io", deviceId, "input", "tap", String(Math.round(x)), String(Math.round(y))],
				{ timeout: SIMCTL_TIMEOUT },
			);
		} catch (err) {
			throw new Error(
				`sendTap failed: ${err}. Requires Xcode 15+ with 'xcrun simctl io input' support.`,
			);
		}
	}

	async sendKeyEvent(deviceId: string, keyCode: string): Promise<void> {
		try {
			await execFile("xcrun", ["simctl", "io", deviceId, "sendkey", keyCode], {
				timeout: SIMCTL_TIMEOUT,
			});
		} catch (err) {
			throw new Error(`sendKeyEvent failed: ${err}`);
		}
	}

	async sendText(deviceId: string, text: string): Promise<void> {
		try {
			// Write text to simulator pasteboard via stdin, then Cmd+V paste
			await new Promise<void>((resolve, reject) => {
				const child = execFileCb(
					"xcrun",
					["simctl", "pbcopy", deviceId],
					{ timeout: SIMCTL_TIMEOUT },
					(err) => (err ? reject(err) : resolve()),
				);
				child.stdin?.write(text);
				child.stdin?.end();
			});
			await execFile("xcrun", ["simctl", "io", deviceId, "sendkey", "command-v"], {
				timeout: SIMCTL_TIMEOUT,
			});
		} catch (err) {
			throw new Error(`sendText failed: ${err}`);
		}
	}

	async sendSwipe(
		deviceId: string,
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		_durationMs?: number,
	): Promise<void> {
		// iOS simulators have limited swipe support via simctl.
		// We use touch event sequence: down → move → up
		try {
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
				{ timeout: SIMCTL_TIMEOUT },
			);
		} catch {
			throw new Error(
				"sendSwipe is not supported on this iOS simulator version. " +
					"Requires Xcode 15+ with 'xcrun simctl io input swipe' support.",
			);
		}
	}

	/**
	 * Parse the accessibility hierarchy output from `xcrun simctl ui` into
	 * a flat list of MobileElement objects.
	 */
	private parseAccessibilityTree(output: string): MobileElement[] {
		const nodes = parseAccessibilityOutput(output);
		const elements: MobileElement[] = [];

		// Build component paths using depth tracking
		const pathStack: string[] = [];

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];

			// Skip nodes without a frame (they have no visual representation)
			if (!node.frame) continue;

			// Determine the component name from role or label
			const componentName = node.role ? node.role.replace(/^AX/, "") : "Unknown";

			// Adjust path stack to current depth
			while (pathStack.length > node.depth) {
				pathStack.pop();
			}
			pathStack.push(componentName);

			const componentPath = pathStack.join("/");

			// Build a stable element ID
			const id = node.label
				? `ios:${componentName}:${node.label}:${i}`
				: `ios:${componentName}:${node.frame.x},${node.frame.y}:${i}`;

			const element: MobileElement = {
				id,
				platform: "ios-native",
				componentPath,
				componentName,
				boundingBox: node.frame,
			};

			// Populate accessibility information
			const accessibility: MobileElement["accessibility"] = {};
			let hasAccessibility = false;

			if (node.label) {
				accessibility.label = node.label;
				hasAccessibility = true;
			}

			const semanticRole = mapIosRole(node.role);
			if (semanticRole) {
				accessibility.role = semanticRole;
				hasAccessibility = true;
			}

			if (node.value) {
				accessibility.value = node.value;
				hasAccessibility = true;
			}

			if (node.traits.length > 0) {
				accessibility.traits = node.traits;
				hasAccessibility = true;
			}

			if (hasAccessibility) {
				element.accessibility = accessibility;
			}

			// Source type hint (SwiftUI / UIKit)
			const sourceType = mapIosSourceType(node.role);
			if (sourceType) {
				element.componentFile = sourceType;
			}

			// If the label looks like text content, populate textContent
			if (node.label && node.role === "AXStaticText") {
				element.textContent = node.label;
			}

			elements.push(element);
		}

		return elements;
	}

	/**
	 * Try to query the in-app Agentation SDK HTTP server for enriched element data.
	 * The SDK runs on port 4748 inside the simulator. On simulators, localhost is shared,
	 * so we can reach it directly.
	 */
	private async querySdkElements(deviceId: string): Promise<MobileElement[] | null> {
		try {
			// On iOS simulators, the app's localhost is accessible from the host
			const body = await this.httpGet("http://127.0.0.1:4748/agentation/elements");
			if (!body) return null;

			return JSON.parse(body) as MobileElement[];
		} catch {
			return null;
		}
	}

	/**
	 * Try to query the SDK for a specific element at coordinates.
	 */
	private async querySdkElementAt(
		_deviceId: string,
		x: number,
		y: number,
	): Promise<MobileElement | null> {
		try {
			const body = await this.httpGet(`http://127.0.0.1:4748/agentation/element?x=${x}&y=${y}`);
			if (!body) return null;

			return JSON.parse(body) as MobileElement;
		} catch {
			return null;
		}
	}

	/**
	 * Merge SDK-sourced elements (with source locations) into accessibility elements.
	 */
	private mergeElements(
		accessibilityElements: MobileElement[],
		sdkElements: MobileElement[],
	): MobileElement[] {
		return mergeElements(accessibilityElements, sdkElements);
	}

	/**
	 * Simple HTTP GET request with timeout.
	 */
	private httpGet(url: string): Promise<string | null> {
		return new Promise((resolve) => {
			const req = http.get(url, { timeout: 2000 }, (res) => {
				if (res.statusCode !== 200) {
					res.resume();
					resolve(null);
					return;
				}
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
				res.on("error", () => resolve(null));
			});
			req.on("error", () => resolve(null));
			req.on("timeout", () => {
				req.destroy();
				resolve(null);
			});
		});
	}

	/**
	 * Check if the introspection server (dylib or SDK) is running.
	 */
	async isIntrospectionServerReady(): Promise<boolean> {
		const body = await this.httpGet(`http://127.0.0.1:${INTROSPECTION_PORT}/agentation/health`);
		return body !== null;
	}

	/**
	 * Get the path to the pre-built introspection dylib.
	 * Returns null if the dylib hasn't been built.
	 */
	getDylibPath(): string | null {
		// Resolve relative to this file: ../dylib/AgentationIntrospector.dylib
		// Works in both ESM (import.meta.url) and CJS (__dirname)
		let thisDir: string;
		try {
			thisDir = dirname(fileURLToPath(import.meta.url));
		} catch {
			thisDir = __dirname;
		}
		const dylibPath = join(thisDir, "..", "dylib", "AgentationIntrospector.dylib");
		return existsSync(dylibPath) ? dylibPath : null;
	}

	/**
	 * Launch (or relaunch) a simulator app with the introspection dylib injected.
	 * Uses SIMCTL_CHILD_DYLD_INSERT_LIBRARIES to load the dylib into the app process.
	 */
	async injectIntoApp(
		deviceId: string,
		bundleId: string,
	): Promise<{ success: boolean; message: string }> {
		const dylibPath = this.getDylibPath();
		if (!dylibPath) {
			return {
				success: false,
				message:
					"Introspection dylib not found. Run the build script: packages/bridges/bridge-ios/dylib/build.sh",
			};
		}

		// Terminate any running instance
		try {
			await execFile("xcrun", ["simctl", "terminate", deviceId, bundleId], {
				timeout: SIMCTL_TIMEOUT,
			});
			// Brief wait for process to fully exit
			await new Promise((r) => setTimeout(r, 500));
		} catch {
			// App may not be running — that's fine
		}

		// Launch with dylib injection
		try {
			const env = { ...process.env, SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: dylibPath };
			await execFile("xcrun", ["simctl", "launch", deviceId, bundleId], {
				timeout: SIMCTL_TIMEOUT,
				env,
			});
		} catch (err) {
			return {
				success: false,
				message: `Failed to launch ${bundleId}: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		// Wait for the introspection server to come up (max 5 seconds)
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 500));
			if (await this.isIntrospectionServerReady()) {
				return {
					success: true,
					message: `Injected into ${bundleId} — introspection server active on port ${INTROSPECTION_PORT}`,
				};
			}
		}

		return {
			success: false,
			message: `Launched ${bundleId} with injection but introspection server did not start within 5s`,
		};
	}

	/**
	 * Get the bundle ID of the frontmost (foreground) app on the simulator.
	 */
	async getFrontmostApp(deviceId: string): Promise<string | null> {
		try {
			const { stdout } = await execFile(
				"xcrun",
				["simctl", "spawn", deviceId, "launchctl", "list"],
				{ timeout: SIMCTL_TIMEOUT },
			);
			// Look for UIKitApplication entries
			const match = stdout.match(/UIKitApplication:([^\[]+)\[/);
			return match ? match[1] : null;
		} catch {
			return null;
		}
	}
}
