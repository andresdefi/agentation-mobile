import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import type { Store } from "@agentation-mobile/core";
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
		"Mark an annotation as resolved",
		{ annotationId: z.string().describe("Annotation ID") },
		async ({ annotationId }) => {
			const annotation = store.updateAnnotationStatus(annotationId, "resolved");
			if (!annotation) {
				return { content: [{ type: "text", text: "Annotation not found" }], isError: true };
			}
			eventBus.emit("annotation:status", annotation);
			return { content: [{ type: "text", text: JSON.stringify(annotation, null, 2) }] };
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
