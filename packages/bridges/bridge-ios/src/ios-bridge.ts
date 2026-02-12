import type { MobileElement } from "@agentation-mobile/core";
import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";

export class IosBridge implements IPlatformBridge {
	readonly platform = "ios-native" as const;

	async listDevices(): Promise<DeviceInfo[]> {
		// TODO: Implement xcrun simctl list devices -j
		return [];
	}

	async captureScreen(_deviceId: string): Promise<Buffer> {
		// TODO: Implement xcrun simctl io booted screenshot
		throw new Error("Not implemented");
	}

	async getElementTree(_deviceId: string): Promise<MobileElement[]> {
		// TODO: Implement accessibility tree inspection
		return [];
	}

	async inspectElement(
		_deviceId: string,
		_x: number,
		_y: number,
	): Promise<MobileElement | null> {
		// TODO: Implement element hit-testing from accessibility tree
		return null;
	}

	async isAvailable(): Promise<boolean> {
		// TODO: Check if xcrun simctl is available (macOS only)
		return false;
	}
}
