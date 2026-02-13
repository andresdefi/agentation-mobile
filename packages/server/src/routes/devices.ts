import type { IPlatformBridge } from "@agentation-mobile/bridge-core";
import { Router } from "express";

/** Cache of deviceId → bridge to avoid re-listing on every request. */
const deviceBridgeCache = new Map<string, { bridge: IPlatformBridge; expiresAt: number }>();
const CACHE_TTL = 30_000;

async function findBridgeForDevice(
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

export function createDeviceRoutes(bridges: IPlatformBridge[]): Router {
	const router = Router();

	// List all devices across all bridges (parallel)
	router.get("/", async (_req, res) => {
		const results = await Promise.allSettled(
			bridges.map(async (bridge) => {
				if (await bridge.isAvailable()) {
					return bridge.listDevices();
				}
				return [];
			}),
		);
		const devices = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
		res.json(devices);
	});

	// Connect to a device over WiFi
	router.post("/connect", async (req, res) => {
		const { host, port } = req.body as { host?: string; port?: number };
		if (!host) {
			res.status(400).json({ error: "host is required" });
			return;
		}
		for (const bridge of bridges) {
			if (bridge.connectWifi) {
				const result = await bridge.connectWifi(host, port);
				res.json(result);
				return;
			}
		}
		res.status(400).json({ error: "No bridge supports WiFi connection" });
	});

	// Pair with a device (Android 11+)
	router.post("/pair", async (req, res) => {
		const { host, port, code } = req.body as {
			host?: string;
			port?: number;
			code?: string;
		};
		if (!host || !port || !code) {
			res.status(400).json({ error: "host, port, and code are required" });
			return;
		}
		for (const bridge of bridges) {
			if (bridge.pairDevice) {
				const result = await bridge.pairDevice(host, port, code);
				res.json(result);
				return;
			}
		}
		res.status(400).json({ error: "No bridge supports device pairing" });
	});

	// Disconnect a WiFi-connected device
	router.post("/:deviceId/disconnect", async (req, res) => {
		const { deviceId } = req.params;
		for (const bridge of bridges) {
			if (bridge.disconnectDevice) {
				const result = await bridge.disconnectDevice(deviceId);
				res.json(result);
				return;
			}
		}
		res.status(400).json({ error: "No bridge supports device disconnect" });
	});

	// Pause animations on a device
	router.post("/:deviceId/pause-animations", async (req, res) => {
		const { deviceId } = req.params;
		const bridge = await findBridgeForDevice(bridges, deviceId);
		if (bridge?.pauseAnimations) {
			const result = await bridge.pauseAnimations(deviceId);
			res.json(result);
			return;
		}
		res.status(400).json({ error: "No bridge supports animation control for this device" });
	});

	// Resume animations on a device
	router.post("/:deviceId/resume-animations", async (req, res) => {
		const { deviceId } = req.params;
		const bridge = await findBridgeForDevice(bridges, deviceId);
		if (bridge?.resumeAnimations) {
			const result = await bridge.resumeAnimations(deviceId);
			res.json(result);
			return;
		}
		res.status(400).json({ error: "No bridge supports animation control for this device" });
	});

	return router;
}
