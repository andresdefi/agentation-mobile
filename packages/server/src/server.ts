import { type Server as HttpServer, createServer as createHttpServer } from "node:http";
import type { IPlatformBridge } from "@agentation-mobile/bridge-core";
import { type IStore, createStore, exportToJson, exportToMarkdown } from "@agentation-mobile/core";
import cors from "cors";
import express, { type Express } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { findBridgeForDevice } from "./bridge-cache";
import { EventBus } from "./event-bus";
import { RecordingEngine } from "./recording-engine";
import { createAnnotationRoutes } from "./routes/annotations";
import { createDeviceRoutes } from "./routes/devices";
import { createInputRoutes } from "./routes/input";
import { createRecordingRoutes } from "./routes/recordings";
import { createSessionRoutes } from "./routes/sessions";
import { createSSERouter } from "./routes/sse";
import { ScrcpyStream } from "./scrcpy-stream";
import { type WebhookConfig, setupWebhooks } from "./webhooks";

export interface ServerConfig {
	port?: number;
	host?: string;
	bridges?: IPlatformBridge[];
	staticDir?: string;
	webhooks?: WebhookConfig[];
}

export interface Server {
	app: Express;
	store: IStore;
	eventBus: EventBus;
	start: () => Promise<void>;
	stop: () => void;
}

export function createServer(config: ServerConfig = {}): Server {
	const envPort = Number(process.env.AGENTATION_MOBILE_PORT) || 4747;
	const envWebhooks = parseEnvWebhooks();

	const {
		port = envPort,
		host = "localhost",
		bridges = [],
		staticDir,
		webhooks = envWebhooks,
	} = config;

	const app = express();
	const httpServer = createHttpServer(app);
	const store = createStore();
	const eventBus = new EventBus();

	// Webhooks
	setupWebhooks(eventBus, webhooks);

	app.use(cors());
	app.use(express.json({ limit: "50mb" }));

	// Health check
	app.get("/api/health", (_req, res) => {
		res.json({ status: "ok", version: "0.1.0" });
	});

	const recordingEngine = new RecordingEngine(store, bridges);

	// API routes
	app.use("/api/sessions", createSessionRoutes(store, eventBus));
	app.use("/api/annotations", createAnnotationRoutes(store, eventBus));
	app.use("/api/devices", createDeviceRoutes(bridges));
	app.use("/api/devices", createInputRoutes(bridges));
	app.use("/api/recordings", createRecordingRoutes(store, recordingEngine, eventBus));
	app.use("/api/events", createSSERouter(eventBus));

	// Export endpoint
	app.get("/api/sessions/:id/export", (req, res) => {
		const session = store.getSession(req.params.id);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}
		const annotations = store.getSessionAnnotations(session.id);
		const format = req.query.format as string;

		if (format === "markdown") {
			const md = exportToMarkdown(annotations, session);
			res.setHeader("Content-Type", "text/markdown; charset=utf-8");
			res.send(md);
			return;
		}

		const json = exportToJson(annotations, session);
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.send(json);
	});

	// Screenshot capture endpoint
	app.post("/api/capture/:deviceId", async (req, res) => {
		const { deviceId } = req.params;
		const platform = req.query.platform as string | undefined;
		const bridge = await findBridgeForDevice(bridges, deviceId, platform);
		if (!bridge) {
			res.status(404).json({ error: "Device not found" });
			return;
		}
		try {
			const screenshot = await bridge.captureScreen(deviceId);
			const screenshotId = crypto.randomUUID();
			store.storeScreenshot(screenshotId, screenshot);
			res.json({ screenshotId, size: screenshot.length });
		} catch (err) {
			res.status(500).json({ error: `Capture failed: ${err}` });
		}
	});

	// Attach resolution screenshot to annotation
	app.post("/api/annotations/:id/resolve-screenshot", (req, res) => {
		const { id } = req.params;
		const { screenshot } = req.body;
		if (!screenshot || typeof screenshot !== "string") {
			res.status(400).json({ error: "screenshot (base64 PNG string) required in body" });
			return;
		}
		const annotation = store.getAnnotation(id);
		if (!annotation) {
			res.status(404).json({ error: "Annotation not found" });
			return;
		}
		const buffer = Buffer.from(screenshot, "base64");
		const screenshotId = crypto.randomUUID();
		store.storeScreenshot(screenshotId, buffer);
		store.attachResolutionScreenshot(id, screenshotId);
		const updated = store.getAnnotation(id);
		if (updated) {
			eventBus.emit("annotation.updated", updated, updated.sessionId, updated.deviceId);
		}
		res.json({ screenshotId, annotationId: id });
	});

	// Screenshot retrieval
	app.get("/api/screenshots/:id", (req, res) => {
		const data = store.getScreenshot(req.params.id);
		if (!data) {
			res.status(404).json({ error: "Screenshot not found" });
			return;
		}
		res.setHeader("Content-Type", "image/png");
		res.send(data);
	});

	// Element tree endpoint
	app.get("/api/devices/:deviceId/elements", async (req, res) => {
		const { deviceId } = req.params;
		const platform = req.query.platform as string | undefined;
		console.log(`[elements] GET /api/devices/${deviceId}/elements?platform=${platform}`);
		const bridge = await findBridgeForDevice(bridges, deviceId, platform);
		if (!bridge) {
			res.status(404).json({ error: "Device not found" });
			return;
		}
		try {
			const elements = await bridge.getElementTree(deviceId);
			const screenId = bridge.getScreenId ? await bridge.getScreenId(deviceId) : null;
			console.log(`[elements] screenId=${screenId} elements=${elements.length}`);
			res.json({ elements, screenId });
		} catch (err) {
			res.status(500).json({ error: `Element tree failed: ${err}` });
		}
	});

	// Inspect element at coordinates
	app.get("/api/devices/:deviceId/inspect", async (req, res) => {
		const { deviceId } = req.params;
		const x = Number(req.query.x);
		const y = Number(req.query.y);
		if (Number.isNaN(x) || Number.isNaN(y)) {
			res.status(400).json({ error: "x and y query params required" });
			return;
		}
		const platform = req.query.platform as string | undefined;
		const bridge = await findBridgeForDevice(bridges, deviceId, platform);
		if (!bridge) {
			res.status(404).json({ error: "Device not found" });
			return;
		}
		try {
			const element = await bridge.inspectElement(deviceId, x, y);
			if (!element) {
				res.status(404).json({ error: "No element at coordinates" });
				return;
			}
			res.json(element);
		} catch (err) {
			res.status(500).json({ error: `Inspect failed: ${err}` });
		}
	});

	// WebSocket screen mirror feed
	const wss = new WebSocketServer({ server: httpServer, path: "/ws/screen" });

	wss.on("connection", (ws, req) => {
		const url = new URL(req.url || "/", `http://${host}:${port}`);
		const deviceId = url.searchParams.get("deviceId");
		const wsPlatform = url.searchParams.get("platform") || undefined;
		if (!deviceId) {
			ws.close(1008, "deviceId query param required");
			return;
		}

		let stream: ScrcpyStream | null = null;
		let interval: ReturnType<typeof setInterval> | null = null;
		let capturing = false;

		const startCapture = async () => {
			const bridge = await findBridgeForDevice(bridges, deviceId, wsPlatform);
			if (!bridge) {
				ws.close(1008, "Device not found");
				return;
			}

			// Attempt high-performance scrcpy-based streaming first.
			// The stream detects scrcpy + ffmpeg availability internally and
			// falls back to adaptive ADB screencap polling when they are missing.
			const hasScrcpy = await ScrcpyStream.isAvailable();
			if (hasScrcpy) {
				stream = new ScrcpyStream({ deviceId });

				stream.on("frame", (frame: Buffer) => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(frame);
					}
				});

				stream.on("error", () => {
					// Non-fatal — individual frame errors are swallowed.
				});

				stream.on("close", () => {
					// scrcpy exited unexpectedly — fall back to polling.
					stream = null;
					if (ws.readyState === WebSocket.OPEN) {
						startPollingFallback(bridge, deviceId);
					}
				});

				try {
					await stream.start();
					return;
				} catch {
					// scrcpy failed to start — fall back to polling
					stream = null;
				}
			}

			startPollingFallback(bridge, deviceId);
		};

		const startPollingFallback = (bridge: IPlatformBridge, devId: string) => {
			interval = setInterval(async () => {
				if (capturing || ws.readyState !== WebSocket.OPEN) return;
				capturing = true;
				try {
					const frame = await bridge.captureScreen(devId);
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(frame);
					}
				} catch {
					// skip frame on error
				} finally {
					capturing = false;
				}
			}, 200); // ~5fps
		};

		startCapture();

		// Handle incoming input messages for low-latency remote interaction
		ws.on("message", async (data) => {
			if (data instanceof Buffer && data[0] === 0x7b) {
				// Starts with '{' — likely JSON
			} else if (typeof data !== "string") {
				return; // Ignore non-JSON binary messages
			}
			try {
				const msg = JSON.parse(typeof data === "string" ? data : data.toString("utf-8"));
				const bridge = await findBridgeForDevice(bridges, deviceId, wsPlatform);
				if (!bridge) return;
				switch (msg.type) {
					case "tap":
						if (bridge.sendTap) await bridge.sendTap(deviceId, msg.x, msg.y);
						break;
					case "swipe":
						if (bridge.sendSwipe) {
							await bridge.sendSwipe(
								deviceId,
								msg.fromX,
								msg.fromY,
								msg.toX,
								msg.toY,
								msg.durationMs,
							);
						}
						break;
					case "text":
						if (bridge.sendText) await bridge.sendText(deviceId, msg.text);
						break;
					case "key":
						if (bridge.sendKeyEvent) await bridge.sendKeyEvent(deviceId, msg.keyCode);
						break;
				}
			} catch {
				// Ignore malformed messages
			}
		});

		ws.on("close", () => {
			if (stream) {
				stream.stop();
				stream = null;
			}
			if (interval) {
				clearInterval(interval);
				interval = null;
			}
		});
	});

	// Serve static web-ui if directory provided
	if (staticDir) {
		app.use(express.static(staticDir));
		app.get("*", (_req, res) => {
			res.sendFile("index.html", { root: staticDir });
		});
	}

	return {
		app,
		store,
		eventBus,
		start: () =>
			new Promise<void>((resolve) => {
				httpServer.listen(port, () => {
					console.log(`agentation-mobile server running at http://${host}:${port}`);
					resolve();
				});
			}),
		stop: () => {
			recordingEngine.stopAll();
			wss.close();
			httpServer.close();
		},
	};
}

function parseEnvWebhooks(): WebhookConfig[] {
	const secret = process.env.AGENTATION_MOBILE_WEBHOOK_SECRET;
	const urls: string[] = [];

	if (process.env.AGENTATION_MOBILE_WEBHOOK_URL) {
		urls.push(process.env.AGENTATION_MOBILE_WEBHOOK_URL);
	}
	if (process.env.AGENTATION_MOBILE_WEBHOOKS) {
		urls.push(
			...process.env.AGENTATION_MOBILE_WEBHOOKS.split(",")
				.map((u) => u.trim())
				.filter(Boolean),
		);
	}

	return urls.map((url) => ({ url, secret }));
}
