import type { IStore } from "@agentation-mobile/core";
import { Router } from "express";
import type { EventBus } from "../event-bus";

export function createAnnotationRoutes(store: IStore, eventBus: EventBus): Router {
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
			sessionId,
			x,
			y,
			deviceId,
			platform,
			screenWidth,
			screenHeight,
			screenId,
			screenshotId,
			comment,
			intent,
			severity,
			element,
			selectedArea,
			selectedText,
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

		const resolvedDeviceId = deviceId || session.deviceId;

		const annotation = store.createAnnotation({
			sessionId,
			x,
			y,
			deviceId: resolvedDeviceId,
			platform: platform || session.platform,
			screenWidth: screenWidth || 0,
			screenHeight: screenHeight || 0,
			screenId: screenId || null,
			screenshotId,
			comment,
			intent,
			severity,
			element,
			selectedArea,
			selectedText,
		});

		eventBus.emit("annotation.created", annotation, annotation.sessionId, resolvedDeviceId);
		res.status(201).json(annotation);
	});

	// Delete annotation
	router.delete("/:id", (req, res) => {
		const annotation = store.getAnnotation(req.params.id);
		const deleted = store.deleteAnnotation(req.params.id);
		if (!deleted) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit(
			"annotation.deleted",
			{ id: req.params.id },
			annotation?.sessionId,
			annotation?.deviceId,
		);
		res.json({ deleted: true });
	});

	// Acknowledge
	router.post("/:id/acknowledge", (req, res) => {
		const annotation = store.updateAnnotationStatus(req.params.id, "acknowledged");
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit("annotation.updated", annotation, annotation.sessionId, annotation.deviceId);
		res.json(annotation);
	});

	// Resolve
	router.post("/:id/resolve", (req, res) => {
		const annotation = store.updateAnnotationStatus(req.params.id, "resolved");
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit("annotation.updated", annotation, annotation.sessionId, annotation.deviceId);
		res.json(annotation);
	});

	// Dismiss
	router.post("/:id/dismiss", (req, res) => {
		const { reason } = req.body ?? {};
		if (reason) {
			store.addThreadMessage(req.params.id, {
				role: "agent",
				content: `Dismissed: ${reason}`,
				timestamp: new Date().toISOString(),
			});
		}
		const annotation = store.updateAnnotationStatus(req.params.id, "dismissed");
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		eventBus.emit("annotation.updated", annotation, annotation.sessionId, annotation.deviceId);
		res.json(annotation);
	});

	// Request agent action
	router.post("/:id/request-action", (req, res) => {
		const annotation = store.getAnnotation(req.params.id);
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		const { prompt } = req.body;
		eventBus.emit(
			"action.requested",
			{ annotationId: annotation.id, annotation, prompt: prompt || null },
			annotation.sessionId,
			annotation.deviceId,
		);
		res.json({ requested: true, annotationId: annotation.id });
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
		eventBus.emit("thread.message", annotation, annotation.sessionId, annotation.deviceId);
		res.json(annotation);
	});

	return router;
}
