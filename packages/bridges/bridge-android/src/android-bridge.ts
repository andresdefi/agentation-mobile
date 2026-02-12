import type { MobileElement } from "@agentation-mobile/core";
import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";

export class AndroidBridge implements IPlatformBridge {
	readonly platform = "android-native" as const;

	async listDevices(): Promise<DeviceInfo[]> {
		// TODO: Implement ADB device discovery
		return [];
	}

	async captureScreen(_deviceId: string): Promise<Buffer> {
		// TODO: Implement adb exec-out screencap -p
		throw new Error("Not implemented");
	}

	async getElementTree(_deviceId: string): Promise<MobileElement[]> {
		// TODO: Implement adb shell uiautomator dump + XML parsing
		return [];
	}

	async inspectElement(
		_deviceId: string,
		_x: number,
		_y: number,
	): Promise<MobileElement | null> {
		// TODO: Implement element hit-testing from UIAutomator tree
		return null;
	}

	async isAvailable(): Promise<boolean> {
		// TODO: Check if adb is installed and accessible
		return false;
	}
}
