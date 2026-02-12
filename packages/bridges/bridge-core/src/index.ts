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
}

export type { DeviceInfo as Device };
