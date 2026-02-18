import type { IStore } from "@agentation-mobile/core";
import { Router } from "express";
import type { EventBus } from "../event-bus";
import type { RecordingEngine } from "../recording-engine";

export function createRecordingRoutes(
	store: IStore,
	engine: RecordingEngine,
	eventBus: EventBus,
): Router {
	const router = Router();

	// Start a new recording
	router.post("/start", async (req, res) => {
		const { deviceId, sessionId, fps } = req.body as {
			deviceId?: string;
			sessionId?: string;
			fps?: number;
		};
		if (!deviceId) {
			res.status(400).json({ error: "deviceId is required" });
			return;
		}
		try {
			const recording = await engine.start(deviceId, fps ?? 10, sessionId);
			eventBus.emit("recording.started", recording);
			res.json(recording);
		} catch (err) {
			res.status(500).json({ error: `Failed to start recording: ${err}` });
		}
	});

	// Stop a recording
	router.post("/:id/stop", (req, res) => {
		const recording = engine.stop(req.params.id);
		if (!recording) {
			res.status(404).json({ error: "Recording not found" });
			return;
		}
		eventBus.emit("recording.stopped", recording);
		res.json(recording);
	});

	// List all recordings
	router.get("/", (_req, res) => {
		res.json(store.listRecordings());
	});

	// Get recording metadata
	router.get("/:id", (req, res) => {
		const recording = store.getRecording(req.params.id);
		if (!recording) {
			res.status(404).json({ error: "Recording not found" });
			return;
		}
		res.json(recording);
	});

	// Get frame list (metadata only)
	router.get("/:id/frames", (req, res) => {
		const recording = store.getRecording(req.params.id);
		if (!recording) {
			res.status(404).json({ error: "Recording not found" });
			return;
		}
		const frames = store.getRecordingFrames(req.params.id);
		res.json(frames);
	});

	// Get frame image at timestamp
	router.get("/:id/frame", (req, res) => {
		const recording = store.getRecording(req.params.id);
		if (!recording) {
			res.status(404).json({ error: "Recording not found" });
			return;
		}
		const t = Number(req.query.t);
		if (Number.isNaN(t)) {
			res.status(400).json({ error: "t (timestamp in ms) query param required" });
			return;
		}
		const frame = store.getFrameAtTimestamp(req.params.id, t);
		if (!frame) {
			res.status(404).json({ error: "No frame at this timestamp" });
			return;
		}
		const data = store.getScreenshot(frame.screenshotId);
		if (!data) {
			res.status(404).json({ error: "Frame screenshot not found" });
			return;
		}
		res.setHeader("Content-Type", "image/png");
		res.send(data);
	});

	return router;
}
