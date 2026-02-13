import type { IPlatformBridge } from "@agentation-mobile/bridge-core";
import { Router } from "express";

export function createDeviceRoutes(bridges: IPlatformBridge[]): Router {
	const router = Router();

	// List all devices across all bridges
	router.get("/", async (_req, res) => {
		const devices = [];
		for (const bridge of bridges) {
			try {
				if (await bridge.isAvailable()) {
					const bridgeDevices = await bridge.listDevices();
					devices.push(...bridgeDevices);
				}
			} catch {
				// skip unavailable bridges
			}
		}
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

	return router;
}
