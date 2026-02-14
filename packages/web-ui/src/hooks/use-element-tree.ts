import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import type { MobileElement } from "../types";

interface ElementTreeResponse {
	elements: MobileElement[];
	screenId: string | null;
}

interface UseElementTreeResult {
	elements: MobileElement[];
	screenId: string | null;
	loading: boolean;
	error: string | null;
	refresh: () => void;
}

export function useElementTree(deviceId: string | null, platform?: string): UseElementTreeResult {
	const [elements, setElements] = useState<MobileElement[]>([]);
	const [screenId, setScreenId] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fetchingRef = useRef(false);

	const fetchElements = useCallback(async () => {
		if (!deviceId) {
			setElements([]);
			setScreenId(null);
			return;
		}
		// Prevent concurrent fetches
		if (fetchingRef.current) {
			console.log("[element-tree] skipped refresh — fetch already in progress");
			return;
		}
		fetchingRef.current = true;
		setLoading(true);
		setError(null);
		try {
			const params = platform ? `?platform=${encodeURIComponent(platform)}` : "";
			const data = await apiFetch<ElementTreeResponse>(
				`/api/devices/${encodeURIComponent(deviceId)}/elements${params}`,
			);
			console.log(
				`[element-tree] fetched screenId=${data.screenId} elements=${data.elements.length}`,
			);
			setElements(data.elements);
			setScreenId(data.screenId);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch element tree");
			setElements([]);
			setScreenId(null);
		} finally {
			setLoading(false);
			fetchingRef.current = false;
		}
	}, [deviceId, platform]);

	useEffect(() => {
		fetchElements();
	}, [fetchElements]);

	return { elements, screenId, loading, error, refresh: fetchElements };
}
