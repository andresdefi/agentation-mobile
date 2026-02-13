import { randomUUID } from "node:crypto";
import type { AnnotationStatus } from "./schemas/enums";
import type { MobileAnnotation } from "./schemas/mobile-annotation";
import type { Session } from "./schemas/session";

export interface CreateSessionInput {
	name: string;
	deviceId: string;
	platform: string;
}

export interface CreateAnnotationInput {
	sessionId: string;
	x: number;
	y: number;
	deviceId: string;
	platform: string;
	screenWidth: number;
	screenHeight: number;
	screenshotId?: string;
	comment: string;
	intent: MobileAnnotation["intent"];
	severity: MobileAnnotation["severity"];
	element?: MobileAnnotation["element"];
	selectedArea?: MobileAnnotation["selectedArea"];
	selectedText?: string;
}

export interface ThreadMessage {
	role: "human" | "agent";
	content: string;
	timestamp: string;
}

export class Store {
	private sessions = new Map<string, Session>();
	private annotations = new Map<string, MobileAnnotation>();
	private screenshots = new Map<string, Buffer>();

	createSession(input: CreateSessionInput): Session {
		const now = new Date().toISOString();
		const session: Session = {
			id: randomUUID(),
			name: input.name,
			deviceId: input.deviceId,
			platform: input.platform,
			devices: [{ deviceId: input.deviceId, platform: input.platform, addedAt: now }],
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.set(session.id, session);
		return session;
	}

	addDeviceToSession(sessionId: string, deviceId: string, platform: string): Session | undefined {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;
		if (session.devices.some((d) => d.deviceId === deviceId)) return session;
		session.devices.push({
			deviceId,
			platform,
			addedAt: new Date().toISOString(),
		});
		session.updatedAt = new Date().toISOString();
		return session;
	}

	removeDeviceFromSession(sessionId: string, deviceId: string): Session | undefined {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;
		session.devices = session.devices.filter((d) => d.deviceId !== deviceId);
		session.updatedAt = new Date().toISOString();
		return session;
	}

	getSessionAnnotationsByDevice(sessionId: string, deviceId: string): MobileAnnotation[] {
		return this.getSessionAnnotations(sessionId).filter((a) => a.deviceId === deviceId);
	}

	getSession(id: string): Session | undefined {
		return this.sessions.get(id);
	}

	listSessions(): Session[] {
		return [...this.sessions.values()];
	}

	createAnnotation(input: CreateAnnotationInput): MobileAnnotation {
		const now = new Date().toISOString();
		const annotation: MobileAnnotation = {
			id: randomUUID(),
			sessionId: input.sessionId,
			x: input.x,
			y: input.y,
			deviceId: input.deviceId,
			platform: input.platform,
			screenWidth: input.screenWidth,
			screenHeight: input.screenHeight,
			screenshotId: input.screenshotId,
			comment: input.comment,
			intent: input.intent,
			severity: input.severity,
			status: "pending",
			element: input.element,
			selectedArea: input.selectedArea,
			selectedText: input.selectedText,
			thread: [],
			createdAt: now,
			updatedAt: now,
		};
		this.annotations.set(annotation.id, annotation);
		return annotation;
	}

	getAnnotation(id: string): MobileAnnotation | undefined {
		return this.annotations.get(id);
	}

	getSessionAnnotations(sessionId: string): MobileAnnotation[] {
		return [...this.annotations.values()].filter((a) => a.sessionId === sessionId);
	}

	getPendingAnnotations(sessionId: string): MobileAnnotation[] {
		return this.getSessionAnnotations(sessionId).filter((a) => a.status === "pending");
	}

	getAllPendingAnnotations(): MobileAnnotation[] {
		return [...this.annotations.values()].filter((a) => a.status === "pending");
	}

	updateAnnotationStatus(id: string, status: AnnotationStatus): MobileAnnotation | undefined {
		const annotation = this.annotations.get(id);
		if (!annotation) return undefined;
		annotation.status = status;
		annotation.updatedAt = new Date().toISOString();
		return annotation;
	}

	addThreadMessage(id: string, message: ThreadMessage): MobileAnnotation | undefined {
		const annotation = this.annotations.get(id);
		if (!annotation) return undefined;
		annotation.thread.push(message);
		annotation.updatedAt = new Date().toISOString();
		return annotation;
	}

	attachResolutionScreenshot(
		annotationId: string,
		screenshotId: string,
	): MobileAnnotation | undefined {
		const annotation = this.annotations.get(annotationId);
		if (!annotation) return undefined;
		annotation.resolvedScreenshotId = screenshotId;
		annotation.updatedAt = new Date().toISOString();
		return annotation;
	}

	storeScreenshot(id: string, data: Buffer): void {
		this.screenshots.set(id, data);
	}

	getScreenshot(id: string): Buffer | undefined {
		return this.screenshots.get(id);
	}
}
