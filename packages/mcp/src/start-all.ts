import {
	RecordingEngine,
	type Server,
	type ServerConfig,
	createServer,
} from "@agentation-mobile/server";
import { createMcpServer } from "./mcp-server";

export interface StartAllConfig extends ServerConfig {
	mcpTransport?: "stdio" | "http";
	mcpPort?: number;
}

/**
 * Convenience function that starts both the HTTP server and MCP server together.
 * Returns the HTTP server instance for further configuration or shutdown.
 */
export async function startAll(config: StartAllConfig = {}): Promise<Server> {
	const { mcpTransport = "stdio", mcpPort = 4748, ...serverConfig } = config;

	const server = createServer(serverConfig);
	await server.start();

	const recordingEngine = new RecordingEngine(server.store, serverConfig.bridges ?? []);
	const mcpServer = createMcpServer({
		store: server.store,
		eventBus: server.eventBus,
		bridges: serverConfig.bridges ?? [],
		recordingEngine,
	});

	if (mcpTransport === "http") {
		const { StreamableHTTPServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/streamableHttp.js"
		);
		const express = (await import("express")).default;

		const mcpApp = express();
		mcpApp.use(express.json());

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});

		mcpApp.post("/mcp", async (req, res) => {
			await transport.handleRequest(req, res, req.body);
		});
		mcpApp.get("/mcp", async (req, res) => {
			await transport.handleRequest(req, res);
		});
		mcpApp.delete("/mcp", async (req, res) => {
			await transport.handleRequest(req, res);
		});

		await mcpServer.connect(transport);
		mcpApp.listen(mcpPort, () => {
			console.log(`MCP HTTP server running at http://localhost:${mcpPort}/mcp`);
		});
	} else {
		const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
		const transport = new StdioServerTransport();
		await mcpServer.connect(transport);
	}

	return server;
}
