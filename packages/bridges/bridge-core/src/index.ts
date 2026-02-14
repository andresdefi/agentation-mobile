import type { AnimationInfo, MobileElement, Platform } from "@agentation-mobile/core";

export { parseUiAutomatorXml, hitTestElement } from "./uiautomator";
export { parseWmSize } from "./android-utils";
export {
	mergeElements,
	findBestMatch,
	mapRole,
	parseAccessibilityOutput,
	accessibilityNodesToElements,
} from "./accessibility-merge";
export type { AccessibilityNode } from "./accessibility-merge";
export {
	IOS_UDID_REGEX,
	isIosSimulatorId,
	IOS_SCREEN_SIZES,
	lookupIosScreenSize,
} from "./ios-devices";
export { SourceMapResolver } from "./source-maps";
export type { SourceMapping, SourceMap } from "./source-maps";

export interface DeviceInfo {
	id: string;
	name: string;
	platform: Platform;
	isEmulator: boolean;
	osVersion: string;
	screenWidth: number;
	screenHeight: number;
}

export interface IPlatformBridge {
	readonly platform: Platform;

	/** Discover connected devices/simulators/emulators */
	listDevices(): Promise<DeviceInfo[]>;

	/** Capture a screenshot as a PNG buffer */
	captureScreen(deviceId: string): Promise<Buffer>;

	/** Get the UI element tree for the current screen */
	getElementTree(deviceId: string): Promise<MobileElement[]>;

	/** Get the current screen/route identifier (optional) */
	getScreenId?(deviceId: string): Promise<string | null>;

	/** Inspect a specific element at screen coordinates */
	inspectElement(deviceId: string, x: number, y: number): Promise<MobileElement | null>;

	/** Check if the bridge is available (tools installed, etc.) */
	isAvailable(): Promise<boolean>;

	/** Connect to a device over WiFi (optional, not all bridges support it) */
	connectWifi?(host: string, port?: number): Promise<{ success: boolean; message: string }>;

	/** Pair with a device for WiFi debugging (optional, Android 11+) */
	pairDevice?(
		host: string,
		port: number,
		code: string,
	): Promise<{ success: boolean; message: string }>;

	/** Disconnect a WiFi-connected device (optional) */
	disconnectDevice?(deviceId: string): Promise<{ success: boolean; message: string }>;

	/** Pause/freeze all animations on the device (optional) */
	pauseAnimations?(deviceId: string): Promise<{ success: boolean; message: string }>;

	/** Resume animations on the device (optional) */
	resumeAnimations?(deviceId: string): Promise<{ success: boolean; message: string }>;

	/** Tap at screen coordinates (optional) */
	sendTap?(deviceId: string, x: number, y: number): Promise<void>;

	/** Swipe gesture between two points (optional) */
	sendSwipe?(
		deviceId: string,
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		durationMs?: number,
	): Promise<void>;

	/** Type text into the currently focused field (optional) */
	sendText?(deviceId: string, text: string): Promise<void>;

	/** Send a key event (optional) */
	sendKeyEvent?(deviceId: string, keyCode: string): Promise<void>;

	/** Get active animations on the current screen (optional) */
	getActiveAnimations?(deviceId: string): Promise<AnimationInfo[]>;
}

export type { DeviceInfo as Device };
