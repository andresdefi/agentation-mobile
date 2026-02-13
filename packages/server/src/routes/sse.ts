import { Router } from "express";
import type { BusEvent, EventBus } from "../event-bus";

export function createSSERouter(eventBus: EventBus): Router {
	const router = Router();

	router.get("/", (req, res) => {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		const handler = (event: BusEvent) => {
			res.write(`event: ${event.type}\n`);
			res.write(`data: ${JSON.stringify(event.data)}\n\n`);
		};

		eventBus.onEvent(handler);

		req.on("close", () => {
			eventBus.offEvent(handler);
		});
	});

	return router;
}
