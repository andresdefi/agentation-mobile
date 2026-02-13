import { randomUUID } from "node:crypto";
import type { AnnotationStatus } from "./schemas/enums";
import type { MobileAnnotation } from "./schemas/mobile-annotation";
import type { Recording, RecordingFrame } from "./schemas/recording";
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

/** Default maximum number of screenshots to retain in memory. */
const DEFAULT_MAX_SCREENSHOTS = 100;

/** Default TTL for screenshots in milliseconds (30 minutes). */
const DEFAULT_SCREENSHOT_TTL_MS = 30 * 60 * 1000;

export interface ScreenshotStoreOptions {
	maxScreenshots?: number;
	screenshotTtlMs?: number;
}

interface StoredScreenshot {
	data: Buffer;
	storedAt: number;
}

export class Store {
	private sessions = new Map<string, Session>();
	private annotations = new Map<string, MobileAnnotation>();
	private screenshots = new Map<string, StoredScreenshot>();
	private recordings = new Map<string, Recording>();
	private recordingFrames = new Map<string, RecordingFrame[]>();
	private recordingScreenshotIds = new Set<string>();
	private readonly maxScreenshots: number;
	private readonly screenshotTtlMs: number;

	constructor(options?: ScreenshotStoreOptions) {
		this.maxScreenshots = options?.maxScreenshots ?? DEFAULT_MAX_SCREENSHOTS;
		this.screenshotTtlMs = options?.screenshotTtlMs ?? DEFAULT_SCREENSHOT_TTL_MS;
	}

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
		this.evictExpiredScreenshots();

		// If at capacity, evict the oldest entry
		if (this.screenshots.size >= this.maxScreenshots) {
			const oldestKey =
				this.findOldestUnreferencedScreenshot() ?? this.screenshots.keys().next().value;
			if (oldestKey) {
				this.screenshots.delete(oldestKey);
			}
		}

		this.screenshots.set(id, { data, storedAt: Date.now() });
	}

	getScreenshot(id: string): Buffer | undefined {
		const entry = this.screenshots.get(id);
		if (!entry) return undefined;

		// Check TTL
		if (Date.now() - entry.storedAt > this.screenshotTtlMs) {
			this.screenshots.delete(id);
			return undefined;
		}

		return entry.data;
	}

	get screenshotCount(): number {
		return this.screenshots.size;
	}

	// -----------------------------------------------------------------------
	// Recording methods
	// -----------------------------------------------------------------------

	createRecording(deviceId: string, fps: number, sessionId?: string): Recording {
		const recording: Recording = {
			id: randomUUID(),
			sessionId,
			deviceId,
			status: "recording",
			fps,
			startedAt: new Date().toISOString(),
			frameCount: 0,
			durationMs: 0,
		};
		this.recordings.set(recording.id, recording);
		this.recordingFrames.set(recording.id, []);
		return recording;
	}

	stopRecording(id: string): Recording | undefined {
		const recording = this.recordings.get(id);
		if (!recording || recording.status === "stopped") return recording;
		recording.status = "stopped";
		recording.stoppedAt = new Date().toISOString();
		const frames = this.recordingFrames.get(id) ?? [];
		recording.frameCount = frames.length;
		if (frames.length > 0) {
			recording.durationMs = frames[frames.length - 1].timestamp;
		}
		return recording;
	}

	addRecordingFrame(recordingId: string, screenshotId: string, timestamp: number): void {
		const frames = this.recordingFrames.get(recordingId);
		if (!frames) return;
		const frame: RecordingFrame = {
			id: randomUUID(),
			recordingId,
			timestamp,
			screenshotId,
		};
		frames.push(frame);
		// Mark this screenshot as referenced by a recording (exempt from LRU eviction)
		this.recordingScreenshotIds.add(screenshotId);
		// Update frame count on recording
		const recording = this.recordings.get(recordingId);
		if (recording) {
			recording.frameCount = frames.length;
			recording.durationMs = timestamp;
		}
	}

	getRecording(id: string): Recording | undefined {
		return this.recordings.get(id);
	}

	listRecordings(): Recording[] {
		return [...this.recordings.values()];
	}

	getRecordingFrames(recordingId: string): RecordingFrame[] {
		return this.recordingFrames.get(recordingId) ?? [];
	}

	getFrameAtTimestamp(recordingId: string, timestampMs: number): RecordingFrame | undefined {
		const frames = this.recordingFrames.get(recordingId);
		if (!frames || frames.length === 0) return undefined;
		// Find closest frame at or before the requested timestamp
		let best: RecordingFrame | undefined;
		for (const frame of frames) {
			if (frame.timestamp <= timestampMs) {
				best = frame;
			} else {
				break;
			}
		}
		return best ?? frames[0];
	}

	private evictExpiredScreenshots(): void {
		const now = Date.now();
		for (const [id, entry] of this.screenshots) {
			if (now - entry.storedAt > this.screenshotTtlMs) {
				this.screenshots.delete(id);
			}
		}
	}

	private findOldestUnreferencedScreenshot(): string | undefined {
		const referencedIds = new Set<string>(this.recordingScreenshotIds);
		for (const annotation of this.annotations.values()) {
			if (annotation.screenshotId) referencedIds.add(annotation.screenshotId);
			if (annotation.resolvedScreenshotId) referencedIds.add(annotation.resolvedScreenshotId);
		}

		let oldestKey: string | undefined;
		let oldestTime = Number.POSITIVE_INFINITY;

		for (const [id, entry] of this.screenshots) {
			if (!referencedIds.has(id) && entry.storedAt < oldestTime) {
				oldestTime = entry.storedAt;
				oldestKey = id;
			}
		}

		return oldestKey;
	}
}
