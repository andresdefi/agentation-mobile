import { cn } from "../utils";

interface SettingsPanelProps {
	darkMode: boolean;
	onToggleDarkMode: () => void;
	onClose: () => void;
}

export function SettingsPanel({ darkMode, onToggleDarkMode, onClose }: SettingsPanelProps) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className="w-72 rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-neutral-200">Settings</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
						aria-label="Close"
					>
						<svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>

				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<span className="text-xs text-neutral-400">Theme</span>
						<button
							type="button"
							onClick={onToggleDarkMode}
							className={cn(
								"relative inline-flex h-6 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
								darkMode ? "bg-neutral-600" : "bg-neutral-700",
							)}
							aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
						>
							<span
								className={cn(
									"pointer-events-none inline-block size-4 rounded-full bg-neutral-200 shadow transition-transform",
									darkMode ? "translate-x-4" : "translate-x-0.5",
								)}
							/>
						</button>
					</div>

					<p className="text-[10px] text-neutral-600">
						{darkMode ? "Dark mode" : "Light mode"} active
					</p>
				</div>
			</div>
		</div>
	);
}
