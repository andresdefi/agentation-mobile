import { useCallback, useState } from "react";

interface TimelineFrame {
	id: string;
	timestamp: number;
	screenshotId: string;
}

interface TimelineProps {
	frames: TimelineFrame[];
	durationMs: number;
	onSeek: (timestampMs: number) => void;
	onClose: () => void;
}

function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	const frac = Math.floor((ms % 1000) / 100);
	return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${frac}`;
}

export function Timeline({ frames, durationMs, onSeek, onClose }: TimelineProps) {
	const [currentTime, setCurrentTime] = useState(0);

	const handleSliderChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = Number(e.target.value);
			setCurrentTime(value);
			onSeek(value);
		},
		[onSeek],
	);

	if (frames.length === 0) {
		return null;
	}

	return (
		<div className="flex items-center gap-3 rounded-xl border border-neutral-700/60 bg-neutral-900/90 px-4 py-2 shadow-2xl backdrop-blur-sm">
			<span className="text-xs tabular-nums text-neutral-400">{formatTime(currentTime)}</span>
			<input
				type="range"
				min={0}
				max={durationMs}
				value={currentTime}
				onChange={handleSliderChange}
				className="h-1 w-48 cursor-pointer appearance-none rounded-full bg-neutral-700 accent-blue-500"
				aria-label="Timeline scrubber"
			/>
			<span className="text-xs tabular-nums text-neutral-500">{formatTime(durationMs)}</span>
			<span className="text-xs text-neutral-600">{frames.length} frames</span>
			<button
				type="button"
				onClick={onClose}
				className="rounded-md px-1.5 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
				aria-label="Close timeline"
			>
				Live
			</button>
		</div>
	);
}
