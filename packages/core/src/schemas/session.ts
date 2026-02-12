import { z } from "zod";

export const SessionSchema = z.object({
	id: z.string(),
	name: z.string(),
	deviceId: z.string(),
	platform: z.string(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export type Session = z.infer<typeof SessionSchema>;
