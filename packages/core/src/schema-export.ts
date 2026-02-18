import { zodToJsonSchema } from "zod-to-json-schema";
import { MobileAnnotationSchema } from "./schemas/mobile-annotation";
import { MobileElementSchema } from "./schemas/mobile-element";
import { SessionSchema } from "./schemas/session";

const SCHEMA_BASE_URL = "https://agentation-mobile.dev/schemas";

export function generateAnnotationJsonSchema() {
	const schema = zodToJsonSchema(MobileAnnotationSchema, {
		name: "MobileAnnotation",
		$refStrategy: "none",
	});
	return {
		...schema,
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: `${SCHEMA_BASE_URL}/annotation.v1.json`,
	};
}

export function generateElementJsonSchema() {
	const schema = zodToJsonSchema(MobileElementSchema, {
		name: "MobileElement",
		$refStrategy: "none",
	});
	return {
		...schema,
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: `${SCHEMA_BASE_URL}/element.v1.json`,
	};
}

export function generateSessionJsonSchema() {
	const schema = zodToJsonSchema(SessionSchema, {
		name: "Session",
		$refStrategy: "none",
	});
	return {
		...schema,
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: `${SCHEMA_BASE_URL}/session.v1.json`,
	};
}
