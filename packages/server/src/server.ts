import express, { type Express } from "express";
import cors from "cors";

export interface ServerConfig {
	port?: number;
	host?: string;
}

export interface Server {
	app: Express;
	start: () => Promise<void>;
}

export function createServer(config: ServerConfig = {}): Server {
	const { port = 4747, host = "localhost" } = config;

	const app = express();
	app.use(cors());
	app.use(express.json());

	// Health check
	app.get("/health", (_req, res) => {
		res.json({ status: "ok", version: "0.1.0" });
	});

	// TODO: Session routes
	// TODO: Annotation routes
	// TODO: Device routes
	// TODO: SSE events endpoint
	// TODO: WebSocket screen feed

	return {
		app,
		start: () =>
			new Promise<void>((resolve) => {
				app.listen(port, () => {
					console.log(`agentation-mobile server running at http://${host}:${port}`);
					resolve();
				});
			}),
	};
}
