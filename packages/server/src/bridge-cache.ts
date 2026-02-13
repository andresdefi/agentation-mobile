import type { IPlatformBridge } from "@agentation-mobile/bridge-core";

/** Cache of deviceId -> bridge to avoid re-listing on every request. */
const deviceBridgeCache = new Map<string, { bridge: IPlatformBridge; expiresAt: number }>();
const CACHE_TTL = 30_000;

export async function findBridgeForDevice(
	bridges: IPlatformBridge[],
	deviceId: string,
): Promise<IPlatformBridge | undefined> {
	const cached = deviceBridgeCache.get(deviceId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.bridge;
	}
	const results = await Promise.allSettled(
		bridges.map(async (bridge) => {
			const devices = await bridge.listDevices();
			return { bridge, devices };
		}),
	);
	const now = Date.now();
	let match: IPlatformBridge | undefined;
	for (const result of results) {
		if (result.status !== "fulfilled") continue;
		const { bridge, devices } = result.value;
		for (const d of devices) {
			deviceBridgeCache.set(d.id, { bridge, expiresAt: now + CACHE_TTL });
			if (d.id === deviceId) match = bridge;
		}
	}
	return match;
}
