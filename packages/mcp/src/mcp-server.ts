import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import {
	type Store,
	exportToJson,
	exportToMarkdown,
	exportWithDetailLevel,
} from "@agentation-mobile/core";
import type { BusEvent, EventBus } from "@agentation-mobile/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface McpServerDeps {
	store: Store;
	eventBus: EventBus;
	bridges: IPlatformBridge[];
}

export function createMcpServer(deps: McpServerDeps) {
	const { store, eventBus, bridges } = deps;
	const findBridge = createBridgeFinder(bridges);
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
		"Get session details with its annotations. Each annotation includes a sourceRef field (e.g. 'Button (src/screens/Login.tsx)') when element data is available.",
		{ sessionId: z.string().describe("Session ID") },
		async ({ sessionId }) => {
			const session = store.getSession(sessionId);
			if (!session) {
				return { content: [{ type: "text", text: "Session not found" }], isError: true };
			}
			const annotations = store.getSessionAnnotations(sessionId);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								...session,
								annotations: enrichAnnotations(annotations as unknown as Record<string, unknown>[]),
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.tool(
		"agentation_mobile_get_pending",
		"Get pending annotations for a session. Each annotation includes a sourceRef field when element data is available.",
		{ sessionId: z.string().describe("Session ID") },
		async ({ sessionId }) => {
			const session = store.getSession(sessionId);
			if (!session) {
				return { content: [{ type: "text", text: "Session not found" }], isError: true };
			}
			const pending = store.getPendingAnnotations(sessionId);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							enrichAnnotations(pending as unknown as Record<string, unknown>[]),
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.tool(
		"agentation_mobile_get_all_pending",
		"Get all pending annotations across all sessions. Each annotation includes a sourceRef field when element data is available.",
		{},
		async () => {
			const pending = store.getAllPendingAnnotations();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							enrichAnnotations(pending as unknown as Record<string, unknown>[]),
							null,
							2,
						),
					},
				],
			};
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
			const bridge = await findBridge(deviceId);
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
		"Watch for new or updated annotations. In 'poll' mode (default), returns current pending immediately. In 'blocking' mode, waits for new annotations to arrive, collects them during a batch window, then returns the batch. Use blocking mode for hands-free agent loops.",
		{
			sessionId: z.string().optional().describe("Optional session ID to filter"),
			mode: z
				.enum(["poll", "blocking"])
				.optional()
				.describe("'poll' returns immediately (default). 'blocking' waits for new annotations."),
			batchWindowMs: z
				.number()
				.optional()
				.describe(
					"How long to collect annotations after the first one arrives before returning (default 10000ms). Only used in blocking mode.",
				),
			maxWaitMs: z
				.number()
				.optional()
				.describe(
					"Maximum time to wait for annotations before returning empty (default 300000ms / 5min). Only used in blocking mode.",
				),
		},
		async ({ sessionId, mode, batchWindowMs, maxWaitMs }) => {
			const currentPending = sessionId
				? store.getPendingAnnotations(sessionId)
				: store.getAllPendingAnnotations();

			if (mode !== "blocking") {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									mode: "poll",
									pending: currentPending,
									count: currentPending.length,
								},
								null,
								2,
							),
						},
					],
				};
			}

			const batchWindow = batchWindowMs ?? 10000;
			const maxWait = maxWaitMs ?? 300000;
			const batch: BusEvent[] = [];

			return new Promise((resolve) => {
				let batchTimer: ReturnType<typeof setTimeout> | null = null;
				let maxTimer: ReturnType<typeof setTimeout> | null = null;

				const cleanup = () => {
					eventBus.offEvent(handler);
					if (batchTimer) clearTimeout(batchTimer);
					if (maxTimer) clearTimeout(maxTimer);
				};

				const returnBatch = () => {
					cleanup();
					const newAnnotations = batch.map((e) => e.data);
					resolve({
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										mode: "blocking",
										newAnnotations,
										newCount: newAnnotations.length,
										pending: sessionId
											? store.getPendingAnnotations(sessionId)
											: store.getAllPendingAnnotations(),
									},
									null,
									2,
								),
							},
						],
					});
				};

				const handler = (event: BusEvent) => {
					if (event.type !== "annotation:created") return;
					if (sessionId) {
						const data = event.data as { sessionId?: string };
						if (data.sessionId !== sessionId) return;
					}
					batch.push(event);
					if (!batchTimer) {
						batchTimer = setTimeout(returnBatch, batchWindow);
					}
				};

				eventBus.onEvent(handler);

				maxTimer = setTimeout(() => {
					returnBatch();
				}, maxWait);
			});
		},
	);

	// --- Mobile-specific tools ---

	server.tool(
		"agentation_mobile_list_devices",
		"List connected mobile devices and simulators/emulators",
		{},
		async () => {
			const results = await Promise.allSettled(
				bridges.map(async (bridge) => {
					if (await bridge.isAvailable()) {
						return bridge.listDevices();
					}
					return [];
				}),
			);
			const allDevices: DeviceInfo[] = [];
			for (const result of results) {
				if (result.status === "fulfilled") {
					allDevices.push(...result.value);
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
			const bridge = await findBridge(deviceId);
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
			const bridge = await findBridge(deviceId);
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
			const bridge = await findBridge(deviceId);
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

	// --- Animation control tools ---

	server.tool(
		"agentation_mobile_pause_animations",
		"Pause/freeze all animations on a mobile device. Useful for getting consistent screenshots and giving precise visual feedback without motion.",
		{
			deviceId: z.string().describe("Device ID"),
		},
		async ({ deviceId }) => {
			const bridge = await findBridge(deviceId);
			if (!bridge) {
				return {
					content: [{ type: "text", text: `No bridge found for device ${deviceId}` }],
					isError: true,
				};
			}
			if (!bridge.pauseAnimations) {
				return {
					content: [
						{
							type: "text",
							text: `Bridge for ${bridge.platform} does not support animation control`,
						},
					],
					isError: true,
				};
			}
			const result = await bridge.pauseAnimations(deviceId);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"agentation_mobile_resume_animations",
		"Resume/restore animations on a mobile device after pausing them.",
		{
			deviceId: z.string().describe("Device ID"),
		},
		async ({ deviceId }) => {
			const bridge = await findBridge(deviceId);
			if (!bridge) {
				return {
					content: [{ type: "text", text: `No bridge found for device ${deviceId}` }],
					isError: true,
				};
			}
			if (!bridge.resumeAnimations) {
				return {
					content: [
						{
							type: "text",
							text: `Bridge for ${bridge.platform} does not support animation control`,
						},
					],
					isError: true,
				};
			}
			const result = await bridge.resumeAnimations(deviceId);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	// --- Export tools ---

	server.tool(
		"agentation_mobile_export",
		"Export session annotations. Formats: json, markdown, agent (compact AI-optimized). Detail levels: compact (comment+intent+severity), standard (default, +position/device/component), detailed (+bounding boxes, thread, paths), forensic (+accessibility, styles, nearby text).",
		{
			sessionId: z.string().describe("Session ID"),
			format: z.enum(["json", "markdown", "agent"]).describe("Export format").optional(),
			detailLevel: z
				.enum(["compact", "standard", "detailed", "forensic"])
				.describe("Level of detail in output (default: standard)")
				.optional(),
		},
		async ({ sessionId, format, detailLevel }) => {
			const session = store.getSession(sessionId);
			if (!session) {
				return { content: [{ type: "text", text: "Session not found" }], isError: true };
			}
			const annotations = store.getSessionAnnotations(sessionId);
			const fmt = format ?? "agent";
			let output: string;
			if (fmt === "json") {
				output = exportToJson(annotations, session);
			} else if (fmt === "markdown") {
				output = exportToMarkdown(annotations, session);
			} else {
				output = exportWithDetailLevel(annotations, detailLevel ?? "standard", session);
			}
			return { content: [{ type: "text", text: output }] };
		},
	);

	return server;
}

// Build a one-line greppable source reference from element data.
// e.g. "Button (src/screens/Login.tsx:42)" or "Button > App/Screen/Button"
function buildSourceRef(element?: {
	componentName?: string;
	componentFile?: string;
	componentPath?: string;
}): string | undefined {
	if (!element) return undefined;
	const name = element.componentName || "Unknown";
	if (element.componentFile) {
		return `${name} (${element.componentFile})`;
	}
	if (element.componentPath) {
		return `${name} > ${element.componentPath}`;
	}
	return name;
}

// Enrich an annotation object with a sourceRef field and areaRef for agent consumption
function enrichAnnotation(annotation: Record<string, unknown>): Record<string, unknown> {
	const enriched = { ...annotation };
	const element = annotation.element as
		| { componentName?: string; componentFile?: string; componentPath?: string }
		| undefined;
	const sourceRef = buildSourceRef(element);
	if (sourceRef) {
		enriched.sourceRef = sourceRef;
	}
	const area = annotation.selectedArea as
		| { x: number; y: number; width: number; height: number }
		| undefined;
	if (area) {
		enriched.areaRef = `${area.width.toFixed(0)}%x${area.height.toFixed(0)}% at (${area.x.toFixed(0)}%,${area.y.toFixed(0)}%)`;
	}
	if (annotation.selectedText) {
		enriched.selectedText = annotation.selectedText;
	}
	return enriched;
}

function enrichAnnotations(annotations: Record<string, unknown>[]): Record<string, unknown>[] {
	return annotations.map(enrichAnnotation);
}

const BRIDGE_CACHE_TTL = 30_000;

function createBridgeFinder(bridges: IPlatformBridge[]) {
	/** Cache of deviceId → bridge with TTL. Scoped to this server instance. */
	const cache = new Map<string, { bridge: IPlatformBridge; expiresAt: number }>();

	return async function findBridge(deviceId: string): Promise<IPlatformBridge | undefined> {
		// Check cache first
		const cached = cache.get(deviceId);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.bridge;
		}

		// Query all bridges in parallel
		const results = await Promise.allSettled(
			bridges.map(async (bridge) => {
				const devices = await bridge.listDevices();
				return { bridge, devices };
			}),
		);

		// Populate cache for all discovered devices, return the match
		let match: IPlatformBridge | undefined;
		const now = Date.now();
		for (const result of results) {
			if (result.status !== "fulfilled") continue;
			const { bridge, devices } = result.value;
			for (const d of devices) {
				cache.set(d.id, { bridge, expiresAt: now + BRIDGE_CACHE_TTL });
				if (d.id === deviceId) {
					match = bridge;
				}
			}
		}
		return match;
	};
}
