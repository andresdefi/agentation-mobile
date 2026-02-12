import type { MobileElement } from "@agentation-mobile/core";
import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";

export class ReactNativeBridge implements IPlatformBridge {
	readonly platform = "react-native" as const;

	async listDevices(): Promise<DeviceInfo[]> {
		// TODO: Discover running Metro bundler instances + connected devices
		return [];
	}

	async captureScreen(_deviceId: string): Promise<Buffer> {
		// TODO: Capture via ADB (Android) or simctl (iOS)
		throw new Error("Not implemented");
	}

	async getElementTree(_deviceId: string): Promise<MobileElement[]> {
		// TODO: Connect to Hermes CDP, walk fiber tree via __REACT_DEVTOOLS_GLOBAL_HOOK__
		return [];
	}

	async inspectElement(
		_deviceId: string,
		_x: number,
		_y: number,
	): Promise<MobileElement | null> {
		// TODO: Hit-test element from fiber tree using bounding boxes
		return null;
	}

	async isAvailable(): Promise<boolean> {
		// TODO: Check if Metro bundler is reachable
		return false;
	}
}
