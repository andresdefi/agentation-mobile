import { execFile as execFileCb } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import {
	type DeviceInfo,
	type IPlatformBridge,
	hitTestElement,
	parseUiAutomatorXml,
	parseWmSize,
} from "@agentation-mobile/bridge-core";
import type { MobileElement } from "@agentation-mobile/core";

const execFile = promisify(execFileCb);

/** Maximum time (ms) to wait for any single ADB command. */
const ADB_TIMEOUT = 15_000;

/** Maximum buffer size (bytes) for ADB screenshot output (~25 MB). */
const ADB_MAX_BUFFER = 25 * 1024 * 1024;

export class AndroidBridge implements IPlatformBridge {
	readonly platform = "android-native" as const;

	/**
	 * Check whether ADB is installed and accessible on the system PATH.
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await execFile("adb", ["version"], { timeout: ADB_TIMEOUT });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Discover all connected Android devices and emulators via `adb devices -l`.
	 * For each device, also queries the screen resolution via `adb shell wm size`.
	 */
	async listDevices(): Promise<DeviceInfo[]> {
		const { stdout } = await execFile("adb", ["devices", "-l"], {
			timeout: ADB_TIMEOUT,
		});

		const lines = stdout.split("\n").slice(1); // Skip header line

		// Parse device serials and static info first
		const rawDevices: Array<{
			serial: string;
			name: string;
			isEmulator: boolean;
		}> = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("*")) continue;

			const parts = trimmed.split(/\s+/);
			if (parts.length < 2) continue;

			const serial = parts[0];
			const state = parts[1];

			if (state !== "device") continue;

			const modelMatch = trimmed.match(/model:(\S+)/);
			const deviceMatch = trimmed.match(/device:(\S+)/);
			const name = modelMatch?.[1]?.replace(/_/g, " ") ?? deviceMatch?.[1] ?? serial;
			const isEmulator = serial.startsWith("emulator-") || serial.includes("localhost:");

			rawDevices.push({ serial, name, isEmulator });
		}

		// Enrich all devices in parallel (OS version + screen size)
		const enriched = await Promise.all(
			rawDevices.map(async (dev) => {
				const [osVersion, screen] = await Promise.all([
					execFile("adb", ["-s", dev.serial, "shell", "getprop", "ro.build.version.release"], {
						timeout: ADB_TIMEOUT,
					})
						.then(({ stdout: v }) => v.trim() || "unknown")
						.catch(() => "unknown"),
					execFile("adb", ["-s", dev.serial, "shell", "wm", "size"], {
						timeout: ADB_TIMEOUT,
					})
						.then(({ stdout: sizeOut }) => parseWmSize(sizeOut))
						.catch(() => ({ width: 0, height: 0 })),
				]);

				return {
					id: dev.serial,
					name: dev.name,
					platform: "android-native" as const,
					isEmulator: dev.isEmulator,
					osVersion,
					screenWidth: screen.width,
					screenHeight: screen.height,
				};
			}),
		);

		return enriched;
	}

	/**
	 * Capture a screenshot from the device as a PNG buffer.
	 * Uses `adb exec-out screencap -p` to stream raw PNG data directly.
	 */
	async captureScreen(deviceId: string): Promise<Buffer> {
		const { stdout } = await execFile("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
			timeout: ADB_TIMEOUT,
			maxBuffer: ADB_MAX_BUFFER,
			encoding: "buffer",
		});

		if (!stdout || stdout.length === 0) {
			throw new Error(`Screenshot capture returned empty buffer for device ${deviceId}`);
		}

		// Validate it looks like a PNG (magic bytes: 0x89 P N G)
		if (stdout[0] !== 0x89 || stdout[1] !== 0x50 || stdout[2] !== 0x4e || stdout[3] !== 0x47) {
			throw new Error(`Screenshot data does not appear to be a valid PNG for device ${deviceId}`);
		}

		return stdout;
	}

	/**
	 * Retrieve the UI element tree via UIAutomator and convert to MobileElement[].
	 * Runs `adb shell uiautomator dump /dev/tty` to get the XML representation
	 * of the current screen, then parses it with fast-xml-parser.
	 */
	async getElementTree(deviceId: string): Promise<MobileElement[]> {
		// Try to get UIAutomator elements and SDK elements in parallel
		const [uiAutomatorElements, sdkElements] = await Promise.all([
			this.getUiAutomatorTree(deviceId),
			this.querySdkElements(deviceId).catch(() => null),
		]);

		// Merge SDK source locations into UIAutomator elements
		if (sdkElements && sdkElements.length > 0) {
			return this.mergeElements(uiAutomatorElements, sdkElements);
		}

		return uiAutomatorElements;
	}

	/**
	 * Get the raw UIAutomator element tree (without SDK enrichment).
	 */
	private async getUiAutomatorTree(deviceId: string): Promise<MobileElement[]> {
		const { stdout } = await execFile(
			"adb",
			["-s", deviceId, "shell", "uiautomator", "dump", "/dev/tty"],
			{ timeout: ADB_TIMEOUT, maxBuffer: ADB_MAX_BUFFER },
		);

		const xmlStart = stdout.indexOf("<?xml");
		if (xmlStart === -1) {
			const hierarchyStart = stdout.indexOf("<hierarchy");
			if (hierarchyStart === -1) {
				throw new Error(
					`UIAutomator dump did not return valid XML for device ${deviceId}. Output: ${stdout.slice(0, 200)}`,
				);
			}
			return parseUiAutomatorXml(stdout.slice(hierarchyStart), "android-native");
		}

		return parseUiAutomatorXml(stdout.slice(xmlStart), "android-native");
	}

	async inspectElement(deviceId: string, x: number, y: number): Promise<MobileElement | null> {
		// Try SDK hit-test first (has source locations), fall back to UIAutomator
		const sdkElement = await this.querySdkElementAt(deviceId, x, y).catch(() => null);
		if (sdkElement?.sourceLocation) {
			return sdkElement;
		}

		const elements = await this.getElementTree(deviceId);
		return hitTestElement(elements, x, y);
	}

	async connectWifi(host: string, port = 5555): Promise<{ success: boolean; message: string }> {
		try {
			const { stdout } = await execFile("adb", ["connect", `${host}:${port}`], {
				timeout: ADB_TIMEOUT,
			});
			const output = stdout.trim();
			const success = output.includes("connected") && !output.includes("failed");
			return { success, message: output };
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async pairDevice(
		host: string,
		port: number,
		code: string,
	): Promise<{ success: boolean; message: string }> {
		try {
			const { stdout } = await execFile("adb", ["pair", `${host}:${port}`, code], {
				timeout: ADB_TIMEOUT,
			});
			const output = stdout.trim();
			const success = output.includes("Successfully paired");
			return { success, message: output };
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async disconnectDevice(deviceId: string): Promise<{ success: boolean; message: string }> {
		try {
			const { stdout } = await execFile("adb", ["disconnect", deviceId], {
				timeout: ADB_TIMEOUT,
			});
			const output = stdout.trim();
			const success = output.includes("disconnected");
			return { success, message: output };
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async pauseAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		try {
			await Promise.all([
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "animator_duration_scale", "0"],
					{ timeout: ADB_TIMEOUT },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "transition_animation_scale", "0"],
					{ timeout: ADB_TIMEOUT },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "window_animation_scale", "0"],
					{ timeout: ADB_TIMEOUT },
				),
			]);
			return { success: true, message: "All animations disabled" };
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async resumeAnimations(deviceId: string): Promise<{ success: boolean; message: string }> {
		try {
			await Promise.all([
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "animator_duration_scale", "1"],
					{ timeout: ADB_TIMEOUT },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "transition_animation_scale", "1"],
					{ timeout: ADB_TIMEOUT },
				),
				execFile(
					"adb",
					["-s", deviceId, "shell", "settings", "put", "global", "window_animation_scale", "1"],
					{ timeout: ADB_TIMEOUT },
				),
			]);
			return { success: true, message: "All animations restored to normal" };
		} catch (err) {
			return { success: false, message: `${err}` };
		}
	}

	async sendTap(deviceId: string, x: number, y: number): Promise<void> {
		await execFile(
			"adb",
			["-s", deviceId, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))],
			{ timeout: ADB_TIMEOUT },
		);
	}

	async sendSwipe(
		deviceId: string,
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		durationMs = 300,
	): Promise<void> {
		await execFile(
			"adb",
			[
				"-s",
				deviceId,
				"shell",
				"input",
				"swipe",
				String(Math.round(fromX)),
				String(Math.round(fromY)),
				String(Math.round(toX)),
				String(Math.round(toY)),
				String(durationMs),
			],
			{ timeout: ADB_TIMEOUT },
		);
	}

	async sendText(deviceId: string, text: string): Promise<void> {
		// Escape special shell characters for adb shell input text
		const escaped = text.replace(/([\\'"$ `!&|;(){}[\]<>?*#~])/g, "\\$1").replace(/ /g, "%s");
		await execFile("adb", ["-s", deviceId, "shell", "input", "text", escaped], {
			timeout: ADB_TIMEOUT,
		});
	}

	async sendKeyEvent(deviceId: string, keyCode: string): Promise<void> {
		await execFile("adb", ["-s", deviceId, "shell", "input", "keyevent", keyCode], {
			timeout: ADB_TIMEOUT,
		});
	}

	/**
	 * Try to query the in-app Agentation SDK HTTP server for enriched element data.
	 * The SDK runs on port 4748 inside the app. We use ADB port forwarding to reach it.
	 * Returns null if the SDK server is not running.
	 */
	private async querySdkElements(deviceId: string): Promise<MobileElement[] | null> {
		try {
			// Set up port forwarding (idempotent — re-running is safe)
			await execFile("adb", ["-s", deviceId, "forward", "tcp:4748", "tcp:4748"], {
				timeout: ADB_TIMEOUT,
			});

			const body = await this.httpGet("http://127.0.0.1:4748/agentation/elements");
			if (!body) return null;

			const elements = JSON.parse(body) as MobileElement[];
			return elements;
		} catch {
			return null;
		}
	}

	/**
	 * Try to query the SDK for a specific element at coordinates.
	 */
	private async querySdkElementAt(
		deviceId: string,
		x: number,
		y: number,
	): Promise<MobileElement | null> {
		try {
			await execFile("adb", ["-s", deviceId, "forward", "tcp:4748", "tcp:4748"], {
				timeout: ADB_TIMEOUT,
			});

			const body = await this.httpGet(`http://127.0.0.1:4748/agentation/element?x=${x}&y=${y}`);
			if (!body) return null;

			return JSON.parse(body) as MobileElement;
		} catch {
			return null;
		}
	}

	/**
	 * Merge SDK-sourced elements (with source locations) into UIAutomator elements
	 * (with accurate bounding boxes). SDK data wins for source info, UIAutomator
	 * wins for bounding box accuracy and element coverage.
	 */
	private mergeElements(
		uiAutomatorElements: MobileElement[],
		sdkElements: MobileElement[],
	): MobileElement[] {
		if (sdkElements.length === 0) return uiAutomatorElements;

		// Build a spatial index of SDK elements for matching
		const enriched = uiAutomatorElements.map((uiEl) => {
			// Find the best matching SDK element by bounding box overlap
			const match = this.findBestSdkMatch(uiEl, sdkElements);
			if (!match) return uiEl;

			return {
				...uiEl,
				sourceLocation: match.sourceLocation ?? uiEl.sourceLocation,
				componentFile: match.componentFile ?? uiEl.componentFile,
				componentName: match.componentName || uiEl.componentName,
				animations: match.animations ?? uiEl.animations,
			};
		});

		return enriched;
	}

	/**
	 * Find the SDK element that best matches a UIAutomator element by bounding box overlap.
	 */
	private findBestSdkMatch(
		target: MobileElement,
		sdkElements: MobileElement[],
	): MobileElement | null {
		let bestMatch: MobileElement | null = null;
		let bestOverlap = 0;

		const tb = target.boundingBox;

		for (const sdk of sdkElements) {
			const sb = sdk.boundingBox;

			// Calculate intersection
			const overlapX = Math.max(
				0,
				Math.min(tb.x + tb.width, sb.x + sb.width) - Math.max(tb.x, sb.x),
			);
			const overlapY = Math.max(
				0,
				Math.min(tb.y + tb.height, sb.y + sb.height) - Math.max(tb.y, sb.y),
			);
			const overlapArea = overlapX * overlapY;

			// Require at least 50% overlap relative to the smaller element
			const targetArea = tb.width * tb.height;
			const sdkArea = sb.width * sb.height;
			const minArea = Math.min(targetArea, sdkArea);

			if (minArea > 0 && overlapArea / minArea > 0.5 && overlapArea > bestOverlap) {
				bestOverlap = overlapArea;
				bestMatch = sdk;
			}
		}

		return bestMatch;
	}

	/**
	 * Simple HTTP GET request with timeout.
	 */
	private httpGet(url: string): Promise<string | null> {
		return new Promise((resolve) => {
			const req = http.get(url, { timeout: 2000 }, (res) => {
				if (res.statusCode !== 200) {
					res.resume();
					resolve(null);
					return;
				}
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
				res.on("error", () => resolve(null));
			});
			req.on("error", () => resolve(null));
			req.on("timeout", () => {
				req.destroy();
				resolve(null);
			});
		});
	}
}
