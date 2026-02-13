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
				arguments: { annotationId: annotation.id },
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
