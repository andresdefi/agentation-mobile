import { useEffect, useRef, useState } from "react";
import { getWebSocketUrl } from "../api";

interface UseScreenMirrorResult {
	frameUrl: string | null;
	connected: boolean;
	error: string | null;
}

export function useScreenMirror(deviceId: string | null): UseScreenMirrorResult {
	const [frameUrl, setFrameUrl] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const prevUrlRef = useRef<string | null>(null);

	useEffect(() => {
		if (!deviceId) {
			setFrameUrl(null);
			setConnected(false);
			setError(null);
			return;
		}

		const wsUrl = getWebSocketUrl(deviceId);
		const ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";
		wsRef.current = ws;

		ws.onopen = () => {
			setConnected(true);
			setError(null);
		};

		ws.onmessage = (event: MessageEvent) => {
			if (event.data instanceof ArrayBuffer) {
				const blob = new Blob([event.data], { type: "image/png" });
				const url = URL.createObjectURL(blob);

				// Revoke previous URL to avoid memory leaks
				if (prevUrlRef.current) {
					URL.revokeObjectURL(prevUrlRef.current);
				}
				prevUrlRef.current = url;
				setFrameUrl(url);
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
			if (prevUrlRef.current) {
				URL.revokeObjectURL(prevUrlRef.current);
				prevUrlRef.current = null;
			}
		};
	}, [deviceId]);

	return { frameUrl, connected, error };
}
