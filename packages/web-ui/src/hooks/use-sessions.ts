import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import type { Session } from "../types";

interface UseSessionsResult {
	sessions: Session[];
	loading: boolean;
	error: string | null;
	createSession: (
		name: string,
		deviceId: string,
		platform: string,
	) => Promise<Session>;
	refresh: () => Promise<void>;
}

export function useSessions(): UseSessionsResult {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const mountedRef = useRef(true);

	const fetchSessions = useCallback(async () => {
		try {
			const data = await apiFetch<Session[]>("/api/sessions");
			if (mountedRef.current) {
				setSessions(data);
				setError(null);
			}
		} catch (err) {
			if (mountedRef.current) {
				setError(
					err instanceof Error ? err.message : "Failed to fetch sessions",
				);
			}
		} finally {
			if (mountedRef.current) {
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		fetchSessions();
		return () => {
			mountedRef.current = false;
		};
	}, [fetchSessions]);

	const createSession = useCallback(
		async (
			name: string,
			deviceId: string,
			platform: string,
		): Promise<Session> => {
			const session = await apiFetch<Session>("/api/sessions", {
				method: "POST",
				body: JSON.stringify({ name, deviceId, platform }),
			});
			setSessions((prev) => [...prev, session]);
			return session;
		},
		[],
	);

	return { sessions, loading, error, createSession, refresh: fetchSessions };
}
