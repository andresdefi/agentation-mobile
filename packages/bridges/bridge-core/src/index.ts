import type { MobileElement, Platform } from "@agentation-mobile/core";

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
}

export type { DeviceInfo as Device };
