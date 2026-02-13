import { useCallback, useState } from "react";
import { apiFetch, getBaseUrl } from "../api";

interface Recording {
	id: string;
	sessionId?: string;
	deviceId: string;
	status: "recording" | "stopped";
	fps: number;
	startedAt: string;
	stoppedAt?: string;
	frameCount: number;
	durationMs: number;
}

interface RecordingFrame {
	id: string;
	recordingId: string;
	timestamp: number;
	screenshotId: string;
}

interface UseRecordingResult {
	recording: Recording | null;
	frames: RecordingFrame[];
	isRecording: boolean;
	elapsedMs: number;
	start: (deviceId: string, sessionId?: string, fps?: number) => Promise<void>;
	stop: () => Promise<void>;
	loadFrames: () => Promise<void>;
	getFrameUrl: (timestampMs: number) => string | null;
}

export function useRecording(): UseRecordingResult {
	const [recording, setRecording] = useState<Recording | null>(null);
	const [frames, setFrames] = useState<RecordingFrame[]>([]);
	const [elapsedMs, setElapsedMs] = useState(0);
	const [timerRef, setTimerRef] = useState<ReturnType<typeof setInterval> | null>(null);

	const start = useCallback(async (deviceId: string, sessionId?: string, fps = 10) => {
		const rec = await apiFetch<Recording>("/api/recordings/start", {
			method: "POST",
			body: JSON.stringify({ deviceId, sessionId, fps }),
		});
		setRecording(rec);
		setFrames([]);
		setElapsedMs(0);

		const startTime = Date.now();
		const timer = setInterval(() => {
			setElapsedMs(Date.now() - startTime);
		}, 100);
		setTimerRef(timer);
	}, []);

	const stop = useCallback(async () => {
		if (!recording) return;
		if (timerRef) {
			clearInterval(timerRef);
			setTimerRef(null);
		}
		const stopped = await apiFetch<Recording>(`/api/recordings/${recording.id}/stop`, {
			method: "POST",
		});
		setRecording(stopped);
		// Load frames after stopping
		const frameList = await apiFetch<RecordingFrame[]>(`/api/recordings/${stopped.id}/frames`);
		setFrames(frameList);
	}, [recording, timerRef]);

	const loadFrames = useCallback(async () => {
		if (!recording) return;
		const frameList = await apiFetch<RecordingFrame[]>(`/api/recordings/${recording.id}/frames`);
		setFrames(frameList);
	}, [recording]);

	const getFrameUrl = useCallback(
		(timestampMs: number): string | null => {
			if (!recording) return null;
			return `${getBaseUrl()}/api/recordings/${recording.id}/frame?t=${timestampMs}`;
		},
		[recording],
	);

	return {
		recording,
		frames,
		isRecording: recording?.status === "recording",
		elapsedMs,
		start,
		stop,
		loadFrames,
		getFrameUrl,
	};
}
