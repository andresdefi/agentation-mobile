import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	generateAnnotationJsonSchema,
	generateElementJsonSchema,
	generateSessionJsonSchema,
} from "./schema-export";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(__dirname, "..", "..", "..", "schema");

if (!existsSync(schemaDir)) {
	mkdirSync(schemaDir, { recursive: true });
}

const schemas = [
	{ name: "annotation.v1.json", generator: generateAnnotationJsonSchema },
	{ name: "element.v1.json", generator: generateElementJsonSchema },
	{ name: "session.v1.json", generator: generateSessionJsonSchema },
];

for (const { name, generator } of schemas) {
	const schema = generator();
	const path = join(schemaDir, name);
	writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
	console.log(`Generated ${path}`);
}

console.log("Schema generation complete.");
