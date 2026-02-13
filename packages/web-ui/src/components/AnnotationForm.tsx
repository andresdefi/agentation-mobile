import { useState } from "react";
import type { AnnotationIntent, AnnotationSeverity } from "../types";
import { cn } from "../utils";

interface AnnotationFormProps {
	x: number;
	y: number;
	onSubmit: (data: {
		comment: string;
		intent: AnnotationIntent;
		severity: AnnotationSeverity;
	}) => void;
	onCancel: () => void;
	submitting: boolean;
}

const INTENTS: { value: AnnotationIntent; label: string }[] = [
	{ value: "fix", label: "Fix" },
	{ value: "change", label: "Change" },
	{ value: "question", label: "Question" },
	{ value: "approve", label: "Approve" },
];

const SEVERITIES: { value: AnnotationSeverity; label: string }[] = [
	{ value: "blocking", label: "Blocking" },
	{ value: "important", label: "Important" },
	{ value: "suggestion", label: "Suggestion" },
];

export function AnnotationForm({ x, y, onSubmit, onCancel, submitting }: AnnotationFormProps) {
	const [comment, setComment] = useState("");
	const [intent, setIntent] = useState<AnnotationIntent>("fix");
	const [severity, setSeverity] = useState<AnnotationSeverity>("important");

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!comment.trim()) return;
		onSubmit({ comment: comment.trim(), intent, severity });
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<form
				onSubmit={handleSubmit}
				className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-lg"
			>
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-balance text-lg font-semibold text-neutral-100">New Annotation</h3>
					<span className="rounded-md bg-neutral-800 px-2 py-0.5 font-mono text-xs tabular-nums text-neutral-400">
						{x.toFixed(1)}%, {y.toFixed(1)}%
					</span>
				</div>

				<div className="flex flex-col gap-4">
					{/* Comment */}
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="annotation-comment"
							className="text-xs font-medium uppercase tracking-wide text-neutral-500"
						>
							Comment
						</label>
						<textarea
							id="annotation-comment"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="Describe the issue or feedback..."
							rows={3}
							autoFocus
							className={cn(
								"w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600",
								"focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600",
							)}
						/>
					</div>

					{/* Intent */}
					<fieldset className="flex flex-col gap-1.5">
						<legend className="text-xs font-medium uppercase tracking-wide text-neutral-500">
							Intent
						</legend>
						<div className="flex gap-2">
							{INTENTS.map((item) => (
								<label
									key={item.value}
									className={cn(
										"flex-1 cursor-pointer rounded-lg border px-3 py-1.5 text-center text-sm transition-colors",
										intent === item.value
											? "border-neutral-500 bg-neutral-800 text-neutral-100"
											: "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700",
									)}
								>
									<input
										type="radio"
										name="intent"
										value={item.value}
										checked={intent === item.value}
										onChange={() => setIntent(item.value)}
										className="sr-only"
									/>
									{item.label}
								</label>
							))}
						</div>
					</fieldset>

					{/* Severity */}
					<fieldset className="flex flex-col gap-1.5">
						<legend className="text-xs font-medium uppercase tracking-wide text-neutral-500">
							Severity
						</legend>
						<div className="flex gap-2">
							{SEVERITIES.map((item) => (
								<label
									key={item.value}
									className={cn(
										"flex-1 cursor-pointer rounded-lg border px-3 py-1.5 text-center text-sm transition-colors",
										severity === item.value
											? "border-neutral-500 bg-neutral-800 text-neutral-100"
											: "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700",
									)}
								>
									<input
										type="radio"
										name="severity"
										value={item.value}
										checked={severity === item.value}
										onChange={() => setSeverity(item.value)}
										className="sr-only"
									/>
									{item.label}
								</label>
							))}
						</div>
					</fieldset>
				</div>

				{/* Actions */}
				<div className="mt-6 flex gap-3">
					<button
						type="button"
						onClick={onCancel}
						disabled={submitting}
						className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-300 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!comment.trim() || submitting}
						className="flex-1 rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{submitting ? "Creating..." : "Create"}
					</button>
				</div>
			</form>
		</div>
	);
}
