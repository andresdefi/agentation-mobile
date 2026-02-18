import type { DeviceInfo, IPlatformBridge } from "@agentation-mobile/bridge-core";
import { Store } from "@agentation-mobile/core";
import { EventBus } from "@agentation-mobile/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./mcp-server";

function createMockBridge(devices: DeviceInfo[] = []): IPlatformBridge {
	return {
		platform: "android-native" as const,
		listDevices: vi.fn().mockResolvedValue(devices),
		captureScreen: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
		getElementTree: vi.fn().mockResolvedValue([]),
		inspectElement: vi.fn().mockResolvedValue(null),
		isAvailable: vi.fn().mockResolvedValue(true),
	};
}

async function setupTestClient(opts?: {
	bridges?: IPlatformBridge[];
}) {
	const store = new Store();
	const eventBus = new EventBus();
	const bridges = opts?.bridges ?? [];

	const mcpServer = createMcpServer({ store, eventBus, bridges });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	const client = new Client({ name: "test-client", version: "0.0.1" });

	await mcpServer.connect(serverTransport);
	await client.connect(clientTransport);

	return { client, store, eventBus, bridges };
}

describe("MCP Server", () => {
	describe("list_sessions", () => {
		it("returns empty array when no sessions exist", async () => {
			const { client } = await setupTestClient();
			const result = await client.callTool({
				name: "agentation_mobile_list_sessions",
				arguments: {},
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			expect(JSON.parse(text)).toEqual([]);
		});

		it("returns created sessions", async () => {
			const { client, store } = await setupTestClient();
			store.createSession({ name: "Test", deviceId: "d-1", platform: "react-native" });
			const result = await client.callTool({
				name: "agentation_mobile_list_sessions",
				arguments: {},
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const sessions = JSON.parse(text);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].name).toBe("Test");
		});
	});

	describe("get_session", () => {
		it("returns session with annotations", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({
				name: "S1",
				deviceId: "d-1",
				platform: "react-native",
			});
			store.createAnnotation({
				sessionId: session.id,
				x: 50,
				y: 50,
				deviceId: "d-1",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Test",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_get_session",
				arguments: { sessionId: session.id },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.name).toBe("S1");
			expect(data.annotations).toHaveLength(1);
		});

		it("returns error for invalid session id", async () => {
			const { client } = await setupTestClient();
			const result = await client.callTool({
				name: "agentation_mobile_get_session",
				arguments: { sessionId: "nonexistent" },
			});
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			expect(text).toBe("Session not found");
		});
	});

	describe("acknowledge / resolve / dismiss lifecycle", () => {
		it("acknowledges an annotation", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			const annotation = store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Ack me",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_acknowledge",
				arguments: { annotationId: annotation.id },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.status).toBe("acknowledged");
		});

		it("resolves an annotation", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			const annotation = store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Resolve me",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_resolve",
				arguments: { annotationId: annotation.id },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.status).toBe("resolved");
		});

		it("dismisses an annotation", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			const annotation = store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Dismiss me",
				intent: "question",
				severity: "suggestion",
			});
			const result = await client.callTool({
				name: "agentation_mobile_dismiss",
				arguments: { annotationId: annotation.id, reason: "Not relevant" },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.status).toBe("dismissed");
		});

		it("returns error for unknown annotation", async () => {
			const { client } = await setupTestClient();
			const result = await client.callTool({
				name: "agentation_mobile_acknowledge",
				arguments: { annotationId: "nonexistent" },
			});
			expect(result.isError).toBe(true);
		});
	});

	describe("list_devices", () => {
		it("returns devices from mock bridges", async () => {
			const mockDevices: DeviceInfo[] = [
				{
					id: "emulator-5554",
					name: "Pixel 7",
					platform: "android-native",
					isEmulator: true,
					osVersion: "14",
					screenWidth: 1080,
					screenHeight: 2400,
				},
			];
			const bridge = createMockBridge(mockDevices);
			const { client } = await setupTestClient({ bridges: [bridge] });
			const result = await client.callTool({
				name: "agentation_mobile_list_devices",
				arguments: {},
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const devices = JSON.parse(text);
			expect(devices).toHaveLength(1);
			expect(devices[0].id).toBe("emulator-5554");
		});

		it("returns empty array when no bridges available", async () => {
			const { client } = await setupTestClient({ bridges: [] });
			const result = await client.callTool({
				name: "agentation_mobile_list_devices",
				arguments: {},
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			expect(JSON.parse(text)).toEqual([]);
		});
	});

	describe("sourceRef enrichment", () => {
		it("includes sourceRef when annotation has element with componentFile", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Fix button",
				intent: "fix",
				severity: "important",
				element: {
					id: "elem-1",
					platform: "react-native",
					componentPath: "App/Screen/Button",
					componentName: "Button",
					componentFile: "src/screens/Login.tsx",
					boundingBox: { x: 100, y: 200, width: 80, height: 40 },
				},
			});
			const result = await client.callTool({
				name: "agentation_mobile_get_session",
				arguments: { sessionId: session.id },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.annotations[0].sourceRef).toBe("Button (src/screens/Login.tsx)");
		});

		it("includes sourceRef with componentPath when no componentFile", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Fix it",
				intent: "fix",
				severity: "important",
				element: {
					id: "elem-2",
					platform: "android-native",
					componentPath: "App/Dashboard/Card",
					componentName: "Card",
					boundingBox: { x: 0, y: 0, width: 100, height: 50 },
				},
			});
			const result = await client.callTool({
				name: "agentation_mobile_get_all_pending",
				arguments: {},
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data[0].sourceRef).toBe("Card > App/Dashboard/Card");
		});

		it("omits sourceRef when annotation has no element", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "No element",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_get_pending",
				arguments: { sessionId: session.id },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data[0].sourceRef).toBeUndefined();
		});
	});

	describe("watch_annotations", () => {
		it("poll mode returns current pending immediately", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Pending one",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_watch_annotations",
				arguments: {},
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.mode).toBe("poll");
			expect(data.pending).toHaveLength(1);
			expect(data.count).toBe(1);
		});

		it("poll mode with sessionId filters annotations", async () => {
			const { client, store } = await setupTestClient();
			const s1 = store.createSession({ name: "S1", deviceId: "d", platform: "react-native" });
			const s2 = store.createSession({ name: "S2", deviceId: "d", platform: "react-native" });
			store.createAnnotation({
				sessionId: s1.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "S1 annotation",
				intent: "fix",
				severity: "important",
			});
			store.createAnnotation({
				sessionId: s2.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "S2 annotation",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_watch_annotations",
				arguments: { sessionId: s1.id },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.pending).toHaveLength(1);
			expect(data.pending[0].comment).toBe("S1 annotation");
		});

		it("blocking mode returns batch after annotation arrives", async () => {
			const { client, store, eventBus } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });

			const watchPromise = client.callTool({
				name: "agentation_mobile_watch_annotations",
				arguments: { mode: "blocking", batchWindowMs: 100, maxWaitMs: 5000 },
			});

			// Simulate annotation creation after a short delay
			setTimeout(() => {
				const annotation = store.createAnnotation({
					sessionId: session.id,
					x: 10,
					y: 20,
					deviceId: "d",
					platform: "react-native",
					screenWidth: 390,
					screenHeight: 844,
					comment: "New one",
					intent: "fix",
					severity: "important",
				});
				eventBus.emit("annotation.created", annotation);
			}, 50);

			const result = await watchPromise;
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.mode).toBe("blocking");
			expect(data.newCount).toBe(1);
			expect(data.newAnnotations).toHaveLength(1);
		});

		it("blocking mode returns empty after maxWaitMs timeout", async () => {
			const { client } = await setupTestClient();

			const result = await client.callTool({
				name: "agentation_mobile_watch_annotations",
				arguments: { mode: "blocking", batchWindowMs: 50, maxWaitMs: 100 },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.mode).toBe("blocking");
			expect(data.newCount).toBe(0);
			expect(data.newAnnotations).toEqual([]);
		});

		it("blocking mode collects multiple annotations in batch window", async () => {
			const { client, store, eventBus } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });

			const watchPromise = client.callTool({
				name: "agentation_mobile_watch_annotations",
				arguments: { mode: "blocking", batchWindowMs: 200, maxWaitMs: 5000 },
			});

			// Emit two annotations within the batch window
			setTimeout(() => {
				const a1 = store.createAnnotation({
					sessionId: session.id,
					x: 10,
					y: 20,
					deviceId: "d",
					platform: "react-native",
					screenWidth: 390,
					screenHeight: 844,
					comment: "First",
					intent: "fix",
					severity: "important",
				});
				eventBus.emit("annotation.created", a1);
			}, 30);

			setTimeout(() => {
				const a2 = store.createAnnotation({
					sessionId: session.id,
					x: 30,
					y: 40,
					deviceId: "d",
					platform: "react-native",
					screenWidth: 390,
					screenHeight: 844,
					comment: "Second",
					intent: "change",
					severity: "suggestion",
				});
				eventBus.emit("annotation.created", a2);
			}, 80);

			const result = await watchPromise;
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.newCount).toBe(2);
			expect(data.newAnnotations).toHaveLength(2);
		});

		it("blocking mode filters by sessionId", async () => {
			const { client, store, eventBus } = await setupTestClient();
			const s1 = store.createSession({ name: "S1", deviceId: "d", platform: "react-native" });
			const s2 = store.createSession({ name: "S2", deviceId: "d", platform: "react-native" });

			const watchPromise = client.callTool({
				name: "agentation_mobile_watch_annotations",
				arguments: { mode: "blocking", sessionId: s1.id, batchWindowMs: 150, maxWaitMs: 5000 },
			});

			// Emit annotation for wrong session (should be ignored)
			setTimeout(() => {
				const a1 = store.createAnnotation({
					sessionId: s2.id,
					x: 10,
					y: 20,
					deviceId: "d",
					platform: "react-native",
					screenWidth: 390,
					screenHeight: 844,
					comment: "Wrong session",
					intent: "fix",
					severity: "important",
				});
				eventBus.emit("annotation.created", a1);
			}, 30);

			// Emit annotation for correct session
			setTimeout(() => {
				const a2 = store.createAnnotation({
					sessionId: s1.id,
					x: 30,
					y: 40,
					deviceId: "d",
					platform: "react-native",
					screenWidth: 390,
					screenHeight: 844,
					comment: "Right session",
					intent: "fix",
					severity: "important",
				});
				eventBus.emit("annotation.created", a2);
			}, 60);

			const result = await watchPromise;
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.newCount).toBe(1);
			expect(data.newAnnotations[0].comment).toBe("Right session");
		});
	});

	describe("capture_screen", () => {
		it("captures a screenshot and returns image data", async () => {
			const mockDevices: DeviceInfo[] = [
				{
					id: "device-1",
					name: "Pixel 7",
					platform: "android-native",
					isEmulator: true,
					osVersion: "14",
					screenWidth: 1080,
					screenHeight: 2400,
				},
			];
			const bridge = createMockBridge(mockDevices);
			const { client } = await setupTestClient({ bridges: [bridge] });
			const result = await client.callTool({
				name: "agentation_mobile_capture_screen",
				arguments: { deviceId: "device-1" },
			});
			expect(result.isError).toBeFalsy();
			const content = result.content as Array<{ type: string; text?: string; data?: string }>;
			expect(content).toHaveLength(2);
			expect(content[0].text).toContain("Screenshot captured");
			expect(content[1].type).toBe("image");
		});

		it("returns error for unknown device", async () => {
			const { client } = await setupTestClient({ bridges: [] });
			const result = await client.callTool({
				name: "agentation_mobile_capture_screen",
				arguments: { deviceId: "nonexistent" },
			});
			expect(result.isError).toBe(true);
		});
	});

	describe("get_element_tree", () => {
		it("returns element tree from bridge", async () => {
			const mockDevices: DeviceInfo[] = [
				{
					id: "device-1",
					name: "Pixel 7",
					platform: "android-native",
					isEmulator: true,
					osVersion: "14",
					screenWidth: 1080,
					screenHeight: 2400,
				},
			];
			const bridge = createMockBridge(mockDevices);
			(bridge.getElementTree as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					id: "el-1",
					platform: "android-native",
					componentPath: "App/Button",
					componentName: "Button",
					boundingBox: { x: 0, y: 0, width: 100, height: 40 },
				},
			]);
			const { client } = await setupTestClient({ bridges: [bridge] });
			const result = await client.callTool({
				name: "agentation_mobile_get_element_tree",
				arguments: { deviceId: "device-1" },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const elements = JSON.parse(text);
			expect(elements).toHaveLength(1);
			expect(elements[0].componentName).toBe("Button");
		});
	});

	describe("reply", () => {
		it("adds a reply to an annotation thread", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d", platform: "react-native" });
			const annotation = store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "d",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Reply to me",
				intent: "question",
				severity: "suggestion",
			});
			const result = await client.callTool({
				name: "agentation_mobile_reply",
				arguments: { annotationId: annotation.id, content: "Here's my reply" },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.thread).toHaveLength(1);
			expect(data.thread[0].role).toBe("agent");
			expect(data.thread[0].content).toBe("Here's my reply");
		});

		it("returns error for unknown annotation", async () => {
			const { client } = await setupTestClient();
			const result = await client.callTool({
				name: "agentation_mobile_reply",
				arguments: { annotationId: "nonexistent", content: "reply" },
			});
			expect(result.isError).toBe(true);
		});
	});

	describe("capture_and_resolve", () => {
		it("captures screenshot and resolves annotation in one step", async () => {
			const mockDevices: DeviceInfo[] = [
				{
					id: "device-1",
					name: "Pixel 7",
					platform: "android-native",
					isEmulator: true,
					osVersion: "14",
					screenWidth: 1080,
					screenHeight: 2400,
				},
			];
			const bridge = createMockBridge(mockDevices);
			const { client, store } = await setupTestClient({ bridges: [bridge] });
			const session = store.createSession({
				name: "S",
				deviceId: "device-1",
				platform: "android-native",
			});
			const annotation = store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 20,
				deviceId: "device-1",
				platform: "android-native",
				screenWidth: 1080,
				screenHeight: 2400,
				comment: "Fix and resolve",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_capture_and_resolve",
				arguments: { annotationId: annotation.id, deviceId: "device-1" },
			});
			expect(result.isError).toBeFalsy();
			const content = result.content as Array<{ type: string; text?: string }>;
			expect(content[0].text).toContain("Annotation resolved");
			// Verify the annotation is actually resolved
			const updated = store.getAnnotation(annotation.id);
			expect(updated?.status).toBe("resolved");
		});
	});

	describe("add_device_to_session", () => {
		it("adds a device to a session", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({ name: "S", deviceId: "d-1", platform: "react-native" });
			const result = await client.callTool({
				name: "agentation_mobile_add_device_to_session",
				arguments: { sessionId: session.id, deviceId: "d-2", platform: "android-native" },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.devices).toHaveLength(2);
		});

		it("returns error for unknown session", async () => {
			const { client } = await setupTestClient();
			const result = await client.callTool({
				name: "agentation_mobile_add_device_to_session",
				arguments: { sessionId: "nonexistent", deviceId: "d-1", platform: "android-native" },
			});
			expect(result.isError).toBe(true);
		});
	});

	describe("pause_animations / resume_animations", () => {
		it("pauses animations on a device", async () => {
			const mockDevices: DeviceInfo[] = [
				{
					id: "device-1",
					name: "Pixel 7",
					platform: "android-native",
					isEmulator: true,
					osVersion: "14",
					screenWidth: 1080,
					screenHeight: 2400,
				},
			];
			const bridge = createMockBridge(mockDevices);
			bridge.pauseAnimations = vi.fn().mockResolvedValue({ success: true, message: "Paused" });
			bridge.resumeAnimations = vi.fn().mockResolvedValue({ success: true, message: "Resumed" });
			const { client } = await setupTestClient({ bridges: [bridge] });

			const pauseResult = await client.callTool({
				name: "agentation_mobile_pause_animations",
				arguments: { deviceId: "device-1" },
			});
			const pauseText = (pauseResult.content as Array<{ type: string; text: string }>)[0].text;
			expect(JSON.parse(pauseText).success).toBe(true);

			const resumeResult = await client.callTool({
				name: "agentation_mobile_resume_animations",
				arguments: { deviceId: "device-1" },
			});
			const resumeText = (resumeResult.content as Array<{ type: string; text: string }>)[0].text;
			expect(JSON.parse(resumeText).success).toBe(true);
		});

		it("returns error when bridge lacks animation support", async () => {
			const mockDevices: DeviceInfo[] = [
				{
					id: "device-1",
					name: "Pixel 7",
					platform: "android-native",
					isEmulator: true,
					osVersion: "14",
					screenWidth: 1080,
					screenHeight: 2400,
				},
			];
			const bridge = createMockBridge(mockDevices);
			// No pauseAnimations/resumeAnimations methods
			const { client } = await setupTestClient({ bridges: [bridge] });

			const result = await client.callTool({
				name: "agentation_mobile_pause_animations",
				arguments: { deviceId: "device-1" },
			});
			expect(result.isError).toBe(true);
		});

		it("returns error for unknown device", async () => {
			const { client } = await setupTestClient({ bridges: [] });
			const result = await client.callTool({
				name: "agentation_mobile_pause_animations",
				arguments: { deviceId: "nonexistent" },
			});
			expect(result.isError).toBe(true);
		});
	});

	describe("export", () => {
		it("exports session annotations as json", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({
				name: "Export Test",
				deviceId: "d-1",
				platform: "react-native",
			});
			store.createAnnotation({
				sessionId: session.id,
				x: 50,
				y: 50,
				deviceId: "d-1",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Export this",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_export",
				arguments: { sessionId: session.id, format: "json" },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			const data = JSON.parse(text);
			expect(data.session.name).toBe("Export Test");
			expect(data.annotations).toHaveLength(1);
		});

		it("exports session annotations as markdown", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({
				name: "MD Test",
				deviceId: "d-1",
				platform: "react-native",
			});
			store.createAnnotation({
				sessionId: session.id,
				x: 25,
				y: 75,
				deviceId: "d-1",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Markdown annotation",
				intent: "change",
				severity: "suggestion",
			});
			const result = await client.callTool({
				name: "agentation_mobile_export",
				arguments: { sessionId: session.id, format: "markdown" },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			expect(text).toContain("# Annotations Report - MD Test");
			expect(text).toContain("Markdown annotation");
		});

		it("exports with agent format and detail level", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({
				name: "Agent Test",
				deviceId: "d-1",
				platform: "react-native",
			});
			store.createAnnotation({
				sessionId: session.id,
				x: 50,
				y: 50,
				deviceId: "d-1",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Agent format test",
				intent: "fix",
				severity: "important",
			});
			const result = await client.callTool({
				name: "agentation_mobile_export",
				arguments: { sessionId: session.id, format: "agent", detailLevel: "compact" },
			});
			const text = (result.content as Array<{ type: string; text: string }>)[0].text;
			expect(text).toContain("Agent format test");
		});

		it("defaults to agent format when no format specified", async () => {
			const { client, store } = await setupTestClient();
			const session = store.createSession({
				name: "Default Fmt",
				deviceId: "d-1",
				platform: "react-native",
			});
			store.createAnnotation({
				sessionId: session.id,
				x: 10,
				y: 10,
				deviceId: "d-1",
				platform: "react-native",
				screenWidth: 390,
				screenHeight: 844,
				comment: "Default format",
				intent: "change",
				severity: "suggestion",
			});
			const result = await client.callTool({
				name: "agentation_mobile_export",
				arguments: { sessionId: session.id },
			});
			expect(result.isError).toBeFalsy();
		});

		it("returns error for unknown session", async () => {
			const { client } = await setupTestClient();
			const result = await client.callTool({
				name: "agentation_mobile_export",
				arguments: { sessionId: "nonexistent", format: "json" },
			});
			expect(result.isError).toBe(true);
		});
	});
});
