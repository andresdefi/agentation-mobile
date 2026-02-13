import { cn } from "../utils";
import type { MobileAnnotation } from "../types";

interface AnnotationPanelProps {
	annotations: MobileAnnotation[];
	selectedAnnotationId: string | null;
	onSelectAnnotation: (annotation: MobileAnnotation) => void;
	loading: boolean;
}

function statusBadgeClasses(status: string): string {
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

function intentIcon(intent: string): string {
	switch (intent) {
		case "fix":
			return "!";
		case "change":
			return "~";
		case "question":
			return "?";
		case "approve":
			return "+";
		default:
			return "-";
	}
}

function intentColor(intent: string): string {
	switch (intent) {
		case "fix":
			return "text-red-400 bg-red-500/10";
		case "change":
			return "text-amber-400 bg-amber-500/10";
		case "question":
			return "text-blue-400 bg-blue-500/10";
		case "approve":
			return "text-green-400 bg-green-500/10";
		default:
			return "text-neutral-400 bg-neutral-500/10";
	}
}

function severityLabel(severity: string): string {
	switch (severity) {
		case "blocking":
			return "BLK";
		case "important":
			return "IMP";
		case "suggestion":
			return "SUG";
		default:
			return severity.toUpperCase().slice(0, 3);
	}
}

function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AnnotationPanel({
	annotations,
	selectedAnnotationId,
	onSelectAnnotation,
	loading,
}: AnnotationPanelProps) {
	if (loading) {
		return (
			<div className="flex flex-col gap-2 px-3 py-4">
				{[1, 2, 3].map((n) => (
					<div
						key={n}
						className="h-20 animate-pulse rounded-lg bg-neutral-800/50"
					/>
				))}
			</div>
		);
	}

	if (annotations.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center px-4 py-12">
				<div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-neutral-800/50">
					<svg
						className="size-6 text-neutral-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
						/>
					</svg>
				</div>
				<p className="text-pretty text-center text-sm text-neutral-500">
					No annotations yet. Click on the screen to create one.
				</p>
			</div>
		);
	}

	// Sort: pending first, then by createdAt descending
	const sorted = [...annotations].sort((a, b) => {
		const statusOrder: Record<string, number> = {
			pending: 0,
			acknowledged: 1,
			resolved: 2,
			dismissed: 3,
		};
		const statusDiff =
			(statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
		if (statusDiff !== 0) return statusDiff;
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});

	return (
		<div className="flex flex-col gap-1.5 overflow-y-auto px-2 py-2">
			{sorted.map((annotation) => (
				<button
					key={annotation.id}
					onClick={() => onSelectAnnotation(annotation)}
					className={cn(
						"flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
						selectedAnnotationId === annotation.id
							? "border-neutral-600 bg-neutral-800"
							: "border-transparent bg-neutral-900 hover:border-neutral-800 hover:bg-neutral-850",
					)}
				>
					{/* Top row: intent icon + comment */}
					<div className="flex items-start gap-2">
						<span
							className={cn(
								"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded font-mono text-xs font-bold",
								intentColor(annotation.intent),
							)}
						>
							{intentIcon(annotation.intent)}
						</span>
						<p className="line-clamp-2 flex-1 text-sm text-neutral-200">
							{annotation.comment}
						</p>
					</div>

					{/* Bottom row: status badge, severity, thread count, time */}
					<div className="flex items-center gap-2 pl-7">
						<span
							className={cn(
								"rounded px-1.5 py-0.5 text-xs font-medium capitalize",
								statusBadgeClasses(annotation.status),
							)}
						>
							{annotation.status}
						</span>
						<span className="text-xs text-neutral-600">
							{severityLabel(annotation.severity)}
						</span>
						{annotation.thread.length > 0 && (
							<span className="text-xs text-neutral-600">
								{annotation.thread.length} msg{annotation.thread.length !== 1 ? "s" : ""}
							</span>
						)}
						<span className="ml-auto text-xs tabular-nums text-neutral-700">
							{formatTimestamp(annotation.createdAt)}
						</span>
					</div>
				</button>
			))}
		</div>
	);
}
