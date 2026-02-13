import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store";
import type { CreateAnnotationInput, CreateSessionInput } from "./store";

function makeSessionInput(overrides?: Partial<CreateSessionInput>): CreateSessionInput {
	return {
		name: "Test Session",
		deviceId: "device-1",
		platform: "react-native",
		...overrides,
	};
}

function makeAnnotationInput(
	sessionId: string,
	overrides?: Partial<CreateAnnotationInput>,
): CreateAnnotationInput {
	return {
		sessionId,
		x: 50,
		y: 50,
		deviceId: "device-1",
		platform: "react-native",
		screenWidth: 390,
		screenHeight: 844,
		comment: "Button is misaligned",
		intent: "fix",
		severity: "important",
		...overrides,
	};
}

describe("Store", () => {
	let store: Store;

	beforeEach(() => {
		store = new Store();
	});

	// --- Sessions ---

	describe("createSession", () => {
		it("creates a session with a unique id", () => {
			const session = store.createSession(makeSessionInput());
			expect(session.id).toBeDefined();
			expect(session.name).toBe("Test Session");
			expect(session.deviceId).toBe("device-1");
			expect(session.platform).toBe("react-native");
		});

		it("initializes devices array with the initial device", () => {
			const session = store.createSession(makeSessionInput());
			expect(session.devices).toHaveLength(1);
			expect(session.devices[0].deviceId).toBe("device-1");
			expect(session.devices[0].platform).toBe("react-native");
		});

		it("sets createdAt and updatedAt timestamps", () => {
			const session = store.createSession(makeSessionInput());
			expect(session.createdAt).toBeDefined();
			expect(session.updatedAt).toBeDefined();
		});
	});

	describe("getSession", () => {
		it("returns a session by id", () => {
			const created = store.createSession(makeSessionInput());
			const retrieved = store.getSession(created.id);
			expect(retrieved).toEqual(created);
		});

		it("returns undefined for unknown id", () => {
			expect(store.getSession("nonexistent")).toBeUndefined();
		});
	});

	describe("listSessions", () => {
		it("returns empty array when no sessions exist", () => {
			expect(store.listSessions()).toEqual([]);
		});

		it("returns all created sessions", () => {
			store.createSession(makeSessionInput({ name: "Session A" }));
			store.createSession(makeSessionInput({ name: "Session B" }));
			const sessions = store.listSessions();
			expect(sessions).toHaveLength(2);
			expect(sessions.map((s) => s.name)).toContain("Session A");
			expect(sessions.map((s) => s.name)).toContain("Session B");
		});
	});

	// --- Annotations ---

	describe("createAnnotation", () => {
		it("creates an annotation with correct fields", () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			expect(annotation.id).toBeDefined();
			expect(annotation.sessionId).toBe(session.id);
			expect(annotation.comment).toBe("Button is misaligned");
			expect(annotation.status).toBe("pending");
			expect(annotation.thread).toEqual([]);
		});

		it("stores element data when provided", () => {
			const session = store.createSession(makeSessionInput());
			const element = {
				id: "elem-1",
				platform: "react-native" as const,
				componentPath: "App/Screen/Button",
				componentName: "Button",
				boundingBox: { x: 100, y: 200, width: 80, height: 40 },
			};
			const annotation = store.createAnnotation(makeAnnotationInput(session.id, { element }));
			expect(annotation.element).toEqual(element);
		});
	});

	describe("getAnnotation", () => {
		it("returns an annotation by id", () => {
			const session = store.createSession(makeSessionInput());
			const created = store.createAnnotation(makeAnnotationInput(session.id));
			const retrieved = store.getAnnotation(created.id);
			expect(retrieved).toEqual(created);
		});

		it("returns undefined for unknown id", () => {
			expect(store.getAnnotation("nonexistent")).toBeUndefined();
		});
	});

	describe("getSessionAnnotations", () => {
		it("returns annotations for a specific session", () => {
			const s1 = store.createSession(makeSessionInput({ name: "S1" }));
			const s2 = store.createSession(makeSessionInput({ name: "S2" }));
			store.createAnnotation(makeAnnotationInput(s1.id, { comment: "A" }));
			store.createAnnotation(makeAnnotationInput(s1.id, { comment: "B" }));
			store.createAnnotation(makeAnnotationInput(s2.id, { comment: "C" }));
			const s1Annotations = store.getSessionAnnotations(s1.id);
			expect(s1Annotations).toHaveLength(2);
			expect(s1Annotations.map((a) => a.comment)).toEqual(["A", "B"]);
		});

		it("returns empty array for session with no annotations", () => {
			const session = store.createSession(makeSessionInput());
			expect(store.getSessionAnnotations(session.id)).toEqual([]);
		});
	});

	// --- Pending ---

	describe("getPendingAnnotations", () => {
		it("returns only pending annotations for a session", () => {
			const session = store.createSession(makeSessionInput());
			const a1 = store.createAnnotation(makeAnnotationInput(session.id, { comment: "P1" }));
			store.createAnnotation(makeAnnotationInput(session.id, { comment: "P2" }));
			store.updateAnnotationStatus(a1.id, "resolved");
			const pending = store.getPendingAnnotations(session.id);
			expect(pending).toHaveLength(1);
			expect(pending[0].comment).toBe("P2");
		});
	});

	describe("getAllPendingAnnotations", () => {
		it("returns pending annotations across all sessions", () => {
			const s1 = store.createSession(makeSessionInput({ name: "S1" }));
			const s2 = store.createSession(makeSessionInput({ name: "S2" }));
			store.createAnnotation(makeAnnotationInput(s1.id));
			const a2 = store.createAnnotation(makeAnnotationInput(s2.id));
			store.updateAnnotationStatus(a2.id, "dismissed");
			const pending = store.getAllPendingAnnotations();
			expect(pending).toHaveLength(1);
			expect(pending[0].sessionId).toBe(s1.id);
		});
	});

	// --- Status lifecycle ---

	describe("updateAnnotationStatus", () => {
		it("transitions pending → acknowledged", () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			const updated = store.updateAnnotationStatus(annotation.id, "acknowledged");
			expect(updated?.status).toBe("acknowledged");
		});

		it("transitions acknowledged → resolved", () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			store.updateAnnotationStatus(annotation.id, "acknowledged");
			const updated = store.updateAnnotationStatus(annotation.id, "resolved");
			expect(updated?.status).toBe("resolved");
		});

		it("transitions pending → dismissed", () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			const updated = store.updateAnnotationStatus(annotation.id, "dismissed");
			expect(updated?.status).toBe("dismissed");
		});

		it("returns undefined for unknown annotation", () => {
			expect(store.updateAnnotationStatus("nonexistent", "resolved")).toBeUndefined();
		});

		it("updates the updatedAt timestamp", async () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			const before = annotation.updatedAt;
			await new Promise((r) => setTimeout(r, 5));
			const updated = store.updateAnnotationStatus(annotation.id, "acknowledged");
			expect(updated?.updatedAt).not.toBe(before);
		});
	});

	// --- Thread ---

	describe("addThreadMessage", () => {
		it("adds a message to the annotation thread", () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			const updated = store.addThreadMessage(annotation.id, {
				role: "agent",
				content: "I'll fix this",
				timestamp: new Date().toISOString(),
			});
			expect(updated?.thread).toHaveLength(1);
			expect(updated?.thread[0].role).toBe("agent");
			expect(updated?.thread[0].content).toBe("I'll fix this");
		});

		it("appends multiple messages in order", () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			store.addThreadMessage(annotation.id, {
				role: "human",
				content: "First",
				timestamp: new Date().toISOString(),
			});
			store.addThreadMessage(annotation.id, {
				role: "agent",
				content: "Second",
				timestamp: new Date().toISOString(),
			});
			const retrieved = store.getAnnotation(annotation.id);
			expect(retrieved?.thread).toHaveLength(2);
			expect(retrieved?.thread[0].content).toBe("First");
			expect(retrieved?.thread[1].content).toBe("Second");
		});

		it("returns undefined for unknown annotation", () => {
			expect(
				store.addThreadMessage("nonexistent", {
					role: "agent",
					content: "test",
					timestamp: new Date().toISOString(),
				}),
			).toBeUndefined();
		});
	});

	// --- Resolution screenshot ---

	describe("attachResolutionScreenshot", () => {
		it("attaches a resolution screenshot id", () => {
			const session = store.createSession(makeSessionInput());
			const annotation = store.createAnnotation(makeAnnotationInput(session.id));
			const updated = store.attachResolutionScreenshot(annotation.id, "screenshot-123");
			expect(updated?.resolvedScreenshotId).toBe("screenshot-123");
		});

		it("returns undefined for unknown annotation", () => {
			expect(store.attachResolutionScreenshot("nonexistent", "s-1")).toBeUndefined();
		});
	});

	// --- Multi-device ---

	describe("addDeviceToSession", () => {
		it("adds a new device to the session", () => {
			const session = store.createSession(makeSessionInput());
			const updated = store.addDeviceToSession(session.id, "device-2", "android-native");
			expect(updated?.devices).toHaveLength(2);
			expect(updated?.devices[1].deviceId).toBe("device-2");
			expect(updated?.devices[1].platform).toBe("android-native");
		});

		it("does not duplicate an existing device", () => {
			const session = store.createSession(makeSessionInput());
			store.addDeviceToSession(session.id, "device-1", "react-native");
			const updated = store.getSession(session.id);
			expect(updated?.devices).toHaveLength(1);
		});

		it("returns undefined for unknown session", () => {
			expect(store.addDeviceToSession("nonexistent", "d-1", "ios-native")).toBeUndefined();
		});
	});

	describe("removeDeviceFromSession", () => {
		it("removes a device from the session", () => {
			const session = store.createSession(makeSessionInput());
			store.addDeviceToSession(session.id, "device-2", "android-native");
			const updated = store.removeDeviceFromSession(session.id, "device-2");
			expect(updated?.devices).toHaveLength(1);
			expect(updated?.devices[0].deviceId).toBe("device-1");
		});

		it("returns undefined for unknown session", () => {
			expect(store.removeDeviceFromSession("nonexistent", "d-1")).toBeUndefined();
		});
	});

	describe("getSessionAnnotationsByDevice", () => {
		it("filters annotations by device id", () => {
			const session = store.createSession(makeSessionInput());
			store.addDeviceToSession(session.id, "device-2", "android-native");
			store.createAnnotation(
				makeAnnotationInput(session.id, { deviceId: "device-1", comment: "D1" }),
			);
			store.createAnnotation(
				makeAnnotationInput(session.id, { deviceId: "device-2", comment: "D2" }),
			);
			const d1Annotations = store.getSessionAnnotationsByDevice(session.id, "device-1");
			expect(d1Annotations).toHaveLength(1);
			expect(d1Annotations[0].comment).toBe("D1");
		});
	});

	// --- Screenshots ---

	describe("storeScreenshot / getScreenshot", () => {
		it("stores and retrieves a screenshot buffer", () => {
			const data = Buffer.from("fake-png-data");
			store.storeScreenshot("ss-1", data);
			const retrieved = store.getScreenshot("ss-1");
			expect(retrieved).toEqual(data);
		});

		it("returns undefined for unknown screenshot", () => {
			expect(store.getScreenshot("nonexistent")).toBeUndefined();
		});
	});
});
