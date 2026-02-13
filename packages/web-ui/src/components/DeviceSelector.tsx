import type { DeviceInfo } from "../types";
import { cn } from "../utils";

interface DeviceSelectorProps {
	devices: DeviceInfo[];
	selectedDeviceId: string | null;
	onSelect: (device: DeviceInfo) => void;
	loading: boolean;
}

function platformLabel(platform: string): string {
	const labels: Record<string, string> = {
		"react-native": "React Native",
		flutter: "Flutter",
		"ios-native": "iOS",
		"android-native": "Android",
	};
	return labels[platform] ?? platform;
}

export function DeviceSelector({
	devices,
	selectedDeviceId,
	onSelect,
	loading,
}: DeviceSelectorProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<label
				htmlFor="device-selector"
				className="text-xs font-medium uppercase tracking-wide text-neutral-500"
			>
				Device
			</label>
			<div className="relative">
				<select
					id="device-selector"
					value={selectedDeviceId ?? ""}
					onChange={(e) => {
						const device = devices.find((d) => d.id === e.target.value);
						if (device) onSelect(device);
					}}
					disabled={loading || devices.length === 0}
					className={cn(
						"w-full appearance-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 pr-8 text-sm text-neutral-100",
						"focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600",
						"disabled:cursor-not-allowed disabled:opacity-50",
					)}
				>
					{loading && <option value="">Loading devices...</option>}
					{!loading && devices.length === 0 && <option value="">No devices found</option>}
					{!loading && devices.length > 0 && !selectedDeviceId && (
						<option value="">Select a device</option>
					)}
					{devices.map((device) => (
						<option key={device.id} value={device.id}>
							{device.name} ({platformLabel(device.platform)})
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
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
					</svg>
				</div>
			</div>
			{selectedDeviceId && (
				<p className="text-pretty text-xs text-neutral-600">
					{devices.find((d) => d.id === selectedDeviceId)?.osVersion ?? ""}
					{" -- "}
					{devices.find((d) => d.id === selectedDeviceId)?.screenWidth ?? 0}x
					{devices.find((d) => d.id === selectedDeviceId)?.screenHeight ?? 0}
				</p>
			)}
		</div>
	);
}
