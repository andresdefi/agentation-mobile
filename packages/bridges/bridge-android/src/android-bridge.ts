import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { MobileElement } from "@agentation-mobile/core";
import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import { XMLParser } from "fast-xml-parser";

const execFile = promisify(execFileCb);

/** Maximum time (ms) to wait for any single ADB command. */
const ADB_TIMEOUT = 15_000;

/** Maximum buffer size (bytes) for ADB screenshot output (~25 MB). */
const ADB_MAX_BUFFER = 25 * 1024 * 1024;

interface UiAutomatorNode {
	"@_index"?: string;
	"@_text"?: string;
	"@_resource-id"?: string;
	"@_class"?: string;
	"@_package"?: string;
	"@_content-desc"?: string;
	"@_checkable"?: string;
	"@_checked"?: string;
	"@_clickable"?: string;
	"@_enabled"?: string;
	"@_focusable"?: string;
	"@_focused"?: string;
	"@_scrollable"?: string;
	"@_long-clickable"?: string;
	"@_password"?: string;
	"@_selected"?: string;
	"@_bounds"?: string;
	"@_rotation"?: string;
	node?: UiAutomatorNode | UiAutomatorNode[];
}

interface ParsedBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Parse UIAutomator bounds string "[x1,y1][x2,y2]" into a bounding box.
 */
function parseBounds(bounds: string): ParsedBounds | null {
	const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
	if (!match) return null;

	const x1 = Number.parseInt(match[1], 10);
	const y1 = Number.parseInt(match[2], 10);
	const x2 = Number.parseInt(match[3], 10);
	const y2 = Number.parseInt(match[4], 10);

	return {
		x: x1,
		y: y1,
		width: x2 - x1,
		height: y2 - y1,
	};
}

/**
 * Derive a human-readable component name from the Android class name.
 * e.g. "android.widget.TextView" -> "TextView"
 */
function classToComponentName(className: string): string {
	const parts = className.split(".");
	return parts[parts.length - 1] ?? className;
}

/**
 * Build a stable element ID from available attributes.
 */
function buildElementId(node: UiAutomatorNode, index: number): string {
	if (node["@_resource-id"]) {
		return node["@_resource-id"];
	}
	const className = node["@_class"] ?? "unknown";
	const bounds = node["@_bounds"] ?? "";
	return `${className}:${bounds}:${index}`;
}

/**
 * Flatten the UIAutomator node tree into a list of MobileElement objects,
 * tracking the component path for each element.
 */
function flattenNodes(
	node: UiAutomatorNode,
	parentPath: string,
	counter: { value: number },
): MobileElement[] {
	const elements: MobileElement[] = [];
	const className = node["@_class"] ?? "UnknownView";
	const componentName = classToComponentName(className);
	const currentPath = parentPath ? `${parentPath}/${componentName}` : componentName;

	const boundsStr = node["@_bounds"];
	if (boundsStr) {
		const parsed = parseBounds(boundsStr);
		if (parsed) {
			const id = buildElementId(node, counter.value);
			counter.value += 1;

			const element: MobileElement = {
				id,
				platform: "android-native",
				componentPath: currentPath,
				componentName,
				boundingBox: parsed,
			};

			const text = node["@_text"];
			if (text) {
				element.textContent = text;
			}

			const contentDesc = node["@_content-desc"];
			const resourceId = node["@_resource-id"];
			const pkg = node["@_package"];

			if (contentDesc || resourceId || pkg) {
				element.accessibility = {};
				if (contentDesc) {
					element.accessibility.label = contentDesc;
				}
				if (resourceId) {
					element.accessibility.hint = resourceId;
				}
				if (pkg) {
					element.accessibility.value = pkg;
				}
			}

			// Map UIAutomator class to a semantic role
			const roleMappings: Record<string, string> = {
				Button: "button",
				ImageButton: "button",
				TextView: "text",
				EditText: "textfield",
				ImageView: "image",
				CheckBox: "checkbox",
				RadioButton: "radio",
				Switch: "switch",
				ToggleButton: "switch",
				SeekBar: "slider",
				ProgressBar: "progressbar",
				Spinner: "combobox",
				RecyclerView: "list",
				ListView: "list",
				ScrollView: "scrollbar",
				WebView: "web",
				TabLayout: "tablist",
			};

			const role = roleMappings[componentName];
			if (role) {
				if (!element.accessibility) {
					element.accessibility = {};
				}
				element.accessibility.role = role;
			}

			// Collect boolean traits from UIAutomator attributes
			const traits: string[] = [];
			if (node["@_clickable"] === "true") traits.push("clickable");
			if (node["@_checkable"] === "true") traits.push("checkable");
			if (node["@_checked"] === "true") traits.push("checked");
			if (node["@_enabled"] === "false") traits.push("disabled");
			if (node["@_focusable"] === "true") traits.push("focusable");
			if (node["@_focused"] === "true") traits.push("focused");
			if (node["@_scrollable"] === "true") traits.push("scrollable");
			if (node["@_long-clickable"] === "true") traits.push("long-clickable");
			if (node["@_selected"] === "true") traits.push("selected");
			if (node["@_password"] === "true") traits.push("password");

			if (traits.length > 0) {
				if (!element.accessibility) {
					element.accessibility = {};
				}
				element.accessibility.traits = traits;
			}

			// Populate styleProps with the Android package info
			if (pkg) {
				element.styleProps = { package: pkg };
			}

			elements.push(element);
		}
	}

	// Recurse into children
	const children = node.node;
	if (children) {
		const childArray = Array.isArray(children) ? children : [children];
		for (const child of childArray) {
			elements.push(...flattenNodes(child, currentPath, counter));
		}
	}

	return elements;
}

/**
 * Compute the area of a bounding box.
 */
function boundingBoxArea(box: { width: number; height: number }): number {
	return box.width * box.height;
}

/**
 * Check if a point (x, y) falls within a bounding box.
 */
function pointInBounds(
	x: number,
	y: number,
	box: { x: number; y: number; width: number; height: number },
): boolean {
	return (
		x >= box.x &&
		x <= box.x + box.width &&
		y >= box.y &&
		y <= box.y + box.height
	);
}

export class AndroidBridge implements IPlatformBridge {
	readonly platform = "android-native" as const;

	/**
	 * Check whether ADB is installed and accessible on the system PATH.
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await execFile("adb", ["version"], { timeout: ADB_TIMEOUT });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Discover all connected Android devices and emulators via `adb devices -l`.
	 * For each device, also queries the screen resolution via `adb shell wm size`.
	 */
	async listDevices(): Promise<DeviceInfo[]> {
		const { stdout } = await execFile("adb", ["devices", "-l"], {
			timeout: ADB_TIMEOUT,
		});

		const lines = stdout.split("\n").slice(1); // Skip header line
		const devices: DeviceInfo[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("*")) continue;

			// Format: <serial> <state> <properties...>
			// e.g. "emulator-5554   device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:generic_x86_64 transport_id:1"
			const parts = trimmed.split(/\s+/);
			if (parts.length < 2) continue;

			const serial = parts[0];
			const state = parts[1];

			// Only include devices in "device" state (not offline, unauthorized, etc.)
			if (state !== "device") continue;

			// Extract model name from properties
			const modelMatch = trimmed.match(/model:(\S+)/);
			const deviceMatch = trimmed.match(/device:(\S+)/);
			const name = modelMatch?.[1]?.replace(/_/g, " ") ?? deviceMatch?.[1] ?? serial;

			const isEmulator = serial.startsWith("emulator-") || serial.includes("localhost:");

			// Query OS version
			let osVersion = "unknown";
			try {
				const { stdout: versionOut } = await execFile(
					"adb",
					["-s", serial, "shell", "getprop", "ro.build.version.release"],
					{ timeout: ADB_TIMEOUT },
				);
				osVersion = versionOut.trim() || "unknown";
			} catch {
				// Silently fall back to unknown
			}

			// Query screen dimensions
			let screenWidth = 0;
			let screenHeight = 0;
			try {
				const { stdout: sizeOut } = await execFile(
					"adb",
					["-s", serial, "shell", "wm", "size"],
					{ timeout: ADB_TIMEOUT },
				);
				// Output format: "Physical size: 1080x1920" or "Override size: 1080x1920"
				// We prefer override size if present, otherwise physical size
				const sizeLines = sizeOut.trim().split("\n");
				for (const sizeLine of sizeLines.reverse()) {
					const sizeMatch = sizeLine.match(/(\d+)x(\d+)/);
					if (sizeMatch) {
						screenWidth = Number.parseInt(sizeMatch[1], 10);
						screenHeight = Number.parseInt(sizeMatch[2], 10);
						break;
					}
				}
			} catch {
				// Silently fall back to 0x0
			}

			devices.push({
				id: serial,
				name,
				platform: "android-native",
				isEmulator,
				osVersion,
				screenWidth,
				screenHeight,
			});
		}

		return devices;
	}

	/**
	 * Capture a screenshot from the device as a PNG buffer.
	 * Uses `adb exec-out screencap -p` to stream raw PNG data directly.
	 */
	async captureScreen(deviceId: string): Promise<Buffer> {
		const { stdout } = await execFile(
			"adb",
			["-s", deviceId, "exec-out", "screencap", "-p"],
			{
				timeout: ADB_TIMEOUT,
				maxBuffer: ADB_MAX_BUFFER,
				encoding: "buffer",
			},
		);

		if (!stdout || stdout.length === 0) {
			throw new Error(`Screenshot capture returned empty buffer for device ${deviceId}`);
		}

		// Validate it looks like a PNG (magic bytes: 0x89 P N G)
		if (
			stdout[0] !== 0x89 ||
			stdout[1] !== 0x50 ||
			stdout[2] !== 0x4e ||
			stdout[3] !== 0x47
		) {
			throw new Error(
				`Screenshot data does not appear to be a valid PNG for device ${deviceId}`,
			);
		}

		return stdout;
	}

	/**
	 * Retrieve the UI element tree via UIAutomator and convert to MobileElement[].
	 * Runs `adb shell uiautomator dump /dev/tty` to get the XML representation
	 * of the current screen, then parses it with fast-xml-parser.
	 */
	async getElementTree(deviceId: string): Promise<MobileElement[]> {
		const { stdout } = await execFile(
			"adb",
			["-s", deviceId, "shell", "uiautomator", "dump", "/dev/tty"],
			{ timeout: ADB_TIMEOUT, maxBuffer: ADB_MAX_BUFFER },
		);

		// UIAutomator prepends "UI hierchary dumped to: /dev/tty" on some versions,
		// and the XML starts with "<?xml" — we need to extract just the XML portion.
		const xmlStart = stdout.indexOf("<?xml");
		if (xmlStart === -1) {
			// Some devices output the XML without the processing instruction
			const hierarchyStart = stdout.indexOf("<hierarchy");
			if (hierarchyStart === -1) {
				throw new Error(
					`UIAutomator dump did not return valid XML for device ${deviceId}. Output: ${stdout.slice(0, 200)}`,
				);
			}
			return this.parseUiAutomatorXml(stdout.slice(hierarchyStart));
		}

		return this.parseUiAutomatorXml(stdout.slice(xmlStart));
	}

	/**
	 * Inspect a specific element at screen coordinates (x, y).
	 * Gets the full element tree and finds the smallest element whose
	 * bounding box contains the given point.
	 */
	async inspectElement(
		deviceId: string,
		x: number,
		y: number,
	): Promise<MobileElement | null> {
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
	 * Parse the UIAutomator XML dump into a flat list of MobileElement objects.
	 */
	private parseUiAutomatorXml(xml: string): MobileElement[] {
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: "@_",
			// Ensure single-child nodes are not collapsed into non-array
			isArray: (name) => name === "node",
		});

		const parsed = parser.parse(xml);

		// The hierarchy root may be at parsed.hierarchy or parsed["hierarchy"]
		const hierarchy = parsed?.hierarchy;
		if (!hierarchy) {
			return [];
		}

		const elements: MobileElement[] = [];
		const counter = { value: 0 };

		// The hierarchy contains one or more top-level "node" elements
		const topNodes = hierarchy.node;
		if (!topNodes) return [];

		const nodeArray = Array.isArray(topNodes) ? topNodes : [topNodes];
		for (const node of nodeArray) {
			elements.push(...flattenNodes(node, "", counter));
		}

		return elements;
	}
}
