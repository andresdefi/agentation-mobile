/**
 * Collects the React Native element tree by walking the React fiber tree.
 * Reports elements with their bounding boxes, component names, source locations,
 * and associated animations to the backend.
 */

import { UIManager, findNodeHandle } from "react-native";

export interface CollectedElement {
	id: string;
	componentName: string;
	componentPath: string;
	componentFile?: string;
	sourceLocation?: {
		file: string;
		line: number;
		column?: number;
	};
	boundingBox: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	textContent?: string;
	accessibility?: {
		label?: string;
		role?: string;
		hint?: string;
	};
}

/**
 * Walk the React fiber tree to collect element info.
 * Uses __REACT_DEVTOOLS_GLOBAL_HOOK__ or direct fiber traversal.
 */
export function collectElementTree(): Promise<CollectedElement[]> {
	return new Promise((resolve) => {
		const elements: CollectedElement[] = [];

		try {
			// Try to access React fiber root via DevTools hook
			const hook = (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ as
				| { renderers?: Map<number, { findFiberByHostInstance?: (instance: unknown) => unknown }> }
				| undefined;

			if (!hook?.renderers) {
				resolve(elements);
				return;
			}

			// Walk all mounted fiber trees
			for (const [, renderer] of hook.renderers) {
				const roots = (renderer as Record<string, unknown>)._fiberRoots as Set<unknown> | undefined;
				if (!roots) continue;

				for (const root of roots) {
					const fiberRoot = root as { current?: unknown };
					if (fiberRoot.current) {
						walkFiber(fiberRoot.current, elements, "");
					}
				}
			}
		} catch {
			// Fiber access failed — return empty
		}

		resolve(elements);
	});
}

interface FiberNode {
	tag: number;
	type: unknown;
	stateNode: unknown;
	child: FiberNode | null;
	sibling: FiberNode | null;
	return: FiberNode | null;
	memoizedProps: Record<string, unknown>;
	_debugSource?: {
		fileName: string;
		lineNumber: number;
		columnNumber?: number;
	};
	_debugOwner?: FiberNode;
}

// Fiber tags we care about
const HOST_COMPONENT = 5; // Native views (View, Text, Image, etc.)
const FUNCTION_COMPONENT = 0;
const CLASS_COMPONENT = 1;

function getComponentName(fiber: FiberNode): string {
	if (!fiber.type) return "Unknown";

	if (typeof fiber.type === "string") return fiber.type;
	if (typeof fiber.type === "function") {
		return (
			(fiber.type as { displayName?: string; name?: string }).displayName ??
			(fiber.type as { name?: string }).name ??
			"Anonymous"
		);
	}
	if (typeof fiber.type === "object" && fiber.type !== null) {
		const obj = fiber.type as Record<string, unknown>;
		if (obj.displayName) return obj.displayName as string;
		if (obj.name) return obj.name as string;
		// Forward refs, memo, etc.
		if (obj.render && typeof obj.render === "function") {
			return (
				(obj.render as { displayName?: string; name?: string }).displayName ??
				(obj.render as { name?: string }).name ??
				"ForwardRef"
			);
		}
	}

	return "Unknown";
}

function buildComponentPath(fiber: FiberNode): string {
	const parts: string[] = [];
	let current: FiberNode | null = fiber;

	while (current) {
		if (current.tag === FUNCTION_COMPONENT || current.tag === CLASS_COMPONENT) {
			const name = getComponentName(current);
			if (name !== "Unknown" && name !== "Anonymous") {
				parts.unshift(name);
			}
		}
		current = current.return;
	}

	return parts.join("/");
}

function isHiddenSubtree(node: FiberNode): boolean {
	const props = node.memoizedProps;
	if (!props) return false;

	// React Navigation Stack hides inactive screens with pointerEvents/opacity
	if (props.pointerEvents === "none") return true;

	// Check style for display:none or opacity:0
	const style = props.style as Record<string, unknown> | undefined;
	if (style) {
		if (style.display === "none") return true;
		if (style.opacity === 0) return true;
	}

	return false;
}

function walkFiber(fiber: unknown, elements: CollectedElement[], parentPath: string): void {
	const node = fiber as FiberNode;
	if (!node) return;

	// Skip hidden subtrees (inactive screens in Stack navigator)
	if (node.tag === HOST_COMPONENT && isHiddenSubtree(node)) {
		// Still process siblings, just skip this subtree's children
		if (node.sibling) {
			walkFiber(node.sibling, elements, parentPath);
		}
		return;
	}

	const componentName = getComponentName(node);

	if (node.tag === HOST_COMPONENT && node.stateNode) {
		// This is a native view — try to measure it
		const handle = findNodeHandle(node.stateNode as React.Component);

		if (handle) {
			try {
				UIManager.measure(handle, (_x, _y, width, height, pageX, pageY) => {
					if (width > 0 && height > 0) {
						const element: CollectedElement = {
							id: `fiber-${elements.length}`,
							componentName,
							componentPath: buildComponentPath(node),
							boundingBox: {
								x: pageX,
								y: pageY,
								width,
								height,
							},
						};

						// Source location from React's debug info
						if (node._debugSource) {
							element.componentFile = node._debugSource.fileName?.replace(/^.*\//, "");
							element.sourceLocation = {
								file: node._debugSource.fileName,
								line: node._debugSource.lineNumber,
								column: node._debugSource.columnNumber,
							};
						}

						// Text content
						if (typeof node.memoizedProps?.children === "string") {
							element.textContent = node.memoizedProps.children;
						}

						// Accessibility
						const props = node.memoizedProps;
						if (
							props?.accessibilityLabel ||
							props?.accessibilityRole ||
							props?.accessibilityHint ||
							props?.accessible
						) {
							element.accessibility = {
								label: props.accessibilityLabel as string | undefined,
								role: props.accessibilityRole as string | undefined,
								hint: props.accessibilityHint as string | undefined,
							};
						}

						elements.push(element);
					}
				});
			} catch {
				// Measure failed for this element
			}
		}
	}

	// Recurse into children
	if (node.child) {
		walkFiber(node.child, elements, parentPath);
	}

	// Recurse into siblings
	if (node.sibling) {
		walkFiber(node.sibling, elements, parentPath);
	}
}

/**
 * Collect elements and resolve all async measurements.
 * Returns after a short delay to allow UIManager.measure callbacks to fire.
 */
export async function collectElementTreeAsync(): Promise<CollectedElement[]> {
	const elements = await collectElementTree();
	// UIManager.measure callbacks are async — wait briefly
	await new Promise<void>((resolve) => setTimeout(() => resolve(), 100));
	return elements;
}
