import { z } from "zod";

export const SessionDeviceSchema = z.object({
	deviceId: z.string(),
	platform: z.string(),
	addedAt: z.string().datetime(),
});

export type SessionDevice = z.infer<typeof SessionDeviceSchema>;

export const SessionSchema = z.object({
	id: z.string(),
	name: z.string(),
	deviceId: z.string(),
	platform: z.string(),
	devices: z.array(SessionDeviceSchema).default([]),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export type Session = z.infer<typeof SessionSchema>;
