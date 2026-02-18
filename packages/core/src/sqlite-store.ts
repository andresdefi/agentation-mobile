import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { AnnotationStatus, SessionStatus } from "./schemas/enums";
import type { MobileAnnotation } from "./schemas/mobile-annotation";
import type { Recording, RecordingFrame } from "./schemas/recording";
import type { Session } from "./schemas/session";
import type { CreateAnnotationInput, CreateSessionInput, ThreadMessage } from "./store";
import type { IStore } from "./store-interface";

/** Default maximum number of screenshots to retain in memory. */
const DEFAULT_MAX_SCREENSHOTS = 100;

/** Default TTL for screenshots in milliseconds (30 minutes). */
const DEFAULT_SCREENSHOT_TTL_MS = 30 * 60 * 1000;

interface StoredScreenshot {
	data: Buffer;
	storedAt: number;
}

export interface SqliteStoreOptions {
	dbPath: string;
	maxScreenshots?: number;
	screenshotTtlMs?: number;
}

export class SqliteStore implements IStore {
	private readonly db: Database.Database;
	private readonly screenshots = new Map<string, StoredScreenshot>();
	private readonly recordingScreenshotIds = new Set<string>();
	private readonly maxScreenshots: number;
	private readonly screenshotTtlMs: number;

	// Prepared statements
	private readonly stmts: {
		insertSession: Database.Statement;
		insertSessionDevice: Database.Statement;
		getSession: Database.Statement;
		listSessions: Database.Statement;
		getSessionDevices: Database.Statement;
		updateSessionUpdatedAt: Database.Statement;
		updateSessionStatus: Database.Statement;
		deleteSessionDevice: Database.Statement;
		insertAnnotation: Database.Statement;
		getAnnotation: Database.Statement;
		getSessionAnnotations: Database.Statement;
		getSessionAnnotationsByDevice: Database.Statement;
		getPendingAnnotations: Database.Statement;
		getAllPendingAnnotations: Database.Statement;
		updateAnnotationStatus: Database.Statement;
		updateAnnotationThread: Database.Statement;
		updateAnnotationResolvedScreenshot: Database.Statement;
		deleteAnnotation: Database.Statement;
		insertRecording: Database.Statement;
		getRecording: Database.Statement;
		listRecordings: Database.Statement;
		updateRecordingStop: Database.Statement;
		insertRecordingFrame: Database.Statement;
		getRecordingFrames: Database.Statement;
		updateRecordingCounts: Database.Statement;
	};

	constructor(options: SqliteStoreOptions) {
		this.maxScreenshots = options.maxScreenshots ?? DEFAULT_MAX_SCREENSHOTS;
		this.screenshotTtlMs = options.screenshotTtlMs ?? DEFAULT_SCREENSHOT_TTL_MS;

		this.db = new Database(options.dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");

		this.createTables();
		this.stmts = this.prepareStatements();
	}

	private createTables(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				device_id TEXT NOT NULL,
				platform TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS session_devices (
				session_id TEXT NOT NULL,
				device_id TEXT NOT NULL,
				platform TEXT NOT NULL,
				added_at TEXT NOT NULL,
				PRIMARY KEY (session_id, device_id),
				FOREIGN KEY (session_id) REFERENCES sessions(id)
			);

			CREATE TABLE IF NOT EXISTS annotations (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				x REAL NOT NULL,
				y REAL NOT NULL,
				device_id TEXT NOT NULL,
				platform TEXT NOT NULL,
				screen_width INTEGER NOT NULL,
				screen_height INTEGER NOT NULL,
				screen_id TEXT,
				screenshot_id TEXT,
				resolved_screenshot_id TEXT,
				comment TEXT NOT NULL,
				intent TEXT NOT NULL,
				severity TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				element_json TEXT,
				selected_area_json TEXT,
				selected_text TEXT,
				thread_json TEXT NOT NULL DEFAULT '[]',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY (session_id) REFERENCES sessions(id)
			);

			CREATE TABLE IF NOT EXISTS recordings (
				id TEXT PRIMARY KEY,
				session_id TEXT,
				device_id TEXT NOT NULL,
				status TEXT NOT NULL,
				fps INTEGER NOT NULL,
				started_at TEXT NOT NULL,
				stopped_at TEXT,
				frame_count INTEGER NOT NULL DEFAULT 0,
				duration_ms INTEGER NOT NULL DEFAULT 0
			);

			CREATE TABLE IF NOT EXISTS recording_frames (
				id TEXT PRIMARY KEY,
				recording_id TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				screenshot_id TEXT NOT NULL,
				FOREIGN KEY (recording_id) REFERENCES recordings(id)
			);

			CREATE TABLE IF NOT EXISTS events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				type TEXT NOT NULL,
				timestamp TEXT NOT NULL,
				session_id TEXT,
				device_id TEXT,
				sequence INTEGER UNIQUE,
				payload_json TEXT
			);
		`);
	}

	private prepareStatements() {
		return {
			insertSession: this.db.prepare(
				"INSERT INTO sessions (id, name, device_id, platform, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			),
			insertSessionDevice: this.db.prepare(
				"INSERT OR IGNORE INTO session_devices (session_id, device_id, platform, added_at) VALUES (?, ?, ?, ?)",
			),
			getSession: this.db.prepare("SELECT * FROM sessions WHERE id = ?"),
			listSessions: this.db.prepare("SELECT * FROM sessions ORDER BY created_at DESC"),
			getSessionDevices: this.db.prepare("SELECT * FROM session_devices WHERE session_id = ?"),
			updateSessionUpdatedAt: this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?"),
			updateSessionStatus: this.db.prepare(
				"UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?",
			),
			deleteSessionDevice: this.db.prepare(
				"DELETE FROM session_devices WHERE session_id = ? AND device_id = ?",
			),
			insertAnnotation: this.db.prepare(
				`INSERT INTO annotations (id, session_id, x, y, device_id, platform, screen_width, screen_height, screen_id,
				screenshot_id, comment, intent, severity, status, element_json, selected_area_json, selected_text, thread_json,
				created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			),
			getAnnotation: this.db.prepare("SELECT * FROM annotations WHERE id = ?"),
			getSessionAnnotations: this.db.prepare(
				"SELECT * FROM annotations WHERE session_id = ? ORDER BY created_at",
			),
			getSessionAnnotationsByDevice: this.db.prepare(
				"SELECT * FROM annotations WHERE session_id = ? AND device_id = ? ORDER BY created_at",
			),
			getPendingAnnotations: this.db.prepare(
				"SELECT * FROM annotations WHERE session_id = ? AND status = 'pending' ORDER BY created_at",
			),
			getAllPendingAnnotations: this.db.prepare(
				"SELECT * FROM annotations WHERE status = 'pending' ORDER BY created_at",
			),
			updateAnnotationStatus: this.db.prepare(
				"UPDATE annotations SET status = ?, updated_at = ? WHERE id = ?",
			),
			updateAnnotationThread: this.db.prepare(
				"UPDATE annotations SET thread_json = ?, updated_at = ? WHERE id = ?",
			),
			updateAnnotationResolvedScreenshot: this.db.prepare(
				"UPDATE annotations SET resolved_screenshot_id = ?, updated_at = ? WHERE id = ?",
			),
			deleteAnnotation: this.db.prepare("DELETE FROM annotations WHERE id = ?"),
			insertRecording: this.db.prepare(
				"INSERT INTO recordings (id, session_id, device_id, status, fps, started_at, frame_count, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			),
			getRecording: this.db.prepare("SELECT * FROM recordings WHERE id = ?"),
			listRecordings: this.db.prepare("SELECT * FROM recordings ORDER BY started_at DESC"),
			updateRecordingStop: this.db.prepare(
				"UPDATE recordings SET status = ?, stopped_at = ?, frame_count = ?, duration_ms = ? WHERE id = ?",
			),
			insertRecordingFrame: this.db.prepare(
				"INSERT INTO recording_frames (id, recording_id, timestamp, screenshot_id) VALUES (?, ?, ?, ?)",
			),
			getRecordingFrames: this.db.prepare(
				"SELECT * FROM recording_frames WHERE recording_id = ? ORDER BY timestamp",
			),
			updateRecordingCounts: this.db.prepare(
				"UPDATE recordings SET frame_count = ?, duration_ms = ? WHERE id = ?",
			),
		};
	}

	// --- Sessions ---

	private rowToSession(row: Record<string, unknown>): Session {
		const devices = this.stmts.getSessionDevices.all(row.id as string) as Array<{
			device_id: string;
			platform: string;
			added_at: string;
		}>;
		return {
			id: row.id as string,
			name: row.name as string,
			deviceId: row.device_id as string,
			platform: row.platform as string,
			status: row.status as SessionStatus,
			devices: devices.map((d) => ({
				deviceId: d.device_id,
				platform: d.platform,
				addedAt: d.added_at,
			})),
			createdAt: row.created_at as string,
			updatedAt: row.updated_at as string,
		};
	}

	createSession(input: CreateSessionInput): Session {
		const now = new Date().toISOString();
		const id = randomUUID();
		this.stmts.insertSession.run(
			id,
			input.name,
			input.deviceId,
			input.platform,
			"active",
			now,
			now,
		);
		this.stmts.insertSessionDevice.run(id, input.deviceId, input.platform, now);
		// biome-ignore lint/style/noNonNullAssertion: row was just inserted
		return this.getSession(id)!;
	}

	getSession(id: string): Session | undefined {
		const row = this.stmts.getSession.get(id) as Record<string, unknown> | undefined;
		if (!row) return undefined;
		return this.rowToSession(row);
	}

	listSessions(): Session[] {
		const rows = this.stmts.listSessions.all() as Record<string, unknown>[];
		return rows.map((r) => this.rowToSession(r));
	}

	addDeviceToSession(sessionId: string, deviceId: string, platform: string): Session | undefined {
		const session = this.getSession(sessionId);
		if (!session) return undefined;
		if (session.devices.some((d) => d.deviceId === deviceId)) return session;
		const now = new Date().toISOString();
		this.stmts.insertSessionDevice.run(sessionId, deviceId, platform, now);
		this.stmts.updateSessionUpdatedAt.run(now, sessionId);
		return this.getSession(sessionId);
	}

	removeDeviceFromSession(sessionId: string, deviceId: string): Session | undefined {
		const session = this.getSession(sessionId);
		if (!session) return undefined;
		this.stmts.deleteSessionDevice.run(sessionId, deviceId);
		const now = new Date().toISOString();
		this.stmts.updateSessionUpdatedAt.run(now, sessionId);
		return this.getSession(sessionId);
	}

	updateSessionStatus(id: string, status: SessionStatus): Session | undefined {
		const session = this.getSession(id);
		if (!session) return undefined;
		const now = new Date().toISOString();
		this.stmts.updateSessionStatus.run(status, now, id);
		return this.getSession(id);
	}

	// --- Annotations ---

	private rowToAnnotation(row: Record<string, unknown>): MobileAnnotation {
		return {
			id: row.id as string,
			sessionId: row.session_id as string,
			x: row.x as number,
			y: row.y as number,
			deviceId: row.device_id as string,
			platform: row.platform as string,
			screenWidth: row.screen_width as number,
			screenHeight: row.screen_height as number,
			screenId: (row.screen_id as string) ?? null,
			screenshotId: row.screenshot_id as string | undefined,
			resolvedScreenshotId: row.resolved_screenshot_id as string | undefined,
			comment: row.comment as string,
			intent: row.intent as MobileAnnotation["intent"],
			severity: row.severity as MobileAnnotation["severity"],
			status: row.status as MobileAnnotation["status"],
			element: row.element_json ? JSON.parse(row.element_json as string) : undefined,
			selectedArea: row.selected_area_json
				? JSON.parse(row.selected_area_json as string)
				: undefined,
			selectedText: row.selected_text as string | undefined,
			thread: JSON.parse(row.thread_json as string),
			createdAt: row.created_at as string,
			updatedAt: row.updated_at as string,
		};
	}

	createAnnotation(input: CreateAnnotationInput): MobileAnnotation {
		const now = new Date().toISOString();
		const id = randomUUID();
		this.stmts.insertAnnotation.run(
			id,
			input.sessionId,
			input.x,
			input.y,
			input.deviceId,
			input.platform,
			input.screenWidth,
			input.screenHeight,
			input.screenId ?? null,
			input.screenshotId ?? null,
			input.comment,
			input.intent,
			input.severity,
			"pending",
			input.element ? JSON.stringify(input.element) : null,
			input.selectedArea ? JSON.stringify(input.selectedArea) : null,
			input.selectedText ?? null,
			"[]",
			now,
			now,
		);
		// biome-ignore lint/style/noNonNullAssertion: row was just inserted
		return this.getAnnotation(id)!;
	}

	getAnnotation(id: string): MobileAnnotation | undefined {
		const row = this.stmts.getAnnotation.get(id) as Record<string, unknown> | undefined;
		if (!row) return undefined;
		return this.rowToAnnotation(row);
	}

	getSessionAnnotations(sessionId: string): MobileAnnotation[] {
		const rows = this.stmts.getSessionAnnotations.all(sessionId) as Record<string, unknown>[];
		return rows.map((r) => this.rowToAnnotation(r));
	}

	getSessionAnnotationsByDevice(sessionId: string, deviceId: string): MobileAnnotation[] {
		const rows = this.stmts.getSessionAnnotationsByDevice.all(sessionId, deviceId) as Record<
			string,
			unknown
		>[];
		return rows.map((r) => this.rowToAnnotation(r));
	}

	getPendingAnnotations(sessionId: string): MobileAnnotation[] {
		const rows = this.stmts.getPendingAnnotations.all(sessionId) as Record<string, unknown>[];
		return rows.map((r) => this.rowToAnnotation(r));
	}

	getAllPendingAnnotations(): MobileAnnotation[] {
		const rows = this.stmts.getAllPendingAnnotations.all() as Record<string, unknown>[];
		return rows.map((r) => this.rowToAnnotation(r));
	}

	updateAnnotationStatus(id: string, status: AnnotationStatus): MobileAnnotation | undefined {
		const annotation = this.getAnnotation(id);
		if (!annotation) return undefined;
		const now = new Date().toISOString();
		this.stmts.updateAnnotationStatus.run(status, now, id);
		return this.getAnnotation(id);
	}

	deleteAnnotation(id: string): boolean {
		const result = this.stmts.deleteAnnotation.run(id);
		return result.changes > 0;
	}

	addThreadMessage(id: string, message: ThreadMessage): MobileAnnotation | undefined {
		const annotation = this.getAnnotation(id);
		if (!annotation) return undefined;
		const thread = [...annotation.thread, { ...message, id: message.id ?? randomUUID() }];
		const now = new Date().toISOString();
		this.stmts.updateAnnotationThread.run(JSON.stringify(thread), now, id);
		return this.getAnnotation(id);
	}

	attachResolutionScreenshot(
		annotationId: string,
		screenshotId: string,
	): MobileAnnotation | undefined {
		const annotation = this.getAnnotation(annotationId);
		if (!annotation) return undefined;
		const now = new Date().toISOString();
		this.stmts.updateAnnotationResolvedScreenshot.run(screenshotId, now, annotationId);
		return this.getAnnotation(annotationId);
	}

	// --- Screenshots (always in-memory) ---

	storeScreenshot(id: string, data: Buffer): void {
		this.evictExpiredScreenshots();
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
		if (Date.now() - entry.storedAt > this.screenshotTtlMs) {
			this.screenshots.delete(id);
			return undefined;
		}
		return entry.data;
	}

	get screenshotCount(): number {
		return this.screenshots.size;
	}

	// --- Recordings ---

	createRecording(deviceId: string, fps: number, sessionId?: string): Recording {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.stmts.insertRecording.run(id, sessionId ?? null, deviceId, "recording", fps, now, 0, 0);
		// biome-ignore lint/style/noNonNullAssertion: row was just inserted
		return this.getRecording(id)!;
	}

	stopRecording(id: string): Recording | undefined {
		const recording = this.getRecording(id);
		if (!recording || recording.status === "stopped") return recording;

		const frames = this.getRecordingFrames(id);
		const frameCount = frames.length;
		const durationMs = frames.length > 0 ? frames[frames.length - 1].timestamp : 0;
		const now = new Date().toISOString();

		this.stmts.updateRecordingStop.run("stopped", now, frameCount, durationMs, id);
		return this.getRecording(id);
	}

	addRecordingFrame(recordingId: string, screenshotId: string, timestamp: number): void {
		const recording = this.getRecording(recordingId);
		if (!recording) return;
		const id = randomUUID();
		this.stmts.insertRecordingFrame.run(id, recordingId, timestamp, screenshotId);
		this.recordingScreenshotIds.add(screenshotId);

		const frames = this.getRecordingFrames(recordingId);
		this.stmts.updateRecordingCounts.run(frames.length, timestamp, recordingId);
	}

	getRecording(id: string): Recording | undefined {
		const row = this.stmts.getRecording.get(id) as Record<string, unknown> | undefined;
		if (!row) return undefined;
		return this.rowToRecording(row);
	}

	listRecordings(): Recording[] {
		const rows = this.stmts.listRecordings.all() as Record<string, unknown>[];
		return rows.map((r) => this.rowToRecording(r));
	}

	getRecordingFrames(recordingId: string): RecordingFrame[] {
		const rows = this.stmts.getRecordingFrames.all(recordingId) as Record<string, unknown>[];
		return rows.map((r) => ({
			id: r.id as string,
			recordingId: r.recording_id as string,
			timestamp: r.timestamp as number,
			screenshotId: r.screenshot_id as string,
		}));
	}

	getFrameAtTimestamp(recordingId: string, timestampMs: number): RecordingFrame | undefined {
		const frames = this.getRecordingFrames(recordingId);
		if (frames.length === 0) return undefined;
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

	close(): void {
		this.db.close();
	}

	/** Get the current max sequence from the events table. */
	getMaxSequence(): number {
		const row = this.db.prepare("SELECT MAX(sequence) as max_seq FROM events").get() as {
			max_seq: number | null;
		};
		return row?.max_seq ?? 0;
	}

	// --- Private helpers ---

	private rowToRecording(row: Record<string, unknown>): Recording {
		return {
			id: row.id as string,
			sessionId: row.session_id as string | undefined,
			deviceId: row.device_id as string,
			status: row.status as Recording["status"],
			fps: row.fps as number,
			startedAt: row.started_at as string,
			stoppedAt: row.stopped_at as string | undefined,
			frameCount: row.frame_count as number,
			durationMs: row.duration_ms as number,
		};
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
		const screenshotRows = this.db
			.prepare(
				"SELECT screenshot_id, resolved_screenshot_id FROM annotations WHERE screenshot_id IS NOT NULL OR resolved_screenshot_id IS NOT NULL",
			)
			.all() as Array<{ screenshot_id: string | null; resolved_screenshot_id: string | null }>;

		for (const row of screenshotRows) {
			if (row.screenshot_id) referencedIds.add(row.screenshot_id);
			if (row.resolved_screenshot_id) referencedIds.add(row.resolved_screenshot_id);
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
