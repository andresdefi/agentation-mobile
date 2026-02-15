import { useCallback, useRef, useState } from "react";
import type { CapturedPage } from "../types";
import { cn } from "../utils";

interface PageGalleryProps {
	pages: CapturedPage[];
	activePageId: string | null;
	onSelectPage: (id: string | null) => void;
	onDeletePage: (id: string) => void;
	onRenamePage: (id: string, label: string) => void;
}

export function PageGallery({
	pages,
	activePageId,
	onSelectPage,
	onDeletePage,
	onRenamePage,
}: PageGalleryProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleStartRename = useCallback((e: React.MouseEvent, id: string) => {
		e.stopPropagation();
		setEditingId(id);
		requestAnimationFrame(() => inputRef.current?.select());
	}, []);

	const handleFinishRename = useCallback(
		(id: string, value: string) => {
			const trimmed = value.trim();
			if (trimmed) onRenamePage(id, trimmed);
			setEditingId(null);
		},
		[onRenamePage],
	);

	if (pages.length === 0) return null;

	return (
		<div className="flex w-20 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
			{/* Live view button */}
			<button
				type="button"
				onClick={() => onSelectPage(null)}
				className={cn(
					"mx-1.5 mt-1.5 flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 p-2 text-xs font-medium transition-colors",
					activePageId === null
						? "border-blue-500 bg-blue-500/10 text-blue-400"
						: "border-transparent text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
				)}
				title="Live view"
				aria-label="Switch to live view"
			>
				<svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
					/>
				</svg>
				<span className="text-[10px] leading-none">Live</span>
			</button>

			{/* Divider */}
			<div className="mx-3 my-1.5 h-px bg-neutral-700" />

			{/* Scrollable thumbnails */}
			<div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
				{pages.map((page, idx) => {
					const isActive = activePageId === page.id;
					const label = page.label ?? `Screen ${idx + 1}`;

					return (
						<div key={page.id} className="group relative shrink-0">
							<button
								type="button"
								onClick={() => onSelectPage(page.id)}
								className={cn(
									"relative w-full overflow-hidden rounded-lg border-2 transition-colors",
									isActive ? "border-blue-500" : "border-transparent hover:border-neutral-600",
								)}
								title={label}
								aria-label={`View ${label}`}
							>
								<img
									src={page.screenshotUrl}
									alt={label}
									className="w-full object-contain"
									draggable={false}
								/>
							</button>

							{/* Label */}
							<div className="mt-0.5 flex items-center justify-center">
								{editingId === page.id ? (
									<input
										ref={inputRef}
										defaultValue={label}
										className="w-full rounded bg-neutral-800 px-1 text-center text-[10px] text-neutral-200 outline-none ring-1 ring-blue-500"
										onBlur={(e) => handleFinishRename(page.id, e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") handleFinishRename(page.id, e.currentTarget.value);
											if (e.key === "Escape") setEditingId(null);
										}}
									/>
								) : (
									<span
										className="max-w-full cursor-pointer truncate text-[10px] text-neutral-500 hover:text-neutral-300"
										onDoubleClick={(e) => handleStartRename(e, page.id)}
										title="Double-click to rename"
									>
										{label}
									</span>
								)}
							</div>

							{/* Delete button */}
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onDeletePage(page.id);
								}}
								className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 hover:bg-red-600 hover:text-white group-hover:flex"
								aria-label={`Delete ${label}`}
							>
								<svg className="size-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={3}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
