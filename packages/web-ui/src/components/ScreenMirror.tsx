import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TextRegion } from "../hooks/use-ocr";
import type { MobileAnnotation, MobileElement, SelectedArea } from "../types";
import { cn, getElementDisplayName, hitTestElement } from "../utils";

export type InteractionMode = "point" | "area" | "text" | "remote";

interface ScreenMirrorProps {
	frameUrl: string | null;
	connected: boolean;
	error: string | null;
	annotations: MobileAnnotation[];
	selectedAnnotationId: string | null;
	recentlyResolved?: Set<string>;
	interactionMode: InteractionMode;
	textRegions?: TextRegion[];
	ocrLoading?: boolean;
	markersHidden?: boolean;
	overrideFrameUrl?: string | null;
	elements?: MobileElement[];
	screenWidth?: number;
	screenHeight?: number;
	pendingElement?: MobileElement | null;
	onClickScreen: (x: number, y: number, anchorX: number, anchorY: number) => void;
	onAreaSelect: (area: SelectedArea) => void;
	onTextSelect: (region: TextRegion) => void;
	onSelectAnnotation: (annotation: MobileAnnotation) => void;
	onRemoteTap?: (xPct: number, yPct: number) => void;
	onRemoteSwipe?: (fromXPct: number, fromYPct: number, toXPct: number, toYPct: number) => void;
}

function pinColor(status: string): string {
	switch (status) {
		case "pending":
			return "bg-yellow-500 border-yellow-300";
		case "acknowledged":
			return "bg-blue-500 border-blue-300";
		case "resolved":
			return "bg-green-500 border-green-300";
		case "dismissed":
			return "bg-neutral-500 border-neutral-400";
		default:
			return "bg-neutral-500 border-neutral-400";
	}
}

function ResolvedPin({
	annotation,
	index,
	isSelected,
	onSelect,
}: {
	annotation: MobileAnnotation;
	index: number;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const prefersReducedMotion = useReducedMotion();

	if (prefersReducedMotion) {
		return (
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onSelect();
				}}
				className={cn(
					"absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold text-white shadow-md",
					"bg-green-500 border-green-300",
					isSelected && "scale-125 ring-2 ring-white/30",
				)}
				style={{
					left: `${annotation.x}%`,
					top: `${annotation.y}%`,
				}}
				aria-label={`Resolved: ${annotation.comment}`}
			>
				<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
				</svg>
			</button>
		);
	}

	return (
		<motion.button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				onSelect();
			}}
			className={cn(
				"absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold text-white shadow-md",
				"bg-green-500 border-green-300",
				isSelected && "ring-2 ring-white/30",
			)}
			style={{
				left: `${annotation.x}%`,
				top: `${annotation.y}%`,
			}}
			initial={{ scale: 1 }}
			animate={{
				scale: [1, 1.5, 1.1],
			}}
			transition={{
				duration: 0.4,
				ease: "easeOut",
				times: [0, 0.5, 1],
			}}
			aria-label={`Resolved: ${annotation.comment}`}
		>
			<motion.div
				initial={{ opacity: 0, scale: 0 }}
				animate={{ opacity: 1, scale: 1 }}
				transition={{ delay: 0.1, duration: 0.2 }}
			>
				<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
				</svg>
			</motion.div>
		</motion.button>
	);
}

export function ScreenMirror({
	frameUrl,
	connected,
	error,
	annotations,
	selectedAnnotationId,
	recentlyResolved,
	interactionMode,
	textRegions,
	ocrLoading,
	markersHidden,
	overrideFrameUrl,
	elements,
	screenWidth,
	screenHeight,
	pendingElement,
	onClickScreen,
	onAreaSelect,
	onTextSelect,
	onSelectAnnotation,
	onRemoteTap,
	onRemoteSwipe,
}: ScreenMirrorProps) {
	const imageRef = useRef<HTMLImageElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [hoveredPin, setHoveredPin] = useState<string | null>(null);

	// Hover highlight state
	const [hoveredElement, setHoveredElement] = useState<MobileElement | null>(null);
	const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
	const rafRef = useRef<number | null>(null);

	// Cancel pending RAF on unmount
	useEffect(() => {
		return () => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
		};
	}, []);

	// Drag state for area selection
	const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
	const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
	const isDragging = dragStart !== null && dragCurrent !== null;

	// Remote mode: swipe gesture tracking
	const [remoteSwipeStart, setRemoteSwipeStart] = useState<{ x: number; y: number } | null>(null);

	const getPercentCoords = useCallback(
		(e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
			const img = imageRef.current;
			if (!img) return null;
			const rect = img.getBoundingClientRect();
			const xPct = ((e.clientX - rect.left) / rect.width) * 100;
			const yPct = ((e.clientY - rect.top) / rect.height) * 100;
			return {
				x: Math.max(0, Math.min(100, xPct)),
				y: Math.max(0, Math.min(100, yPct)),
			};
		},
		[],
	);

	const handleClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (interactionMode === "area") return;
			if (interactionMode === "remote") return; // remote uses mouseDown/mouseUp
			const coords = getPercentCoords(e);
			if (coords) onClickScreen(coords.x, coords.y, e.clientX, e.clientY);
		},
		[interactionMode, onClickScreen, getPercentCoords],
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (interactionMode === "remote") {
				e.preventDefault();
				const coords = getPercentCoords(e);
				if (coords) setRemoteSwipeStart(coords);
				return;
			}
			if (interactionMode !== "area") return;
			e.preventDefault();
			const coords = getPercentCoords(e);
			if (coords) {
				setDragStart(coords);
				setDragCurrent(coords);
			}
		},
		[interactionMode, getPercentCoords],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			// Drag update for area mode (not throttled — needs immediate feedback)
			if (dragStart) {
				const coords = getPercentCoords(e);
				if (coords) setDragCurrent(coords);
				return;
			}

			// Hover hit-testing throttled to once per frame
			if (
				interactionMode !== "remote" &&
				elements &&
				elements.length > 0 &&
				screenWidth &&
				screenHeight
			) {
				const clientX = e.clientX;
				const clientY = e.clientY;
				if (rafRef.current) cancelAnimationFrame(rafRef.current);
				rafRef.current = requestAnimationFrame(() => {
					const img = imageRef.current;
					if (!img) return;
					const rect = img.getBoundingClientRect();
					const xPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
					const yPct = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
					const hit = hitTestElement(elements, xPct, yPct, screenWidth, screenHeight);
					setHoveredElement(hit);
					setMousePos({ x: clientX, y: clientY });
				});
			}
		},
		[dragStart, interactionMode, elements, screenWidth, screenHeight, getPercentCoords],
	);

	const handleMouseUp = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			// Remote mode: tap or swipe
			if (interactionMode === "remote" && remoteSwipeStart) {
				const coords = getPercentCoords(e);
				if (coords) {
					const dx = Math.abs(coords.x - remoteSwipeStart.x);
					const dy = Math.abs(coords.y - remoteSwipeStart.y);
					if (dx < 2 && dy < 2) {
						// Tap (minimal movement)
						onRemoteTap?.(coords.x, coords.y);
					} else {
						// Swipe
						onRemoteSwipe?.(remoteSwipeStart.x, remoteSwipeStart.y, coords.x, coords.y);
					}
				}
				setRemoteSwipeStart(null);
				return;
			}

			if (!dragStart || !dragCurrent) return;
			const x = Math.min(dragStart.x, dragCurrent.x);
			const y = Math.min(dragStart.y, dragCurrent.y);
			const width = Math.abs(dragCurrent.x - dragStart.x);
			const height = Math.abs(dragCurrent.y - dragStart.y);

			setDragStart(null);
			setDragCurrent(null);

			// Only create area if it's at least 2% in both dimensions (ignore tiny clicks)
			if (width >= 2 && height >= 2) {
				onAreaSelect({ x, y, width, height });
			}
		},
		[
			interactionMode,
			remoteSwipeStart,
			dragStart,
			dragCurrent,
			getPercentCoords,
			onRemoteTap,
			onRemoteSwipe,
			onAreaSelect,
		],
	);

	// Calculate drag rect for rendering
	const dragRect = isDragging
		? {
				left: Math.min(dragStart.x, dragCurrent.x),
				top: Math.min(dragStart.y, dragCurrent.y),
				width: Math.abs(dragCurrent.x - dragStart.x),
				height: Math.abs(dragCurrent.y - dragStart.y),
			}
		: null;

	// Empty state: no device connected
	if (!connected && !frameUrl && !error) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3">
				<div className="flex size-16 items-center justify-center rounded-2xl bg-neutral-800/50">
					<svg
						className="size-8 text-neutral-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
						/>
					</svg>
				</div>
				<p className="text-pretty text-sm text-neutral-500">
					Select a device to begin screen mirroring
				</p>
			</div>
		);
	}

	// Error state
	if (error && !frameUrl) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3">
				<div className="flex size-16 items-center justify-center rounded-2xl bg-red-500/10">
					<svg
						className="size-8 text-red-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
						/>
					</svg>
				</div>
				<p className="text-pretty text-sm text-red-400">{error}</p>
			</div>
		);
	}

	// Connecting state (no frame yet)
	if (!frameUrl && connected) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3">
				<div className="size-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-400" />
				<p className="text-pretty text-sm text-neutral-500">Waiting for screen data...</p>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
		>
			{/* Connection indicator */}
			<div className="absolute left-4 top-4 z-10 flex items-center gap-1.5">
				<span className={cn("size-2 rounded-full", connected ? "bg-green-500" : "bg-red-500")} />
				<span className="text-xs text-neutral-500">{connected ? "Live" : "Disconnected"}</span>
			</div>

			{/* Resolution toast */}
			<AnimatePresence>
				{recentlyResolved && recentlyResolved.size > 0 && (
					<motion.div
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
						className="absolute right-4 top-4 z-30 rounded-lg border border-green-800 bg-green-950/90 px-3 py-1.5 text-xs text-green-300"
					>
						Annotation resolved by agent
					</motion.div>
				)}
			</AnimatePresence>

			{/* Screen image with annotation overlay */}
			<div className="relative max-h-full max-w-full">
				{frameUrl && (
					<>
						{/* Clickable/draggable overlay area exactly matching the image */}
						<div
							className={cn(
								"absolute inset-0 z-10",
								interactionMode === "remote" ? "cursor-pointer" : "cursor-crosshair",
							)}
							role="button"
							tabIndex={0}
							onClick={handleClick}
							onMouseDown={handleMouseDown}
							onMouseMove={handleMouseMove}
							onMouseUp={handleMouseUp}
							onMouseLeave={(e) => {
								handleMouseUp(e);
								setHoveredElement(null);
								setMousePos(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									handleClick(e as unknown as React.MouseEvent<HTMLDivElement>);
								}
							}}
						/>

						{/* Hover highlight rectangle */}
						{hoveredElement?.boundingBox && screenWidth && screenHeight && !pendingElement && (
							<div
								className="pointer-events-none absolute z-15 border-2 border-blue-400 bg-blue-400/10"
								style={{
									left: `${(hoveredElement.boundingBox.x / screenWidth) * 100}%`,
									top: `${(hoveredElement.boundingBox.y / screenHeight) * 100}%`,
									width: `${(hoveredElement.boundingBox.width / screenWidth) * 100}%`,
									height: `${(hoveredElement.boundingBox.height / screenHeight) * 100}%`,
								}}
							/>
						)}

						{/* Pending annotation element highlight (stays visible while popup is open) */}
						{pendingElement?.boundingBox && screenWidth && screenHeight && (
							<div
								className="pointer-events-none absolute z-15 border-2 border-blue-400 bg-blue-400/10"
								style={{
									left: `${(pendingElement.boundingBox.x / screenWidth) * 100}%`,
									top: `${(pendingElement.boundingBox.y / screenHeight) * 100}%`,
									width: `${(pendingElement.boundingBox.width / screenWidth) * 100}%`,
									height: `${(pendingElement.boundingBox.height / screenHeight) * 100}%`,
								}}
							/>
						)}

						{/* Hover tooltip — positioned above cursor like Agentation web */}
						{hoveredElement && mousePos && !pendingElement && (
							<div
								className="pointer-events-none fixed z-50 max-w-xs rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-neutral-100 shadow-lg"
								style={{
									left: Math.max(8, Math.min(mousePos.x, window.innerWidth - 100)),
									top: Math.max(8, mousePos.y - 32),
								}}
							>
								{getElementDisplayName(hoveredElement)}
							</div>
						)}

						{/* Active drag selection rectangle */}
						{dragRect && (
							<div
								className="pointer-events-none absolute z-20 border-2 border-dashed border-blue-400 bg-blue-400/10"
								style={{
									left: `${dragRect.left}%`,
									top: `${dragRect.top}%`,
									width: `${dragRect.width}%`,
									height: `${dragRect.height}%`,
								}}
							/>
						)}

						{/* Area overlays for annotations with selectedArea */}
						{!markersHidden &&
							annotations.map((annotation) =>
								annotation.selectedArea ? (
									<button
										key={`area-${annotation.id}`}
										type="button"
										className={cn(
											"absolute z-15 border-2 border-dashed transition-colors",
											selectedAnnotationId === annotation.id
												? "border-blue-400 bg-blue-400/15"
												: "border-neutral-400/50 bg-neutral-400/5 hover:border-neutral-300/70 hover:bg-neutral-300/10",
										)}
										style={{
											left: `${annotation.selectedArea.x}%`,
											top: `${annotation.selectedArea.y}%`,
											width: `${annotation.selectedArea.width}%`,
											height: `${annotation.selectedArea.height}%`,
										}}
										onClick={(e) => {
											e.stopPropagation();
											onSelectAnnotation(annotation);
										}}
										aria-label={`Area annotation: ${annotation.comment}`}
									/>
								) : null,
							)}

						{/* OCR loading indicator */}
						{ocrLoading && (
							<div className="absolute inset-0 z-25 flex items-center justify-center bg-black/30">
								<div className="flex items-center gap-2 rounded-lg bg-neutral-900/90 px-4 py-2">
									<div className="size-4 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
									<span className="text-xs text-neutral-300">Detecting text...</span>
								</div>
							</div>
						)}

						{/* OCR text region overlays */}
						{interactionMode === "text" &&
							textRegions &&
							textRegions.map((region, idx) => (
								<button
									key={`text-${idx}-${region.x.toFixed(0)}-${region.y.toFixed(0)}`}
									type="button"
									className="absolute z-20 border border-amber-400/60 bg-amber-400/10 transition-colors hover:border-amber-300 hover:bg-amber-400/20"
									style={{
										left: `${region.x}%`,
										top: `${region.y}%`,
										width: `${region.width}%`,
										height: `${region.height}%`,
									}}
									onClick={(e) => {
										e.stopPropagation();
										onTextSelect(region);
									}}
									title={region.text}
									aria-label={`Text: ${region.text}`}
								/>
							))}

						<img
							ref={imageRef}
							src={overrideFrameUrl ?? frameUrl}
							alt="Device screen mirror"
							className="block max-h-[calc(100dvh-8rem)] rounded-lg object-contain shadow-lg"
							draggable={false}
						/>

						{/* Annotation pins */}
						{!markersHidden &&
							annotations.map((annotation, idx) => {
								const isResolved = recentlyResolved?.has(annotation.id);
								const isSelected = selectedAnnotationId === annotation.id;

								if (isResolved) {
									return (
										<ResolvedPin
											key={annotation.id}
											annotation={annotation}
											index={idx + 1}
											isSelected={isSelected}
											onSelect={() => onSelectAnnotation(annotation)}
										/>
									);
								}

								return (
									<button
										type="button"
										key={annotation.id}
										onClick={(e) => {
											e.stopPropagation();
											onSelectAnnotation(annotation);
										}}
										onMouseEnter={() => setHoveredPin(annotation.id)}
										onMouseLeave={() => setHoveredPin(null)}
										className={cn(
											"absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold text-white shadow-md transition-transform",
											pinColor(annotation.status),
											isSelected && "scale-125 ring-2 ring-white/30",
										)}
										style={{
											left: `${annotation.x}%`,
											top: `${annotation.y}%`,
										}}
										aria-label={`Annotation: ${annotation.comment}`}
									>
										{idx + 1}

										{/* Tooltip on hover */}
										{hoveredPin === annotation.id && (
											<div className="absolute bottom-full left-1/2 z-30 mb-2 w-48 -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 shadow-lg">
												<p className="line-clamp-2 text-xs text-neutral-200">
													{annotation.comment}
												</p>
												<div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
													<span className="capitalize">{annotation.intent}</span>
													<span>{annotation.severity}</span>
												</div>
											</div>
										)}
									</button>
								);
							})}
					</>
				)}
			</div>
		</div>
	);
}
