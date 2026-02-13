import { useCallback, useRef, useState } from "react";
import { cn } from "../utils";

type DiffMode = "side-by-side" | "slider";

interface ScreenshotDiffProps {
	beforeId: string | null;
	afterId: string | null;
	serverUrl: string;
}

export function ScreenshotDiff({ beforeId, afterId, serverUrl }: ScreenshotDiffProps) {
	const [mode, setMode] = useState<DiffMode>("side-by-side");
	const [sliderPosition, setSliderPosition] = useState(50);
	const sliderContainerRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);

	const beforeSrc = beforeId ? `${serverUrl}/api/screenshots/${beforeId}` : null;
	const afterSrc = afterId ? `${serverUrl}/api/screenshots/${afterId}` : null;

	const updateSlider = useCallback((clientX: number) => {
		const container = sliderContainerRef.current;
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const x = clientX - rect.left;
		const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
		setSliderPosition(pct);
	}, []);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			draggingRef.current = true;
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			updateSlider(e.clientX);
		},
		[updateSlider],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!draggingRef.current) return;
			updateSlider(e.clientX);
		},
		[updateSlider],
	);

	const handlePointerUp = useCallback(() => {
		draggingRef.current = false;
	}, []);

	if (!beforeSrc && !afterSrc) return null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-neutral-400">Screenshots</span>
				{beforeSrc && afterSrc && (
					<div className="flex gap-1 rounded-md bg-neutral-900 p-0.5">
						<button
							onClick={() => setMode("side-by-side")}
							className={cn(
								"rounded px-2 py-0.5 text-xs font-medium transition-colors",
								mode === "side-by-side"
									? "bg-neutral-700 text-neutral-100"
									: "text-neutral-500 hover:text-neutral-300",
							)}
						>
							Side by side
						</button>
						<button
							onClick={() => setMode("slider")}
							className={cn(
								"rounded px-2 py-0.5 text-xs font-medium transition-colors",
								mode === "slider"
									? "bg-neutral-700 text-neutral-100"
									: "text-neutral-500 hover:text-neutral-300",
							)}
						>
							Slider
						</button>
					</div>
				)}
			</div>

			{mode === "side-by-side" && (
				<div className="flex gap-2">
					{beforeSrc && (
						<div className="flex flex-1 flex-col gap-1">
							<span className="text-xs text-neutral-500">Before</span>
							<div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
								<img
									src={beforeSrc}
									alt="Before screenshot"
									className="h-auto w-full object-contain"
								/>
							</div>
						</div>
					)}
					{afterSrc && (
						<div className="flex flex-1 flex-col gap-1">
							<span className="text-xs text-neutral-500">After</span>
							<div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
								<img
									src={afterSrc}
									alt="After screenshot"
									className="h-auto w-full object-contain"
								/>
							</div>
						</div>
					)}
				</div>
			)}

			{mode === "slider" && beforeSrc && afterSrc && (
				<div
					ref={sliderContainerRef}
					className="relative select-none overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
				>
					<img
						src={afterSrc}
						alt="After screenshot"
						className="block h-auto w-full object-contain"
						draggable={false}
					/>
					<div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPosition}%` }}>
						<img
							src={beforeSrc}
							alt="Before screenshot"
							className="block h-auto object-contain"
							style={{ width: `${sliderContainerRef.current?.offsetWidth ?? 0}px` }}
							draggable={false}
						/>
					</div>
					<div
						className="absolute inset-y-0 z-10 w-0.5 bg-neutral-100"
						style={{ left: `${sliderPosition}%` }}
					>
						<div className="absolute left-1/2 top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-100">
							<svg
								className="size-3 text-neutral-900"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M8 9l4-4 4 4M8 15l4 4 4-4"
								/>
							</svg>
						</div>
					</div>
					<div className="pointer-events-none absolute left-2 top-2 rounded bg-neutral-900/80 px-1.5 py-0.5 text-xs text-neutral-300">
						Before
					</div>
					<div className="pointer-events-none absolute right-2 top-2 rounded bg-neutral-900/80 px-1.5 py-0.5 text-xs text-neutral-300">
						After
					</div>
				</div>
			)}
		</div>
	);
}
