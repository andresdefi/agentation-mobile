import { zodToJsonSchema } from "zod-to-json-schema";
import { MobileAnnotationSchema } from "./schemas/mobile-annotation";
import { MobileElementSchema } from "./schemas/mobile-element";
import { SessionSchema } from "./schemas/session";

export function generateAnnotationJsonSchema() {
	return zodToJsonSchema(MobileAnnotationSchema, {
		name: "MobileAnnotation",
		$refStrategy: "none",
	});
}

export function generateElementJsonSchema() {
	return zodToJsonSchema(MobileElementSchema, {
		name: "MobileElement",
		$refStrategy: "none",
	});
}

export function generateSessionJsonSchema() {
	return zodToJsonSchema(SessionSchema, {
		name: "Session",
		$refStrategy: "none",
	});
}
