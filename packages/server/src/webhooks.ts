import type { BusEvent, EventBus } from "./event-bus";

export interface WebhookConfig {
	url: string;
	events?: string[];
	secret?: string;
}

export function setupWebhooks(eventBus: EventBus, webhooks: WebhookConfig[]) {
	if (webhooks.length === 0) return;

	eventBus.onEvent(async (event: BusEvent) => {
		for (const webhook of webhooks) {
			if (webhook.events && !webhook.events.includes(event.type)) continue;

			try {
				const body = JSON.stringify(event);
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
					"X-Agentation-Event": event.type,
				};

				if (webhook.secret) {
					const encoder = new TextEncoder();
					const key = await crypto.subtle.importKey(
						"raw",
						encoder.encode(webhook.secret),
						{ name: "HMAC", hash: "SHA-256" },
						false,
						["sign"],
					);
					const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
					const hex = Array.from(new Uint8Array(signature))
						.map((b) => b.toString(16).padStart(2, "0"))
						.join("");
					headers["X-Agentation-Signature"] = `sha256=${hex}`;
				}

				await fetch(webhook.url, {
					method: "POST",
					headers,
					body,
					signal: AbortSignal.timeout(10_000),
				});
			} catch {
				// Webhook delivery failures are non-fatal
			}
		}
	});
}
