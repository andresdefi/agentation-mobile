const DEFAULT_BASE_URL = "http://localhost:4747";

function getBaseUrl(): string {
	if (typeof window !== "undefined") {
		const custom = (window as unknown as Record<string, unknown>)
			.__API_BASE_URL__;
		if (typeof custom === "string" && custom.length > 0) {
			return custom;
		}
	}
	return DEFAULT_BASE_URL;
}

export async function apiFetch<T>(
	path: string,
	options?: RequestInit,
): Promise<T> {
	const baseUrl = getBaseUrl();
	const url = `${baseUrl}${path}`;
	const response = await fetch(url, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`API error ${response.status}: ${body}`);
	}
	return response.json() as Promise<T>;
}

export function getEventsUrl(): string {
	return `${getBaseUrl()}/api/events`;
}

export function getWebSocketUrl(deviceId: string): string {
	const baseUrl = getBaseUrl();
	const wsUrl = baseUrl.replace(/^http/, "ws");
	return `${wsUrl}/ws/screen?deviceId=${encodeURIComponent(deviceId)}`;
}

export { getBaseUrl };
