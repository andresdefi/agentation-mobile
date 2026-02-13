import { cn } from "../utils";

interface RecordingControlsProps {
	isRecording: boolean;
	elapsedMs: number;
	onStart: () => void;
	onStop: () => void;
}

function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function RecordingControls({
	isRecording,
	elapsedMs,
	onStart,
	onStop,
}: RecordingControlsProps) {
	return (
		<div className="flex items-center gap-2">
			{isRecording ? (
				<>
					<button
						type="button"
						onClick={onStop}
						className="flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/30"
						aria-label="Stop recording"
					>
						<span className="size-2.5 rounded-sm bg-red-400" />
						Stop
					</button>
					<span className="flex items-center gap-1.5 text-xs tabular-nums text-neutral-400">
						<span className={cn("size-2 rounded-full bg-red-500 animate-pulse")} />
						{formatElapsed(elapsedMs)}
					</span>
				</>
			) : (
				<button
					type="button"
					onClick={onStart}
					className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
					aria-label="Start recording"
				>
					<span className="size-2.5 rounded-full bg-red-500" />
					Record
				</button>
			)}
		</div>
	);
}
