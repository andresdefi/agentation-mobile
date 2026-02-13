import type { MobileElement, Platform } from "@agentation-mobile/core";
import { XMLParser } from "fast-xml-parser";

// ---------------------------------------------------------------------------
// UIAutomator XML node types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared role mappings
// ---------------------------------------------------------------------------

const ROLE_MAPPINGS: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseBounds(
	bounds: string,
): { x: number; y: number; width: number; height: number } | null {
	const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
	if (!match) return null;
	const x1 = Number.parseInt(match[1], 10);
	const y1 = Number.parseInt(match[2], 10);
	const x2 = Number.parseInt(match[3], 10);
	const y2 = Number.parseInt(match[4], 10);
	return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function classToComponentName(className: string): string {
	const parts = className.split(".");
	return parts[parts.length - 1] ?? className;
}

function buildElementId(node: UiAutomatorNode, index: number): string {
	if (node["@_resource-id"]) return node["@_resource-id"];
	const className = node["@_class"] ?? "unknown";
	const bounds = node["@_bounds"] ?? "";
	return `${className}:${bounds}:${index}`;
}

function flattenNodes(
	node: UiAutomatorNode,
	parentPath: string,
	counter: { value: number },
	platform: Platform,
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
				platform,
				componentPath: currentPath,
				componentName,
				boundingBox: parsed,
			};

			const text = node["@_text"];
			if (text) element.textContent = text;

			const contentDesc = node["@_content-desc"];
			const resourceId = node["@_resource-id"];
			const pkg = node["@_package"];

			if (contentDesc || resourceId || pkg) {
				element.accessibility = {};
				if (contentDesc) element.accessibility.label = contentDesc;
				if (resourceId) element.accessibility.hint = resourceId;
				if (pkg) element.accessibility.value = pkg;
			}

			const role = ROLE_MAPPINGS[componentName];
			if (role) {
				if (!element.accessibility) element.accessibility = {};
				element.accessibility.role = role;
			}

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
				if (!element.accessibility) element.accessibility = {};
				element.accessibility.traits = traits;
			}

			if (pkg) element.styleProps = { package: pkg };

			elements.push(element);
		}
	}

	const children = node.node;
	if (children) {
		const childArray = Array.isArray(children) ? children : [children];
		for (const child of childArray) {
			elements.push(...flattenNodes(child, currentPath, counter, platform));
		}
	}

	return elements;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a UIAutomator XML dump into a flat list of MobileElement objects.
 * Uses fast-xml-parser for robust parsing with proper tree structure.
 */
export function parseUiAutomatorXml(xml: string, platform: Platform): MobileElement[] {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "@_",
		isArray: (name) => name === "node",
	});

	const parsed = parser.parse(xml);
	const hierarchy = parsed?.hierarchy;
	if (!hierarchy) return [];

	const elements: MobileElement[] = [];
	const counter = { value: 0 };

	const topNodes = hierarchy.node;
	if (!topNodes) return [];

	const nodeArray = Array.isArray(topNodes) ? topNodes : [topNodes];
	for (const node of nodeArray) {
		elements.push(...flattenNodes(node, "", counter, platform));
	}

	return elements;
}

/**
 * Find the smallest element whose bounding box contains the point (x, y).
 */
export function hitTestElement(
	elements: MobileElement[],
	x: number,
	y: number,
): MobileElement | null {
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
