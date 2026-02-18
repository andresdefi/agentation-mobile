import {
	type DeviceInfo,
	IOS_UDID_REGEX,
	type IPlatformBridge,
	SourceMapResolver,
} from "@agentation-mobile/bridge-core";
import {
	type IStore,
	type MobileElement,
	exportToJson,
	exportToMarkdown,
	exportWithDetailLevel,
} from "@agentation-mobile/core";
import type { BusEvent, EventBus, RecordingEngine } from "@agentation-mobile/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface McpServerDeps {
	store: IStore;
	eventBus: EventBus;
	bridges: IPlatformBridge[];
	recordingEngine?: RecordingEngine;
}

export function createMcpServer(deps: McpServerDeps) {
	const { store, eventBus, bridges, recordingEngine } = deps;
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
			eventBus.emit("annotation.updated", annotation, annotation.sessionId, annotation.deviceId);
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
			eventBus.emit("annotation.updated", annotation, annotation.sessionId, annotation.deviceId);
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
				eventBus.emit("annotation.updated", annotation, annotation.sessionId, annotation.deviceId);
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
		"Dismiss an annotation with a reason explaining why it was dismissed",
		{
			annotationId: z.string().describe("Annotation ID"),
			reason: z.string().describe("Reason for dismissing the annotation"),
		},
		async ({ annotationId, reason }) => {
			store.addThreadMessage(annotationId, {
				role: "agent",
				content: `Dismissed: ${reason}`,
				timestamp: new Date().toISOString(),
			});
			const annotation = store.updateAnnotationStatus(annotationId, "dismissed");
			if (!annotation) {
				return { content: [{ type: "text", text: "Annotation not found" }], isError: true };
			}
			eventBus.emit("annotation.updated", annotation, annotation.sessionId, annotation.deviceId);
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
			eventBus.emit("thread.message", annotation, annotation.sessionId, annotation.deviceId);
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
		async ({ sessionId, mode, batchWindowMs, maxWaitMs }, { signal }) => {
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
			let cleaned = false;

			return new Promise((resolve) => {
				let batchTimer: ReturnType<typeof setTimeout> | null = null;
				let maxTimer: ReturnType<typeof setTimeout> | null = null;

				const cleanup = () => {
					if (cleaned) return;
					cleaned = true;
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
					if (event.type !== "annotation.created" && event.type !== "action.requested") return;
					if (sessionId) {
						const data = event.data as { sessionId?: string };
						if (data.sessionId !== sessionId) return;
					}
					batch.push(event);
					if (!batchTimer) {
						batchTimer = setTimeout(returnBatch, batchWindow);
					}
				};

				// Clean up if the MCP client disconnects (AbortSignal from transport)
				if (signal) {
					signal.addEventListener(
						"abort",
						() => {
							cleanup();
							resolve({
								content: [
									{
										type: "text",
										text: JSON.stringify({
											mode: "blocking",
											aborted: true,
											newAnnotations: [],
											newCount: 0,
										}),
									},
								],
							});
						},
						{ once: true },
					);
				}

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
		{
			deviceId: z.string().describe("Device ID from list_devices"),
			platform: z
				.string()
				.optional()
				.describe("Platform hint (react-native, ios-native, android-native, flutter)"),
		},
		async ({ deviceId, platform }) => {
			const bridge = await findBridge(deviceId, platform);
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
			platform: z
				.string()
				.optional()
				.describe("Platform hint (react-native, ios-native, android-native, flutter)"),
		},
		async ({ deviceId, x, y, platform }) => {
			const bridge = await findBridge(deviceId, platform);
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

	server.tool(
		"agentation_mobile_create_annotation",
		"Create a new annotation on a device screen. Optionally inspects the element at the given coordinates to enrich the annotation with component data (name, file path, source location).",
		{
			sessionId: z.string().describe("Session ID to attach annotation to"),
			x: z.number().describe("X coordinate as percentage (0-100) of screen width"),
			y: z.number().describe("Y coordinate as percentage (0-100) of screen height"),
			comment: z.string().describe("Annotation comment / feedback text"),
			intent: z
				.enum(["fix", "change", "question", "approve"])
				.optional()
				.describe("Annotation intent (default: fix)"),
			severity: z
				.enum(["blocking", "important", "suggestion"])
				.optional()
				.describe("Annotation severity (default: important)"),
			deviceId: z.string().optional().describe("Device ID (defaults to session's device)"),
			platform: z
				.string()
				.optional()
				.describe("Platform hint (react-native, ios-native, android-native, flutter)"),
		},
		async ({ sessionId, x, y, comment, intent, severity, deviceId, platform }) => {
			const session = store.getSession(sessionId);
			if (!session) {
				return {
					content: [{ type: "text", text: "Session not found" }],
					isError: true,
				};
			}

			const resolvedDeviceId = deviceId || session.deviceId;
			const resolvedPlatform = platform || session.platform;

			// Try to inspect element at coordinates for enrichment
			let element: MobileElement | null = null;
			const bridge = await findBridge(resolvedDeviceId, resolvedPlatform);
			if (bridge) {
				try {
					const screenWidth = 390; // reasonable default, will be overridden if available
					const screenHeight = 844;
					const pixelX = Math.round((x / 100) * screenWidth);
					const pixelY = Math.round((y / 100) * screenHeight);
					element = await bridge.inspectElement(resolvedDeviceId, pixelX, pixelY);
				} catch {
					// Continue without element enrichment
				}
			}

			const annotation = store.createAnnotation({
				sessionId,
				x,
				y,
				deviceId: resolvedDeviceId,
				platform: resolvedPlatform,
				screenWidth: 0,
				screenHeight: 0,
				comment,
				intent: intent ?? "fix",
				severity: severity ?? "important",
				element: element ?? undefined,
			});

			eventBus.emit("annotation.created", annotation, sessionId, annotation.deviceId);
			const enriched = enrichAnnotation(annotation as unknown as Record<string, unknown>);

			return {
				content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }],
			};
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

	// Search component source — returns search strategies for AI agents
	server.tool(
		"agentation_mobile_search_component_source",
		"Given a component name and platform, returns file search patterns and strategies for locating the component in the source code. Useful when sourceLocation is unavailable.",
		{
			componentName: z.string().describe("Component/widget name to search for"),
			platform: z
				.enum(["react-native", "flutter", "android-native", "ios-native"])
				.describe("Target platform")
				.optional(),
		},
		async ({ componentName, platform }) => {
			const strategies: string[] = [];

			if (!platform || platform === "react-native") {
				strategies.push(
					"**React Native search patterns:**",
					`- grep -r "function ${componentName}" --include="*.tsx" --include="*.jsx"`,
					`- grep -r "const ${componentName}" --include="*.tsx" --include="*.jsx"`,
					`- grep -r "export.*${componentName}" --include="*.tsx" --include="*.ts"`,
					`- File patterns: **/${componentName}.tsx, **/${componentName}/index.tsx`,
					"- Common dirs: src/components/, src/screens/, src/views/",
				);
			}
			if (!platform || platform === "flutter") {
				strategies.push(
					"**Flutter search patterns:**",
					`- grep -r "class ${componentName}" --include="*.dart"`,
					`- grep -r "Widget ${componentName}" --include="*.dart"`,
					`- File patterns: **/${componentName.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? "_" : "") + c.toLowerCase())}.dart`,
					"- Common dirs: lib/src/, lib/widgets/, lib/screens/, lib/pages/",
				);
			}
			if (!platform || platform === "android-native") {
				strategies.push(
					"**Android/Kotlin search patterns:**",
					`- grep -r "class ${componentName}" --include="*.kt"`,
					`- grep -r "@Composable.*${componentName}" --include="*.kt"`,
					`- File patterns: **/${componentName}.kt`,
					"- Common dirs: app/src/main/java/, app/src/main/kotlin/",
				);
			}
			if (!platform || platform === "ios-native") {
				strategies.push(
					"**iOS/Swift search patterns:**",
					`- grep -r "struct ${componentName}" --include="*.swift"`,
					`- grep -r "class ${componentName}" --include="*.swift"`,
					`- File patterns: **/${componentName}.swift`,
					"- Common dirs: Sources/, App/, Views/, Screens/",
				);
			}

			const output = [`## Source search strategies for "${componentName}"`, "", ...strategies].join(
				"\n",
			);

			return { content: [{ type: "text", text: output }] };
		},
	);

	// -----------------------------------------------------------------------
	// Source Map Resolution tool
	// -----------------------------------------------------------------------

	const sourceMapResolver = new SourceMapResolver();

	server.tool(
		"agentation_mobile_resolve_source_map",
		"Resolve a minified/bundled source location back to its original file:line using a source map. Useful for production builds where source info is stripped. Provide the path to the source map file and the generated line/column.",
		{
			sourceMapPath: z
				.string()
				.describe(
					"Path to the source map file (.map). For RN: usually in android/app/build/generated/sourcemaps/ or ios/build/",
				),
			generatedLine: z.number().describe("Line number in the generated/bundled file"),
			generatedColumn: z.number().optional().describe("Column number (default 0)"),
		},
		async ({ sourceMapPath, generatedLine, generatedColumn }) => {
			const loaded = await sourceMapResolver.loadSourceMap(sourceMapPath);
			if (!loaded) {
				return {
					content: [
						{
							type: "text",
							text: `Could not load source map at: ${sourceMapPath}. Ensure the file exists.`,
						},
					],
					isError: true,
				};
			}

			const resolved = sourceMapResolver.resolve(
				sourceMapPath,
				generatedLine,
				generatedColumn ?? 0,
			);

			if (!resolved) {
				return {
					content: [
						{
							type: "text",
							text: `No mapping found for line ${generatedLine}${generatedColumn != null ? `:${generatedColumn}` : ""} in the source map.`,
						},
					],
				};
			}

			const loc =
				resolved.column != null
					? `${resolved.file}:${resolved.line}:${resolved.column}`
					: `${resolved.file}:${resolved.line}`;

			return {
				content: [
					{
						type: "text",
						text: `Resolved: ${loc}${resolved.name ? ` (${resolved.name})` : ""}`,
					},
				],
			};
		},
	);

	// -----------------------------------------------------------------------
	// Remote Input tools
	// -----------------------------------------------------------------------

	server.tool(
		"agentation_mobile_tap",
		"Tap at pixel coordinates on a device screen.",
		{
			deviceId: z.string().describe("Target device ID"),
			x: z.number().describe("X coordinate in pixels"),
			y: z.number().describe("Y coordinate in pixels"),
		},
		async ({ deviceId, x, y }) => {
			const bridge = await findBridge(deviceId);
			if (!bridge?.sendTap) {
				return {
					content: [{ type: "text", text: "No bridge supports tap for this device" }],
					isError: true,
				};
			}
			try {
				await bridge.sendTap(deviceId, x, y);
				return { content: [{ type: "text", text: `Tapped at (${x}, ${y})` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Tap failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"agentation_mobile_swipe",
		"Perform a swipe gesture between two points on the device screen.",
		{
			deviceId: z.string().describe("Target device ID"),
			fromX: z.number().describe("Start X coordinate in pixels"),
			fromY: z.number().describe("Start Y coordinate in pixels"),
			toX: z.number().describe("End X coordinate in pixels"),
			toY: z.number().describe("End Y coordinate in pixels"),
			durationMs: z.number().describe("Duration of swipe in milliseconds (default 300)").optional(),
		},
		async ({ deviceId, fromX, fromY, toX, toY, durationMs }) => {
			const bridge = await findBridge(deviceId);
			if (!bridge?.sendSwipe) {
				return {
					content: [{ type: "text", text: "No bridge supports swipe for this device" }],
					isError: true,
				};
			}
			try {
				await bridge.sendSwipe(deviceId, fromX, fromY, toX, toY, durationMs);
				return {
					content: [
						{
							type: "text",
							text: `Swiped from (${fromX}, ${fromY}) to (${toX}, ${toY})`,
						},
					],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Swipe failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"agentation_mobile_type_text",
		"Type text into the currently focused input field on the device.",
		{
			deviceId: z.string().describe("Target device ID"),
			text: z.string().describe("Text to type"),
		},
		async ({ deviceId, text }) => {
			const bridge = await findBridge(deviceId);
			if (!bridge?.sendText) {
				return {
					content: [{ type: "text", text: "No bridge supports text input for this device" }],
					isError: true,
				};
			}
			try {
				await bridge.sendText(deviceId, text);
				return { content: [{ type: "text", text: `Typed: "${text}"` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Text input failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"agentation_mobile_press_key",
		"Send a key event to the device. For Android: KEYCODE_BACK, KEYCODE_HOME, KEYCODE_ENTER, etc. For iOS: return, escape, home, etc.",
		{
			deviceId: z.string().describe("Target device ID"),
			keyCode: z.string().describe("Key code string (platform-specific)"),
		},
		async ({ deviceId, keyCode }) => {
			const bridge = await findBridge(deviceId);
			if (!bridge?.sendKeyEvent) {
				return {
					content: [{ type: "text", text: "No bridge supports key events for this device" }],
					isError: true,
				};
			}
			try {
				await bridge.sendKeyEvent(deviceId, keyCode);
				return { content: [{ type: "text", text: `Pressed key: ${keyCode}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Key event failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	// -----------------------------------------------------------------------
	// Animation tools
	// -----------------------------------------------------------------------

	server.tool(
		"agentation_mobile_get_animations",
		"Get active animations on a device. Returns all elements that have animation data, including the animation type, property, status, duration, and source location.",
		{
			deviceId: z.string().describe("Target device ID"),
		},
		async ({ deviceId }) => {
			const bridge = await findBridge(deviceId);
			if (!bridge) {
				return {
					content: [{ type: "text", text: "Device not found" }],
					isError: true,
				};
			}
			try {
				// Get element tree and filter for elements with animations
				const elements = await bridge.getElementTree(deviceId);
				const animated = elements.filter((el) => el.animations && el.animations.length > 0);

				if (animated.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No animations detected. Note: animation detection works best with React Native (Animated API), Flutter (built-in animation widgets), and native apps using the Agentation SDK.",
							},
						],
					};
				}

				const summary = animated
					.map((el) => {
						const ref = buildSourceRef(el) ?? el.componentName;
						const anims = (el.animations ?? [])
							.map((a) => {
								let desc = `  - ${a.property} (${a.type})`;
								if (a.status) desc += ` [${a.status}]`;
								if (a.duration) desc += ` ${a.duration}ms`;
								if (a.sourceLocation)
									desc += ` @ ${a.sourceLocation.file}:${a.sourceLocation.line}`;
								return desc;
							})
							.join("\n");
						return `${ref}:\n${anims}`;
					})
					.join("\n\n");

				return {
					content: [
						{
							type: "text",
							text: `Found ${animated.length} animated element(s):\n\n${summary}`,
						},
					],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Animation detection failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	// -----------------------------------------------------------------------
	// Recording tools
	// -----------------------------------------------------------------------

	server.tool(
		"agentation_mobile_start_recording",
		"Start recording the device screen at a configurable FPS. Returns recording metadata.",
		{
			deviceId: z.string().describe("Target device ID"),
			sessionId: z
				.string()
				.optional()
				.describe("Optional session ID to associate with the recording"),
			fps: z.number().optional().describe("Frames per second (default 10)"),
		},
		async ({ deviceId, sessionId, fps }) => {
			if (!recordingEngine) {
				return {
					content: [{ type: "text", text: "Recording engine not available" }],
					isError: true,
				};
			}
			try {
				const recording = await recordingEngine.start(deviceId, fps, sessionId);
				eventBus.emit("recording.started", recording);
				return {
					content: [{ type: "text", text: JSON.stringify(recording, null, 2) }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Start recording failed: ${err}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"agentation_mobile_stop_recording",
		"Stop an active recording and return its metadata including frame count and duration.",
		{
			recordingId: z.string().describe("Recording ID from start_recording"),
		},
		async ({ recordingId }) => {
			if (!recordingEngine) {
				return {
					content: [{ type: "text", text: "Recording engine not available" }],
					isError: true,
				};
			}
			const recording = recordingEngine.stop(recordingId);
			if (!recording) {
				return {
					content: [{ type: "text", text: "Recording not found" }],
					isError: true,
				};
			}
			eventBus.emit("recording.stopped", recording);
			return {
				content: [{ type: "text", text: JSON.stringify(recording, null, 2) }],
			};
		},
	);

	server.tool(
		"agentation_mobile_list_recordings",
		"List all recordings, optionally filtered by session ID.",
		{
			sessionId: z.string().optional().describe("Optional session ID to filter by"),
		},
		async ({ sessionId }) => {
			let recordings = store.listRecordings();
			if (sessionId) {
				recordings = recordings.filter((r) => r.sessionId === sessionId);
			}
			return {
				content: [{ type: "text", text: JSON.stringify(recordings, null, 2) }],
			};
		},
	);

	server.tool(
		"agentation_mobile_get_recording_frame",
		"Get a frame image from a recording at a specific timestamp. Returns the frame as a base64-encoded PNG image.",
		{
			recordingId: z.string().describe("Recording ID"),
			timestampMs: z.number().describe("Timestamp in milliseconds from recording start"),
		},
		async ({ recordingId, timestampMs }) => {
			const frame = store.getFrameAtTimestamp(recordingId, timestampMs);
			if (!frame) {
				return {
					content: [{ type: "text", text: "No frame found at that timestamp" }],
					isError: true,
				};
			}
			const screenshot = store.getScreenshot(frame.screenshotId);
			if (!screenshot) {
				return {
					content: [{ type: "text", text: "Frame screenshot data not found" }],
					isError: true,
				};
			}
			const base64 = screenshot.toString("base64");
			return {
				content: [
					{
						type: "text",
						text: `Frame at ${timestampMs}ms (actual: ${frame.timestamp}ms)`,
					},
					{ type: "image", data: base64, mimeType: "image/png" },
				],
			};
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
	sourceLocation?: { file: string; line: number; column?: number };
}): string | undefined {
	if (!element) return undefined;
	const name = element.componentName || "Unknown";
	if (element.sourceLocation) {
		const { file, line, column } = element.sourceLocation;
		const loc = column != null ? `${file}:${line}:${column}` : `${file}:${line}`;
		return `${name} (${loc})`;
	}
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
		| {
				componentName?: string;
				componentFile?: string;
				componentPath?: string;
				sourceLocation?: { file: string; line: number; column?: number };
				animations?: Array<{
					type: string;
					property: string;
					status?: string;
					duration?: number;
					sourceLocation?: { file: string; line: number };
				}>;
		  }
		| undefined;
	const sourceRef = buildSourceRef(element);
	if (sourceRef) {
		enriched.sourceRef = sourceRef;
	}
	// Include animation summary if present
	if (element?.animations && element.animations.length > 0) {
		enriched.animationSummary = element.animations
			.map((a) => {
				let desc = `${a.property} (${a.type})`;
				if (a.status) desc += ` [${a.status}]`;
				if (a.duration) desc += ` ${a.duration}ms`;
				if (a.sourceLocation) desc += ` @ ${a.sourceLocation.file}:${a.sourceLocation.line}`;
				return desc;
			})
			.join("; ");
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

/**
 * iOS simulator UDIDs are 36-char UUID strings.
 * Android device IDs are "emulator-5554", IP:port, or serial strings.
 * Metro virtual devices start with "metro-".
 */
function guessPlatformFromDeviceId(deviceId: string): string | undefined {
	if (deviceId.startsWith("metro-")) return "react-native";
	if (IOS_UDID_REGEX.test(deviceId)) return undefined; // Could be ios-native or react-native
	if (deviceId.startsWith("emulator-") || deviceId.includes(":")) return undefined; // Could be android-native or react-native
	return undefined;
}

function createBridgeFinder(bridges: IPlatformBridge[]) {
	const cache = new Map<string, { bridge: IPlatformBridge; expiresAt: number }>();

	function cacheKey(deviceId: string, platform?: string): string {
		return platform ? `${deviceId}:${platform}` : deviceId;
	}

	return async function findBridge(
		deviceId: string,
		platform?: string,
	): Promise<IPlatformBridge | undefined> {
		// Check cache first (platform-specific key takes precedence)
		if (platform) {
			const cached = cache.get(cacheKey(deviceId, platform));
			if (cached && cached.expiresAt > Date.now()) {
				return cached.bridge;
			}
		}
		const cachedGeneric = cache.get(deviceId);
		if (!platform && cachedGeneric && cachedGeneric.expiresAt > Date.now()) {
			return cachedGeneric.bridge;
		}

		// Try heuristic-based ordering: put likely bridges first
		const guess = platform || guessPlatformFromDeviceId(deviceId);
		const ordered = guess
			? [...bridges].sort((a, b) => {
					if (a.platform === guess) return -1;
					if (b.platform === guess) return 1;
					return 0;
				})
			: bridges;

		// Try bridges sequentially with early exit, but still populate cache
		for (const bridge of ordered) {
			try {
				if (!(await bridge.isAvailable())) continue;
				const devices = await bridge.listDevices();
				const now = Date.now();
				for (const d of devices) {
					cache.set(cacheKey(d.id, bridge.platform), {
						bridge,
						expiresAt: now + BRIDGE_CACHE_TTL,
					});
					// Also set generic key for backwards compat
					cache.set(d.id, { bridge, expiresAt: now + BRIDGE_CACHE_TTL });
				}
				if (devices.some((d) => d.id === deviceId) && (!platform || bridge.platform === platform)) {
					return bridge;
				}
			} catch {
				// bridge unavailable, try next
			}
		}

		return undefined;
	};
}
