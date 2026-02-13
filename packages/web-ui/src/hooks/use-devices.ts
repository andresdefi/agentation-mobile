import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import type { DeviceInfo } from "../types";

interface UseDevicesOptions {
	/** When false, polling is paused (initial fetch still runs). Defaults to true. */
	enabled?: boolean;
}

interface UseDevicesResult {
	devices: DeviceInfo[];
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

export function useDevices(options: UseDevicesOptions = {}): UseDevicesResult {
	const { enabled = true } = options;
	const [devices, setDevices] = useState<DeviceInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const mountedRef = useRef(true);

	const fetchDevices = useCallback(async () => {
		try {
			const data = await apiFetch<DeviceInfo[]>("/api/devices");
			if (mountedRef.current) {
				setDevices(data);
				setError(null);
			}
		} catch (err) {
			if (mountedRef.current) {
				setError(err instanceof Error ? err.message : "Failed to fetch devices");
			}
		} finally {
			if (mountedRef.current) {
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		fetchDevices();

		if (!enabled) return;

		const interval = setInterval(fetchDevices, 5000);

		return () => {
			mountedRef.current = false;
			clearInterval(interval);
		};
	}, [fetchDevices, enabled]);

	return { devices, loading, error, refresh: fetchDevices };
}
