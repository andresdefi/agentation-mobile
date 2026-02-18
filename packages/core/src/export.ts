import type { MobileAnnotation } from "./schemas/mobile-annotation";
import type { MobileElement } from "./schemas/mobile-element";
import type { Session } from "./schemas/session";

export type DetailLevel = "compact" | "standard" | "detailed" | "forensic";

/** Returns a human-readable display name for an element, e.g. `Button "Submit"` */
export function formatElementName(element: MobileElement): string {
	const name = element.componentName;
	const text = element.textContent || element.accessibility?.label || element.nearbyText || null;
	if (!text) return name;
	const truncated = text.length > 30 ? `${text.slice(0, 27)}...` : text;
	return `${name} "${truncated}"`;
}

export interface ExportData {
	session?: Session;
	annotations: MobileAnnotation[];
	exportedAt: string;
}

export function exportToJson(annotations: MobileAnnotation[], session?: Session): string {
	const data: ExportData = {
		session,
		annotations,
		exportedAt: new Date().toISOString(),
	};
	return JSON.stringify(data, null, 2);
}

export function exportToMarkdown(annotations: MobileAnnotation[], session?: Session): string {
	const lines: string[] = [];

	if (session) {
		lines.push(`# Annotations Report - ${session.name}`);
		lines.push("");
		lines.push(`**Device:** ${session.deviceId} | **Platform:** ${session.platform}`);
		lines.push(`**Date:** ${session.createdAt}`);
	} else {
		lines.push("# Annotations Report");
	}

	lines.push("");
	lines.push(`**Total annotations:** ${annotations.length}`);
	lines.push("");
	lines.push("---");

	for (let i = 0; i < annotations.length; i++) {
		const annotation = annotations[i];
		lines.push("");
		lines.push(`## Annotation #${i + 1}: ${annotation.comment}`);
		lines.push("");
		lines.push(`- **Status:** ${annotation.status}`);
		lines.push(`- **Intent:** ${annotation.intent} | **Severity:** ${annotation.severity}`);
		lines.push(`- **Position:** ${annotation.x}%, ${annotation.y}%`);

		if (annotation.element) {
			lines.push(
				`- **Element:** ${annotation.element.componentName} (${annotation.element.componentPath})`,
			);
		}

		if (annotation.selectedArea) {
			const sa = annotation.selectedArea;
			lines.push(
				`- **Area:** ${sa.width.toFixed(0)}% x ${sa.height.toFixed(0)}% at (${sa.x.toFixed(0)}%, ${sa.y.toFixed(0)}%)`,
			);
		}

		if (annotation.selectedText) {
			lines.push(`- **Selected Text:** "${annotation.selectedText}"`);
		}

		lines.push(`- **Created:** ${annotation.createdAt}`);

		if (annotation.thread.length > 0) {
			lines.push("");
			lines.push("### Thread");
			lines.push("");
			for (const message of annotation.thread) {
				lines.push(`> **${message.role}** (${message.timestamp}): ${message.content}`);
				lines.push("");
			}
		}
	}

	return lines.join("\n");
}

/**
 * Clean markdown format optimized for AI agents.
 * Designed to be pasted into any AI tool (ChatGPT, Claude, etc.)
 */
export function exportToAgentMarkdown(annotations: MobileAnnotation[], session?: Session): string {
	const lines: string[] = [];

	if (session) {
		lines.push(`## Screen Feedback: ${session.name} (${session.platform})`);
		lines.push(`**Screen:** ${session.deviceId}`);
	} else {
		lines.push("## Screen Feedback");
	}
	lines.push("");

	for (let i = 0; i < annotations.length; i++) {
		const a = annotations[i];

		const elementName = a.element
			? formatElementName(a.element)
			: `Point ${a.x.toFixed(0)}%, ${a.y.toFixed(0)}%`;
		lines.push(`### ${i + 1}. ${elementName}`);

		if (a.element?.componentPath) {
			lines.push(`**Component:** ${a.element.componentPath}`);
		}
		if (a.element?.componentFile) {
			let source = a.element.componentFile;
			if (a.element.sourceLocation) {
				source += `:${a.element.sourceLocation.line}`;
			}
			lines.push(`**Source:** ${source}`);
		}
		lines.push(`**Feedback:** ${a.comment}`);

		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

export type ComponentDetectionMode = "none" | "name-only" | "name-file" | "full-hierarchy";

export function getDetectionModeForLevel(level: DetailLevel): ComponentDetectionMode {
	switch (level) {
		case "compact":
			return "none";
		case "standard":
			return "name-file";
		case "detailed":
			return "full-hierarchy";
		case "forensic":
			return "full-hierarchy";
	}
}

/**
 * Export annotations with configurable detail level.
 *
 * - compact: comment + intent + severity only (no component info)
 * - standard: + position, device, component name + file
 * - detailed: + full component path hierarchy, bounding boxes, thread
 * - forensic: + accessibility, styles, animations, source location, timestamps
 */
export function exportWithDetailLevel(
	annotations: MobileAnnotation[],
	level: DetailLevel = "standard",
	session?: Session,
): string {
	const lines: string[] = [];
	const mode = getDetectionModeForLevel(level);

	if (session) {
		lines.push(`# ${session.name} — ${annotations.length} annotations`);
		if (level !== "compact") {
			lines.push(`Platform: ${session.platform} | Device: ${session.deviceId}`);
		}
	} else {
		lines.push(`# ${annotations.length} annotations`);
	}
	lines.push("");

	for (let i = 0; i < annotations.length; i++) {
		const a = annotations[i];

		// All levels: intent/severity + comment
		let ref = `${i + 1}. [${a.intent}/${a.severity}]`;

		// Component info based on detection mode
		if (mode !== "none" && a.element?.componentName) {
			ref += ` ${a.element.componentName}`;
			if (mode === "name-file" && a.element.componentFile) {
				ref += ` (${a.element.componentFile})`;
			} else if (mode === "full-hierarchy" && a.element.componentPath) {
				ref += ` > ${a.element.componentPath}`;
			}
		}
		lines.push(ref);
		lines.push(`   ${a.comment}`);

		// Standard+: status + position + device + area + text
		if (level !== "compact") {
			let posLine = `   Status: ${a.status} | Position: ${a.x.toFixed(1)}%, ${a.y.toFixed(1)}%`;
			if (a.selectedArea) {
				posLine += ` | Area: ${a.selectedArea.width.toFixed(0)}%x${a.selectedArea.height.toFixed(0)}% at (${a.selectedArea.x.toFixed(0)}%,${a.selectedArea.y.toFixed(0)}%)`;
			}
			lines.push(posLine);
			if (a.selectedText) {
				lines.push(`   SelectedText: "${a.selectedText}"`);
			}
			lines.push(`   Device: ${a.deviceId} (${a.platform}) ${a.screenWidth}x${a.screenHeight}`);
		}

		// Detailed+: bounding box, component path, thread, source location
		if (level === "detailed" || level === "forensic") {
			if (a.element?.componentPath) {
				lines.push(`   Path: ${a.element.componentPath}`);
			}
			if (a.element?.componentFile) {
				let source = `   Source: ${a.element.componentFile}`;
				if (a.element.sourceLocation) {
					source += `:${a.element.sourceLocation.line}`;
					if (a.element.sourceLocation.column != null) {
						source += `:${a.element.sourceLocation.column}`;
					}
				}
				lines.push(source);
			}
			if (a.element?.boundingBox) {
				const bb = a.element.boundingBox;
				lines.push(`   BoundingBox: ${bb.x},${bb.y} ${bb.width}x${bb.height}`);
			}
			if (a.thread.length > 0) {
				for (const msg of a.thread) {
					lines.push(`   > ${msg.role}: ${msg.content}`);
				}
			}
		}

		// Forensic: full element properties + animations
		if (level === "forensic" && a.element) {
			if (a.element.textContent) {
				lines.push(`   Text: "${a.element.textContent}"`);
			}
			if (a.element.nearbyText) {
				lines.push(`   NearbyText: "${a.element.nearbyText}"`);
			}
			if (a.element.accessibility) {
				const acc = a.element.accessibility;
				const parts: string[] = [];
				if (acc.role) parts.push(`role=${acc.role}`);
				if (acc.label) parts.push(`label="${acc.label}"`);
				if (acc.hint) parts.push(`hint="${acc.hint}"`);
				if (acc.value) parts.push(`value="${acc.value}"`);
				if (acc.traits?.length) parts.push(`traits=[${acc.traits.join(",")}]`);
				if (parts.length > 0) {
					lines.push(`   Accessibility: ${parts.join(" | ")}`);
				}
			}
			if (a.element.styleProps && Object.keys(a.element.styleProps).length > 0) {
				lines.push(`   Styles: ${JSON.stringify(a.element.styleProps)}`);
			}
			if (a.element.animations && a.element.animations.length > 0) {
				const animDescs = a.element.animations.map((anim) => {
					let desc = `${anim.property} (${anim.type})`;
					if (anim.status) desc += ` [${anim.status}]`;
					if (anim.duration) desc += ` ${anim.duration}ms`;
					if (anim.sourceLocation) {
						desc += ` @ ${anim.sourceLocation.file}:${anim.sourceLocation.line}`;
					}
					return desc;
				});
				lines.push(`   Animations: ${animDescs.join("; ")}`);
			}
			lines.push(`   Created: ${a.createdAt} | Updated: ${a.updatedAt}`);
		}

		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

/**
 * AFS (Agentation Format Standard) annotation representation.
 * Maps mobile-specific field names to Agentation's web-oriented naming.
 */
export interface AFSAnnotation {
	id: string;
	sessionId: string;
	x: number;
	y: number;
	deviceId: string;
	platform: string;
	screenWidth: number;
	screenHeight: number;
	comment: string;
	intent: string;
	severity: string;
	status: string;
	element?: string;
	elementPath?: string;
	elementFile?: string;
	sourceLocation?: { file: string; line: number; column?: number };
	selectedArea?: { x: number; y: number; width: number; height: number };
	selectedText?: string;
	thread: Array<{ id: string; role: string; content: string; timestamp: string }>;
	createdAt: string;
	updatedAt: string;
}

/**
 * Convert a MobileAnnotation to the Agentation Format Standard (AFS).
 * Maps componentName → element, componentPath → elementPath, etc.
 */
export function toAFS(annotation: MobileAnnotation): AFSAnnotation {
	return {
		id: annotation.id,
		sessionId: annotation.sessionId,
		x: annotation.x,
		y: annotation.y,
		deviceId: annotation.deviceId,
		platform: annotation.platform,
		screenWidth: annotation.screenWidth,
		screenHeight: annotation.screenHeight,
		comment: annotation.comment,
		intent: annotation.intent,
		severity: annotation.severity,
		status: annotation.status,
		element: annotation.element?.componentName,
		elementPath: annotation.element?.componentPath,
		elementFile: annotation.element?.componentFile,
		sourceLocation: annotation.element?.sourceLocation,
		selectedArea: annotation.selectedArea,
		selectedText: annotation.selectedText,
		thread: annotation.thread.map((m) => ({
			id: (m as { id?: string }).id ?? "",
			role: m.role,
			content: m.content,
			timestamp: m.timestamp,
		})),
		createdAt: annotation.createdAt,
		updatedAt: annotation.updatedAt,
	};
}

export function formatGitHubIssueBody(annotation: MobileAnnotation, session?: Session): string {
	const lines: string[] = [];

	lines.push("## Annotation Details");
	lines.push("");
	lines.push(`**Comment:** ${annotation.comment}`);
	lines.push(`**Intent:** ${annotation.intent} | **Severity:** ${annotation.severity}`);
	lines.push(`**Status:** ${annotation.status}`);
	lines.push("");

	lines.push("## Context");
	lines.push("");
	lines.push(`- **Position:** ${annotation.x}%, ${annotation.y}%`);
	if (annotation.selectedArea) {
		const sa = annotation.selectedArea;
		lines.push(
			`- **Selected Area:** ${sa.width.toFixed(0)}% x ${sa.height.toFixed(0)}% at (${sa.x.toFixed(0)}%, ${sa.y.toFixed(0)}%)`,
		);
	}
	if (annotation.selectedText) {
		lines.push(`- **Selected Text:** "${annotation.selectedText}"`);
	}
	lines.push(`- **Screen:** ${annotation.screenWidth}x${annotation.screenHeight}`);
	lines.push(`- **Device:** ${annotation.deviceId}`);
	lines.push(`- **Platform:** ${annotation.platform}`);

	if (session) {
		lines.push(`- **Session:** ${session.name} (${session.id})`);
	}

	if (annotation.element) {
		lines.push("");
		lines.push("## Element");
		lines.push("");
		lines.push(`- **Component:** ${annotation.element.componentName}`);
		lines.push(`- **Path:** ${annotation.element.componentPath}`);
		if (annotation.element.componentFile) {
			lines.push(`- **File:** ${annotation.element.componentFile}`);
		}
		if (annotation.element.textContent) {
			lines.push(`- **Text:** ${annotation.element.textContent}`);
		}
		if (annotation.element.accessibility) {
			const a11y = annotation.element.accessibility;
			if (a11y.label) lines.push(`- **Accessibility label:** ${a11y.label}`);
			if (a11y.role) lines.push(`- **Accessibility role:** ${a11y.role}`);
		}
	}

	if (annotation.thread.length > 0) {
		lines.push("");
		lines.push("## Thread");
		lines.push("");
		for (const message of annotation.thread) {
			lines.push(`> **${message.role}** (${message.timestamp}): ${message.content}`);
			lines.push("");
		}
	}

	lines.push("");
	lines.push("---");
	lines.push(`*Generated by agentation-mobile on ${new Date().toISOString()}*`);

	return lines.join("\n");
}
