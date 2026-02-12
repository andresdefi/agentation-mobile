import { z } from "zod";
import {
	AnnotationIntentSchema,
	AnnotationSeveritySchema,
	AnnotationStatusSchema,
} from "./enums";
import { MobileElementSchema } from "./mobile-element";

export const ThreadMessageSchema = z.object({
	role: z.enum(["human", "agent"]),
	content: z.string(),
	timestamp: z.string().datetime(),
});

export const MobileAnnotationSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	x: z.number().min(0).max(100),
	y: z.number().min(0).max(100),
	deviceId: z.string(),
	platform: z.string(),
	screenWidth: z.number(),
	screenHeight: z.number(),
	screenshotId: z.string().optional(),
	comment: z.string(),
	intent: AnnotationIntentSchema,
	severity: AnnotationSeveritySchema,
	status: AnnotationStatusSchema.default("pending"),
	element: MobileElementSchema.optional(),
	thread: z.array(ThreadMessageSchema).default([]),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export type MobileAnnotation = z.infer<typeof MobileAnnotationSchema>;
