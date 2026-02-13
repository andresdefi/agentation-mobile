import type { CreateAnnotationInput, MobileAnnotation } from "@agentation-mobile/core";
import type React from "react";
import { createContext, useCallback, useEffect, useRef, useState } from "react";

export interface AgentationConfig {
	serverUrl: string;
	deviceId?: string;
	sessionId?: string;
	enabled?: boolean;
}

export interface AgentationContextValue {
	annotations: MobileAnnotation[];
	connected: boolean;
	serverUrl: string;
	createAnnotation: (data: CreateAnnotationInput) => Promise<void>;
}

export const AgentationContext = createContext<AgentationContextValue | null>(null);

const POLL_INTERVAL = 3000;
const RECONNECT_DELAY = 2000;

export function AgentationProvider({
	serverUrl,
	deviceId,
	sessionId,
	enabled = true,
	children,
}: AgentationConfig & { children: React.ReactNode }) {
	const [annotations, setAnnotations] = useState<MobileAnnotation[]>([]);
	const [connected, setConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	// Only active in dev mode and when enabled
	const isActive = typeof __DEV__ !== "undefined" ? __DEV__ && enabled : enabled;

	const normalizedUrl = serverUrl.replace(/\/$/, "");

	// Fetch annotations from the REST API
	const fetchAnnotations = useCallback(async () => {
		if (!sessionId || !mountedRef.current) return;
		try {
			const url = `${normalizedUrl}/api/annotations?sessionId=${encodeURIComponent(sessionId)}`;
			const response = await fetch(url);
			if (response.ok && mountedRef.current) {
				const data = (await response.json()) as MobileAnnotation[];
				setAnnotations(data);
			}
		} catch {
			// Silently ignore fetch errors — the server may be unreachable
		}
	}, [normalizedUrl, sessionId]);

	// Connect WebSocket
	const connectWebSocket = useCallback(() => {
		if (!isActive || !mountedRef.current) return;

		const wsUrl = `${normalizedUrl.replace(/^http/, "ws")}/ws/screen`;
		const ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			if (mountedRef.current) {
				setConnected(true);
				// Send device identification
				ws.send(
					JSON.stringify({
						type: "identify",
						deviceId: deviceId ?? "unknown",
						sessionId: sessionId ?? "",
					}),
				);
			}
		};

		ws.onmessage = (event) => {
			if (!mountedRef.current) return;
			try {
				const message = JSON.parse(event.data as string) as {
					type: string;
					annotations?: MobileAnnotation[];
				};
				if (message.type === "annotations" && message.annotations) {
					setAnnotations(message.annotations);
				}
			} catch {
				// Ignore malformed messages
			}
		};

		ws.onerror = () => {
			// WebSocket errors are handled via onclose
		};

		ws.onclose = () => {
			if (mountedRef.current) {
				setConnected(false);
				// Schedule reconnection
				reconnectTimerRef.current = setTimeout(() => {
					if (mountedRef.current) {
						connectWebSocket();
					}
				}, RECONNECT_DELAY);
			}
		};

		wsRef.current = ws;
	}, [isActive, normalizedUrl, deviceId, sessionId]);

	// Create annotation via REST API
	const createAnnotation = useCallback(
		async (data: CreateAnnotationInput) => {
			const url = `${normalizedUrl}/api/annotations`;
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			});
			if (!response.ok) {
				throw new Error(`Failed to create annotation: ${response.status}`);
			}
			// Refresh annotations after creating one
			await fetchAnnotations();
		},
		[normalizedUrl, fetchAnnotations],
	);

	// Set up WebSocket connection and polling
	useEffect(() => {
		mountedRef.current = true;

		if (!isActive) return;

		connectWebSocket();

		// Poll for annotation updates
		if (sessionId) {
			fetchAnnotations();
			pollTimerRef.current = setInterval(fetchAnnotations, POLL_INTERVAL);
		}

		return () => {
			mountedRef.current = false;

			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
			if (pollTimerRef.current) {
				clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
		};
	}, [isActive, connectWebSocket, fetchAnnotations, sessionId]);

	const contextValue: AgentationContextValue = {
		annotations,
		connected,
		serverUrl: normalizedUrl,
		createAnnotation,
	};

	return <AgentationContext.Provider value={contextValue}>{children}</AgentationContext.Provider>;
}
