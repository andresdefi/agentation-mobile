import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getEventsUrl } from "../api";
import type { CreateAnnotationPayload, MobileAnnotation, SessionWithAnnotations } from "../types";

interface UseAnnotationsResult {
	annotations: MobileAnnotation[];
	loading: boolean;
	error: string | null;
	createAnnotation: (payload: CreateAnnotationPayload) => Promise<MobileAnnotation>;
	reply: (annotationId: string, content: string) => Promise<MobileAnnotation>;
	updateStatus: (
		annotationId: string,
		action: "acknowledge" | "resolve" | "dismiss",
	) => Promise<MobileAnnotation>;
	refresh: () => Promise<void>;
}

export function useAnnotations(sessionId: string | null): UseAnnotationsResult {
	const [annotations, setAnnotations] = useState<MobileAnnotation[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const mountedRef = useRef(true);
	const eventSourceRef = useRef<EventSource | null>(null);

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

	// Subscribe to SSE for real-time updates
	useEffect(() => {
		mountedRef.current = true;

		if (!sessionId) return;

		fetchAnnotations();

		const eventsUrl = getEventsUrl();
		const eventSource = new EventSource(eventsUrl);
		eventSourceRef.current = eventSource;

		const handleAnnotationEvent = (event: MessageEvent) => {
			try {
				const annotation = JSON.parse(event.data) as MobileAnnotation;
				if (annotation.sessionId !== sessionId) return;

				setAnnotations((prev) => {
					const idx = prev.findIndex((a) => a.id === annotation.id);
					if (idx >= 0) {
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

		eventSource.addEventListener("annotation:created", handleAnnotationEvent);
		eventSource.addEventListener("annotation:status", handleAnnotationEvent);
		eventSource.addEventListener("annotation:reply", handleAnnotationEvent);
		eventSource.addEventListener("annotation:updated", handleAnnotationEvent);

		eventSource.onerror = () => {
			// EventSource will automatically reconnect
		};

		return () => {
			mountedRef.current = false;
			eventSource.close();
			eventSourceRef.current = null;
		};
	}, [sessionId, fetchAnnotations]);

	const createAnnotation = useCallback(
		async (payload: CreateAnnotationPayload): Promise<MobileAnnotation> => {
			const annotation = await apiFetch<MobileAnnotation>("/api/annotations", {
				method: "POST",
				body: JSON.stringify(payload),
			});
			setAnnotations((prev) => [...prev, annotation]);
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

	return {
		annotations,
		loading,
		error,
		createAnnotation,
		reply,
		updateStatus,
		refresh: fetchAnnotations,
	};
}
