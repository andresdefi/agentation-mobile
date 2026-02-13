#!/usr/bin/env node
import { Store } from "@agentation-mobile/core";
import { EventBus, RecordingEngine } from "@agentation-mobile/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";

async function main() {
	const store = new Store();
	const eventBus = new EventBus();

	// Dynamically load available bridges
	const bridges = [];
	try {
		const { AndroidBridge } = await import("@agentation-mobile/bridge-android");
		const android = new AndroidBridge();
		if (await android.isAvailable()) bridges.push(android);
	} catch {
		/* bridge not available */
	}
	try {
		const { ReactNativeBridge } = await import("@agentation-mobile/bridge-react-native");
		const rn = new ReactNativeBridge();
		if (await rn.isAvailable()) bridges.push(rn);
	} catch {
		/* bridge not available */
	}

	const recordingEngine = new RecordingEngine(store, bridges);
	const server = createMcpServer({ store, eventBus, bridges, recordingEngine });
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(console.error);
