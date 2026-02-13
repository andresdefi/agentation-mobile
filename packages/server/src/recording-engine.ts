import crypto from "node:crypto";
import type { IPlatformBridge } from "@agentation-mobile/bridge-core";
import type { Recording, Store } from "@agentation-mobile/core";
import { findBridgeForDevice } from "./bridge-cache";

interface RecordingSession {
	recordingId: string;
	deviceId: string;
	interval: ReturnType<typeof setInterval>;
	startTime: number;
}

export class RecordingEngine {
	private activeSessions = new Map<string, RecordingSession>();

	constructor(
		private readonly store: Store,
		private readonly bridges: IPlatformBridge[],
	) {}

	async start(deviceId: string, fps = 10, sessionId?: string): Promise<Recording> {
		const recording = this.store.createRecording(deviceId, fps, sessionId);
		const startTime = Date.now();
		const intervalMs = Math.round(1000 / fps);

		let capturing = false;
		const interval = setInterval(async () => {
			if (capturing) return;
			capturing = true;
			try {
				const bridge = await findBridgeForDevice(this.bridges, deviceId);
				if (!bridge) return;
				const frame = await bridge.captureScreen(deviceId);
				const screenshotId = crypto.randomUUID();
				this.store.storeScreenshot(screenshotId, frame);
				const timestamp = Date.now() - startTime;
				this.store.addRecordingFrame(recording.id, screenshotId, timestamp);
			} catch {
				// Skip frame on error
			} finally {
				capturing = false;
			}
		}, intervalMs);

		this.activeSessions.set(recording.id, {
			recordingId: recording.id,
			deviceId,
			interval,
			startTime,
		});

		return recording;
	}

	stop(recordingId: string): Recording | undefined {
		const session = this.activeSessions.get(recordingId);
		if (session) {
			clearInterval(session.interval);
			this.activeSessions.delete(recordingId);
		}
		return this.store.stopRecording(recordingId);
	}

	isRecording(recordingId: string): boolean {
		return this.activeSessions.has(recordingId);
	}

	stopAll(): void {
		for (const [id] of this.activeSessions) {
			this.stop(id);
		}
	}
}
