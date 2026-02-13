import type { CreateAnnotationInput, MobileAnnotation } from "@agentation-mobile/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type React from "react";
import { createContext, useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "@agentation-mobile/annotations";

export interface AgentationConfig {
	/** Server URL. If omitted, runs in local-only mode (annotations stored on device). */
	serverUrl?: string;
	deviceId?: string;
	sessionId?: string;
	enabled?: boolean;
}

export interface AgentationContextValue {
	annotations: MobileAnnotation[];
	connected: boolean;
	/** Whether running in local-only mode (no server). */
	localMode: boolean;
	serverUrl: string | null;
	createAnnotation: (data: CreateAnnotationInput) => Promise<void>;
	/** Export all annotations as structured text for pasting into AI tools. */
	exportAnnotations: () => string;
}

export const AgentationContext = createContext<AgentationContextValue | null>(null);

const POLL_INTERVAL = 3000;
const RECONNECT_DELAY = 2000;

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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

	const normalizedUrl = serverUrl?.replace(/\/$/, "") ?? null;
	const localMode = normalizedUrl === null;

	// Load annotations from local storage on mount
	useEffect(() => {
		if (!isActive) return;
		AsyncStorage.getItem(STORAGE_KEY)
			.then((stored) => {
				if (stored && mountedRef.current) {
					const parsed = JSON.parse(stored) as MobileAnnotation[];
					setAnnotations(parsed);
				}
			})
			.catch(() => {
				// Ignore storage read errors
			});
	}, [isActive]);

	// Persist annotations to local storage whenever they change
	const persistAnnotations = useCallback((anns: MobileAnnotation[]) => {
		AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(anns)).catch(() => {
			// Ignore storage write errors
		});
	}, []);

	// Fetch annotations from the REST API (server mode only)
	const fetchAnnotations = useCallback(async () => {
		if (!sessionId || !mountedRef.current || !normalizedUrl) return;
		try {
			const url = `${normalizedUrl}/api/annotations?sessionId=${encodeURIComponent(sessionId)}`;
			const response = await fetch(url);
			if (response.ok && mountedRef.current) {
				const data = (await response.json()) as MobileAnnotation[];
				setAnnotations(data);
				persistAnnotations(data);
			}
		} catch {
			// Silently ignore fetch errors — the server may be unreachable
		}
	}, [normalizedUrl, sessionId, persistAnnotations]);

	// Connect WebSocket (server mode only)
	const connectWebSocket = useCallback(() => {
		if (!isActive || !mountedRef.current || !normalizedUrl) return;

		const wsUrl = `${normalizedUrl.replace(/^http/, "ws")}/ws/screen`;
		const ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			if (mountedRef.current) {
				setConnected(true);
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
					persistAnnotations(message.annotations);
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
				reconnectTimerRef.current = setTimeout(() => {
					if (mountedRef.current) {
						connectWebSocket();
					}
				}, RECONNECT_DELAY);
			}
		};

		wsRef.current = ws;
	}, [isActive, normalizedUrl, deviceId, sessionId, persistAnnotations]);

	// Create annotation — local or server
	const createAnnotation = useCallback(
		async (data: CreateAnnotationInput) => {
			if (localMode) {
				// Local-only mode: create annotation locally
				const now = new Date().toISOString();
				const annotation: MobileAnnotation = {
					id: generateId(),
					sessionId: data.sessionId,
					x: data.x,
					y: data.y,
					deviceId: data.deviceId,
					platform: data.platform,
					screenWidth: data.screenWidth,
					screenHeight: data.screenHeight,
					screenshotId: data.screenshotId,
					comment: data.comment,
					intent: data.intent,
					severity: data.severity,
					status: "pending",
					element: data.element,
					selectedArea: data.selectedArea,
					selectedText: data.selectedText,
					thread: [],
					createdAt: now,
					updatedAt: now,
				};
				setAnnotations((prev) => {
					const next = [...prev, annotation];
					persistAnnotations(next);
					return next;
				});
			} else {
				// Server mode: POST to server
				const url = `${normalizedUrl}/api/annotations`;
				const response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
				if (!response.ok) {
					throw new Error(`Failed to create annotation: ${response.status}`);
				}
				await fetchAnnotations();
			}
		},
		[localMode, normalizedUrl, fetchAnnotations, persistAnnotations],
	);

	// Export annotations as structured text (for sharing/pasting into AI tools)
	const exportAnnotations = useCallback(() => {
		const lines: string[] = [];
		lines.push(`# ${annotations.length} annotations`);
		lines.push("");

		for (let i = 0; i < annotations.length; i++) {
			const a = annotations[i];
			let ref = `${i + 1}. [${a.intent}/${a.severity}]`;
			if (a.element?.componentName) {
				ref += ` ${a.element.componentName}`;
				if (a.element.componentFile) {
					ref += ` (${a.element.componentFile})`;
				}
			}
			lines.push(ref);
			lines.push(`   ${a.comment}`);
			lines.push(`   Status: ${a.status} | Position: ${a.x.toFixed(1)}%, ${a.y.toFixed(1)}%`);
			if (a.selectedText) {
				lines.push(`   Text: "${a.selectedText}"`);
			}
			lines.push("");
		}

		return lines.join("\n").trimEnd();
	}, [annotations]);

	// Set up WebSocket connection and polling (server mode only)
	useEffect(() => {
		mountedRef.current = true;

		if (!isActive || localMode) return;

		connectWebSocket();

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
	}, [isActive, localMode, connectWebSocket, fetchAnnotations, sessionId]);

	const contextValue: AgentationContextValue = {
		annotations,
		connected: localMode ? true : connected,
		localMode,
		serverUrl: normalizedUrl,
		createAnnotation,
		exportAnnotations,
	};

	return <AgentationContext.Provider value={contextValue}>{children}</AgentationContext.Provider>;
}
