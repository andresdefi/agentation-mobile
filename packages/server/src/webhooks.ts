import type { BusEvent, EventBus } from "./event-bus";

export interface WebhookConfig {
	url: string;
	events?: string[];
	secret?: string;
}

/** Max retries per webhook delivery attempt. */
const MAX_RETRIES = 2;
/** Delay between retries (ms). */
const RETRY_DELAY = 1000;

async function signPayload(body: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const hex = Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `sha256=${hex}`;
}

async function deliverWebhook(webhook: WebhookConfig, event: BusEvent): Promise<void> {
	const body = JSON.stringify(event);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Agentation-Event": event.type,
		"X-Agentation-Sequence": String(event.sequence),
	};

	if (webhook.secret) {
		headers["X-Agentation-Signature"] = await signPayload(body, webhook.secret);
	}

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(webhook.url, {
				method: "POST",
				headers,
				body,
				signal: AbortSignal.timeout(10_000),
			});
			if (res.ok || res.status < 500) return;
			// Server error — retry
		} catch {
			// Network error — retry
		}
		if (attempt < MAX_RETRIES) {
			await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
		}
	}
	throw new Error(`All ${MAX_RETRIES + 1} delivery attempts failed`);
}

export function setupWebhooks(eventBus: EventBus, webhooks: WebhookConfig[]) {
	if (webhooks.length === 0) return;

	eventBus.onEvent((event: BusEvent) => {
		for (const webhook of webhooks) {
			if (webhook.events && !webhook.events.includes(event.type)) continue;
			deliverWebhook(webhook, event).catch((err) => {
				console.warn(
					`[webhook] delivery failed for ${webhook.url} (${event.type}):`,
					err instanceof Error ? err.message : err,
				);
			});
		}
	});
}
