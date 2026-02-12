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

export const MobileElementSchema = z.object({
	id: z.string(),
	platform: PlatformSchema,
	componentPath: z.string(),
	componentName: z.string(),
	componentFile: z.string().optional(),
	boundingBox: BoundingBoxSchema,
	styleProps: z.record(z.unknown()).optional(),
	accessibility: AccessibilitySchema.optional(),
	textContent: z.string().optional(),
	nearbyText: z.string().optional(),
});

export type MobileElement = z.infer<typeof MobileElementSchema>;
