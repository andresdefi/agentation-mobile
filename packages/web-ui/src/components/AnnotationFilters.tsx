import type { AnnotationIntent, AnnotationSeverity, AnnotationStatus } from "../types";
import { cn } from "../utils";

export interface Filters {
	status: AnnotationStatus | null;
	intent: AnnotationIntent | null;
	severity: AnnotationSeverity | null;
}

interface AnnotationFiltersProps {
	filters: Filters;
	onFiltersChange: (filters: Filters) => void;
}

const STATUS_OPTIONS: { value: AnnotationStatus; label: string; key: string }[] = [
	{ value: "pending", label: "Pending", key: "1" },
	{ value: "acknowledged", label: "Ack'd", key: "2" },
	{ value: "resolved", label: "Resolved", key: "3" },
	{ value: "dismissed", label: "Dismissed", key: "4" },
];

const INTENT_OPTIONS: { value: AnnotationIntent; label: string }[] = [
	{ value: "fix", label: "Fix" },
	{ value: "change", label: "Change" },
	{ value: "question", label: "Question" },
	{ value: "approve", label: "Approve" },
];

const SEVERITY_OPTIONS: { value: AnnotationSeverity; label: string }[] = [
	{ value: "blocking", label: "Blocking" },
	{ value: "important", label: "Important" },
	{ value: "suggestion", label: "Suggestion" },
];

function FilterChip({
	label,
	active,
	shortcut,
	onClick,
}: {
	label: string;
	active: boolean;
	shortcut?: string;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className={cn(
				"rounded-md px-2 py-0.5 text-xs transition-colors",
				active
					? "bg-neutral-700 text-neutral-200"
					: "bg-neutral-800/50 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-400",
			)}
		>
			{label}
			{shortcut && <span className="ml-1 text-neutral-600">{shortcut}</span>}
		</button>
	);
}

export function AnnotationFilters({ filters, onFiltersChange }: AnnotationFiltersProps) {
	const hasActiveFilters = filters.status || filters.intent || filters.severity;

	return (
		<div className="flex flex-col gap-1.5 border-b border-neutral-800 px-3 pb-2">
			{/* Status row */}
			<div className="flex flex-wrap gap-1">
				{STATUS_OPTIONS.map((opt) => (
					<FilterChip
						key={opt.value}
						label={opt.label}
						shortcut={opt.key}
						active={filters.status === opt.value}
						onClick={() =>
							onFiltersChange({
								...filters,
								status: filters.status === opt.value ? null : opt.value,
							})
						}
					/>
				))}
			</div>

			{/* Intent + Severity row */}
			<div className="flex flex-wrap gap-1">
				{INTENT_OPTIONS.map((opt) => (
					<FilterChip
						key={opt.value}
						label={opt.label}
						active={filters.intent === opt.value}
						onClick={() =>
							onFiltersChange({
								...filters,
								intent: filters.intent === opt.value ? null : opt.value,
							})
						}
					/>
				))}
				<span className="mx-0.5 self-center text-neutral-800">|</span>
				{SEVERITY_OPTIONS.map((opt) => (
					<FilterChip
						key={opt.value}
						label={opt.label}
						active={filters.severity === opt.value}
						onClick={() =>
							onFiltersChange({
								...filters,
								severity: filters.severity === opt.value ? null : opt.value,
							})
						}
					/>
				))}
			</div>

			{/* Clear filters */}
			{hasActiveFilters && (
				<button
					onClick={() => onFiltersChange({ status: null, intent: null, severity: null })}
					className="self-start text-xs text-neutral-600 hover:text-neutral-400"
				>
					Clear filters (Esc)
				</button>
			)}
		</div>
	);
}
