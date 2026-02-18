import type { AnnotationStatus, SessionStatus } from "./schemas/enums";
import type { MobileAnnotation } from "./schemas/mobile-annotation";
import type { Recording, RecordingFrame } from "./schemas/recording";
import type { Session } from "./schemas/session";
import type { CreateAnnotationInput, CreateSessionInput, ThreadMessage } from "./store";

export interface IStore {
	// Sessions
	createSession(input: CreateSessionInput): Session;
	getSession(id: string): Session | undefined;
	listSessions(): Session[];
	addDeviceToSession(sessionId: string, deviceId: string, platform: string): Session | undefined;
	removeDeviceFromSession(sessionId: string, deviceId: string): Session | undefined;
	updateSessionStatus(id: string, status: SessionStatus): Session | undefined;

	// Annotations
	createAnnotation(input: CreateAnnotationInput): MobileAnnotation;
	getAnnotation(id: string): MobileAnnotation | undefined;
	getSessionAnnotations(sessionId: string): MobileAnnotation[];
	getSessionAnnotationsByDevice(sessionId: string, deviceId: string): MobileAnnotation[];
	getPendingAnnotations(sessionId: string): MobileAnnotation[];
	getAllPendingAnnotations(): MobileAnnotation[];
	updateAnnotationStatus(id: string, status: AnnotationStatus): MobileAnnotation | undefined;
	deleteAnnotation(id: string): boolean;
	addThreadMessage(id: string, message: ThreadMessage): MobileAnnotation | undefined;
	attachResolutionScreenshot(
		annotationId: string,
		screenshotId: string,
	): MobileAnnotation | undefined;

	// Screenshots (always in-memory)
	storeScreenshot(id: string, data: Buffer): void;
	getScreenshot(id: string): Buffer | undefined;
	get screenshotCount(): number;

	// Recordings
	createRecording(deviceId: string, fps: number, sessionId?: string): Recording;
	stopRecording(id: string): Recording | undefined;
	addRecordingFrame(recordingId: string, screenshotId: string, timestamp: number): void;
	getRecording(id: string): Recording | undefined;
	listRecordings(): Recording[];
	getRecordingFrames(recordingId: string): RecordingFrame[];
	getFrameAtTimestamp(recordingId: string, timestampMs: number): RecordingFrame | undefined;

	/** Close the store and release resources. */
	close(): void;
}
