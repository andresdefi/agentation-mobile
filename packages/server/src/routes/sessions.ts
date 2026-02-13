import type { Store } from "@agentation-mobile/core";
import { Router } from "express";
import type { EventBus } from "../event-bus";

export function createSessionRoutes(store: Store, eventBus: EventBus): Router {
	const router = Router();

	// List sessions
	router.get("/", (_req, res) => {
		res.json(store.listSessions());
	});

	// Get session with annotations
	router.get("/:id", (req, res) => {
		const session = store.getSession(req.params.id);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}
		const annotations = store.getSessionAnnotations(session.id);
		res.json({ ...session, annotations });
	});

	// Create session
	router.post("/", (req, res) => {
		const { name, deviceId, platform } = req.body;
		if (!name || !deviceId || !platform) {
			res.status(400).json({ error: "name, deviceId, and platform required" });
			return;
		}
		const session = store.createSession({ name, deviceId, platform });
		eventBus.emit("session:created", session);
		res.status(201).json(session);
	});

	// Get pending annotations for session
	router.get("/:id/pending", (req, res) => {
		const session = store.getSession(req.params.id);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}
		res.json(store.getPendingAnnotations(session.id));
	});

	// Add device to session
	router.post("/:id/devices", (req, res) => {
		const { deviceId, platform } = req.body;
		if (!deviceId || !platform) {
			res.status(400).json({ error: "deviceId and platform required" });
			return;
		}
		const session = store.addDeviceToSession(req.params.id, deviceId, platform);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}
		res.json(session);
	});

	// Remove device from session
	router.delete("/:id/devices/:deviceId", (req, res) => {
		const session = store.removeDeviceFromSession(req.params.id, req.params.deviceId);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}
		res.json(session);
	});

	// Get annotations filtered by device
	router.get("/:id/devices/:deviceId/annotations", (req, res) => {
		const session = store.getSession(req.params.id);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}
		res.json(store.getSessionAnnotationsByDevice(session.id, req.params.deviceId));
	});

	return router;
}
