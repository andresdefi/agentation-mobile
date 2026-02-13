import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { AnnotationFilters, type Filters } from "./components/AnnotationFilters";
import { AnnotationForm } from "./components/AnnotationForm";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { type DeviceTab, DeviceTabs } from "./components/DeviceTabs";
import { ElementTreePanel } from "./components/ElementTreePanel";
import { ExportMenu } from "./components/ExportMenu";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { type InteractionMode, ScreenMirror } from "./components/ScreenMirror";
import { ThreadView } from "./components/ThreadView";
import { useAnnotations } from "./hooks/use-annotations";
import { useDevices } from "./hooks/use-devices";
import { useElementTree } from "./hooks/use-element-tree";
import { type TextRegion, useOcr } from "./hooks/use-ocr";
import { useScreenMirror } from "./hooks/use-screen-mirror";
import { useSessions } from "./hooks/use-sessions";
import type {
	AnnotationIntent,
	AnnotationSeverity,
	AnnotationStatus,
	DeviceInfo,
	MobileAnnotation,
	MobileElement,
	SelectedArea,
} from "./types";
import { cn } from "./utils";

export function App() {
	// Theme state — light mode by default
	const [darkMode, setDarkMode] = useState(() => {
		const stored = localStorage.getItem("agentation-theme");
		return stored === "dark";
	});

	useEffect(() => {
		document.documentElement.classList.toggle("dark", darkMode);
		localStorage.setItem("agentation-theme", darkMode ? "dark" : "light");
	}, [darkMode]);

	// Device state
	const { devices, loading: devicesLoading } = useDevices();
	const [tabs, setTabs] = useState<DeviceTab[]>([]);
	const [activeTabIndex, setActiveTabIndex] = useState(0);

	// Derive active device/session from tabs
	const activeTab = tabs[activeTabIndex] ?? null;
	const selectedDevice = activeTab?.device ?? null;
	const activeSessionId = activeTab?.sessionId ?? null;

	// Session state
	const { sessions, createSession } = useSessions();

	// Annotations
	const {
		annotations,
		loading: annotationsLoading,
		recentlyResolved,
		createAnnotation,
		reply,
		updateStatus,
	} = useAnnotations(activeSessionId);

	// Screen mirror
	const { frameUrl, connected, error: mirrorError } = useScreenMirror(selectedDevice?.id ?? null);

	// Element tree
	const {
		elements,
		loading: elementsLoading,
		error: elementsError,
		refresh: refreshElements,
	} = useElementTree(selectedDevice?.id ?? null);

	// OCR
	const { regions: textRegions, loading: ocrLoading, runOcr, clear: clearOcr } = useOcr();

	// UI state
	const [clickCoords, setClickCoords] = useState<{
		x: number;
		y: number;
		element?: MobileElement | null;
		inspecting?: boolean;
		selectedArea?: SelectedArea;
		selectedText?: string;
	} | null>(null);
	const [selectedAnnotation, setSelectedAnnotation] = useState<MobileAnnotation | null>(null);
	const [submittingAnnotation, setSubmittingAnnotation] = useState(false);
	const [sidebarTab, setSidebarTab] = useState<"annotations" | "elements">("annotations");
	const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
	const [sidebarView, setSidebarView] = useState<"list" | "thread">("list");
	const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
	const [filters, setFilters] = useState<Filters>({
		status: null,
		intent: null,
		severity: null,
	});
	const [exportMenuOpen, setExportMenuOpen] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [interactionMode, setInteractionMode] = useState<InteractionMode>("point");
	const [animationsPaused, setAnimationsPaused] = useState(false);

	// Filtered annotations
	const filteredAnnotations = useMemo(() => {
		return annotations.filter((a) => {
			if (filters.status && a.status !== filters.status) return false;
			if (filters.intent && a.intent !== filters.intent) return false;
			if (filters.severity && a.severity !== filters.severity) return false;
			return true;
		});
	}, [annotations, filters]);

	// Keep selectedAnnotation synced with live data
	const liveSelectedAnnotation = selectedAnnotation
		? (annotations.find((a) => a.id === selectedAnnotation.id) ?? selectedAnnotation)
		: null;

	// Extract text regions from element tree (more accurate than OCR when available)
	const elementTextRegions = useMemo(() => {
		if (!selectedDevice || elements.length === 0) return [];
		const screenW = selectedDevice.screenWidth || 1;
		const screenH = selectedDevice.screenHeight || 1;
		const regions: TextRegion[] = [];
		for (const el of elements) {
			if (!el.textContent || !el.boundingBox) continue;
			const { x, y, width, height } = el.boundingBox;
			if (width <= 0 || height <= 0) continue;
			regions.push({
				text: el.textContent,
				x: (x / screenW) * 100,
				y: (y / screenH) * 100,
				width: (width / screenW) * 100,
				height: (height / screenH) * 100,
				confidence: 100,
			});
		}
		return regions;
	}, [elements, selectedDevice]);

	// Run OCR when switching to text mode, merge with element tree text
	useEffect(() => {
		if (interactionMode === "text" && frameUrl) {
			runOcr(frameUrl);
		} else {
			clearOcr();
		}
	}, [interactionMode, frameUrl, runOcr, clearOcr]);

	// Merge OCR and element tree text regions (element tree takes priority)
	const mergedTextRegions = useMemo(() => {
		if (elementTextRegions.length === 0) return textRegions;
		if (textRegions.length === 0) return elementTextRegions;
		// Element tree regions first (higher confidence), then OCR regions that don't overlap
		const merged = [...elementTextRegions];
		for (const ocrRegion of textRegions) {
			const overlaps = elementTextRegions.some((elRegion) => {
				const overlapX =
					ocrRegion.x < elRegion.x + elRegion.width && ocrRegion.x + ocrRegion.width > elRegion.x;
				const overlapY =
					ocrRegion.y < elRegion.y + elRegion.height && ocrRegion.y + ocrRegion.height > elRegion.y;
				return overlapX && overlapY;
			});
			if (!overlaps) {
				merged.push(ocrRegion);
			}
		}
		return merged;
	}, [textRegions, elementTextRegions]);

	// Copy annotations to clipboard as structured markdown
	const handleCopyAnnotations = useCallback(async () => {
		if (annotations.length === 0) return;

		const lines: string[] = [];
		lines.push(`# ${annotations.length} annotations`);
		lines.push("");

		for (let i = 0; i < annotations.length; i++) {
			const a = annotations[i];
			let ref = `${i + 1}. [${a.intent}/${a.severity}]`;
			if (a.element?.componentName) {
				ref += ` ${a.element.componentName}`;
				if (a.element.componentFile) {
					ref += ` (${a.element.componentFile})`;
				} else if (a.element.componentPath) {
					ref += ` > ${a.element.componentPath}`;
				}
			}
			lines.push(ref);
			lines.push(`   ${a.comment}`);
			lines.push(`   Status: ${a.status} | Position: ${a.x.toFixed(1)}%, ${a.y.toFixed(1)}%`);
			if (a.thread.length > 0) {
				for (const msg of a.thread) {
					lines.push(`   > ${msg.role}: ${msg.content}`);
				}
			}
			lines.push("");
		}

		try {
			await navigator.clipboard.writeText(lines.join("\n").trimEnd());
			setCopyFeedback(
				`Copied ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`,
			);
			setTimeout(() => setCopyFeedback(null), 2000);
		} catch {
			setCopyFeedback("Copy failed");
			setTimeout(() => setCopyFeedback(null), 2000);
		}
	}, [annotations]);

	// Keyboard shortcuts
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (showShortcuts) {
					setShowShortcuts(false);
				} else if (exportMenuOpen) {
					setExportMenuOpen(false);
				} else if (clickCoords) {
					setClickCoords(null);
				} else if (sidebarView === "thread") {
					setSidebarView("list");
					setSelectedAnnotation(null);
				} else if (filters.status || filters.intent || filters.severity) {
					setFilters({ status: null, intent: null, severity: null });
				}
				return;
			}

			const target = e.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT"
			)
				return;

			if (e.key === "?") {
				setShowShortcuts((v) => !v);
				return;
			}

			if (e.key === "1") {
				setFilters((f) => ({
					...f,
					status: f.status === "pending" ? null : ("pending" as AnnotationStatus),
				}));
				return;
			}
			if (e.key === "2") {
				setFilters((f) => ({
					...f,
					status: f.status === "acknowledged" ? null : ("acknowledged" as AnnotationStatus),
				}));
				return;
			}
			if (e.key === "3") {
				setFilters((f) => ({
					...f,
					status: f.status === "resolved" ? null : ("resolved" as AnnotationStatus),
				}));
				return;
			}
			if (e.key === "4") {
				setFilters((f) => ({
					...f,
					status: f.status === "dismissed" ? null : ("dismissed" as AnnotationStatus),
				}));
				return;
			}

			if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
				setFilters((prev) => ({
					...prev,
					intent: prev.intent === "fix" ? null : ("fix" as AnnotationIntent),
				}));
				return;
			}
			if (e.key === "q" && !e.metaKey && !e.ctrlKey) {
				setFilters((prev) => ({
					...prev,
					intent: prev.intent === "question" ? null : ("question" as AnnotationIntent),
				}));
				return;
			}
			if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
				setFilters((prev) => ({
					...prev,
					intent: prev.intent === "change" ? null : ("change" as AnnotationIntent),
				}));
				return;
			}
			if (e.key === "a" && !e.metaKey && !e.ctrlKey) {
				setFilters((prev) => ({
					...prev,
					intent: prev.intent === "approve" ? null : ("approve" as AnnotationIntent),
				}));
				return;
			}

			if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
				if (sidebarView === "thread") {
					setSidebarView("list");
					setSelectedAnnotation(null);
				}
				return;
			}
			if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
				handleCopyAnnotations();
				return;
			}
			if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
				setExportMenuOpen((v) => !v);
				return;
			}
			if (e.key === "t" && !e.metaKey && !e.ctrlKey) {
				if (sidebarView === "thread") {
					setSidebarView("list");
					setSelectedAnnotation(null);
				}
				setSidebarTab((tab) => (tab === "elements" ? "annotations" : "elements"));
				return;
			}

			if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
				if (filteredAnnotations.length === 0) return;
				const currentIdx = liveSelectedAnnotation
					? filteredAnnotations.findIndex((ann) => ann.id === liveSelectedAnnotation.id)
					: -1;
				const nextIdx = currentIdx + 1 >= filteredAnnotations.length ? 0 : currentIdx + 1;
				setSelectedAnnotation(filteredAnnotations[nextIdx]);
				setSidebarView("thread");
				return;
			}
			if (e.key === "p" && !e.metaKey && !e.ctrlKey) {
				if (filteredAnnotations.length === 0) return;
				const currentIdx = liveSelectedAnnotation
					? filteredAnnotations.findIndex((ann) => ann.id === liveSelectedAnnotation.id)
					: -1;
				const prevIdx = currentIdx <= 0 ? filteredAnnotations.length - 1 : currentIdx - 1;
				setSelectedAnnotation(filteredAnnotations[prevIdx]);
				setSidebarView("thread");
				return;
			}
		};

		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [
		clickCoords,
		sidebarView,
		filters,
		handleCopyAnnotations,
		filteredAnnotations,
		liveSelectedAnnotation,
		showShortcuts,
		exportMenuOpen,
	]);

	// Handle adding a device (creates a new tab)
	const handleAddDevice = useCallback(
		async (device: DeviceInfo) => {
			// Check if this device already has a tab
			const existingIdx = tabs.findIndex((t) => t.device.id === device.id);
			if (existingIdx >= 0) {
				setActiveTabIndex(existingIdx);
				return;
			}

			// Find or create session
			const existingSession = sessions.find((s) => s.deviceId === device.id);
			let sessionId: string;
			if (existingSession) {
				sessionId = existingSession.id;
			} else {
				const session = await createSession(`${device.name} session`, device.id, device.platform);
				sessionId = session.id;
			}

			const newTab: DeviceTab = { device, sessionId };
			setTabs((prev) => [...prev, newTab]);
			setActiveTabIndex(tabs.length);
			setSelectedAnnotation(null);
			setSidebarView("list");
		},
		[tabs, sessions, createSession],
	);

	// Handle switching tabs
	const handleSelectTab = useCallback(
		(index: number) => {
			if (index === activeTabIndex) return;
			setActiveTabIndex(index);
			setSelectedAnnotation(null);
			setSidebarView("list");
			setClickCoords(null);
		},
		[activeTabIndex],
	);

	// Handle closing a tab
	const handleCloseTab = useCallback(
		(index: number) => {
			setTabs((prev) => prev.filter((_, i) => i !== index));
			if (index <= activeTabIndex && activeTabIndex > 0) {
				setActiveTabIndex((prev) => prev - 1);
			}
			setSelectedAnnotation(null);
			setSidebarView("list");
			setClickCoords(null);
		},
		[activeTabIndex],
	);

	// Handle clicking on the screen mirror
	const handleScreenClick = useCallback(
		async (x: number, y: number) => {
			if (!activeSessionId || !selectedDevice) return;
			setClickCoords({ x, y, inspecting: true });

			const pixelX = Math.round((x / 100) * selectedDevice.screenWidth);
			const pixelY = Math.round((y / 100) * selectedDevice.screenHeight);

			try {
				const element = await apiFetch<MobileElement>(
					`/api/devices/${encodeURIComponent(selectedDevice.id)}/inspect?x=${pixelX}&y=${pixelY}`,
				);
				setClickCoords((prev) => (prev ? { ...prev, element, inspecting: false } : null));
			} catch {
				setClickCoords((prev) => (prev ? { ...prev, element: null, inspecting: false } : null));
			}
		},
		[activeSessionId, selectedDevice],
	);

	// Handle text region selection (text mode)
	const handleTextSelect = useCallback(
		async (region: TextRegion) => {
			if (!activeSessionId || !selectedDevice) return;
			// Use center of text region as annotation position
			const centerX = region.x + region.width / 2;
			const centerY = region.y + region.height / 2;
			setClickCoords({
				x: centerX,
				y: centerY,
				selectedText: region.text,
				inspecting: true,
			});

			const pixelX = Math.round((centerX / 100) * selectedDevice.screenWidth);
			const pixelY = Math.round((centerY / 100) * selectedDevice.screenHeight);

			try {
				const element = await apiFetch<MobileElement>(
					`/api/devices/${encodeURIComponent(selectedDevice.id)}/inspect?x=${pixelX}&y=${pixelY}`,
				);
				setClickCoords((prev) => (prev ? { ...prev, element, inspecting: false } : null));
			} catch {
				setClickCoords((prev) => (prev ? { ...prev, element: null, inspecting: false } : null));
			}
		},
		[activeSessionId, selectedDevice],
	);

	// Handle area selection (drag mode)
	const handleAreaSelect = useCallback(
		async (area: SelectedArea) => {
			if (!activeSessionId || !selectedDevice) return;
			// Use center of area as annotation position
			const centerX = area.x + area.width / 2;
			const centerY = area.y + area.height / 2;
			setClickCoords({ x: centerX, y: centerY, selectedArea: area, inspecting: true });

			const pixelX = Math.round((centerX / 100) * selectedDevice.screenWidth);
			const pixelY = Math.round((centerY / 100) * selectedDevice.screenHeight);

			try {
				const element = await apiFetch<MobileElement>(
					`/api/devices/${encodeURIComponent(selectedDevice.id)}/inspect?x=${pixelX}&y=${pixelY}`,
				);
				setClickCoords((prev) => (prev ? { ...prev, element, inspecting: false } : null));
			} catch {
				setClickCoords((prev) => (prev ? { ...prev, element: null, inspecting: false } : null));
			}
		},
		[activeSessionId, selectedDevice],
	);

	// Handle annotation form submit
	const handleAnnotationSubmit = useCallback(
		async (data: {
			comment: string;
			intent: AnnotationIntent;
			severity: AnnotationSeverity;
		}) => {
			if (!clickCoords || !activeSessionId || !selectedDevice) return;

			setSubmittingAnnotation(true);
			try {
				await createAnnotation({
					sessionId: activeSessionId,
					x: clickCoords.x,
					y: clickCoords.y,
					deviceId: selectedDevice.id,
					platform: selectedDevice.platform,
					screenWidth: selectedDevice.screenWidth,
					screenHeight: selectedDevice.screenHeight,
					comment: data.comment,
					intent: data.intent,
					severity: data.severity,
					element: clickCoords.element ?? undefined,
					selectedArea: clickCoords.selectedArea,
					selectedText: clickCoords.selectedText,
				});
				setClickCoords(null);
			} finally {
				setSubmittingAnnotation(false);
			}
		},
		[clickCoords, activeSessionId, selectedDevice, createAnnotation],
	);

	const handleToggleAnimations = useCallback(async () => {
		if (!selectedDevice) return;
		const endpoint = animationsPaused ? "resume-animations" : "pause-animations";
		try {
			const res = await fetch(`/api/devices/${encodeURIComponent(selectedDevice.id)}/${endpoint}`, {
				method: "POST",
			});
			if (res.ok) {
				setAnimationsPaused(!animationsPaused);
			}
		} catch {
			// silently fail — dev tool
		}
	}, [selectedDevice, animationsPaused]);

	const handleSelectAnnotation = useCallback((annotation: MobileAnnotation) => {
		setSelectedAnnotation(annotation);
		setSidebarView("thread");
	}, []);

	const handleReply = useCallback(
		async (annotationId: string, content: string) => {
			const updated = await reply(annotationId, content);
			setSelectedAnnotation(updated);
		},
		[reply],
	);

	const handleUpdateStatus = useCallback(
		async (annotationId: string, action: "acknowledge" | "resolve" | "dismiss") => {
			const updated = await updateStatus(annotationId, action);
			setSelectedAnnotation(updated);
		},
		[updateStatus],
	);

	return (
		<div className="flex h-dvh bg-neutral-950 text-neutral-100">
			{/* Sidebar */}
			<aside
				className={cn("flex w-80 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900")}
			>
				{/* Sidebar header */}
				<div className="flex flex-col gap-4 border-b border-neutral-800 px-4 py-4">
					<div className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-neutral-800">
							<svg
								className="size-4 text-neutral-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
								/>
							</svg>
						</div>
						<h1 className="flex-1 text-balance text-sm font-semibold tracking-tight">
							agentation-mobile
						</h1>
						<button
							type="button"
							onClick={() => setDarkMode((v) => !v)}
							className="rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
							aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
							title={darkMode ? "Light mode" : "Dark mode"}
						>
							{darkMode ? "Light" : "Dark"}
						</button>
						<button
							type="button"
							onClick={handleCopyAnnotations}
							disabled={annotations.length === 0}
							className="rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
							aria-label="Copy annotations to clipboard"
							title="Copy annotations (C)"
						>
							{copyFeedback ?? "Copy"}
						</button>
						<ExportMenu
							sessionId={activeSessionId}
							disabled={annotations.length === 0}
							isOpen={exportMenuOpen}
							onOpenChange={setExportMenuOpen}
						/>
					</div>

					<DeviceTabs
						tabs={tabs}
						activeTabIndex={activeTabIndex}
						onSelectTab={handleSelectTab}
						onCloseTab={handleCloseTab}
						onAddDevice={handleAddDevice}
						availableDevices={devices}
						devicesLoading={devicesLoading}
					/>
				</div>

				{/* Sidebar tabs */}
				{sidebarView !== "thread" && (
					<div className="flex border-b border-neutral-800">
						<button
							type="button"
							onClick={() => setSidebarTab("annotations")}
							className={cn(
								"flex-1 px-4 py-2 text-xs font-medium transition-colors",
								sidebarTab === "annotations"
									? "border-b-2 border-neutral-400 text-neutral-200"
									: "text-neutral-500 hover:text-neutral-300",
							)}
						>
							Annotations
						</button>
						<button
							type="button"
							onClick={() => setSidebarTab("elements")}
							className={cn(
								"flex-1 px-4 py-2 text-xs font-medium transition-colors",
								sidebarTab === "elements"
									? "border-b-2 border-neutral-400 text-neutral-200"
									: "text-neutral-500 hover:text-neutral-300",
							)}
						>
							Elements
						</button>
					</div>
				)}

				{/* Sidebar content */}
				<div className="flex flex-1 flex-col overflow-hidden">
					{sidebarView === "list" && sidebarTab === "annotations" && (
						<>
							<div className="flex items-center justify-between px-4 py-2">
								<span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
									Annotations
								</span>
								{annotations.length > 0 && (
									<span className="rounded-md bg-neutral-800 px-1.5 py-0.5 font-mono text-xs tabular-nums text-neutral-500">
										{filteredAnnotations.length !== annotations.length
											? `${filteredAnnotations.length}/${annotations.length}`
											: annotations.length}
									</span>
								)}
							</div>

							{annotations.length > 0 && (
								<AnnotationFilters filters={filters} onFiltersChange={setFilters} />
							)}

							<div className="flex-1 overflow-y-auto">
								<AnnotationPanel
									annotations={filteredAnnotations}
									selectedAnnotationId={liveSelectedAnnotation?.id ?? null}
									onSelectAnnotation={handleSelectAnnotation}
									loading={annotationsLoading}
								/>
							</div>
						</>
					)}

					{sidebarView === "list" && sidebarTab === "elements" && (
						<ElementTreePanel
							elements={elements}
							loading={elementsLoading}
							error={elementsError}
							selectedElementIds={selectedElementIds}
							onSelectElement={(element, multiSelect) => {
								const id = element.id;
								if (!id) return;
								if (multiSelect) {
									setSelectedElementIds((prev) => {
										const next = new Set(prev);
										if (next.has(id)) {
											next.delete(id);
										} else {
											next.add(id);
										}
										return next;
									});
								} else {
									setSelectedElementIds(new Set([id]));
								}
							}}
							onRefresh={refreshElements}
						/>
					)}

					{sidebarView === "thread" && liveSelectedAnnotation && (
						<ThreadView
							annotation={liveSelectedAnnotation}
							onReply={handleReply}
							onClose={() => {
								setSidebarView("list");
								setSelectedAnnotation(null);
							}}
							onUpdateStatus={handleUpdateStatus}
						/>
					)}
				</div>

				{/* Sidebar footer */}
				<div className="flex items-center justify-between border-t border-neutral-800 px-4 py-2">
					<p className="text-xs text-neutral-700">
						{connected ? "Connected" : "Not connected"} --{" "}
						{annotations.filter((a) => a.status === "pending").length} pending
					</p>
					<button
						type="button"
						onClick={() => setShowShortcuts(true)}
						className="rounded p-0.5 text-neutral-700 transition-colors hover:bg-neutral-800 hover:text-neutral-400"
						aria-label="Keyboard shortcuts"
						title="Keyboard shortcuts (?)"
					>
						<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01"
							/>
						</svg>
					</button>
				</div>
			</aside>

			{/* Main content area */}
			<main className="flex flex-1 flex-col overflow-hidden">
				{/* Mode toggle toolbar */}
				{connected && frameUrl && (
					<div className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-4 py-1.5">
						<span className="mr-2 text-xs text-neutral-600">Mode:</span>
						<button
							type="button"
							onClick={() => setInteractionMode("point")}
							className={cn(
								"rounded px-2 py-0.5 text-xs transition-colors",
								interactionMode === "point"
									? "bg-neutral-700 text-neutral-200"
									: "text-neutral-500 hover:text-neutral-300",
							)}
							title="Click to annotate a point"
						>
							Point
						</button>
						<button
							type="button"
							onClick={() => setInteractionMode("area")}
							className={cn(
								"rounded px-2 py-0.5 text-xs transition-colors",
								interactionMode === "area"
									? "bg-neutral-700 text-neutral-200"
									: "text-neutral-500 hover:text-neutral-300",
							)}
							title="Drag to select an area"
						>
							Area
						</button>
						<button
							type="button"
							onClick={() => setInteractionMode("text")}
							className={cn(
								"rounded px-2 py-0.5 text-xs transition-colors",
								interactionMode === "text"
									? "bg-neutral-700 text-neutral-200"
									: "text-neutral-500 hover:text-neutral-300",
							)}
							title="Click text to annotate it"
						>
							Text
						</button>
						<div className="mx-2 h-4 w-px bg-neutral-700" />
						<button
							type="button"
							onClick={handleToggleAnimations}
							className={cn(
								"rounded px-2 py-0.5 text-xs transition-colors",
								animationsPaused
									? "bg-amber-600 text-neutral-100"
									: "text-neutral-500 hover:text-neutral-300",
							)}
							title={
								animationsPaused
									? "Resume device animations"
									: "Pause device animations for stable screenshots"
							}
						>
							{animationsPaused ? "Animations Paused" : "Pause Animations"}
						</button>
					</div>
				)}
				<ScreenMirror
					frameUrl={frameUrl}
					connected={connected}
					error={mirrorError}
					annotations={filteredAnnotations}
					selectedAnnotationId={liveSelectedAnnotation?.id ?? null}
					recentlyResolved={recentlyResolved}
					interactionMode={interactionMode}
					textRegions={mergedTextRegions}
					ocrLoading={ocrLoading}
					onClickScreen={handleScreenClick}
					onAreaSelect={handleAreaSelect}
					onTextSelect={handleTextSelect}
					onSelectAnnotation={handleSelectAnnotation}
				/>
			</main>

			{/* Annotation form popup */}
			{clickCoords && (
				<AnnotationForm
					x={clickCoords.x}
					y={clickCoords.y}
					element={clickCoords.element}
					inspectingElement={clickCoords.inspecting}
					selectedArea={clickCoords.selectedArea}
					selectedText={clickCoords.selectedText}
					onSubmit={handleAnnotationSubmit}
					onCancel={() => setClickCoords(null)}
					submitting={submittingAnnotation}
				/>
			)}

			{/* Keyboard shortcuts overlay */}
			{showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}
		</div>
	);
}
