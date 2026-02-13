import { writeFile } from "node:fs/promises";
import { createServer } from "@agentation-mobile/server";
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
	.option("-w, --webhook <url...>", "Webhook URLs for annotation events")
	.action(async (options) => {
		const bridges = await loadBridges();
		const webhooks =
			(options.webhook as string[] | undefined)?.map((url: string) => ({ url })) ?? [];
		const server = createServer({
			port: Number(options.port),
			bridges,
			webhooks,
		});
		await server.start();
		console.log(`Bridges loaded: ${bridges.map((b) => b.platform).join(", ") || "none"}`);
		if (webhooks.length > 0) {
			console.log(`Webhooks: ${webhooks.map((w) => w.url).join(", ")}`);
		}
	});

program
	.command("mcp")
	.description("Start the MCP server (stdio transport)")
	.action(async () => {
		const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
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

program
	.command("capture")
	.description("Capture a screenshot from a device")
	.option("-d, --device <id>", "Device ID (defaults to first available)")
	.option("-o, --output <path>", "Output file path")
	.action(async (options) => {
		const bridges = await loadBridges();
		if (bridges.length === 0) {
			console.error("No platform bridges available.");
			process.exit(1);
		}

		let targetDeviceId = options.device as string | undefined;
		let targetBridge = bridges[0];

		if (targetDeviceId) {
			let found = false;
			for (const bridge of bridges) {
				const devices = await bridge.listDevices();
				if (devices.some((d) => d.id === targetDeviceId)) {
					targetBridge = bridge;
					found = true;
					break;
				}
			}
			if (!found) {
				console.error(`Device not found: ${targetDeviceId}`);
				process.exit(1);
			}
		} else {
			for (const bridge of bridges) {
				const devices = await bridge.listDevices();
				if (devices.length > 0) {
					targetBridge = bridge;
					targetDeviceId = devices[0].id;
					break;
				}
			}
			if (!targetDeviceId) {
				console.error("No devices found.");
				process.exit(1);
			}
		}

		const buffer = await targetBridge.captureScreen(targetDeviceId);
		const outputPath = options.output ?? `screenshot-${Date.now()}.png`;
		await writeFile(outputPath, buffer);
		console.log(`Screenshot saved to ${outputPath}`);
	});

program
	.command("inspect")
	.description("Inspect a UI element at screen coordinates")
	.argument("<x>", "X coordinate (pixels)", Number)
	.argument("<y>", "Y coordinate (pixels)", Number)
	.option("-d, --device <id>", "Device ID (defaults to first available)")
	.action(async (x: number, y: number, options) => {
		const bridges = await loadBridges();
		if (bridges.length === 0) {
			console.error("No platform bridges available.");
			process.exit(1);
		}

		let targetDeviceId = options.device as string | undefined;
		let targetBridge = bridges[0];

		if (targetDeviceId) {
			let found = false;
			for (const bridge of bridges) {
				const devices = await bridge.listDevices();
				if (devices.some((d) => d.id === targetDeviceId)) {
					targetBridge = bridge;
					found = true;
					break;
				}
			}
			if (!found) {
				console.error(`Device not found: ${targetDeviceId}`);
				process.exit(1);
			}
		} else {
			for (const bridge of bridges) {
				const devices = await bridge.listDevices();
				if (devices.length > 0) {
					targetBridge = bridge;
					targetDeviceId = devices[0].id;
					break;
				}
			}
			if (!targetDeviceId) {
				console.error("No devices found.");
				process.exit(1);
			}
		}

		const element = await targetBridge.inspectElement(targetDeviceId, x, y);
		if (!element) {
			console.log("No element found at the given coordinates.");
		} else {
			console.log(JSON.stringify(element, null, 2));
		}
	});

program
	.command("status")
	.description("Show pending annotation summary from the running server")
	.option("-p, --port <port>", "Server port", "4747")
	.action(async (options) => {
		const url = `http://localhost:${options.port}/api/annotations/pending`;
		try {
			const res = await fetch(url);
			if (!res.ok) {
				console.error(`Server returned ${res.status}: ${res.statusText}`);
				process.exit(1);
			}
			const annotations = (await res.json()) as Array<{
				severity: string;
			}>;
			const total = annotations.length;
			if (total === 0) {
				console.log("No pending annotations.");
				return;
			}

			const bySeverity: Record<string, number> = {};
			for (const a of annotations) {
				bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
			}

			console.log(`Pending annotations: ${total}`);
			for (const [severity, count] of Object.entries(bySeverity)) {
				console.log(`  ${severity}: ${count}`);
			}
		} catch (err) {
			if (err instanceof TypeError && (err as NodeJS.ErrnoException).cause) {
				console.error(`Could not connect to server on port ${options.port}. Is it running?`);
			} else {
				console.error(`Could not connect to server on port ${options.port}. Is it running?`);
			}
			process.exit(1);
		}
	});

program.parse();

async function loadBridges() {
	const bridges = [];
	try {
		const { AndroidBridge } = await import("@agentation-mobile/bridge-android");
		const android = new AndroidBridge();
		if (await android.isAvailable()) bridges.push(android);
	} catch {
		/* not available */
	}
	try {
		const { ReactNativeBridge } = await import("@agentation-mobile/bridge-react-native");
		const rn = new ReactNativeBridge();
		if (await rn.isAvailable()) bridges.push(rn);
	} catch {
		/* not available */
	}
	try {
		const { IosBridge } = await import("@agentation-mobile/bridge-ios");
		const ios = new IosBridge();
		if (await ios.isAvailable()) bridges.push(ios);
	} catch {
		/* not available */
	}
	return bridges;
}
