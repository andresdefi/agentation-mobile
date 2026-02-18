import { EventEmitter } from "node:events";

export type EventType =
	| "annotation.created"
	| "annotation.updated"
	| "annotation.deleted"
	| "thread.message"
	| "session.created"
	| "session.updated"
	| "session.closed"
	| "action.requested"
	| "recording.started"
	| "recording.stopped";

export interface BusEvent {
	type: EventType;
	data: unknown;
	timestamp: string;
	sequence: number;
	sessionId?: string;
	deviceId?: string;
}

/** Default event retention period in days. */
const DEFAULT_EVENT_RETENTION_DAYS = 7;

/** Maximum number of events to retain for replay. */
const DEFAULT_MAX_EVENTS = 1000;

let eventRetentionDays =
	Number(process.env.AGENTATION_MOBILE_EVENT_RETENTION_DAYS) || DEFAULT_EVENT_RETENTION_DAYS;

export function getEventRetentionDays(): number {
	return eventRetentionDays;
}

export function setEventRetentionDays(days: number): void {
	eventRetentionDays = days;
}

export class EventBus extends EventEmitter {
	private sequenceCounter = 0;
	private readonly eventLog: BusEvent[] = [];
	private readonly maxEvents: number;

	constructor(options?: { maxEvents?: number }) {
		super();
		this.maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;
	}

	/** Restore the sequence counter (e.g. from a persisted store on startup). */
	setSequence(seq: number): void {
		this.sequenceCounter = seq;
	}

	emit(type: EventType, data: unknown, sessionId?: string, deviceId?: string): boolean {
		const event: BusEvent = {
			type,
			data,
			timestamp: new Date().toISOString(),
			sequence: ++this.sequenceCounter,
			sessionId,
			deviceId,
		};

		// Store for replay
		this.eventLog.push(event);
		if (this.eventLog.length > this.maxEvents) {
			this.eventLog.shift();
		}

		return super.emit("event", event);
	}

	onEvent(handler: (event: BusEvent) => void): void {
		this.on("event", handler);
	}

	offEvent(handler: (event: BusEvent) => void): void {
		this.off("event", handler);
	}

	/**
	 * Get all events since the given sequence number.
	 * Optionally filter by sessionId.
	 */
	getEventsSince(sinceSequence: number, sessionId?: string): BusEvent[] {
		return this.eventLog.filter((e) => {
			if (e.sequence <= sinceSequence) return false;
			if (sessionId && e.sessionId !== sessionId) return false;
			return true;
		});
	}

	get currentSequence(): number {
		return this.sequenceCounter;
	}
}
