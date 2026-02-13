import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import type { MobileElement } from "@agentation-mobile/core";

const execFile = promisify(execFileCb);

/** Maximum time (ms) to wait for any single simctl command. */
const SIMCTL_TIMEOUT = 15_000;

/** Maximum buffer size (bytes) for screenshot output (~25 MB). */
const SIMCTL_MAX_BUFFER = 25 * 1024 * 1024;

/**
 * Known iOS simulator screen dimensions keyed by device model substring.
 * Used as a fallback when dynamic resolution detection is not available.
 */
const KNOWN_SCREEN_SIZES: Record<string, { width: number; height: number }> = {
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
	"iPhone 13 Pro Max": { width: 428, height: 926 },
	"iPhone 13 Pro": { width: 390, height: 844 },
	"iPhone 13 mini": { width: 375, height: 812 },
	"iPhone 13": { width: 390, height: 844 },
	"iPhone 12 Pro Max": { width: 428, height: 926 },
	"iPhone 12 Pro": { width: 390, height: 844 },
	"iPhone 12 mini": { width: 375, height: 812 },
	"iPhone 12": { width: 390, height: 844 },
	"iPhone SE (3rd generation)": { width: 375, height: 667 },
	"iPhone SE (2nd generation)": { width: 375, height: 667 },
	"iPad Pro (12.9-inch)": { width: 1024, height: 1366 },
	"iPad Pro (11-inch)": { width: 834, height: 1194 },
	"iPad Air": { width: 820, height: 1180 },
	"iPad mini": { width: 744, height: 1133 },
	iPad: { width: 810, height: 1080 },
};

/**
 * Resolve the logical screen size for a simulator by device name.
 * Tries to match the most specific device name first, then falls back
 * to partial matches, and finally returns a sensible default.
 */
function resolveScreenSize(deviceName: string): { width: number; height: number } {
	// Exact match first
	if (KNOWN_SCREEN_SIZES[deviceName]) {
		return KNOWN_SCREEN_SIZES[deviceName];
	}

	// Partial match: find the longest key that is a substring of the device name
	let bestMatch: { width: number; height: number } | null = null;
	let bestLength = 0;

	for (const [key, size] of Object.entries(KNOWN_SCREEN_SIZES)) {
		if (deviceName.includes(key) && key.length > bestLength) {
			bestMatch = size;
			bestLength = key.length;
		}
	}

	if (bestMatch) {
		return bestMatch;
	}

	// Default: iPhone-sized screen
	return { width: 393, height: 852 };
}

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
export { parseAccessibilityOutput, mapIosRole, pointInBounds, boundingBoxArea };
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

					const screenSize = resolveScreenSize(device.name);

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
				const screenSize = resolveScreenSize(name);

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
			const { stdout } = await execFile("xcrun", ["simctl", "ui", deviceId, "accessibility"], {
				timeout: SIMCTL_TIMEOUT,
				maxBuffer: SIMCTL_MAX_BUFFER,
			});

			if (!stdout || stdout.trim().length === 0) {
				return this.buildFallbackRoot(deviceId);
			}

			const elements = this.parseAccessibilityTree(stdout);
			if (elements.length === 0) {
				return this.buildFallbackRoot(deviceId);
			}

			return elements;
		} catch {
			// `xcrun simctl ui` may not be available in all Xcode versions.
			// Return a fallback root element so callers always get at least one element.
			return this.buildFallbackRoot(deviceId);
		}
	}

	/**
	 * Build a single fallback root element when the accessibility tree is
	 * empty or unavailable. This ensures callers always get at least one
	 * element representing the full screen.
	 */
	private buildFallbackRoot(deviceId: string): MobileElement[] {
		return [
			{
				id: `ios:root:${deviceId}`,
				platform: "ios-native",
				componentPath: "Application",
				componentName: "Application",
				boundingBox: { x: 0, y: 0, width: 0, height: 0 },
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

			// If the label looks like text content, populate textContent
			if (node.label && node.role === "AXStaticText") {
				element.textContent = node.label;
			}

			elements.push(element);
		}

		return elements;
	}
}
