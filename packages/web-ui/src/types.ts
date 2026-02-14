export type Platform = "react-native" | "flutter" | "ios-native" | "android-native";

export type AnnotationIntent = "fix" | "change" | "question" | "approve";

export type AnnotationSeverity = "blocking" | "important" | "suggestion";

export type AnnotationStatus = "pending" | "acknowledged" | "resolved" | "dismissed";

export interface DeviceInfo {
	id: string;
	name: string;
	platform: Platform;
	isEmulator: boolean;
	osVersion: string;
	screenWidth: number;
	screenHeight: number;
}

export interface ThreadMessage {
	role: "human" | "agent";
	content: string;
	timestamp: string;
}

export interface BoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Accessibility {
	label?: string;
	role?: string;
	hint?: string;
	value?: string;
	traits?: string[];
}

export interface SourceLocation {
	file: string;
	line: number;
	column?: number;
}

export interface AnimationInfo {
	type: "timing" | "spring" | "decay" | "transition" | "keyframe" | "unknown";
	property: string;
	status?: "running" | "paused" | "completed";
	duration?: number;
	sourceLocation?: SourceLocation;
}

export interface MobileElement {
	id: string;
	platform: Platform;
	componentPath: string;
	componentName: string;
	componentFile?: string;
	sourceLocation?: SourceLocation;
	boundingBox: BoundingBox;
	styleProps?: Record<string, unknown>;
	accessibility?: Accessibility;
	textContent?: string;
	nearbyText?: string;
	animations?: AnimationInfo[];
}

export interface SelectedArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MobileAnnotation {
	id: string;
	sessionId: string;
	x: number;
	y: number;
	deviceId: string;
	platform: string;
	screenWidth: number;
	screenHeight: number;
	screenId?: string | null;
	screenshotId?: string;
	resolvedScreenshotId?: string;
	comment: string;
	intent: AnnotationIntent;
	severity: AnnotationSeverity;
	status: AnnotationStatus;
	element?: MobileElement;
	selectedArea?: SelectedArea;
	selectedText?: string;
	thread: ThreadMessage[];
	createdAt: string;
	updatedAt: string;
}

export interface Session {
	id: string;
	name: string;
	deviceId: string;
	platform: string;
	createdAt: string;
	updatedAt: string;
}

export interface SessionWithAnnotations extends Session {
	annotations: MobileAnnotation[];
}

export interface CreateAnnotationPayload {
	sessionId: string;
	x: number;
	y: number;
	deviceId: string;
	platform: string;
	screenWidth: number;
	screenHeight: number;
	screenId?: string | null;
	comment: string;
	intent: AnnotationIntent;
	severity: AnnotationSeverity;
	element?: MobileElement;
	selectedArea?: SelectedArea;
	selectedText?: string;
}
