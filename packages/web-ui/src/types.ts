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

export interface MobileElement {
	id: string;
	platform: Platform;
	componentPath: string;
	componentName: string;
	componentFile?: string;
	boundingBox: BoundingBox;
	styleProps?: Record<string, unknown>;
	accessibility?: Accessibility;
	textContent?: string;
	nearbyText?: string;
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
	screenshotId?: string;
	comment: string;
	intent: AnnotationIntent;
	severity: AnnotationSeverity;
	status: AnnotationStatus;
	element?: MobileElement;
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
	comment: string;
	intent: AnnotationIntent;
	severity: AnnotationSeverity;
}
