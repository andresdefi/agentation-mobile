import { Router } from "express";
import type { Store } from "@agentation-mobile/core";
import type { EventBus } from "../event-bus";

export function createAnnotationRoutes(store: Store, eventBus: EventBus): Router {
	const router = Router();

	// Get all pending across all sessions
	router.get("/pending", (_req, res) => {
		res.json(store.getAllPendingAnnotations());
	});

	// Get single annotation
	router.get("/:id", (req, res) => {
		const annotation = store.getAnnotation(req.params.id);
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		res.json(annotation);
	});

	// Create annotation
	router.post("/", (req, res) => {
		const {
			sessionId, x, y, deviceId, platform,
			screenWidth, screenHeight, screenshotId,
			comment, intent, severity, element,
		} = req.body;

		if (!sessionId || x == null || y == null || !comment || !intent || !severity) {
			res.status(400).json({
				error: "sessionId, x, y, comment, intent, severity required",
			});
			return;
		}

		const session = store.getSession(sessionId);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}

		const annotation = store.createAnnotation({
			sessionId,
			x, y,
			deviceId: deviceId || session.deviceId,
			platform: platform || session.platform,
			screenWidth: screenWidth || 0,
			screenHeight: screenHeight || 0,
			screenshotId,
			comment,
			intent,
			severity,
			element,
		});

		eventBus.emit("annotation:created", annotation);
		res.status(201).json(annotation);
	});

	// Acknowledge
	router.post("/:id/acknowledge", (req, res) => {
		const annotation = store.updateAnnotationStatus(req.params.id, "acknowledged");
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit("annotation:status", annotation);
		res.json(annotation);
	});

	// Resolve
	router.post("/:id/resolve", (req, res) => {
		const annotation = store.updateAnnotationStatus(req.params.id, "resolved");
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit("annotation:status", annotation);
		res.json(annotation);
	});

	// Dismiss
	router.post("/:id/dismiss", (req, res) => {
		const annotation = store.updateAnnotationStatus(req.params.id, "dismissed");
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit("annotation:status", annotation);
		res.json(annotation);
	});

	// Reply to thread
	router.post("/:id/reply", (req, res) => {
		const { role, content } = req.body;
		if (!role || !content) {
			res.status(400).json({ error: "role and content required" });
			return;
		}
		const annotation = store.addThreadMessage(req.params.id, {
			role,
			content,
			timestamp: new Date().toISOString(),
		});
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit("annotation:reply", annotation);
		res.json(annotation);
	});

	return router;
}
