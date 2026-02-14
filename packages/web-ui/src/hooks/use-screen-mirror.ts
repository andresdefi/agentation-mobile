import { useCallback, useEffect, useRef, useState } from "react";
import { getWebSocketUrl } from "../api";

export interface InputMessage {
	type: "tap" | "swipe" | "text" | "key";
	x?: number;
	y?: number;
	fromX?: number;
	fromY?: number;
	toX?: number;
	toY?: number;
	durationMs?: number;
	text?: string;
	keyCode?: string;
}

interface UseScreenMirrorResult {
	frameUrl: string | null;
	connected: boolean;
	error: string | null;
	sendInput: (msg: InputMessage) => void;
}

/** Thumbnail size for frame comparison (NxN pixels) */
const THUMB_SIZE = 16;
/** Pixel difference threshold (0-255 per channel) to count as "changed" */
const PIXEL_THRESHOLD = 30;
/** Fraction of pixels that must differ to trigger a screen change */
const CHANGE_FRACTION = 0.15;
/** Minimum ms between screen-change callbacks */
const DEBOUNCE_MS = 800;
/** How often to sample frames for comparison */
const SAMPLE_INTERVAL_MS = 500;

function computeDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	const totalPixels = a.length / 4;
	let changed = 0;
	for (let i = 0; i < a.length; i += 4) {
		const dr = Math.abs(a[i] - b[i]);
		const dg = Math.abs(a[i + 1] - b[i + 1]);
		const db = Math.abs(a[i + 2] - b[i + 2]);
		if (dr > PIXEL_THRESHOLD || dg > PIXEL_THRESHOLD || db > PIXEL_THRESHOLD) {
			changed++;
		}
	}
	return changed / totalPixels;
}

export function useScreenMirror(
	deviceId: string | null,
	platform?: string,
	onScreenChange?: () => void,
): UseScreenMirrorResult {
	const [frameUrl, setFrameUrl] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const prevUrlRef = useRef<string | null>(null);

	// Frame comparison refs
	const prevThumbRef = useRef<Uint8ClampedArray | null>(null);
	const lastChangeTimeRef = useRef(0);
	const lastSampleTimeRef = useRef(0);
	const onScreenChangeRef = useRef(onScreenChange);
	onScreenChangeRef.current = onScreenChange;
	const comparingRef = useRef(false);

	// Reusable Image + Canvas for thumbnail
	const imgElRef = useRef<HTMLImageElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

	useEffect(() => {
		if (!deviceId) {
			setFrameUrl(null);
			setConnected(false);
			setError(null);
			prevThumbRef.current = null;
			return;
		}

		const wsUrl = getWebSocketUrl(deviceId, platform);
		const ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";
		wsRef.current = ws;

		// Create reusable Image + Canvas
		if (!canvasRef.current) {
			const canvas = document.createElement("canvas");
			canvas.width = THUMB_SIZE;
			canvas.height = THUMB_SIZE;
			canvasRef.current = canvas;
			ctxRef.current = canvas.getContext("2d", { willReadFrequently: true });
		}
		if (!imgElRef.current) {
			imgElRef.current = new Image();
		}

		ws.onopen = () => {
			setConnected(true);
			setError(null);
		};

		ws.onmessage = (event: MessageEvent) => {
			if (event.data instanceof ArrayBuffer) {
				const blob = new Blob([event.data], { type: "image/png" });
				const url = URL.createObjectURL(blob);

				// Revoke previous display URL
				if (prevUrlRef.current) {
					URL.revokeObjectURL(prevUrlRef.current);
				}
				prevUrlRef.current = url;
				setFrameUrl(url);

				// Screen change detection — sample periodically
				const now = Date.now();
				if (
					onScreenChangeRef.current &&
					ctxRef.current &&
					imgElRef.current &&
					!comparingRef.current &&
					now - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS
				) {
					lastSampleTimeRef.current = now;
					comparingRef.current = true;

					// Create a SEPARATE blob URL for comparison (won't be revoked by next frame)
					const compareUrl = URL.createObjectURL(blob);
					const img = imgElRef.current;

					const cleanup = () => {
						URL.revokeObjectURL(compareUrl);
						comparingRef.current = false;
					};

					img.onload = () => {
						try {
							const ctx = ctxRef.current;
							if (!ctx) {
								cleanup();
								return;
							}
							ctx.drawImage(img, 0, 0, THUMB_SIZE, THUMB_SIZE);
							const imageData = ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE);
							const currentThumb = imageData.data;

							if (prevThumbRef.current) {
								const diff = computeDiff(prevThumbRef.current, currentThumb);
								if (diff >= CHANGE_FRACTION) {
									const changeNow = Date.now();
									if (changeNow - lastChangeTimeRef.current >= DEBOUNCE_MS) {
										lastChangeTimeRef.current = changeNow;
										console.log(
											`[screen-change] ${(diff * 100).toFixed(0)}% pixels changed — refreshing elements`,
										);
										onScreenChangeRef.current?.();
									}
								}
							}
							prevThumbRef.current = new Uint8ClampedArray(currentThumb);
							cleanup();
						} catch (err) {
							console.warn("[screen-change] comparison error:", err);
							cleanup();
						}
					};
					img.onerror = () => {
						console.warn("[screen-change] Image load failed for comparison");
						cleanup();
					};
					img.src = compareUrl;
				}
			}
		};

		ws.onerror = () => {
			setError("WebSocket connection error");
			setConnected(false);
		};

		ws.onclose = (event) => {
			setConnected(false);
			if (event.code !== 1000) {
				setError(event.reason || "WebSocket disconnected");
			}
		};

		return () => {
			ws.close();
			wsRef.current = null;
			prevThumbRef.current = null;
			if (prevUrlRef.current) {
				URL.revokeObjectURL(prevUrlRef.current);
				prevUrlRef.current = null;
			}
		};
	}, [deviceId, platform]);

	const sendInput = useCallback((msg: InputMessage) => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		}
	}, []);

	return { frameUrl, connected, error, sendInput };
}
