import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import type { MobileElement } from "@agentation-mobile/core";

export class FlutterBridge implements IPlatformBridge {
	readonly platform = "flutter" as const;

	async listDevices(): Promise<DeviceInfo[]> {
		// TODO: Discover running Flutter apps via Dart VM Service
		return [];
	}

	async captureScreen(_deviceId: string): Promise<Buffer> {
		// TODO: Capture via Dart VM Service or platform-specific tools
		throw new Error("Not implemented");
	}

	async getElementTree(_deviceId: string): Promise<MobileElement[]> {
		// TODO: Use ext.flutter.inspector.getRootWidgetSummaryTree
		return [];
	}

	async inspectElement(_deviceId: string, _x: number, _y: number): Promise<MobileElement | null> {
		// TODO: Hit-test via ext.flutter.inspector.getWidgetForHitTest
		return null;
	}

	async isAvailable(): Promise<boolean> {
		// TODO: Check if Flutter daemon is running
		return false;
	}
}
