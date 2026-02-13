/**
 * Shared Android device utilities for bridge implementations.
 */

/**
 * Parse `adb shell wm size` output to extract screen dimensions.
 * Handles both single-line and multi-line output (prefers the last
 * matching line, which is typically the override/actual size).
 */
export function parseWmSize(stdout: string): { width: number; height: number } {
	const lines = stdout.trim().split("\n");
	for (const line of lines.reverse()) {
		const match = line.match(/(\d+)x(\d+)/);
		if (match) {
			return {
				width: Number.parseInt(match[1], 10),
				height: Number.parseInt(match[2], 10),
			};
		}
	}
	return { width: 0, height: 0 };
}
