import { EventEmitter } from "node:events";

export type EventType =
	| "annotation:created"
	| "annotation:updated"
	| "annotation:status"
	| "annotation:reply"
	| "session:created";

export interface BusEvent {
	type: EventType;
	data: unknown;
	timestamp: string;
}

export class EventBus extends EventEmitter {
	emit(type: EventType, data: unknown): boolean {
		const event: BusEvent = {
			type,
			data,
			timestamp: new Date().toISOString(),
		};
		return super.emit("event", event);
	}

	onEvent(handler: (event: BusEvent) => void): void {
		this.on("event", handler);
	}

	offEvent(handler: (event: BusEvent) => void): void {
		this.off("event", handler);
	}
}
