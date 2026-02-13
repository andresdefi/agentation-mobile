import { type ChildProcess, exec, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ScrcpyStreamOptions {
	deviceId: string;
	maxFps?: number;
	maxSize?: number;
	bitRate?: number;
}

/**
 * High-performance screen streaming for Android devices.
 *
 * If scrcpy is detected on the system, uses `scrcpy --no-display` to obtain
 * raw H.264 frames from the device encoder and pipes them through ffmpeg for
 * JPEG extraction.  When scrcpy is not available, falls back to adaptive
 * polling via `adb exec-out screencap -p`, which can still reach ~10-15 fps
 * on modern devices.
 *
 * Events:
 *  - `frame`  (Buffer)  — JPEG image data for one frame
 *  - `error`  (Error)   — non-fatal streaming error
 *  - `close`  ()        — stream ended
 */
export class ScrcpyStream extends EventEmitter {
	private process: ChildProcess | null = null;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private running = false;

	private readonly deviceId: string;
	private readonly maxFps: number;
	private readonly maxSize: number;
	private readonly bitRate: number;

	constructor(options: ScrcpyStreamOptions) {
		super();
		this.deviceId = options.deviceId;
		this.maxFps = options.maxFps ?? 15;
		this.maxSize = options.maxSize ?? 1024;
		this.bitRate = options.bitRate ?? 2_000_000;
	}

	// ------------------------------------------------------------------
	// Static helpers
	// ------------------------------------------------------------------

	/** Check whether the `scrcpy` binary is reachable via $PATH. */
	static async isAvailable(): Promise<boolean> {
		try {
			await execAsync("which scrcpy");
			return true;
		} catch {
			return false;
		}
	}

	/** Check whether `ffmpeg` is reachable via $PATH. */
	static async isFfmpegAvailable(): Promise<boolean> {
		try {
			await execAsync("which ffmpeg");
			return true;
		} catch {
			return false;
		}
	}

	// ------------------------------------------------------------------
	// Public API
	// ------------------------------------------------------------------

	/**
	 * Start streaming frames.
	 *
	 * Attempts scrcpy + ffmpeg first; if either is missing, transparently
	 * falls back to adaptive ADB screencap polling.
	 */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		const [hasScrcpy, hasFfmpeg] = await Promise.all([
			ScrcpyStream.isAvailable(),
			ScrcpyStream.isFfmpegAvailable(),
		]);

		if (hasScrcpy && hasFfmpeg) {
			this.startScrcpyPipeline();
		} else {
			this.startAdaptivePolling();
		}
	}

	/** Stop the stream and clean up child processes / timers. */
	stop(): void {
		this.running = false;

		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		if (this.process) {
			this.process.kill("SIGTERM");
			this.process = null;
		}
	}

	// ------------------------------------------------------------------
	// scrcpy + ffmpeg pipeline
	// ------------------------------------------------------------------

	/**
	 * Spawns scrcpy in raw-video mode and pipes the H.264 stream through
	 * ffmpeg, which decodes frames and outputs them as individual JPEG
	 * images separated by a recognisable boundary.
	 *
	 * Pipeline: scrcpy (H.264 stdout) -> ffmpeg (decode -> JPEG frames stdout)
	 */
	private startScrcpyPipeline(): void {
		const scrcpyArgs = [
			`--serial=${this.deviceId}`,
			"--no-audio",
			"--no-playback",
			`--max-fps=${this.maxFps}`,
			`--max-size=${this.maxSize}`,
			`--video-bit-rate=${this.bitRate}`,
			"--video-codec=h264",
			"--raw-video-stream",
		];

		const scrcpy = spawn("scrcpy", scrcpyArgs, { stdio: ["ignore", "pipe", "ignore"] });

		// ffmpeg reads H.264 from stdin and outputs a stream of JPEG images.
		// Each image is preceded by a content-type boundary that we use for
		// splitting (mjpeg muxer writes standard MIME multipart).
		const ffmpeg = spawn(
			"ffmpeg",
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-f",
				"h264",
				"-i",
				"pipe:0",
				"-vf",
				`fps=${this.maxFps},scale=${this.maxSize}:-1`,
				"-f",
				"image2pipe",
				"-vcodec",
				"mjpeg",
				"-q:v",
				"5",
				"pipe:1",
			],
			{ stdio: ["pipe", "pipe", "ignore"] },
		);

		// Wire scrcpy stdout -> ffmpeg stdin
		scrcpy.stdout?.pipe(ffmpeg.stdin!);

		// Keep a reference for cleanup (kill scrcpy -> ffmpeg will end too)
		this.process = scrcpy;

		// ----- Parse JPEG frames from ffmpeg stdout -----
		// JPEG files always start with 0xFFD8 and end with 0xFFD9.
		let buffer: Buffer = Buffer.alloc(0);

		ffmpeg.stdout?.on("data", (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			this.extractJpegFrames(buffer, (remaining) => {
				buffer = remaining;
			});
		});

		// ----- Error / close handling -----
		scrcpy.on("error", (err) => this.emit("error", err));
		ffmpeg.on("error", (err) => this.emit("error", err));

		const handleClose = () => {
			if (!this.running) return;
			this.running = false;
			ffmpeg.kill("SIGTERM");
			this.emit("close");
		};

		scrcpy.on("close", handleClose);
		ffmpeg.on("close", handleClose);
	}

	/**
	 * Scan `buf` for complete JPEG images (SOI 0xFFD8 ... EOI 0xFFD9) and
	 * emit each one as a `frame` event.  Calls `onRemaining` with the
	 * leftover bytes that have not yet formed a complete image.
	 */
	private extractJpegFrames(buf: Buffer, onRemaining: (remaining: Buffer) => void): void {
		let data = buf;
		let start = indexOfJpegStart(data);

		while (start !== -1) {
			const end = indexOfJpegEnd(data, start + 2);
			if (end === -1) {
				// Incomplete frame — keep from SOI onward
				onRemaining(start > 0 ? data.subarray(start) : data);
				return;
			}

			// end points to the first byte of the FFD9 marker; include both bytes
			const frame = data.subarray(start, end + 2);
			data = data.subarray(end + 2);
			this.emit("frame", Buffer.from(frame));

			start = indexOfJpegStart(data);
		}

		// No more SOI markers — discard remaining bytes
		onRemaining(Buffer.alloc(0));
	}

	// ------------------------------------------------------------------
	// Adaptive ADB screencap polling  (fallback)
	// ------------------------------------------------------------------

	/**
	 * Polls `adb exec-out screencap -p` at an interval that adapts to
	 * the actual capture duration, targeting {@link maxFps}.
	 */
	private startAdaptivePolling(): void {
		const targetInterval = Math.round(1000 / this.maxFps);

		const poll = async () => {
			if (!this.running) return;

			const start = Date.now();
			try {
				const frame = await this.captureScreencap();
				if (this.running) {
					this.emit("frame", frame);
				}
			} catch (err) {
				this.emit("error", err instanceof Error ? err : new Error(String(err)));
			}

			if (!this.running) return;

			const elapsed = Date.now() - start;
			const delay = Math.max(0, targetInterval - elapsed);
			this.pollTimer = setTimeout(poll, delay);
		};

		poll();
	}

	/** Capture a single PNG frame via ADB. */
	private captureScreencap(): Promise<Buffer> {
		return new Promise<Buffer>((resolve, reject) => {
			const proc = spawn("adb", ["-s", this.deviceId, "exec-out", "screencap", "-p"], {
				stdio: ["ignore", "pipe", "ignore"],
			});

			const chunks: Buffer[] = [];
			proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));

			proc.on("close", (code) => {
				if (code === 0) {
					resolve(Buffer.concat(chunks));
				} else {
					reject(new Error(`adb screencap exited with code ${code}`));
				}
			});

			proc.on("error", reject);
		});
	}
}

// ------------------------------------------------------------------
// JPEG boundary helpers
// ------------------------------------------------------------------

/** Find the index of the JPEG SOI marker (0xFF 0xD8) in `buf`. */
function indexOfJpegStart(buf: Buffer, offset = 0): number {
	for (let i = offset; i < buf.length - 1; i++) {
		if (buf[i] === 0xff && buf[i + 1] === 0xd8) return i;
	}
	return -1;
}

/** Find the index of the JPEG EOI marker (0xFF 0xD9) in `buf`. */
function indexOfJpegEnd(buf: Buffer, offset = 0): number {
	for (let i = offset; i < buf.length - 1; i++) {
		if (buf[i] === 0xff && buf[i + 1] === 0xd9) return i;
	}
	return -1;
}
