import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileElement, SelectedArea } from "../types";
import { cn, getElementDisplayName } from "../utils";

interface AnnotationFormProps {
	x: number;
	y: number;
	anchorX: number;
	anchorY: number;
	element?: MobileElement | null;
	inspectingElement?: boolean;
	selectedArea?: SelectedArea;
	selectedText?: string;
	onSubmit: (comment: string) => void;
	onCancel: () => void;
	submitting: boolean;
}

const POPUP_WIDTH = 280;
const POPUP_HEIGHT_ESTIMATE = 290;

export function AnnotationForm({
	x,
	y,
	anchorX,
	anchorY,
	element,
	inspectingElement,
	selectedArea,
	selectedText,
	onSubmit,
	onCancel,
	submitting,
}: AnnotationFormProps) {
	const [comment, setComment] = useState("");
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [animState, setAnimState] = useState<"initial" | "enter" | "entered" | "exit">("initial");
	const [isShaking, setIsShaking] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Animate in on mount
	useEffect(() => {
		requestAnimationFrame(() => setAnimState("enter"));
		const timer = setTimeout(() => setAnimState("entered"), 200);
		return () => clearTimeout(timer);
	}, []);

	// Focus textarea after mount
	useEffect(() => {
		const timer = setTimeout(() => textareaRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, []);

	const shake = useCallback(() => {
		setIsShaking(true);
		setTimeout(() => {
			setIsShaking(false);
			textareaRef.current?.focus();
		}, 250);
	}, []);

	const handleCancel = useCallback(() => {
		setAnimState("exit");
		setTimeout(() => onCancel(), 150);
	}, [onCancel]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!comment.trim()) return;
		onSubmit(comment.trim());
	};

	// Click outside → shake (not dismiss)
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (formRef.current && !formRef.current.contains(e.target as Node)) {
				e.preventDefault();
				e.stopPropagation();
				shake();
			}
		};
		document.addEventListener("click", handleClickOutside, true);
		return () => document.removeEventListener("click", handleClickOutside, true);
	}, [shake]);

	// Centered below click point, flip above if near bottom edge
	const clampedX = Math.max(
		POPUP_WIDTH / 2 + 20,
		Math.min(window.innerWidth - POPUP_WIDTH / 2 - 20, anchorX),
	);
	const flipY = anchorY > window.innerHeight - POPUP_HEIGHT_ESTIMATE;

	const popupStyle: React.CSSProperties = {
		position: "fixed",
		left: clampedX,
		width: POPUP_WIDTH,
		zIndex: 50,
		...(flipY ? { bottom: window.innerHeight - anchorY + 20 } : { top: anchorY + 20 }),
		...(animState === "enter"
			? { animation: "popup-enter 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }
			: animState === "entered" && isShaking
				? { animation: "popup-shake 0.25s ease-out", transform: "translateX(-50%)" }
				: animState === "entered"
					? { opacity: 1, transform: "translateX(-50%) scale(1) translateY(0)" }
					: animState === "exit"
						? { animation: "popup-exit 0.15s ease-in forwards" }
						: { opacity: 0, transform: "translateX(-50%)" }),
	};

	const headerText =
		!inspectingElement && element ? getElementDisplayName(element) : "New Annotation";

	return (
		<form
			ref={formRef}
			onSubmit={handleSubmit}
			style={popupStyle}
			className="rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					handleCancel();
				}
			}}
		>
			{/* Header */}
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-balance text-sm font-semibold text-neutral-100">
					{inspectingElement ? (
						<span className="flex items-center gap-2">
							<span className="size-3 animate-spin rounded-full border border-neutral-700 border-t-neutral-400" />
							<span className="text-neutral-500">Inspecting...</span>
						</span>
					) : (
						headerText
					)}
				</h3>
				<span className="rounded-md bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-neutral-500">
					{x.toFixed(0)}%, {y.toFixed(0)}%
				</span>
			</div>

			{/* Expandable details */}
			{!inspectingElement && element && (
				<div className="mb-3">
					<button
						type="button"
						onClick={() => setDetailsOpen((v) => !v)}
						className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
					>
						<svg
							className={cn("size-3 transition-transform", detailsOpen && "rotate-90")}
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
						Details
					</button>
					{detailsOpen && (
						<div className="mt-1.5 space-y-0.5 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2">
							{element.componentPath && (
								<p className="truncate font-mono text-[11px] text-neutral-500">
									{element.componentPath}
								</p>
							)}
							{element.componentFile && (
								<p className="truncate font-mono text-[11px] text-neutral-400">
									{element.componentFile}
									{element.sourceLocation && `:${element.sourceLocation.line}`}
								</p>
							)}
							{element.styleProps && Object.keys(element.styleProps).length > 0 && (
								<div className="mt-1 border-t border-neutral-800 pt-1">
									{Object.entries(element.styleProps)
										.slice(0, 4)
										.map(([key, val]) => (
											<p key={key} className="truncate font-mono text-[11px] text-neutral-600">
												{key}: {String(val)}
											</p>
										))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Selected text indicator */}
			{selectedArea == null && selectedText && (
				<div className="mb-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-2.5 py-1.5">
					<p className="line-clamp-2 text-xs text-neutral-200">&ldquo;{selectedText}&rdquo;</p>
				</div>
			)}

			{/* Selected area indicator */}
			{selectedArea && (
				<div className="mb-3">
					<span className="rounded-md bg-blue-900/50 px-2 py-0.5 font-mono text-xs tabular-nums text-blue-400">
						{selectedArea.width.toFixed(0)}% x {selectedArea.height.toFixed(0)}% area
					</span>
				</div>
			)}

			{/* Textarea */}
			<textarea
				ref={textareaRef}
				value={comment}
				onChange={(e) => setComment(e.target.value)}
				placeholder="What should change?"
				rows={2}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						if (comment.trim()) {
							onSubmit(comment.trim());
						}
					}
				}}
				className={cn(
					"mb-3 w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600",
					"focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600",
				)}
			/>

			{/* Buttons */}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleCancel}
					disabled={submitting}
					className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-300 disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={!comment.trim() || submitting}
					className="flex-1 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{submitting ? "Adding..." : "Add"}
				</button>
			</div>
		</form>
	);
}
