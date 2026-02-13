import { useCallback, useState } from "react";
import { cn } from "./utils";
import { useDevices } from "./hooks/use-devices";
import { useAnnotations } from "./hooks/use-annotations";
import { useScreenMirror } from "./hooks/use-screen-mirror";
import { useSessions } from "./hooks/use-sessions";
import { DeviceSelector } from "./components/DeviceSelector";
import { ScreenMirror } from "./components/ScreenMirror";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { AnnotationForm } from "./components/AnnotationForm";
import { ThreadView } from "./components/ThreadView";
import type {
	AnnotationIntent,
	AnnotationSeverity,
	DeviceInfo,
	MobileAnnotation,
} from "./types";

export function App() {
	// Device state
	const { devices, loading: devicesLoading } = useDevices();
	const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null);

	// Session state
	const { sessions, createSession } = useSessions();
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

	// Annotations
	const {
		annotations,
		loading: annotationsLoading,
		createAnnotation,
		reply,
		updateStatus,
	} = useAnnotations(activeSessionId);

	// Screen mirror
	const {
		frameUrl,
		connected,
		error: mirrorError,
	} = useScreenMirror(selectedDevice?.id ?? null);

	// UI state
	const [clickCoords, setClickCoords] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [selectedAnnotation, setSelectedAnnotation] =
		useState<MobileAnnotation | null>(null);
	const [submittingAnnotation, setSubmittingAnnotation] = useState(false);
	const [sidebarView, setSidebarView] = useState<"list" | "thread">("list");

	// Handle device selection: auto-create or reuse session
	const handleSelectDevice = useCallback(
		async (device: DeviceInfo) => {
			setSelectedDevice(device);
			setSelectedAnnotation(null);
			setSidebarView("list");

			// Look for existing session for this device
			const existingSession = sessions.find(
				(s) => s.deviceId === device.id,
			);

			if (existingSession) {
				setActiveSessionId(existingSession.id);
			} else {
				const session = await createSession(
					`${device.name} session`,
					device.id,
					device.platform,
				);
				setActiveSessionId(session.id);
			}
		},
		[sessions, createSession],
	);

	// Handle clicking on the screen mirror
	const handleScreenClick = useCallback(
		(x: number, y: number) => {
			if (!activeSessionId) return;
			setClickCoords({ x, y });
		},
		[activeSessionId],
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
				});
				setClickCoords(null);
			} finally {
				setSubmittingAnnotation(false);
			}
		},
		[clickCoords, activeSessionId, selectedDevice, createAnnotation],
	);

	// Handle selecting an annotation (from panel or pin)
	const handleSelectAnnotation = useCallback(
		(annotation: MobileAnnotation) => {
			setSelectedAnnotation(annotation);
			setSidebarView("thread");
		},
		[],
	);

	// Handle reply
	const handleReply = useCallback(
		async (annotationId: string, content: string) => {
			const updated = await reply(annotationId, content);
			setSelectedAnnotation(updated);
		},
		[reply],
	);

	// Handle status update
	const handleUpdateStatus = useCallback(
		async (
			annotationId: string,
			action: "acknowledge" | "resolve" | "dismiss",
		) => {
			const updated = await updateStatus(annotationId, action);
			setSelectedAnnotation(updated);
		},
		[updateStatus],
	);

	// Keep selectedAnnotation synced with live data
	const liveSelectedAnnotation = selectedAnnotation
		? annotations.find((a) => a.id === selectedAnnotation.id) ??
			selectedAnnotation
		: null;

	return (
		<div className="flex h-dvh bg-neutral-950 text-neutral-100">
			{/* Sidebar */}
			<aside
				className={cn(
					"flex w-80 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900",
				)}
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
						<h1 className="text-balance text-sm font-semibold tracking-tight">
							agentation-mobile
						</h1>
					</div>

					<DeviceSelector
						devices={devices}
						selectedDeviceId={selectedDevice?.id ?? null}
						onSelect={handleSelectDevice}
						loading={devicesLoading}
					/>
				</div>

				{/* Sidebar content */}
				<div className="flex flex-1 flex-col overflow-hidden">
					{sidebarView === "list" && (
						<>
							{/* Annotation count header */}
							<div className="flex items-center justify-between px-4 py-2">
								<span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
									Annotations
								</span>
								{annotations.length > 0 && (
									<span className="rounded-md bg-neutral-800 px-1.5 py-0.5 font-mono text-xs tabular-nums text-neutral-500">
										{annotations.length}
									</span>
								)}
							</div>
							<div className="flex-1 overflow-y-auto">
								<AnnotationPanel
									annotations={annotations}
									selectedAnnotationId={liveSelectedAnnotation?.id ?? null}
									onSelectAnnotation={handleSelectAnnotation}
									loading={annotationsLoading}
								/>
							</div>
						</>
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
				<div className="border-t border-neutral-800 px-4 py-2">
					<p className="text-xs text-neutral-700">
						{connected ? "Connected" : "Not connected"} --{" "}
						{annotations.filter((a) => a.status === "pending").length} pending
					</p>
				</div>
			</aside>

			{/* Main content area */}
			<main className="flex flex-1 flex-col overflow-hidden">
				<ScreenMirror
					frameUrl={frameUrl}
					connected={connected}
					error={mirrorError}
					annotations={annotations}
					selectedAnnotationId={liveSelectedAnnotation?.id ?? null}
					onClickScreen={handleScreenClick}
					onSelectAnnotation={handleSelectAnnotation}
				/>
			</main>

			{/* Annotation form popup */}
			{clickCoords && (
				<AnnotationForm
					x={clickCoords.x}
					y={clickCoords.y}
					onSubmit={handleAnnotationSubmit}
					onCancel={() => setClickCoords(null)}
					submitting={submittingAnnotation}
				/>
			)}
		</div>
	);
}
