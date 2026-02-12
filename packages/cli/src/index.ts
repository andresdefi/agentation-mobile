import { Command } from "commander";

const program = new Command();

program
	.name("agentation-mobile")
	.description("Mobile UI annotation tool for AI coding agents")
	.version("0.1.0");

program
	.command("start")
	.description("Start the agentation-mobile server and web UI")
	.option("-p, --port <port>", "Server port", "4747")
	.action(async (options) => {
		const { createServer } = await import("@agentation-mobile/server");
		const server = createServer({ port: Number(options.port) });
		await server.start();
	});

program
	.command("mcp")
	.description("Start the MCP server (stdio transport)")
	.action(async () => {
		const { StdioServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/stdio.js"
		);
		const { createMcpServer } = await import("@agentation-mobile/mcp");
		const server = createMcpServer();
		const transport = new StdioServerTransport();
		await server.connect(transport);
	});

program
	.command("devices")
	.description("List connected devices and simulators")
	.action(async () => {
		// TODO: Enumerate bridges and list devices
		console.log("No devices found (bridges not yet implemented)");
	});

program.parse();
