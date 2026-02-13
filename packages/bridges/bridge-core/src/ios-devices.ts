/**
 * Shared iOS device utilities for bridge implementations.
 */

/** Regex matching iOS simulator UDIDs (standard UUID format). */
export const IOS_UDID_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/** Test whether a device ID looks like an iOS simulator UDID. */
export function isIosSimulatorId(deviceId: string): boolean {
	return IOS_UDID_REGEX.test(deviceId);
}

/**
 * Known iOS simulator screen dimensions keyed by device model substring.
 * Used as a fallback when dynamic resolution detection is not available.
 */
export const IOS_SCREEN_SIZES: Record<string, { width: number; height: number }> = {
	"iPhone 16 Pro Max": { width: 440, height: 956 },
	"iPhone 16 Pro": { width: 402, height: 874 },
	"iPhone 16 Plus": { width: 430, height: 932 },
	"iPhone 16": { width: 393, height: 852 },
	"iPhone 15 Pro Max": { width: 430, height: 932 },
	"iPhone 15 Pro": { width: 393, height: 852 },
	"iPhone 15 Plus": { width: 430, height: 932 },
	"iPhone 15": { width: 393, height: 852 },
	"iPhone 14 Pro Max": { width: 430, height: 932 },
	"iPhone 14 Pro": { width: 393, height: 852 },
	"iPhone 14 Plus": { width: 428, height: 926 },
	"iPhone 14": { width: 390, height: 844 },
	"iPhone 13 Pro Max": { width: 428, height: 926 },
	"iPhone 13 Pro": { width: 390, height: 844 },
	"iPhone 13 mini": { width: 375, height: 812 },
	"iPhone 13": { width: 390, height: 844 },
	"iPhone 12 Pro Max": { width: 428, height: 926 },
	"iPhone 12 Pro": { width: 390, height: 844 },
	"iPhone 12 mini": { width: 375, height: 812 },
	"iPhone 12": { width: 390, height: 844 },
	"iPhone SE (3rd generation)": { width: 375, height: 667 },
	"iPhone SE (2nd generation)": { width: 375, height: 667 },
	"iPhone SE": { width: 375, height: 667 },
	"iPad Pro (12.9-inch)": { width: 1024, height: 1366 },
	"iPad Pro (11-inch)": { width: 834, height: 1194 },
	"iPad Air": { width: 820, height: 1180 },
	"iPad mini": { width: 744, height: 1133 },
	iPad: { width: 810, height: 1080 },
};

/**
 * Resolve the logical screen size for an iOS simulator by device name.
 * Tries longest substring match first, then falls back to a default.
 */
export function lookupIosScreenSize(deviceName: string): {
	width: number;
	height: number;
} {
	// Exact match first
	if (IOS_SCREEN_SIZES[deviceName]) {
		return IOS_SCREEN_SIZES[deviceName];
	}

	// Partial match: find the longest key that is a substring of the device name
	let bestMatch: { width: number; height: number } | null = null;
	let bestLength = 0;

	for (const [key, size] of Object.entries(IOS_SCREEN_SIZES)) {
		if (deviceName.includes(key) && key.length > bestLength) {
			bestMatch = size;
			bestLength = key.length;
		}
	}

	if (bestMatch) {
		return bestMatch;
	}

	// Default: iPhone-sized screen
	return { width: 393, height: 852 };
}
