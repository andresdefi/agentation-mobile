import { Command } from "commander";
import { createServer } from "@agentation-mobile/server";

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
		const bridges = await loadBridges();
		const server = createServer({
			port: Number(options.port),
			bridges,
		});
		await server.start();
		console.log(`Bridges loaded: ${bridges.map((b) => b.platform).join(", ") || "none"}`);
	});

program
	.command("mcp")
	.description("Start the MCP server (stdio transport)")
	.action(async () => {
		const { StdioServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/stdio.js"
		);
		const { Store } = await import("@agentation-mobile/core");
		const { EventBus } = await import("@agentation-mobile/server");
		const { createMcpServer } = await import("@agentation-mobile/mcp");

		const store = new Store();
		const eventBus = new EventBus();
		const bridges = await loadBridges();

		const server = createMcpServer({ store, eventBus, bridges });
		const transport = new StdioServerTransport();
		await server.connect(transport);
	});

program
	.command("devices")
	.description("List connected devices and simulators")
	.action(async () => {
		const bridges = await loadBridges();
		if (bridges.length === 0) {
			console.log("No platform bridges available. Is ADB installed?");
			return;
		}
		for (const bridge of bridges) {
			const devices = await bridge.listDevices();
			if (devices.length === 0) {
				console.log(`[${bridge.platform}] No devices found`);
			} else {
				for (const device of devices) {
					console.log(
						`[${bridge.platform}] ${device.name} (${device.id}) ${device.isEmulator ? "[emulator]" : ""} ${device.screenWidth}x${device.screenHeight}`,
					);
				}
			}
		}
	});

program.parse();

async function loadBridges() {
	const bridges = [];
	try {
		const { AndroidBridge } = await import("@agentation-mobile/bridge-android");
		const android = new AndroidBridge();
		if (await android.isAvailable()) bridges.push(android);
	} catch { /* not available */ }
	try {
		const { ReactNativeBridge } = await import("@agentation-mobile/bridge-react-native");
		const rn = new ReactNativeBridge();
		if (await rn.isAvailable()) bridges.push(rn);
	} catch { /* not available */ }
	return bridges;
}
