import type { IPlatformBridge } from "@agentation-mobile/bridge-core";
import { Router } from "express";
import { findBridgeForDevice } from "../bridge-cache";

export function createInputRoutes(bridges: IPlatformBridge[]): Router {
	const router = Router();

	// Tap at screen coordinates
	router.post("/:deviceId/input/tap", async (req, res) => {
		const { deviceId } = req.params;
		const { x, y } = req.body as { x?: number; y?: number };
		if (x == null || y == null) {
			res.status(400).json({ error: "x and y are required" });
			return;
		}
		const bridge = await findBridgeForDevice(bridges, deviceId);
		if (!bridge?.sendTap) {
			res.status(400).json({ error: "No bridge supports tap for this device" });
			return;
		}
		try {
			await bridge.sendTap(deviceId, x, y);
			res.json({ success: true });
		} catch (err) {
			res.status(500).json({ error: `Tap failed: ${err}` });
		}
	});

	// Swipe gesture
	router.post("/:deviceId/input/swipe", async (req, res) => {
		const { deviceId } = req.params;
		const { fromX, fromY, toX, toY, durationMs } = req.body as {
			fromX?: number;
			fromY?: number;
			toX?: number;
			toY?: number;
			durationMs?: number;
		};
		if (fromX == null || fromY == null || toX == null || toY == null) {
			res.status(400).json({ error: "fromX, fromY, toX, toY are required" });
			return;
		}
		const bridge = await findBridgeForDevice(bridges, deviceId);
		if (!bridge?.sendSwipe) {
			res.status(400).json({ error: "No bridge supports swipe for this device" });
			return;
		}
		try {
			await bridge.sendSwipe(deviceId, fromX, fromY, toX, toY, durationMs);
			res.json({ success: true });
		} catch (err) {
			res.status(500).json({ error: `Swipe failed: ${err}` });
		}
	});

	// Type text
	router.post("/:deviceId/input/text", async (req, res) => {
		const { deviceId } = req.params;
		const { text } = req.body as { text?: string };
		if (!text) {
			res.status(400).json({ error: "text is required" });
			return;
		}
		const bridge = await findBridgeForDevice(bridges, deviceId);
		if (!bridge?.sendText) {
			res.status(400).json({ error: "No bridge supports text input for this device" });
			return;
		}
		try {
			await bridge.sendText(deviceId, text);
			res.json({ success: true });
		} catch (err) {
			res.status(500).json({ error: `Text input failed: ${err}` });
		}
	});

	// Key event
	router.post("/:deviceId/input/key", async (req, res) => {
		const { deviceId } = req.params;
		const { keyCode } = req.body as { keyCode?: string };
		if (!keyCode) {
			res.status(400).json({ error: "keyCode is required" });
			return;
		}
		const bridge = await findBridgeForDevice(bridges, deviceId);
		if (!bridge?.sendKeyEvent) {
			res.status(400).json({ error: "No bridge supports key events for this device" });
			return;
		}
		try {
			await bridge.sendKeyEvent(deviceId, keyCode);
			res.json({ success: true });
		} catch (err) {
			res.status(500).json({ error: `Key event failed: ${err}` });
		}
	});

	return router;
}
