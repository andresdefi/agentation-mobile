import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Source map resolution for production builds.
 *
 * React Native: Metro generates source maps alongside the bundle.
 * Flutter: Debug symbols contain source mapping data.
 *
 * This module provides utilities to resolve minified/compiled
 * source locations back to their original file:line positions.
 */

interface SourceMapping {
	generatedLine: number;
	generatedColumn: number;
	originalFile: string;
	originalLine: number;
	originalColumn: number;
	name?: string;
}

interface SourceMap {
	version: number;
	sources: string[];
	sourcesContent?: (string | null)[];
	mappings: string;
	names: string[];
	file?: string;
	sourceRoot?: string;
}

/**
 * VLQ (Variable Length Quantity) decoder for source map mappings.
 */
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
const VLQ_BASE_MASK = VLQ_BASE - 1;
const VLQ_CONTINUATION_BIT = VLQ_BASE;

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_MAP = new Map<string, number>();
for (let i = 0; i < BASE64_CHARS.length; i++) {
	BASE64_MAP.set(BASE64_CHARS[i], i);
}

function decodeVLQ(encoded: string, startIndex: number): { value: number; index: number } {
	let result = 0;
	let shift = 0;
	let continuation: boolean;
	let index = startIndex;

	do {
		const char = encoded[index++];
		const digit = BASE64_MAP.get(char);
		if (digit === undefined) throw new Error(`Invalid base64 char: ${char}`);

		continuation = (digit & VLQ_CONTINUATION_BIT) !== 0;
		result += (digit & VLQ_BASE_MASK) << shift;
		shift += VLQ_BASE_SHIFT;
	} while (continuation);

	// Sign is stored in the least significant bit
	const isNegative = (result & 1) !== 0;
	result >>= 1;

	return { value: isNegative ? -result : result, index };
}

/**
 * Parse a source map's "mappings" string into a list of SourceMapping objects.
 * Only parses enough to build a lookup — stops after the target region.
 */
function parseMappings(sourceMap: SourceMap): SourceMapping[] {
	const { mappings, sources, sourceRoot } = sourceMap;
	const result: SourceMapping[] = [];

	let generatedLine = 0;
	let originalLine = 0;
	let originalColumn = 0;
	let sourceIndex = 0;
	let nameIndex = 0;

	const segments = mappings.split(";");

	for (const lineSegments of segments) {
		generatedLine++;
		let generatedColumn = 0;

		if (!lineSegments) continue;

		const fields = lineSegments.split(",");

		for (const field of fields) {
			if (!field) continue;

			let idx = 0;

			// 1. Generated column (always present)
			const gc = decodeVLQ(field, idx);
			generatedColumn += gc.value;
			idx = gc.index;

			// If only 1 field, it's a generated column with no original mapping
			if (idx >= field.length) continue;

			// 2. Source file index
			const si = decodeVLQ(field, idx);
			sourceIndex += si.value;
			idx = si.index;

			// 3. Original line
			const ol = decodeVLQ(field, idx);
			originalLine += ol.value;
			idx = ol.index;

			// 4. Original column
			const oc = decodeVLQ(field, idx);
			originalColumn += oc.value;
			idx = oc.index;

			// 5. Name index (optional)
			let name: string | undefined;
			if (idx < field.length) {
				const ni = decodeVLQ(field, idx);
				nameIndex += ni.value;
				name = sourceMap.names[nameIndex];
			}

			const originalFile = sourceRoot
				? `${sourceRoot}/${sources[sourceIndex]}`
				: sources[sourceIndex];

			result.push({
				generatedLine,
				generatedColumn,
				originalFile,
				originalLine: originalLine + 1, // Source map lines are 0-based, we use 1-based
				originalColumn,
				name,
			});
		}
	}

	return result;
}

/**
 * Resolve a generated source location to its original location.
 * Uses binary search on the parsed mappings for efficiency.
 */
function resolveLocation(
	mappings: SourceMapping[],
	generatedLine: number,
	generatedColumn: number,
): { file: string; line: number; column?: number; name?: string } | undefined {
	// Find the best matching mapping: same generated line, closest column <=
	let bestMatch: SourceMapping | undefined;

	for (const m of mappings) {
		if (m.generatedLine === generatedLine) {
			if (m.generatedColumn <= generatedColumn) {
				if (!bestMatch || m.generatedColumn > bestMatch.generatedColumn) {
					bestMatch = m;
				}
			}
		}
	}

	if (bestMatch) {
		return {
			file: bestMatch.originalFile,
			line: bestMatch.originalLine,
			column: bestMatch.originalColumn,
			name: bestMatch.name,
		};
	}

	return undefined;
}

/**
 * SourceMapResolver: loads and caches source maps for resolving locations.
 */
export class SourceMapResolver {
	private cache = new Map<string, { mappings: SourceMapping[]; sourceMap: SourceMap }>();

	/**
	 * Load a source map from a file path.
	 * Caches the parsed result for subsequent lookups.
	 */
	async loadSourceMap(sourceMapPath: string): Promise<boolean> {
		if (this.cache.has(sourceMapPath)) return true;

		try {
			await access(sourceMapPath);
			const content = await readFile(sourceMapPath, "utf-8");
			const sourceMap = JSON.parse(content) as SourceMap;
			const mappings = parseMappings(sourceMap);
			this.cache.set(sourceMapPath, { mappings, sourceMap });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Resolve a generated location to its original source.
	 */
	resolve(
		sourceMapPath: string,
		generatedLine: number,
		generatedColumn = 0,
	): { file: string; line: number; column?: number; name?: string } | undefined {
		const cached = this.cache.get(sourceMapPath);
		if (!cached) return undefined;

		return resolveLocation(cached.mappings, generatedLine, generatedColumn);
	}

	/**
	 * Try to find a React Native Metro source map.
	 * Common locations:
	 *   - android/app/build/generated/sourcemaps/react/debug/index.android.bundle.map
	 *   - ios/build/index.ios.bundle.map
	 *   - Metro: http://localhost:8081/index.map
	 */
	static async findReactNativeSourceMap(projectRoot: string): Promise<string | null> {
		const candidates = [
			join(
				projectRoot,
				"android/app/build/generated/sourcemaps/react/debug/index.android.bundle.map",
			),
			join(
				projectRoot,
				"android/app/build/generated/sourcemaps/react/release/index.android.bundle.map",
			),
			join(projectRoot, "ios/build/index.ios.bundle.map"),
			join(
				projectRoot,
				"ios/build/generated/sourcemaps/react/Debug-iphonesimulator/index.ios.bundle.map",
			),
		];

		for (const candidate of candidates) {
			try {
				await access(candidate);
				return candidate;
			} catch {
				// try next candidate
			}
		}

		return null;
	}

	/**
	 * Try to fetch a source map from Metro bundler (dev mode).
	 */
	static async fetchMetroSourceMap(
		platform: "android" | "ios" = "android",
	): Promise<string | null> {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 5000);
			const url = `http://localhost:8081/index.bundle.map?platform=${platform}&dev=true`;
			const res = await fetch(url, { signal: controller.signal });
			clearTimeout(timer);

			if (!res.ok) return null;
			return await res.text();
		} catch {
			return null;
		}
	}

	/**
	 * Clear the cache.
	 */
	clear(): void {
		this.cache.clear();
	}
}

export type { SourceMapping, SourceMap };
