import { Router } from "express";
import type { BusEvent, EventBus } from "../event-bus";

export function createSSERouter(eventBus: EventBus): Router {
	const router = Router();

	router.get("/", (req, res) => {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		// Replay missed events if client reconnects with Last-Event-ID
		const lastEventId = req.headers["last-event-id"];
		if (lastEventId) {
			const sinceSequence = Number.parseInt(lastEventId as string, 10);
			if (!Number.isNaN(sinceSequence)) {
				const missed = eventBus.getEventsSince(sinceSequence);
				for (const event of missed) {
					res.write(`id: ${event.sequence}\n`);
					res.write(`event: ${event.type}\n`);
					res.write(
						`data: ${JSON.stringify({ ...(event.data as object), _sequence: event.sequence })}\n\n`,
					);
				}
			}
		}

		const handler = (event: BusEvent) => {
			res.write(`id: ${event.sequence}\n`);
			res.write(`event: ${event.type}\n`);
			res.write(
				`data: ${JSON.stringify({ ...(event.data as object), _sequence: event.sequence })}\n\n`,
			);
		};

		eventBus.onEvent(handler);

		req.on("close", () => {
			eventBus.offEvent(handler);
		});
	});

	// Explicit replay endpoint for non-SSE clients
	router.get("/replay", (req, res) => {
		const since = Number.parseInt(req.query.since as string, 10);
		if (Number.isNaN(since)) {
			res.status(400).json({ error: "since parameter required (sequence number)" });
			return;
		}
		const sessionId = req.query.sessionId as string | undefined;
		const events = eventBus.getEventsSince(since, sessionId);
		res.json({
			events,
			currentSequence: eventBus.currentSequence,
		});
	});

	return router;
}
