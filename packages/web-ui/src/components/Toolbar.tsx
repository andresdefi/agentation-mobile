import { cn } from "../utils";
import type { InteractionMode } from "./ScreenMirror";

interface ToolbarProps {
	interactionMode: InteractionMode;
	onInteractionModeChange: (mode: InteractionMode) => void;
	animationsPaused: boolean;
	onToggleAnimations: () => void;
	markersHidden: boolean;
	onToggleMarkers: () => void;
	onCopy: () => void;
	copyFeedback: string | null;
	onClearAll: () => void;
	annotationCount: number;
	onOpenSettings: () => void;
	onOpenShortcuts: () => void;
}

function Kbd({ children }: { children: string }) {
	return (
		<kbd className="ml-1.5 rounded border border-neutral-600 bg-neutral-700/50 px-1 py-px font-mono text-[10px] leading-tight text-neutral-400">
			{children}
		</kbd>
	);
}

function Divider() {
	return <div className="h-5 w-px bg-neutral-700" />;
}

export function Toolbar({
	interactionMode,
	onInteractionModeChange,
	animationsPaused,
	onToggleAnimations,
	markersHidden,
	onToggleMarkers,
	onCopy,
	copyFeedback,
	onClearAll,
	annotationCount,
	onOpenSettings,
	onOpenShortcuts,
}: ToolbarProps) {
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
			<div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-neutral-700/60 bg-neutral-900/90 px-2 py-1.5 shadow-2xl backdrop-blur-sm">
				{/* Annotation mode: Point */}
				<button
					type="button"
					onClick={() => onInteractionModeChange("point")}
					className={cn(
						"rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
						interactionMode === "point"
							? "bg-neutral-700 text-neutral-100"
							: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
					)}
					title="Point mode — click to annotate"
				>
					Point
				</button>

				<Divider />

				{/* Action group: Pause | Hide | Copy | Clear */}
				<button
					type="button"
					onClick={onToggleAnimations}
					className={cn(
						"flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
						animationsPaused
							? "bg-amber-600/20 text-amber-400"
							: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
					)}
					title={animationsPaused ? "Resume animations (P)" : "Pause animations (P)"}
					aria-label={animationsPaused ? "Resume animations" : "Pause animations"}
				>
					<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{animationsPaused ? (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
							/>
						) : (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M10 9v6m4-6v6"
							/>
						)}
					</svg>
					<Kbd>P</Kbd>
				</button>

				<button
					type="button"
					onClick={onToggleMarkers}
					className={cn(
						"flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
						markersHidden
							? "bg-neutral-700/60 text-neutral-300"
							: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
					)}
					title={markersHidden ? "Show markers (H)" : "Hide markers (H)"}
					aria-label={markersHidden ? "Show markers" : "Hide markers"}
				>
					<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{markersHidden ? (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18"
							/>
						) : (
							<>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
								/>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
								/>
							</>
						)}
					</svg>
					<Kbd>H</Kbd>
				</button>

				<button
					type="button"
					onClick={onCopy}
					disabled={annotationCount === 0}
					className="flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
					title="Copy annotations (C)"
					aria-label="Copy annotations"
				>
					{copyFeedback ? (
						<svg
							className="size-3.5 text-green-400"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M5 13l4 4L19 7"
							/>
						</svg>
					) : (
						<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
							/>
						</svg>
					)}
					<Kbd>C</Kbd>
				</button>

				<button
					type="button"
					onClick={onClearAll}
					disabled={annotationCount === 0}
					className="flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
					title="Clear all annotations (X)"
					aria-label="Clear all annotations"
				>
					<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					<Kbd>X</Kbd>
				</button>

				<Divider />

				{/* Settings & Help */}
				<button
					type="button"
					onClick={onOpenSettings}
					className="flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
					title="Settings"
					aria-label="Settings"
				>
					<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
						/>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
						/>
					</svg>
				</button>

				<button
					type="button"
					onClick={onOpenShortcuts}
					className="flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
					title="Keyboard shortcuts (?)"
					aria-label="Keyboard shortcuts"
				>
					<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01"
						/>
					</svg>
					<Kbd>?</Kbd>
				</button>
			</div>
		</div>
	);
}
