import { Router } from "express";
import type { IPlatformBridge } from "@agentation-mobile/bridge-core";

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

	return router;
}
