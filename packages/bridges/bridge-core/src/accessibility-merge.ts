import type { MobileElement, Platform } from "@agentation-mobile/core";

/**
 * Maps iOS AX accessibility roles to semantic role names.
 */
const IOS_ROLE_MAP: Record<string, string> = {
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

/**
 * Maps Android widget class names to semantic role names.
 */
const ANDROID_ROLE_MAP: Record<string, string> = {
	"android.widget.Button": "button",
	"android.widget.TextView": "text",
	"android.widget.EditText": "textfield",
	"android.widget.ImageView": "image",
	"android.widget.ImageButton": "button",
	"android.widget.CheckBox": "checkbox",
	"android.widget.RadioButton": "radio",
	"android.widget.Switch": "switch",
	"android.widget.ToggleButton": "switch",
	"android.widget.SeekBar": "slider",
	"android.widget.ProgressBar": "progressbar",
	"android.widget.Spinner": "combobox",
	"android.widget.ListView": "list",
	"android.widget.RecyclerView": "list",
	"android.widget.ScrollView": "scrollbar",
	"android.widget.HorizontalScrollView": "scrollbar",
	"android.widget.TabHost": "tablist",
	"android.widget.TabWidget": "tablist",
	"android.webkit.WebView": "web",
	"android.widget.LinearLayout": "group",
	"android.widget.RelativeLayout": "group",
	"android.widget.FrameLayout": "group",
	"android.view.ViewGroup": "group",
	"android.view.View": "view",
};

/**
 * Maps a platform-specific role string to a unified semantic role.
 * Handles both iOS AX roles and Android widget class names.
 */
export function mapRole(role: string): string {
	// Check iOS mappings first
	if (role in IOS_ROLE_MAP) return IOS_ROLE_MAP[role];

	// Check Android mappings
	if (role in ANDROID_ROLE_MAP) return ANDROID_ROLE_MAP[role];

	// Fallback: strip AX prefix for iOS, extract class name for Android
	if (role.startsWith("AX")) return role.replace(/^AX/, "").toLowerCase();
	if (role.includes(".")) return role.split(".").pop()?.toLowerCase() ?? role.toLowerCase();

	return role.toLowerCase();
}

/**
 * Finds the best SDK element match for a given native element using bounding box
 * overlap. Returns null if no sufficient overlap is found.
 *
 * Requires >50% overlap relative to the smaller element's area.
 */
export function findBestMatch(
	target: MobileElement,
	sdkElements: MobileElement[],
): MobileElement | null {
	let bestMatch: MobileElement | null = null;
	let bestOverlap = 0;

	const tb = target.boundingBox;
	const targetArea = tb.width * tb.height;

	for (const sdk of sdkElements) {
		const sb = sdk.boundingBox;

		const overlapX = Math.max(0, Math.min(tb.x + tb.width, sb.x + sb.width) - Math.max(tb.x, sb.x));
		const overlapY = Math.max(
			0,
			Math.min(tb.y + tb.height, sb.y + sb.height) - Math.max(tb.y, sb.y),
		);
		const overlapArea = overlapX * overlapY;

		const sdkArea = sb.width * sb.height;
		const minArea = Math.min(targetArea, sdkArea);

		if (minArea > 0 && overlapArea / minArea > 0.5 && overlapArea > bestOverlap) {
			bestOverlap = overlapArea;
			bestMatch = sdk;
		}
	}

	// Fallback: when both have zero-area bounding boxes, try text-content matching
	if (!bestMatch && targetArea === 0 && target.textContent) {
		const targetText = target.textContent.trim().toLowerCase();
		if (targetText.length > 0) {
			for (const sdk of sdkElements) {
				const sdkText = sdk.textContent?.trim().toLowerCase();
				if (sdkText && sdkText === targetText) {
					return sdk;
				}
			}
		}
	}

	return bestMatch;
}

/**
 * Enriches "native" elements (from accessibility tree / UIAutomator) with data from
 * "SDK" elements (from fiber tree / DevTools) using bounding box overlap matching.
 *
 * Native elements provide accurate bounding boxes; SDK elements provide component
 * names, file paths, and source locations.
 */
export function mergeElements(
	nativeElements: MobileElement[],
	sdkElements: MobileElement[],
): MobileElement[] {
	if (sdkElements.length === 0) return nativeElements;

	return nativeElements.map((nativeEl) => {
		const match = findBestMatch(nativeEl, sdkElements);
		if (!match) return nativeEl;

		return {
			...nativeEl,
			sourceLocation: match.sourceLocation ?? nativeEl.sourceLocation,
			componentFile: match.componentFile ?? nativeEl.componentFile,
			componentName: match.componentName || nativeEl.componentName,
			animations: match.animations ?? nativeEl.animations,
		};
	});
}

export interface AccessibilityNode {
	label: string;
	role: string;
	value: string;
	traits: string[];
	frame: { x: number; y: number; width: number; height: number } | null;
	depth: number;
}

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
 * Parses the raw text output from `xcrun simctl ui <deviceId> accessibility`
 * into structured accessibility nodes.
 */
export function parseAccessibilityOutput(output: string): AccessibilityNode[] {
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
 * Converts parsed iOS accessibility nodes into MobileElement[].
 * Uses the shared `mapRole` for semantic role mapping.
 */
export function accessibilityNodesToElements(
	nodes: AccessibilityNode[],
	platform: Platform,
): MobileElement[] {
	const elements: MobileElement[] = [];
	const pathStack: string[] = [];

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (!node.frame) continue;

		const componentName = node.role ? node.role.replace(/^AX/, "") : "Unknown";

		while (pathStack.length > node.depth) {
			pathStack.pop();
		}
		pathStack.push(componentName);

		const componentPath = pathStack.join("/");
		const id = node.label
			? `ios:${componentName}:${node.label}:${i}`
			: `ios:${componentName}:${node.frame.x},${node.frame.y}:${i}`;

		const element: MobileElement = {
			id,
			platform,
			componentPath,
			componentName,
			boundingBox: node.frame,
		};

		const accessibility: MobileElement["accessibility"] = {};
		let hasAccessibility = false;

		if (node.label) {
			accessibility.label = node.label;
			hasAccessibility = true;
		}

		const semanticRole = mapRole(node.role);
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

		if (node.label && node.role === "AXStaticText") {
			element.textContent = node.label;
		}

		elements.push(element);
	}

	return elements;
}
