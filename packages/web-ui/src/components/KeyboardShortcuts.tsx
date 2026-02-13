interface KeyboardShortcutsProps {
	onClose: () => void;
}

const shortcuts = [
	{ group: "Toolbar" },
	{ key: "P", description: "Pause / resume animations" },
	{ key: "H", description: "Hide / show markers" },
	{ key: "C", description: "Copy annotations" },
	{ key: "X", description: "Clear all annotations" },
	{ key: "Esc", description: "Close / dismiss / clear" },
	{ group: "Navigation" },
	{ key: "]", description: "Next annotation" },
	{ key: "[", description: "Previous annotation" },
	{ key: "R", description: "Back to list" },
	{ key: "T", description: "Toggle elements panel" },
	{ group: "Status Filters" },
	{ key: "1", description: "Pending" },
	{ key: "2", description: "Acknowledged" },
	{ key: "3", description: "Resolved" },
	{ key: "4", description: "Dismissed" },
	{ group: "Intent Filters" },
	{ key: "F", description: "Fix" },
	{ key: "Q", description: "Question" },
	{ key: "G", description: "Change" },
	{ key: "A", description: "Approve" },
	{ group: "Actions" },
	{ key: "E", description: "Export menu" },
	{ key: "?", description: "Show shortcuts" },
] as const;

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className="w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-neutral-200">Keyboard Shortcuts</h2>
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

				<div className="space-y-3">
					{shortcuts.map((item, i) => {
						if ("group" in item && !("key" in item)) {
							return (
								<p
									key={item.group}
									className={`text-xs font-medium uppercase tracking-wide text-neutral-500 ${i > 0 ? "pt-2" : ""}`}
								>
									{item.group}
								</p>
							);
						}
						if ("key" in item && "description" in item) {
							return (
								<div key={item.key} className="flex items-center justify-between">
									<span className="text-xs text-neutral-400">{item.description}</span>
									<kbd className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-300">
										{item.key}
									</kbd>
								</div>
							);
						}
						return null;
					})}
				</div>
			</div>
		</div>
	);
}
