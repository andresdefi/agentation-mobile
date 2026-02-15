import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getEventsUrl } from "../api";
import type { CreateAnnotationPayload, MobileAnnotation, SessionWithAnnotations } from "../types";

interface UseAnnotationsResult {
	annotations: MobileAnnotation[];
	loading: boolean;
	error: string | null;
	recentlyResolved: Set<string>;
	createAnnotation: (payload: CreateAnnotationPayload) => Promise<MobileAnnotation>;
	reply: (annotationId: string, content: string) => Promise<MobileAnnotation>;
	updateStatus: (
		annotationId: string,
		action: "acknowledge" | "resolve" | "dismiss",
	) => Promise<MobileAnnotation>;
	deleteAnnotation: (annotationId: string) => Promise<void>;
	refresh: () => Promise<void>;
}

export function useAnnotations(sessionId: string | null): UseAnnotationsResult {
	const [annotations, setAnnotations] = useState<MobileAnnotation[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [recentlyResolved, setRecentlyResolved] = useState<Set<string>>(new Set());
	const mountedRef = useRef(true);
	const eventSourceRef = useRef<EventSource | null>(null);
	const resolvedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	const fetchAnnotations = useCallback(async () => {
		if (!sessionId) {
			setAnnotations([]);
			return;
		}

		setLoading(true);
		try {
			const data = await apiFetch<SessionWithAnnotations>(`/api/sessions/${sessionId}`);
			if (mountedRef.current) {
				setAnnotations(data.annotations);
				setError(null);
			}
		} catch (err) {
			if (mountedRef.current) {
				setError(err instanceof Error ? err.message : "Failed to fetch annotations");
			}
		} finally {
			if (mountedRef.current) {
				setLoading(false);
			}
		}
	}, [sessionId]);

	// Track recently resolved annotations for animation (auto-clears after 3s)
	const markResolved = useCallback((id: string) => {
		setRecentlyResolved((prev) => new Set(prev).add(id));
		const timer = setTimeout(() => {
			setRecentlyResolved((prev) => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
			resolvedTimersRef.current.delete(id);
		}, 3000);
		// Clear any existing timer for this id
		const existing = resolvedTimersRef.current.get(id);
		if (existing) clearTimeout(existing);
		resolvedTimersRef.current.set(id, timer);
	}, []);

	// Cleanup timers on unmount
	useEffect(() => {
		return () => {
			for (const timer of resolvedTimersRef.current.values()) {
				clearTimeout(timer);
			}
		};
	}, []);

	// Subscribe to SSE for real-time updates with auto-reconnect
	useEffect(() => {
		mountedRef.current = true;

		if (!sessionId) return;

		fetchAnnotations();

		let reconnectDelay = 1000;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		const handleAnnotationEvent = (event: MessageEvent) => {
			try {
				const annotation = JSON.parse(event.data) as MobileAnnotation;
				if (annotation.sessionId !== sessionId) return;

				setAnnotations((prev) => {
					const idx = prev.findIndex((a) => a.id === annotation.id);
					if (idx >= 0) {
						if (prev[idx].status !== "resolved" && annotation.status === "resolved") {
							markResolved(annotation.id);
						}
						const next = [...prev];
						next[idx] = annotation;
						return next;
					}
					return [...prev, annotation];
				});
			} catch {
				// ignore malformed events
			}
		};

		function connect() {
			if (!mountedRef.current) return;

			const eventsUrl = getEventsUrl();
			const eventSource = new EventSource(eventsUrl);
			eventSourceRef.current = eventSource;

			eventSource.addEventListener("annotation:created", handleAnnotationEvent);
			eventSource.addEventListener("annotation:status", handleAnnotationEvent);
			eventSource.addEventListener("annotation:reply", handleAnnotationEvent);
			eventSource.addEventListener("annotation:updated", handleAnnotationEvent);

			eventSource.onopen = () => {
				reconnectDelay = 1000; // Reset backoff on success
			};

			eventSource.onerror = () => {
				eventSource.close();
				eventSourceRef.current = null;
				if (mountedRef.current) {
					reconnectTimer = setTimeout(connect, reconnectDelay);
					reconnectDelay = Math.min(reconnectDelay * 2, 30000);
				}
			};
		}

		connect();

		return () => {
			mountedRef.current = false;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			eventSourceRef.current?.close();
			eventSourceRef.current = null;
		};
	}, [sessionId, fetchAnnotations, markResolved]);

	const createAnnotation = useCallback(
		async (payload: CreateAnnotationPayload): Promise<MobileAnnotation> => {
			const annotation = await apiFetch<MobileAnnotation>("/api/annotations", {
				method: "POST",
				body: JSON.stringify(payload),
			});
			setAnnotations((prev) => {
				// Guard against duplicates — SSE may have already added this annotation
				if (prev.some((a) => a.id === annotation.id)) return prev;
				return [...prev, annotation];
			});
			return annotation;
		},
		[],
	);

	const reply = useCallback(
		async (annotationId: string, content: string): Promise<MobileAnnotation> => {
			const annotation = await apiFetch<MobileAnnotation>(
				`/api/annotations/${annotationId}/reply`,
				{
					method: "POST",
					body: JSON.stringify({ role: "human", content }),
				},
			);
			setAnnotations((prev) => prev.map((a) => (a.id === annotation.id ? annotation : a)));
			return annotation;
		},
		[],
	);

	const updateStatus = useCallback(
		async (
			annotationId: string,
			action: "acknowledge" | "resolve" | "dismiss",
		): Promise<MobileAnnotation> => {
			const annotation = await apiFetch<MobileAnnotation>(
				`/api/annotations/${annotationId}/${action}`,
				{ method: "POST" },
			);
			setAnnotations((prev) => prev.map((a) => (a.id === annotation.id ? annotation : a)));
			return annotation;
		},
		[],
	);

	const deleteAnnotation = useCallback(async (annotationId: string): Promise<void> => {
		await apiFetch(`/api/annotations/${annotationId}`, { method: "DELETE" });
		setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
	}, []);

	return {
		annotations,
		loading,
		error,
		recentlyResolved,
		createAnnotation,
		reply,
		updateStatus,
		deleteAnnotation,
		refresh: fetchAnnotations,
	};
}
