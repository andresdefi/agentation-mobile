import { z } from "zod";
import { PlatformSchema } from "./enums";

export const BoundingBoxSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});

export const AccessibilitySchema = z.object({
	label: z.string().optional(),
	role: z.string().optional(),
	hint: z.string().optional(),
	value: z.string().optional(),
	traits: z.array(z.string()).optional(),
});

export const SourceLocationSchema = z.object({
	file: z.string(),
	line: z.number(),
	column: z.number().optional(),
});

export const AnimationInfoSchema = z.object({
	type: z.enum(["timing", "spring", "decay", "transition", "keyframe", "unknown"]),
	property: z.string().describe("Animated property: opacity, transform, color, width, etc."),
	status: z.enum(["running", "paused", "completed"]).optional(),
	duration: z.number().optional().describe("Duration in milliseconds"),
	sourceLocation: SourceLocationSchema.optional(),
});

export const MobileElementSchema = z.object({
	id: z.string(),
	platform: PlatformSchema,
	componentPath: z.string(),
	componentName: z.string(),
	componentFile: z.string().optional(),
	sourceLocation: SourceLocationSchema.optional(),
	boundingBox: BoundingBoxSchema,
	styleProps: z.record(z.unknown()).optional(),
	accessibility: AccessibilitySchema.optional(),
	textContent: z.string().optional(),
	nearbyText: z.string().optional(),
	animations: z.array(AnimationInfoSchema).optional(),
});

export type AnimationInfo = z.infer<typeof AnimationInfoSchema>;
export type SourceLocation = z.infer<typeof SourceLocationSchema>;
export type MobileElement = z.infer<typeof MobileElementSchema>;
