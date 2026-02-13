import { describe, expect, it } from "vitest";
import { exportToJson, exportToMarkdown, formatGitHubIssueBody } from "./export";
import type { MobileAnnotation } from "./schemas/mobile-annotation";
import type { Session } from "./schemas/session";

function makeSession(overrides?: Partial<Session>): Session {
	return {
		id: "session-1",
		name: "Login Screen Review",
		deviceId: "device-1",
		platform: "react-native",
		devices: [
			{ deviceId: "device-1", platform: "react-native", addedAt: "2025-01-01T00:00:00.000Z" },
		],
		createdAt: "2025-01-01T00:00:00.000Z",
		updatedAt: "2025-01-01T00:00:00.000Z",
		...overrides,
	};
}

function makeAnnotation(overrides?: Partial<MobileAnnotation>): MobileAnnotation {
	return {
		id: "ann-1",
		sessionId: "session-1",
		x: 50,
		y: 30,
		deviceId: "device-1",
		platform: "react-native",
		screenWidth: 390,
		screenHeight: 844,
		comment: "Button text is truncated",
		intent: "fix",
		severity: "important",
		status: "pending",
		thread: [],
		createdAt: "2025-01-01T00:00:00.000Z",
		updatedAt: "2025-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("exportToJson", () => {
	it("produces valid JSON with session and annotations", () => {
		const session = makeSession();
		const annotations = [makeAnnotation()];
		const result = exportToJson(annotations, session);
		const parsed = JSON.parse(result);
		expect(parsed.session).toEqual(session);
		expect(parsed.annotations).toHaveLength(1);
		expect(parsed.exportedAt).toBeDefined();
	});

	it("works without a session", () => {
		const result = exportToJson([makeAnnotation()]);
		const parsed = JSON.parse(result);
		expect(parsed.session).toBeUndefined();
		expect(parsed.annotations).toHaveLength(1);
	});

	it("handles empty annotations array", () => {
		const result = exportToJson([]);
		const parsed = JSON.parse(result);
		expect(parsed.annotations).toEqual([]);
	});
});

describe("exportToMarkdown", () => {
	it("includes session header when provided", () => {
		const session = makeSession();
		const md = exportToMarkdown([makeAnnotation()], session);
		expect(md).toContain("# Annotations Report - Login Screen Review");
		expect(md).toContain("**Device:** device-1");
		expect(md).toContain("**Platform:** react-native");
	});

	it("uses generic header without session", () => {
		const md = exportToMarkdown([makeAnnotation()]);
		expect(md).toContain("# Annotations Report");
		expect(md).not.toContain("Login Screen Review");
	});

	it("includes annotation details", () => {
		const md = exportToMarkdown([makeAnnotation()]);
		expect(md).toContain("## Annotation #1: Button text is truncated");
		expect(md).toContain("**Status:** pending");
		expect(md).toContain("**Intent:** fix");
		expect(md).toContain("**Severity:** important");
		expect(md).toContain("**Position:** 50%, 30%");
	});

	it("includes element info when present", () => {
		const annotation = makeAnnotation({
			element: {
				id: "el-1",
				platform: "react-native",
				componentPath: "App/Login/SubmitButton",
				componentName: "SubmitButton",
				boundingBox: { x: 0, y: 0, width: 100, height: 40 },
			},
		});
		const md = exportToMarkdown([annotation]);
		expect(md).toContain("**Element:** SubmitButton (App/Login/SubmitButton)");
	});

	it("includes thread messages", () => {
		const annotation = makeAnnotation({
			thread: [
				{ role: "human", content: "Please fix ASAP", timestamp: "2025-01-01T01:00:00.000Z" },
				{ role: "agent", content: "On it", timestamp: "2025-01-01T01:01:00.000Z" },
			],
		});
		const md = exportToMarkdown([annotation]);
		expect(md).toContain("### Thread");
		expect(md).toContain("**human**");
		expect(md).toContain("Please fix ASAP");
		expect(md).toContain("**agent**");
		expect(md).toContain("On it");
	});

	it("shows total annotations count", () => {
		const md = exportToMarkdown([makeAnnotation(), makeAnnotation({ id: "ann-2" })]);
		expect(md).toContain("**Total annotations:** 2");
	});
});

describe("formatGitHubIssueBody", () => {
	it("includes annotation details section", () => {
		const body = formatGitHubIssueBody(makeAnnotation());
		expect(body).toContain("## Annotation Details");
		expect(body).toContain("**Comment:** Button text is truncated");
		expect(body).toContain("**Intent:** fix");
		expect(body).toContain("**Severity:** important");
		expect(body).toContain("**Status:** pending");
	});

	it("includes context section", () => {
		const body = formatGitHubIssueBody(makeAnnotation());
		expect(body).toContain("## Context");
		expect(body).toContain("**Position:** 50%, 30%");
		expect(body).toContain("**Screen:** 390x844");
		expect(body).toContain("**Device:** device-1");
		expect(body).toContain("**Platform:** react-native");
	});

	it("includes session info when provided", () => {
		const session = makeSession();
		const body = formatGitHubIssueBody(makeAnnotation(), session);
		expect(body).toContain("**Session:** Login Screen Review");
	});

	it("includes element section when present", () => {
		const annotation = makeAnnotation({
			element: {
				id: "el-1",
				platform: "react-native",
				componentPath: "App/Login/SubmitButton",
				componentName: "SubmitButton",
				componentFile: "src/Login.tsx",
				textContent: "Submit",
				boundingBox: { x: 0, y: 0, width: 100, height: 40 },
				accessibility: { label: "Submit button", role: "button" },
			},
		});
		const body = formatGitHubIssueBody(annotation);
		expect(body).toContain("## Element");
		expect(body).toContain("**Component:** SubmitButton");
		expect(body).toContain("**Path:** App/Login/SubmitButton");
		expect(body).toContain("**File:** src/Login.tsx");
		expect(body).toContain("**Text:** Submit");
		expect(body).toContain("**Accessibility label:** Submit button");
		expect(body).toContain("**Accessibility role:** button");
	});

	it("includes thread when present", () => {
		const annotation = makeAnnotation({
			thread: [{ role: "human", content: "Needs fixing", timestamp: "2025-01-01T01:00:00.000Z" }],
		});
		const body = formatGitHubIssueBody(annotation);
		expect(body).toContain("## Thread");
		expect(body).toContain("Needs fixing");
	});

	it("includes footer with generation timestamp", () => {
		const body = formatGitHubIssueBody(makeAnnotation());
		expect(body).toContain("Generated by agentation-mobile");
	});
});
