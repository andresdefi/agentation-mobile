import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { MobileElement } from "../types";

interface UseElementTreeResult {
	elements: MobileElement[];
	loading: boolean;
	error: string | null;
	refresh: () => void;
}

export function useElementTree(deviceId: string | null): UseElementTreeResult {
	const [elements, setElements] = useState<MobileElement[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchElements = useCallback(async () => {
		if (!deviceId) {
			setElements([]);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const data = await apiFetch<MobileElement[]>(
				`/api/devices/${encodeURIComponent(deviceId)}/elements`,
			);
			setElements(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch element tree");
			setElements([]);
		} finally {
			setLoading(false);
		}
	}, [deviceId]);

	useEffect(() => {
		fetchElements();
	}, [fetchElements]);

	return { elements, loading, error, refresh: fetchElements };
}
