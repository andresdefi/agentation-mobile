import { useState } from "react";
import { getBaseUrl } from "../api";
import type { MobileAnnotation } from "../types";
import { cn } from "../utils";
import { ScreenshotDiff } from "./ScreenshotDiff";

interface ThreadViewProps {
	annotation: MobileAnnotation;
	onReply: (annotationId: string, content: string) => Promise<void>;
	onClose: () => void;
	onUpdateStatus: (
		annotationId: string,
		action: "acknowledge" | "resolve" | "dismiss",
	) => Promise<void>;
}

function formatTime(timestamp: string): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function statusColor(status: string): string {
	switch (status) {
		case "pending":
			return "bg-yellow-500/20 text-yellow-400";
		case "acknowledged":
			return "bg-blue-500/20 text-blue-400";
		case "resolved":
			return "bg-green-500/20 text-green-400";
		case "dismissed":
			return "bg-neutral-500/20 text-neutral-400";
		default:
			return "bg-neutral-500/20 text-neutral-400";
	}
}

function intentColor(intent: string): string {
	switch (intent) {
		case "fix":
			return "text-red-400";
		case "change":
			return "text-amber-400";
		case "question":
			return "text-blue-400";
		case "approve":
			return "text-green-400";
		default:
			return "text-neutral-400";
	}
}

export function ThreadView({ annotation, onReply, onClose, onUpdateStatus }: ThreadViewProps) {
	const [replyText, setReplyText] = useState("");
	const [sending, setSending] = useState(false);

	const handleSendReply = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!replyText.trim() || sending) return;
		setSending(true);
		try {
			await onReply(annotation.id, replyText.trim());
			setReplyText("");
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
				<div className="flex items-center gap-2">
					<button
						onClick={onClose}
						className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
						aria-label="Close thread"
					>
						<svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M15 19l-7-7 7-7"
							/>
						</svg>
					</button>
					<h3 className="text-balance text-sm font-semibold text-neutral-100">Thread</h3>
				</div>
				<span
					className={cn(
						"rounded-md px-2 py-0.5 text-xs font-medium capitalize",
						statusColor(annotation.status),
					)}
				>
					{annotation.status}
				</span>
			</div>

			{/* Annotation summary */}
			<div className="border-b border-neutral-800 px-4 py-3">
				<p className="text-pretty text-sm text-neutral-200">{annotation.comment}</p>
				<div className="mt-2 flex items-center gap-3 text-xs">
					<span className={cn("font-medium capitalize", intentColor(annotation.intent))}>
						{annotation.intent}
					</span>
					<span className="text-neutral-500">{annotation.severity}</span>
					<span className="font-mono tabular-nums text-neutral-600">
						{annotation.x.toFixed(1)}%, {annotation.y.toFixed(1)}%
					</span>
				</div>
			</div>

			{/* Screenshot diff */}
			{annotation.screenshotId && annotation.resolvedScreenshotId && (
				<div className="border-b border-neutral-800 px-4 py-3">
					<ScreenshotDiff
						beforeId={annotation.screenshotId}
						afterId={annotation.resolvedScreenshotId}
						serverUrl={getBaseUrl()}
					/>
				</div>
			)}

			{/* Status actions */}
			{annotation.status !== "resolved" && annotation.status !== "dismissed" && (
				<div className="flex gap-2 border-b border-neutral-800 px-4 py-2">
					{annotation.status === "pending" && (
						<button
							onClick={() => onUpdateStatus(annotation.id, "acknowledge")}
							className="rounded-md bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20"
						>
							Acknowledge
						</button>
					)}
					<button
						onClick={() => onUpdateStatus(annotation.id, "resolve")}
						className="rounded-md bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/20"
					>
						Resolve
					</button>
					<button
						onClick={() => onUpdateStatus(annotation.id, "dismiss")}
						className="rounded-md bg-neutral-500/10 px-2.5 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-500/20"
					>
						Dismiss
					</button>
				</div>
			)}

			{/* Messages */}
			<div className="flex-1 overflow-y-auto px-4 py-3">
				{annotation.thread.length === 0 && (
					<p className="text-pretty py-8 text-center text-sm text-neutral-600">
						No messages yet. Start the conversation below.
					</p>
				)}
				<div className="flex flex-col gap-3">
					{annotation.thread.map((msg, i) => (
						<div
							key={`${msg.timestamp}-${i}`}
							className={cn(
								"flex flex-col gap-1",
								msg.role === "human" ? "items-start" : "items-end",
							)}
						>
							<div
								className={cn(
									"max-w-[85%] rounded-lg px-3 py-2 text-sm",
									msg.role === "human"
										? "bg-neutral-800 text-neutral-200"
										: "bg-neutral-700 text-neutral-100",
								)}
							>
								<p className="text-pretty">{msg.content}</p>
							</div>
							<span className="px-1 text-xs text-neutral-600">
								{msg.role === "human" ? "You" : "Agent"} -- {formatTime(msg.timestamp)}
							</span>
						</div>
					))}
				</div>
			</div>

			{/* Reply input */}
			<form onSubmit={handleSendReply} className="flex gap-2 border-t border-neutral-800 px-4 py-3">
				<input
					type="text"
					value={replyText}
					onChange={(e) => setReplyText(e.target.value)}
					placeholder="Type a reply..."
					className={cn(
						"flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600",
						"focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600",
					)}
				/>
				<button
					type="submit"
					disabled={!replyText.trim() || sending}
					className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Send
				</button>
			</form>
		</div>
	);
}
