import { z } from "zod";

export const RecordingStatusSchema = z.enum(["recording", "stopped"]);

export const RecordingSchema = z.object({
	id: z.string(),
	sessionId: z.string().optional(),
	deviceId: z.string(),
	status: RecordingStatusSchema,
	fps: z.number(),
	startedAt: z.string(),
	stoppedAt: z.string().optional(),
	frameCount: z.number(),
	durationMs: z.number(),
});

export const RecordingFrameSchema = z.object({
	id: z.string(),
	recordingId: z.string(),
	timestamp: z.number(),
	screenshotId: z.string(),
});

export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;
export type Recording = z.infer<typeof RecordingSchema>;
export type RecordingFrame = z.infer<typeof RecordingFrameSchema>;
