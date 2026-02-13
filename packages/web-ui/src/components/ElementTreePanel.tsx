import { useState } from "react";
import type { MobileElement } from "../types";
import { cn } from "../utils";

interface ElementTreePanelProps {
	elements: MobileElement[];
	loading: boolean;
	error: string | null;
	selectedElementIds: Set<string>;
	onSelectElement: (element: MobileElement, multiSelect: boolean) => void;
	onRefresh: () => void;
}

function buildTree(elements: MobileElement[]): Map<string, MobileElement[]> {
	const tree = new Map<string, MobileElement[]>();
	for (const el of elements) {
		const parts = el.componentPath.split("/");
		const parentPath = parts.slice(0, -1).join("/");
		const key = parentPath || "__root__";
		const children = tree.get(key) ?? [];
		children.push(el);
		tree.set(key, children);
	}
	return tree;
}

function TreeNode({
	element,
	tree,
	depth,
	selectedElementIds,
	onSelectElement,
}: {
	element: MobileElement;
	tree: Map<string, MobileElement[]>;
	depth: number;
	selectedElementIds: Set<string>;
	onSelectElement: (el: MobileElement, multiSelect: boolean) => void;
}) {
	const [expanded, setExpanded] = useState(depth < 2);
	const children = tree.get(element.componentPath) ?? [];
	const hasChildren = children.length > 0;
	const isSelected = element.id ? selectedElementIds.has(element.id) : false;

	return (
		<div>
			<button
				type="button"
				onClick={(e) => onSelectElement(element, e.shiftKey)}
				className={cn(
					"flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-neutral-800",
					isSelected && "bg-neutral-800 ring-1 ring-neutral-600",
				)}
				style={{ paddingLeft: `${depth * 16 + 4}px` }}
			>
				{hasChildren ? (
					<span
						onClick={(e) => {
							e.stopPropagation();
							setExpanded(!expanded);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								setExpanded(!expanded);
							}
						}}
						className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300"
					>
						<svg
							className={cn("size-3 transition-transform", expanded && "rotate-90")}
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</span>
				) : (
					<span className="size-4 shrink-0" />
				)}

				<span className="truncate font-mono text-blue-400">{element.componentName}</span>

				{element.animations && element.animations.length > 0 && (
					<span className="ml-0.5 size-1.5 shrink-0 rounded-full bg-amber-400" title="Animated" />
				)}

				{element.textContent && (
					<span className="ml-1 truncate text-neutral-600">&quot;{element.textContent}&quot;</span>
				)}
			</button>

			{expanded &&
				children.map((child) => (
					<TreeNode
						key={child.id ?? child.componentPath}
						element={child}
						tree={tree}
						depth={depth + 1}
						selectedElementIds={selectedElementIds}
						onSelectElement={onSelectElement}
					/>
				))}
		</div>
	);
}

function ElementDetail({ element }: { element: MobileElement }) {
	return (
		<div className="flex flex-col gap-2 border-t border-neutral-800 px-4 py-3">
			<div className="flex items-center justify-between">
				<span className="font-mono text-sm text-blue-400">{element.componentName}</span>
				<span className="rounded-md bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-500">
					{element.platform}
				</span>
			</div>

			{element.sourceLocation && (
				<div className="flex flex-col gap-0.5">
					<span className="text-xs font-medium uppercase tracking-wide text-neutral-600">
						Source
					</span>
					<span className="truncate font-mono text-xs text-emerald-400">
						{element.sourceLocation.file}:{element.sourceLocation.line}
						{element.sourceLocation.column != null && `:${element.sourceLocation.column}`}
					</span>
				</div>
			)}

			{!element.sourceLocation && element.componentFile && (
				<div className="flex flex-col gap-0.5">
					<span className="text-xs font-medium uppercase tracking-wide text-neutral-600">
						Source
					</span>
					<span className="truncate font-mono text-xs text-neutral-400">
						{element.componentFile}
					</span>
				</div>
			)}

			<div className="flex flex-col gap-0.5">
				<span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Path</span>
				<span className="truncate text-xs text-neutral-400">{element.componentPath}</span>
			</div>

			<div className="flex flex-col gap-0.5">
				<span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Bounds</span>
				<span className="font-mono text-xs tabular-nums text-neutral-400">
					x:{element.boundingBox.x} y:{element.boundingBox.y} w:
					{element.boundingBox.width} h:{element.boundingBox.height}
				</span>
			</div>

			{element.accessibility?.label && (
				<div className="flex flex-col gap-0.5">
					<span className="text-xs font-medium uppercase tracking-wide text-neutral-600">
						Accessibility
					</span>
					<span className="text-xs text-neutral-400">
						{element.accessibility.role && (
							<span className="mr-2 text-neutral-500">[{element.accessibility.role}]</span>
						)}
						{element.accessibility.label}
					</span>
				</div>
			)}

			{element.textContent && (
				<div className="flex flex-col gap-0.5">
					<span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Text</span>
					<span className="text-xs text-neutral-400">{element.textContent}</span>
				</div>
			)}

			{element.animations && element.animations.length > 0 && (
				<div className="flex flex-col gap-0.5">
					<span className="text-xs font-medium uppercase tracking-wide text-neutral-600">
						Animations
					</span>
					<div className="flex flex-col gap-1">
						{element.animations.map((anim, i) => (
							<div key={`${anim.property}-${i}`} className="flex items-center gap-1.5">
								<span
									className={cn(
										"size-1.5 rounded-full",
										anim.status === "running"
											? "bg-amber-400"
											: anim.status === "paused"
												? "bg-blue-400"
												: "bg-neutral-500",
									)}
								/>
								<span className="font-mono text-xs text-amber-300">{anim.property}</span>
								<span className="text-xs text-neutral-600">({anim.type})</span>
								{anim.duration && (
									<span className="font-mono text-xs tabular-nums text-neutral-500">
										{anim.duration}ms
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

export function ElementTreePanel({
	elements,
	loading,
	error,
	selectedElementIds,
	onSelectElement,
	onRefresh,
}: ElementTreePanelProps) {
	const tree = buildTree(elements);
	const selectedElements = elements.filter((el) => el.id && selectedElementIds.has(el.id));
	const lastSelected =
		selectedElements.length > 0 ? selectedElements[selectedElements.length - 1] : null;

	// Root elements: those without a parent in the tree
	const rootElements = elements.filter((el) => {
		const parts = el.componentPath.split("/");
		const parentPath = parts.slice(0, -1).join("/");
		return !parentPath || !elements.some((other) => other.componentPath === parentPath);
	});

	if (loading) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8">
				<div className="size-5 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-400" />
				<p className="text-xs text-neutral-500">Loading element tree...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-col gap-2 px-4 py-8 text-center">
				<p className="text-xs text-red-400">{error}</p>
				<button
					type="button"
					onClick={onRefresh}
					className="mx-auto rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-700"
				>
					Retry
				</button>
			</div>
		);
	}

	if (elements.length === 0) {
		return (
			<div className="flex flex-col gap-2 px-4 py-8 text-center">
				<p className="text-pretty text-xs text-neutral-500">
					No elements found. Make sure a device is connected and running an app.
				</p>
				<button
					type="button"
					onClick={onRefresh}
					className="mx-auto rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-700"
				>
					Refresh
				</button>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2">
				<span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
					Elements
				</span>
				<div className="flex items-center gap-2">
					{selectedElements.length > 1 && (
						<span className="rounded-md bg-blue-900/50 px-1.5 py-0.5 font-mono text-xs tabular-nums text-blue-400">
							{selectedElements.length} selected
						</span>
					)}
					<span className="rounded-md bg-neutral-800 px-1.5 py-0.5 font-mono text-xs tabular-nums text-neutral-500">
						{elements.length}
					</span>
					<button
						type="button"
						onClick={onRefresh}
						className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
						aria-label="Refresh element tree"
					>
						<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
					</button>
				</div>
			</div>

			{/* Tree */}
			<div className="flex-1 overflow-y-auto px-2 py-1">
				{rootElements.map((el) => (
					<TreeNode
						key={el.id ?? el.componentPath}
						element={el}
						tree={tree}
						depth={0}
						selectedElementIds={selectedElementIds}
						onSelectElement={onSelectElement}
					/>
				))}
			</div>

			{/* Selected element detail */}
			{lastSelected && <ElementDetail element={lastSelected} />}
		</div>
	);
}
