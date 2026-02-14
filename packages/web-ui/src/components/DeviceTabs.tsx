import { useState } from "react";
import type { DeviceInfo } from "../types";
import { cn } from "../utils";

interface DeviceTab {
	device: DeviceInfo;
	sessionId: string;
}

interface DeviceTabsProps {
	tabs: DeviceTab[];
	activeTabIndex: number;
	onSelectTab: (index: number) => void;
	onCloseTab: (index: number) => void;
	onAddDevice: (device: DeviceInfo) => void;
	availableDevices: DeviceInfo[];
	devicesLoading: boolean;
}

function deviceKey(device: DeviceInfo): string {
	return `${device.id}:::${device.platform}`;
}

function platformIcon(platform: string): string {
	switch (platform) {
		case "react-native":
			return "RN";
		case "flutter":
			return "FL";
		case "ios-native":
			return "iOS";
		case "android-native":
			return "And";
		default:
			return "?";
	}
}

export function DeviceTabs({
	tabs,
	activeTabIndex,
	onSelectTab,
	onCloseTab,
	onAddDevice,
	availableDevices,
	devicesLoading,
}: DeviceTabsProps) {
	const [showAddMenu, setShowAddMenu] = useState(false);

	// Devices not already in a tab (compare by id + platform since same device can have multiple bridges)
	const unusedDevices = availableDevices.filter(
		(d) => !tabs.some((tab) => tab.device.id === d.id && tab.device.platform === d.platform),
	);

	if (tabs.length === 0) {
		return (
			<div className="flex flex-col gap-1.5">
				<span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Device</span>
				<div className="relative">
					<select
						value=""
						onChange={(e) => {
							const [id, platform] = e.target.value.split(":::");
							const device = availableDevices.find((d) => d.id === id && d.platform === platform);
							if (device) onAddDevice(device);
						}}
						disabled={devicesLoading || availableDevices.length === 0}
						className={cn(
							"w-full appearance-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 pr-8 text-sm text-neutral-100",
							"focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600",
							"disabled:cursor-not-allowed disabled:opacity-50",
						)}
					>
						{devicesLoading && <option value="">Loading devices...</option>}
						{!devicesLoading && availableDevices.length === 0 && (
							<option value="">No devices found</option>
						)}
						{!devicesLoading && availableDevices.length > 0 && (
							<option value="">Select a device</option>
						)}
						{availableDevices.map((device) => (
							<option key={deviceKey(device)} value={deviceKey(device)}>
								{device.name} ({platformIcon(device.platform)})
								{device.isEmulator ? " [Emulator]" : ""}
							</option>
						))}
					</select>
					<div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
						<svg
							className="size-4 text-neutral-500"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M19 9l-7 7-7-7"
							/>
						</svg>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Devices</span>
			<div className="flex flex-wrap items-center gap-1">
				{tabs.map((tab, i) => (
					<div
						key={deviceKey(tab.device)}
						className={cn(
							"group flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors",
							i === activeTabIndex
								? "border-neutral-600 bg-neutral-800 text-neutral-100"
								: "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300",
						)}
					>
						<button
							type="button"
							onClick={() => onSelectTab(i)}
							className="flex items-center gap-1.5"
						>
							<span className="rounded bg-neutral-700 px-1 py-0.5 font-mono text-[10px] leading-none text-neutral-400">
								{platformIcon(tab.device.platform)}
							</span>
							<span className="max-w-24 truncate">{tab.device.name}</span>
						</button>
						{tabs.length > 1 && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onCloseTab(i);
								}}
								className="ml-0.5 rounded p-0.5 text-neutral-600 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-300 group-hover:opacity-100"
								aria-label={`Close ${tab.device.name} tab`}
							>
								<svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						)}
					</div>
				))}

				{/* Add device button */}
				<div className="relative">
					<button
						type="button"
						onClick={() => setShowAddMenu((v) => !v)}
						disabled={unusedDevices.length === 0 && !devicesLoading}
						className="flex size-7 items-center justify-center rounded-lg border border-dashed border-neutral-700 text-neutral-600 transition-colors hover:border-neutral-500 hover:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
						aria-label="Add device"
						title="Add device"
					>
						<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 4v16m8-8H4"
							/>
						</svg>
					</button>

					{showAddMenu && unusedDevices.length > 0 && (
						<div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
							{unusedDevices.map((device) => (
								<button
									type="button"
									key={deviceKey(device)}
									onClick={() => {
										onAddDevice(device);
										setShowAddMenu(false);
									}}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
								>
									<span className="rounded bg-neutral-600 px-1 py-0.5 font-mono text-[10px] leading-none">
										{platformIcon(device.platform)}
									</span>
									<span className="truncate">{device.name}</span>
									{device.isEmulator && <span className="ml-auto text-neutral-600">[Emu]</span>}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Active device info */}
			{tabs[activeTabIndex] && (
				<p className="text-pretty text-xs text-neutral-600">
					{tabs[activeTabIndex].device.osVersion ?? ""}
					{" -- "}
					{tabs[activeTabIndex].device.screenWidth ?? 0}x
					{tabs[activeTabIndex].device.screenHeight ?? 0}
				</p>
			)}
		</div>
	);
}

export type { DeviceTab };
