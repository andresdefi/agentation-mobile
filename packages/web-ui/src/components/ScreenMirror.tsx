import { useCallback, useRef, useState } from "react";
import { cn } from "../utils";
import type { MobileAnnotation } from "../types";

interface ScreenMirrorProps {
	frameUrl: string | null;
	connected: boolean;
	error: string | null;
	annotations: MobileAnnotation[];
	selectedAnnotationId: string | null;
	onClickScreen: (x: number, y: number) => void;
	onSelectAnnotation: (annotation: MobileAnnotation) => void;
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

export function ScreenMirror({
	frameUrl,
	connected,
	error,
	annotations,
	selectedAnnotationId,
	onClickScreen,
	onSelectAnnotation,
}: ScreenMirrorProps) {
	const imageRef = useRef<HTMLImageElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [hoveredPin, setHoveredPin] = useState<string | null>(null);

	const handleClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const img = imageRef.current;
			if (!img) return;

			const rect = img.getBoundingClientRect();
			const clickX = e.clientX - rect.left;
			const clickY = e.clientY - rect.top;

			// Calculate percentage coordinates relative to the image
			const xPct = (clickX / rect.width) * 100;
			const yPct = (clickY / rect.height) * 100;

			// Clamp to valid range
			const clampedX = Math.max(0, Math.min(100, xPct));
			const clampedY = Math.max(0, Math.min(100, yPct));

			onClickScreen(clampedX, clampedY);
		},
		[onClickScreen],
	);

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
				<p className="text-pretty text-sm text-neutral-500">
					Waiting for screen data...
				</p>
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
				<span
					className={cn(
						"size-2 rounded-full",
						connected ? "bg-green-500" : "bg-red-500",
					)}
				/>
				<span className="text-xs text-neutral-500">
					{connected ? "Live" : "Disconnected"}
				</span>
			</div>

			{/* Screen image with annotation overlay */}
			<div className="relative max-h-full max-w-full">
				{frameUrl && (
					<>
						{/* Clickable overlay area exactly matching the image */}
						<div
							className="absolute inset-0 z-10 cursor-crosshair"
							onClick={handleClick}
						/>

						<img
							ref={imageRef}
							src={frameUrl}
							alt="Device screen mirror"
							className="block max-h-[calc(100dvh-8rem)] rounded-lg object-contain shadow-lg"
							draggable={false}
						/>

						{/* Annotation pins */}
						{annotations.map((annotation) => (
							<button
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
									selectedAnnotationId === annotation.id && "scale-125 ring-2 ring-white/30",
								)}
								style={{
									left: `${annotation.x}%`,
									top: `${annotation.y}%`,
								}}
								aria-label={`Annotation: ${annotation.comment}`}
							>
								{annotations.indexOf(annotation) + 1}

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
						))}
					</>
				)}
			</div>
		</div>
	);
}
