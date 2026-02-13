import { useCallback, useRef, useState } from "react";
import { getBaseUrl } from "../api";
import { cn } from "../utils";

interface ExportMenuProps {
	sessionId: string | null;
	disabled?: boolean;
}

export function ExportMenu({ sessionId, disabled }: ExportMenuProps) {
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const handleExport = useCallback(
		async (format: "json" | "markdown") => {
			if (!sessionId) return;
			setOpen(false);

			const baseUrl = getBaseUrl();
			const url = `${baseUrl}/api/sessions/${sessionId}/export?format=${format}`;

			try {
				const res = await fetch(url);
				if (!res.ok) {
					console.error(`Export failed: ${res.status}`);
					return;
				}

				const content = await res.text();
				const ext = format === "json" ? "json" : "md";
				const mimeType = format === "json" ? "application/json" : "text/markdown";

				const blob = new Blob([content], { type: mimeType });
				const downloadUrl = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = downloadUrl;
				a.download = `annotations-${sessionId}.${ext}`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(downloadUrl);
			} catch (err) {
				console.error("Export failed:", err);
			}
		},
		[sessionId],
	);

	return (
		<div className="relative" ref={menuRef}>
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				onBlur={(e) => {
					if (!menuRef.current?.contains(e.relatedTarget as Node)) {
						setOpen(false);
					}
				}}
				disabled={disabled || !sessionId}
				aria-label="Export annotations"
				className={cn(
					"flex size-8 items-center justify-center rounded-lg transition-colors",
					disabled || !sessionId
						? "cursor-not-allowed text-neutral-700"
						: "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200",
				)}
			>
				<svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/>
				</svg>
			</button>

			{open && (
				<div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
					<button
						type="button"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => handleExport("json")}
						className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
					>
						<svg
							className="size-3.5 shrink-0"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
							/>
						</svg>
						Export as JSON
					</button>
					<button
						type="button"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => handleExport("markdown")}
						className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
					>
						<svg
							className="size-3.5 shrink-0"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						Export as Markdown
					</button>
				</div>
			)}
		</div>
	);
}
