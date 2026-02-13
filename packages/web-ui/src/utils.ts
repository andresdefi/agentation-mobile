import type { MobileElement } from "./types";

/** Minimal cn utility for conditional class merging */
export function cn(...inputs: Array<string | false | null | undefined>): string {
	return inputs.filter(Boolean).join(" ");
}

/** Returns a human-readable display name for an element, e.g. `Button "Submit"` */
export function getElementDisplayName(element: MobileElement): string {
	const name = element.componentName;
	const text = element.textContent || element.accessibility?.label || element.nearbyText || null;
	if (!text) return name;
	const truncated = text.length > 30 ? `${text.slice(0, 27)}...` : text;
	return `${name} "${truncated}"`;
}

/** Client-side hit test: find the deepest/smallest element containing (xPct, yPct). */
export function hitTestElement(
	elements: MobileElement[],
	xPct: number,
	yPct: number,
	screenWidth: number,
	screenHeight: number,
): MobileElement | null {
	const px = (xPct / 100) * screenWidth;
	const py = (yPct / 100) * screenHeight;

	let best: MobileElement | null = null;
	let bestArea = Number.POSITIVE_INFINITY;

	// Iterate in reverse (later = deeper/on top)
	for (let i = elements.length - 1; i >= 0; i--) {
		const el = elements[i];
		const bb = el.boundingBox;
		if (!bb || bb.width <= 0 || bb.height <= 0) continue;
		if (px >= bb.x && px <= bb.x + bb.width && py >= bb.y && py <= bb.y + bb.height) {
			const area = bb.width * bb.height;
			if (area < bestArea) {
				best = el;
				bestArea = area;
			}
		}
	}
	return best;
}
