import type { CreateAnnotationInput, MobileAnnotation } from "@agentation-mobile/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type React from "react";
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import {
	type DetectedAnimation,
	getActiveAnimations,
	installAnimationDetector,
	onAnimationChange,
	uninstallAnimationDetector,
} from "./AnimationDetector";
import { collectElementTreeAsync } from "./ElementCollector";
import type { CollectedElement } from "./ElementCollector";

const STORAGE_KEY = "@agentation-mobile/annotations";
const PENDING_IDS_KEY = "@agentation-mobile/pending-ids";

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
	/** Currently active/recent animations detected in the app. */
	activeAnimations: DetectedAnimation[];
	/** Collected element tree from the React fiber tree. */
	elements: CollectedElement[];
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
	const [activeAnims, setActiveAnims] = useState<DetectedAnimation[]>([]);
	const [collectedElements, setCollectedElements] = useState<CollectedElement[]>([]);
	const wsRef = useRef<WebSocket | null>(null);
	const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);
	const pendingIdsRef = useRef<Set<string>>(new Set());

	// Only active in dev mode and when enabled
	const isActive = typeof __DEV__ !== "undefined" ? __DEV__ && enabled : enabled;

	const normalizedUrl = serverUrl?.replace(/\/$/, "") ?? null;
	const localMode = normalizedUrl === null;

	// Persist pending IDs to storage
	const persistPendingIds = useCallback(() => {
		AsyncStorage.setItem(PENDING_IDS_KEY, JSON.stringify([...pendingIdsRef.current])).catch(
			() => {},
		);
	}, []);

	// Load annotations and pending IDs from local storage on mount
	useEffect(() => {
		if (!isActive) return;
		Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(PENDING_IDS_KEY)])
			.then(([stored, pendingStored]) => {
				if (!mountedRef.current) return;
				if (stored) {
					const parsed = JSON.parse(stored) as MobileAnnotation[];
					setAnnotations(parsed);
				}
				if (pendingStored) {
					const ids = JSON.parse(pendingStored) as string[];
					pendingIdsRef.current = new Set(ids);
				}
			})
			.catch(() => {});
	}, [isActive]);

	// Persist annotations to local storage whenever they change
	const persistAnnotations = useCallback((anns: MobileAnnotation[]) => {
		AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(anns)).catch(() => {});
	}, []);

	// Upload pending local annotations to the server
	const uploadPending = useCallback(
		async (currentAnnotations: MobileAnnotation[]) => {
			if (!normalizedUrl || pendingIdsRef.current.size === 0) return;

			const pending = currentAnnotations.filter((a) => pendingIdsRef.current.has(a.id));
			for (const annotation of pending) {
				try {
					const response = await fetch(`${normalizedUrl}/api/annotations`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							sessionId: annotation.sessionId,
							x: annotation.x,
							y: annotation.y,
							deviceId: annotation.deviceId,
							platform: annotation.platform,
							screenWidth: annotation.screenWidth,
							screenHeight: annotation.screenHeight,
							screenshotId: annotation.screenshotId,
							comment: annotation.comment,
							intent: annotation.intent,
							severity: annotation.severity,
							element: annotation.element,
							selectedArea: annotation.selectedArea,
							selectedText: annotation.selectedText,
						}),
					});
					if (response.ok) {
						pendingIdsRef.current.delete(annotation.id);
					}
				} catch {
					// Will retry on next fetch cycle
				}
			}
			persistPendingIds();
		},
		[normalizedUrl, persistPendingIds],
	);

	// Fetch annotations from the REST API (server mode only)
	// Merges server data with any remaining unsynced local annotations
	const fetchAnnotations = useCallback(async () => {
		if (!sessionId || !mountedRef.current || !normalizedUrl) return;
		try {
			const url = `${normalizedUrl}/api/annotations?sessionId=${encodeURIComponent(sessionId)}`;
			const response = await fetch(url);
			if (response.ok && mountedRef.current) {
				const serverData = (await response.json()) as MobileAnnotation[];

				setAnnotations((prev) => {
					// Upload any pending annotations first
					uploadPending(prev);

					// Merge: server data + remaining unsynced locals
					const serverIds = new Set(serverData.map((a) => a.id));
					const stillPending = prev.filter(
						(a) => pendingIdsRef.current.has(a.id) && !serverIds.has(a.id),
					);
					const merged = [...serverData, ...stillPending];
					persistAnnotations(merged);
					return merged;
				});
			}
		} catch {
			// Silently ignore fetch errors — the server may be unreachable
		}
	}, [normalizedUrl, sessionId, persistAnnotations, uploadPending]);

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
					setAnnotations((prev) => {
						const serverIds = new Set(message.annotations?.map((a) => a.id) ?? []);
						const stillPending = prev.filter(
							(a) => pendingIdsRef.current.has(a.id) && !serverIds.has(a.id),
						);
						const merged = [...(message.annotations ?? []), ...stillPending];
						persistAnnotations(merged);
						return merged;
					});
				}
			} catch {
				// Ignore malformed messages
			}
		};

		ws.onerror = () => {};

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

	// Create annotation — always local-first, then sync to server
	const createAnnotation = useCallback(
		async (data: CreateAnnotationInput) => {
			// Always create locally first
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

			pendingIdsRef.current.add(annotation.id);
			persistPendingIds();

			setAnnotations((prev) => {
				const next = [...prev, annotation];
				persistAnnotations(next);
				return next;
			});

			// If server mode, try to upload immediately
			if (!localMode && normalizedUrl) {
				try {
					const response = await fetch(`${normalizedUrl}/api/annotations`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(data),
					});
					if (response.ok) {
						pendingIdsRef.current.delete(annotation.id);
						persistPendingIds();
						await fetchAnnotations();
					}
				} catch {
					// Stays in pending, will be uploaded on next fetch cycle
				}
			}
		},
		[localMode, normalizedUrl, fetchAnnotations, persistAnnotations, persistPendingIds],
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

	// Install animation detector and subscribe to changes
	useEffect(() => {
		if (!isActive) return;

		installAnimationDetector();

		const unsubscribe = onAnimationChange(() => {
			if (mountedRef.current) {
				setActiveAnims(getActiveAnimations());
			}
		});

		return () => {
			unsubscribe();
			uninstallAnimationDetector();
		};
	}, [isActive]);

	// Periodically collect element tree and report animations to the backend
	useEffect(() => {
		if (!isActive || localMode || !normalizedUrl) return;

		const reportInterval = setInterval(async () => {
			if (!mountedRef.current) return;

			// Collect element tree
			const elements = await collectElementTreeAsync();
			if (mountedRef.current) {
				setCollectedElements(elements);
			}

			// Report animations + elements to backend
			const animations = getActiveAnimations();
			if (animations.length > 0 || elements.length > 0) {
				try {
					await fetch(
						`${normalizedUrl}/api/devices/${encodeURIComponent(deviceId ?? "unknown")}/sdk-report`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								animations,
								elements,
								timestamp: Date.now(),
							}),
						},
					);
				} catch {
					// Silently ignore — server may be unreachable
				}
			}
		}, 1000);

		return () => clearInterval(reportInterval);
	}, [isActive, localMode, normalizedUrl, deviceId]);

	const contextValue: AgentationContextValue = {
		annotations,
		connected: localMode ? true : connected,
		localMode,
		serverUrl: normalizedUrl,
		createAnnotation,
		exportAnnotations,
		activeAnimations: activeAnims,
		elements: collectedElements,
	};

	return <AgentationContext.Provider value={contextValue}>{children}</AgentationContext.Provider>;
}
