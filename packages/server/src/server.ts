import { type Server as HttpServer, createServer as createHttpServer } from "node:http";
import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import { Store } from "@agentation-mobile/core";
import cors from "cors";
import express, { type Express } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { EventBus } from "./event-bus";
import { createAnnotationRoutes } from "./routes/annotations";
import { createDeviceRoutes } from "./routes/devices";
import { createSessionRoutes } from "./routes/sessions";
import { createSSERouter } from "./routes/sse";
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
	store: Store;
	eventBus: EventBus;
	start: () => Promise<void>;
	stop: () => void;
}

export function createServer(config: ServerConfig = {}): Server {
	const { port = 4747, host = "localhost", bridges = [], staticDir, webhooks = [] } = config;

	const app = express();
	const httpServer = createHttpServer(app);
	const store = new Store();
	const eventBus = new EventBus();

	// Webhooks
	setupWebhooks(eventBus, webhooks);

	app.use(cors());
	app.use(express.json({ limit: "50mb" }));

	// Health check
	app.get("/api/health", (_req, res) => {
		res.json({ status: "ok", version: "0.1.0" });
	});

	// API routes
	app.use("/api/sessions", createSessionRoutes(store, eventBus));
	app.use("/api/annotations", createAnnotationRoutes(store, eventBus));
	app.use("/api/devices", createDeviceRoutes(bridges));
	app.use("/api/events", createSSERouter(eventBus));

	// Screenshot capture endpoint
	app.post("/api/capture/:deviceId", async (req, res) => {
		const { deviceId } = req.params;
		const bridge = await findBridgeForDevice(bridges, deviceId);
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
		const bridge = await findBridgeForDevice(bridges, deviceId);
		if (!bridge) {
			res.status(404).json({ error: "Device not found" });
			return;
		}
		try {
			const elements = await bridge.getElementTree(deviceId);
			res.json(elements);
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
		const bridge = await findBridgeForDevice(bridges, deviceId);
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
		if (!deviceId) {
			ws.close(1008, "deviceId query param required");
			return;
		}

		let interval: ReturnType<typeof setInterval> | null = null;
		let capturing = false;

		const startCapture = async () => {
			const bridge = await findBridgeForDevice(bridges, deviceId);
			if (!bridge) {
				ws.close(1008, "Device not found");
				return;
			}

			interval = setInterval(async () => {
				if (capturing || ws.readyState !== WebSocket.OPEN) return;
				capturing = true;
				try {
					const frame = await bridge.captureScreen(deviceId);
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

		ws.on("close", () => {
			if (interval) clearInterval(interval);
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
			wss.close();
			httpServer.close();
		},
	};
}

async function findBridgeForDevice(
	bridges: IPlatformBridge[],
	deviceId: string,
): Promise<IPlatformBridge | undefined> {
	for (const bridge of bridges) {
		try {
			const devices = await bridge.listDevices();
			if (devices.some((d: DeviceInfo) => d.id === deviceId)) {
				return bridge;
			}
		} catch {
			// skip unavailable bridges
		}
	}
	return undefined;
}
