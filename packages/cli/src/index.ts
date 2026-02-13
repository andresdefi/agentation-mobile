import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IPlatformBridge } from "@agentation-mobile/bridge-core";
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
	.option("--webhook-secret <secret>", "HMAC secret for webhook signature verification")
	.action(async (options) => {
		const bridges = await loadBridges();
		const secret = options.webhookSecret as string | undefined;
		const webhooks =
			(options.webhook as string[] | undefined)?.map((url: string) => ({
				url,
				secret,
			})) ?? [];
		const server = createServer({
			port: Number(options.port),
			bridges,
			webhooks,
		});
		await server.start();
		console.log(`Bridges loaded: ${bridges.map((b) => b.platform).join(", ") || "none"}`);
		if (webhooks.length > 0) {
			console.log(`Webhooks: ${webhooks.map((w) => w.url).join(", ")}${secret ? " (signed)" : ""}`);
		}
	});

program
	.command("mcp")
	.description("Start the MCP server")
	.option("-t, --transport <type>", "Transport type (stdio or http)", "stdio")
	.option("--port <port>", "HTTP transport port", "4748")
	.action(async (options) => {
		const { Store } = await import("@agentation-mobile/core");
		const { EventBus, RecordingEngine } = await import("@agentation-mobile/server");
		const { createMcpServer } = await import("@agentation-mobile/mcp");

		const store = new Store();
		const eventBus = new EventBus();
		const bridges = await loadBridges();
		const recordingEngine = new RecordingEngine(store, bridges);

		const server = createMcpServer({ store, eventBus, bridges, recordingEngine });

		if (options.transport === "http") {
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

			await server.connect(transport);

			const mcpPort = Number(options.port);
			mcpApp.listen(mcpPort, () => {
				console.log(`MCP HTTP server running at http://localhost:${mcpPort}/mcp`);
			});
		} else {
			const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
			const transport = new StdioServerTransport();
			await server.connect(transport);
		}
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
		const results = await Promise.allSettled(
			bridges.map(async (bridge) => ({
				platform: bridge.platform,
				devices: await bridge.listDevices(),
			})),
		);
		for (const result of results) {
			if (result.status !== "fulfilled") continue;
			const { platform, devices } = result.value;
			if (devices.length === 0) {
				console.log(`[${platform}] No devices found`);
			} else {
				for (const device of devices) {
					console.log(
						`[${platform}] ${device.name} (${device.id}) ${device.isEmulator ? "[emulator]" : ""} ${device.screenWidth}x${device.screenHeight}`,
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

		const { bridge, deviceId } = await resolveDevice(bridges, options.device as string | undefined);
		const buffer = await bridge.captureScreen(deviceId);
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

		const { bridge, deviceId } = await resolveDevice(bridges, options.device as string | undefined);
		const element = await bridge.inspectElement(deviceId, x, y);
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

program
	.command("connect")
	.description("Connect to a device over WiFi")
	.argument("<host>", "Device IP address")
	.option("-p, --port <port>", "ADB port", "5555")
	.action(async (host: string, options) => {
		const bridges = await loadBridges();
		for (const bridge of bridges) {
			if (bridge.connectWifi) {
				const result = await bridge.connectWifi(host, Number(options.port));
				console.log(result.message);
				process.exit(result.success ? 0 : 1);
				return;
			}
		}
		console.error("No bridge supports WiFi connection. Is ADB installed?");
		process.exit(1);
	});

program
	.command("pair")
	.description("Pair with an Android device for wireless debugging (Android 11+)")
	.argument("<host>", "Device IP address")
	.argument("<port>", "Pairing port shown on device", Number)
	.argument("<code>", "Pairing code shown on device")
	.action(async (host: string, port: number, code: string) => {
		const bridges = await loadBridges();
		for (const bridge of bridges) {
			if (bridge.pairDevice) {
				const result = await bridge.pairDevice(host, port, code);
				console.log(result.message);
				process.exit(result.success ? 0 : 1);
				return;
			}
		}
		console.error("No bridge supports device pairing. Is ADB installed?");
		process.exit(1);
	});

program
	.command("export")
	.description("Export session annotations as JSON, Markdown, or GitHub issues")
	.requiredOption("-s, --session <id>", "Session ID")
	.option("-f, --format <format>", "Export format (json, markdown, github)", "json")
	.option("-p, --port <port>", "Server port", "4747")
	.option("-o, --output <path>", "Output file path (stdout if omitted)")
	.action(async (options) => {
		const baseUrl = `http://localhost:${options.port}`;
		const format = options.format as string;

		if (format === "github") {
			const { formatGitHubIssueBody } = await import("@agentation-mobile/core");
			const { execFile } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execFileAsync = promisify(execFile);

			const sessionRes = await fetch(`${baseUrl}/api/sessions/${options.session}`);
			if (!sessionRes.ok) {
				console.error(`Failed to fetch session: ${sessionRes.status}`);
				process.exit(1);
			}
			const sessionData = (await sessionRes.json()) as {
				id: string;
				name: string;
				deviceId: string;
				platform: string;
				createdAt: string;
				updatedAt: string;
				annotations: Array<{
					id: string;
					comment: string;
					intent: string;
					severity: string;
					[key: string]: unknown;
				}>;
			};
			const { annotations, ...session } = sessionData;

			if (annotations.length === 0) {
				console.log("No annotations to export.");
				return;
			}

			for (const annotation of annotations) {
				const title = `[${annotation.severity}] ${annotation.intent}: ${annotation.comment}`;
				const body = formatGitHubIssueBody(
					annotation as Parameters<typeof formatGitHubIssueBody>[0],
					session as Parameters<typeof formatGitHubIssueBody>[1],
				);
				try {
					await execFileAsync("gh", ["issue", "create", "--title", title, "--body", body]);
					console.log(`Created issue for annotation ${annotation.id}`);
				} catch {
					console.error(`Failed to create issue for annotation ${annotation.id}`);
				}
			}
			return;
		}

		const exportFormat = format === "markdown" ? "markdown" : "json";
		const url = `${baseUrl}/api/sessions/${options.session}/export?format=${exportFormat}`;

		try {
			const res = await fetch(url);
			if (!res.ok) {
				console.error(`Server returned ${res.status}: ${res.statusText}`);
				process.exit(1);
			}
			const content = await res.text();

			if (options.output) {
				await writeFile(options.output, content, "utf-8");
				console.log(`Exported to ${options.output}`);
			} else {
				process.stdout.write(content);
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

program
	.command("init")
	.description("Set up agentation-mobile SDK in your project")
	.action(async () => {
		const cwd = process.cwd();
		const framework = detectFramework(cwd);

		if (!framework) {
			console.log(
				"Could not detect framework. Make sure you are in a React Native or Flutter project.",
			);
			console.log("");
			console.log("Manual setup:");
			console.log("  React Native: npm install @agentation-mobile/react-native-sdk");
			console.log("  Flutter:      flutter pub add agentation_mobile --dev");
			process.exit(1);
		}

		if (framework === "react-native") {
			console.log("Detected: React Native");
			console.log("");
			console.log("1. Install the SDK:");
			console.log("   npm install @agentation-mobile/react-native-sdk");
			console.log("");
			console.log("2. Wrap your app with the provider (e.g. in App.tsx):");
			console.log("");
			console.log(
				'   import { AgentationProvider, AgentationOverlay } from "@agentation-mobile/react-native-sdk";',
			);
			console.log("");
			console.log("   export default function App() {");
			console.log("     return (");
			console.log("       <AgentationProvider>");
			console.log("         {/* your app */}");
			console.log("         <AgentationOverlay />");
			console.log("       </AgentationProvider>");
			console.log("     );");
			console.log("   }");
			console.log("");
			console.log("3. Start the server in a separate terminal:");
			console.log("   npx agentation-mobile start");
			console.log("");
			console.log(
				"The overlay will appear in dev builds. It auto-connects to the server at localhost:4747.",
			);
		} else {
			console.log("Detected: Flutter");
			console.log("");
			console.log("1. Add the SDK to pubspec.yaml:");
			console.log("   flutter pub add agentation_mobile --dev");
			console.log("");
			console.log("2. Add the overlay to your app (e.g. in main.dart):");
			console.log("");
			console.log("   import 'package:agentation_mobile/agentation_mobile.dart';");
			console.log("");
			console.log("   @override");
			console.log("   Widget build(BuildContext context) {");
			console.log("     return AgentationOverlay(");
			console.log("       child: MaterialApp(/* ... */),");
			console.log("     );");
			console.log("   }");
			console.log("");
			console.log("3. Start the server in a separate terminal:");
			console.log("   npx agentation-mobile start");
			console.log("");
			console.log(
				"The overlay will appear in debug builds. It auto-connects to the server at localhost:4747.",
			);
		}
	});

program.parse();

function detectFramework(cwd: string): "react-native" | "flutter" | null {
	// Check for React Native
	const rnPackageJson = join(cwd, "package.json");
	if (existsSync(rnPackageJson)) {
		try {
			const pkg = JSON.parse(require("node:fs").readFileSync(rnPackageJson, "utf-8")) as Record<
				string,
				Record<string, string> | undefined
			>;
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (deps["react-native"]) return "react-native";
		} catch {
			// not parseable
		}
	}

	// Check for Flutter
	if (existsSync(join(cwd, "pubspec.yaml"))) return "flutter";

	return null;
}

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
	try {
		const { FlutterBridge } = await import("@agentation-mobile/bridge-flutter");
		const flutter = new FlutterBridge();
		if (await flutter.isAvailable()) bridges.push(flutter);
	} catch {
		/* not available */
	}
	return bridges;
}

interface ResolvedDevice {
	bridge: IPlatformBridge;
	deviceId: string;
}

async function resolveDevice(
	bridges: IPlatformBridge[],
	requestedId?: string,
): Promise<ResolvedDevice> {
	const results = await Promise.allSettled(
		bridges.map(async (bridge) => {
			const devices = await bridge.listDevices();
			return { bridge, devices };
		}),
	);
	for (const result of results) {
		if (result.status !== "fulfilled") continue;
		const { bridge, devices } = result.value;
		if (requestedId) {
			if (devices.some((d) => d.id === requestedId)) {
				return { bridge, deviceId: requestedId };
			}
		} else if (devices.length > 0) {
			return { bridge, deviceId: devices[0].id };
		}
	}
	if (requestedId) {
		console.error(`Device not found: ${requestedId}`);
	} else {
		console.error("No devices found.");
	}
	process.exit(1);
}
