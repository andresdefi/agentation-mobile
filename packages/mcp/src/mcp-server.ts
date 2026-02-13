import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import { type Store, exportToJson, exportToMarkdown } from "@agentation-mobile/core";
import type { EventBus } from "@agentation-mobile/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface McpServerDeps {
	store: Store;
	eventBus: EventBus;
	bridges: IPlatformBridge[];
}

export function createMcpServer(deps: McpServerDeps) {
	const { store, eventBus, bridges } = deps;
	const server = new McpServer({
		name: "agentation-mobile",
		version: "0.1.0",
	});

	// --- Session tools ---

	server.tool("agentation_mobile_list_sessions", "List all annotation sessions", {}, async () => {
		const sessions = store.listSessions();
		return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
	});

	server.tool(
		"agentation_mobile_get_session",
		"Get session details with its annotations",
		{ sessionId: z.string().describe("Session ID") },
		async ({ sessionId }) => {
			const session = store.getSession(sessionId);
			if (!session) {
				return { content: [{ type: "text", text: "Session not found" }], isError: true };
			}
			const annotations = store.getSessionAnnotations(sessionId);
			return {
				content: [{ type: "text", text: JSON.stringify({ ...session, annotations }, null, 2) }],
			};
		},
	);

	server.tool(
		"agentation_mobile_get_pending",
		"Get pending annotations for a session",
		{ sessionId: z.string().describe("Session ID") },
		async ({ sessionId }) => {
			const session = store.getSession(sessionId);
			if (!session) {
				return { content: [{ type: "text", text: "Session not found" }], isError: true };
			}
			const pending = store.getPendingAnnotations(sessionId);
			return { content: [{ type: "text", text: JSON.stringify(pending, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_get_all_pending",
		"Get all pending annotations across all sessions",
		{},
		async () => {
			const pending = store.getAllPendingAnnotations();
			return { content: [{ type: "text", text: JSON.stringify(pending, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_acknowledge",
		"Acknowledge an annotation (mark as seen by agent)",
		{ annotationId: z.string().describe("Annotation ID") },
		async ({ annotationId }) => {
			const annotation = store.updateAnnotationStatus(annotationId, "acknowledged");
			if (!annotation) {
				return { content: [{ type: "text", text: "Annotation not found" }], isError: true };
			}
			eventBus.emit("annotation:status", annotation);
			return { content: [{ type: "text", text: JSON.stringify(annotation, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_resolve",
		"Mark an annotation as resolved, optionally attaching an after-screenshot for diff comparison",
		{
			annotationId: z.string().describe("Annotation ID"),
			screenshotId: z
				.string()
				.optional()
				.describe("Optional screenshot ID of the 'after' state to attach for before/after diff"),
		},
		async ({ annotationId, screenshotId }) => {
			if (screenshotId) {
				store.attachResolutionScreenshot(annotationId, screenshotId);
			}
			const annotation = store.updateAnnotationStatus(annotationId, "resolved");
			if (!annotation) {
				return { content: [{ type: "text", text: "Annotation not found" }], isError: true };
			}
			eventBus.emit("annotation:status", annotation);
			return { content: [{ type: "text", text: JSON.stringify(annotation, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_capture_and_resolve",
		"Capture a screenshot of the current device screen, attach it as the resolution (after) screenshot, and resolve the annotation in one step",
		{
			annotationId: z.string().describe("Annotation ID"),
			deviceId: z.string().describe("Device ID to capture the after-screenshot from"),
		},
		async ({ annotationId, deviceId }) => {
			const bridge = await findBridge(bridges, deviceId);
			if (!bridge) {
				return { content: [{ type: "text", text: "Device not found" }], isError: true };
			}
			try {
				const screenshot = await bridge.captureScreen(deviceId);
				const screenshotId = crypto.randomUUID();
				store.storeScreenshot(screenshotId, screenshot);
				store.attachResolutionScreenshot(annotationId, screenshotId);
				const annotation = store.updateAnnotationStatus(annotationId, "resolved");
				if (!annotation) {
					return { content: [{ type: "text", text: "Annotation not found" }], isError: true };
				}
				eventBus.emit("annotation:status", annotation);
				const base64 = screenshot.toString("base64");
				return {
					content: [
						{
							type: "text",
							text: `Annotation resolved with after-screenshot. Screenshot ID: ${screenshotId}`,
						},
						{ type: "image", data: base64, mimeType: "image/png" },
					],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Capture failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"agentation_mobile_dismiss",
		"Dismiss an annotation",
		{ annotationId: z.string().describe("Annotation ID") },
		async ({ annotationId }) => {
			const annotation = store.updateAnnotationStatus(annotationId, "dismissed");
			if (!annotation) {
				return { content: [{ type: "text", text: "Annotation not found" }], isError: true };
			}
			eventBus.emit("annotation:status", annotation);
			return { content: [{ type: "text", text: JSON.stringify(annotation, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_reply",
		"Reply to an annotation thread",
		{
			annotationId: z.string().describe("Annotation ID"),
			content: z.string().describe("Reply message content"),
		},
		async ({ annotationId, content }) => {
			const annotation = store.addThreadMessage(annotationId, {
				role: "agent",
				content,
				timestamp: new Date().toISOString(),
			});
			if (!annotation) {
				return {
					content: [{ type: "text", text: "Annotation not found" }],
					isError: true,
				};
			}
			eventBus.emit("annotation:reply", annotation);
			return {
				content: [{ type: "text", text: JSON.stringify(annotation, null, 2) }],
			};
		},
	);

	server.tool(
		"agentation_mobile_watch_annotations",
		"Watch for new or updated annotations (returns current pending and subscribes for updates)",
		{
			sessionId: z.string().optional().describe("Optional session ID to filter"),
		},
		async ({ sessionId }) => {
			const pending = sessionId
				? store.getPendingAnnotations(sessionId)
				: store.getAllPendingAnnotations();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								pending,
								message:
									"Showing current pending annotations. Use get_all_pending to poll for updates.",
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	// --- Mobile-specific tools ---

	server.tool(
		"agentation_mobile_list_devices",
		"List connected mobile devices and simulators/emulators",
		{},
		async () => {
			const allDevices: DeviceInfo[] = [];
			for (const bridge of bridges) {
				try {
					if (await bridge.isAvailable()) {
						const devices = await bridge.listDevices();
						allDevices.push(...devices);
					}
				} catch {
					// skip
				}
			}
			return { content: [{ type: "text", text: JSON.stringify(allDevices, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_capture_screen",
		"Capture a screenshot of a device screen. Returns a screenshot ID and base64 image.",
		{ deviceId: z.string().describe("Device ID from list_devices") },
		async ({ deviceId }) => {
			const bridge = await findBridge(bridges, deviceId);
			if (!bridge) {
				return { content: [{ type: "text", text: "Device not found" }], isError: true };
			}
			try {
				const screenshot = await bridge.captureScreen(deviceId);
				const screenshotId = crypto.randomUUID();
				store.storeScreenshot(screenshotId, screenshot);
				const base64 = screenshot.toString("base64");
				return {
					content: [
						{ type: "text", text: `Screenshot captured. ID: ${screenshotId}` },
						{ type: "image", data: base64, mimeType: "image/png" },
					],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Capture failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"agentation_mobile_get_element_tree",
		"Get the UI element tree for the current screen of a device",
		{ deviceId: z.string().describe("Device ID from list_devices") },
		async ({ deviceId }) => {
			const bridge = await findBridge(bridges, deviceId);
			if (!bridge) {
				return { content: [{ type: "text", text: "Device not found" }], isError: true };
			}
			try {
				const elements = await bridge.getElementTree(deviceId);
				return {
					content: [{ type: "text", text: JSON.stringify(elements, null, 2) }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Element tree failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"agentation_mobile_inspect_element",
		"Inspect a UI element at specific screen coordinates",
		{
			deviceId: z.string().describe("Device ID from list_devices"),
			x: z.number().describe("X coordinate in pixels"),
			y: z.number().describe("Y coordinate in pixels"),
		},
		async ({ deviceId, x, y }) => {
			const bridge = await findBridge(bridges, deviceId);
			if (!bridge) {
				return { content: [{ type: "text", text: "Device not found" }], isError: true };
			}
			try {
				const element = await bridge.inspectElement(deviceId, x, y);
				if (!element) {
					return {
						content: [{ type: "text", text: "No element found at coordinates" }],
					};
				}
				return {
					content: [{ type: "text", text: JSON.stringify(element, null, 2) }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Inspect failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	// --- Multi-device tools ---

	server.tool(
		"agentation_mobile_add_device_to_session",
		"Add a device to an existing session for multi-device annotation",
		{
			sessionId: z.string().describe("Session ID"),
			deviceId: z.string().describe("Device ID from list_devices"),
			platform: z.string().describe("Device platform"),
		},
		async ({ sessionId, deviceId, platform }) => {
			const session = store.addDeviceToSession(sessionId, deviceId, platform);
			if (!session) {
				return { content: [{ type: "text", text: "Session not found" }], isError: true };
			}
			return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_connect_wifi",
		"Connect to an Android device over WiFi for wireless debugging",
		{
			host: z.string().describe("Device IP address"),
			port: z.number().optional().describe("ADB port (default 5555)"),
		},
		async ({ host, port }) => {
			for (const bridge of bridges) {
				if (bridge.connectWifi) {
					const result = await bridge.connectWifi(host, port);
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
				}
			}
			return {
				content: [{ type: "text", text: "No bridge supports WiFi connection" }],
				isError: true,
			};
		},
	);

	// --- Export tools ---

	server.tool(
		"agentation_mobile_export",
		"Export session annotations as JSON or Markdown",
		{
			sessionId: z.string().describe("Session ID"),
			format: z.enum(["json", "markdown"]).describe("Export format"),
		},
		async ({ sessionId, format }) => {
			const session = store.getSession(sessionId);
			if (!session) {
				return { content: [{ type: "text", text: "Session not found" }], isError: true };
			}
			const annotations = store.getSessionAnnotations(sessionId);
			const output =
				format === "json"
					? exportToJson(annotations, session)
					: exportToMarkdown(annotations, session);
			return { content: [{ type: "text", text: output }] };
		},
	);

	return server;
}

async function findBridge(
	bridges: IPlatformBridge[],
	deviceId: string,
): Promise<IPlatformBridge | undefined> {
	for (const bridge of bridges) {
		try {
			const devices = await bridge.listDevices();
			if (devices.some((d) => d.id === deviceId)) {
				return bridge;
			}
		} catch {
			// skip
		}
	}
	return undefined;
}
