/**
 * Detects and tracks animations in React Native apps by monkey-patching
 * the Animated API and optionally Reanimated.
 *
 * Captures: animation type, config (duration, easing, toValue), source location,
 * status (running/completed), and maps to animated values for element association.
 */

import { Animated } from "react-native";

export interface DetectedAnimation {
	id: string;
	type: "timing" | "spring" | "decay" | "loop" | "sequence" | "parallel";
	property: string;
	status: "running" | "completed" | "stopped";
	startedAt: number;
	duration?: number;
	toValue?: number;
	fromValue?: number;
	easing?: string;
	useNativeDriver?: boolean;
	sourceLocation?: {
		file: string;
		line: number;
		column?: number;
	};
	config: Record<string, unknown>;
}

type AnimationCallback = (result: { finished: boolean }) => void;

let animationCounter = 0;
let installed = false;

const activeAnimations = new Map<string, DetectedAnimation>();
const listeners = new Set<() => void>();

// Originals stored for cleanup
let originalTiming: typeof Animated.timing | null = null;
let originalSpring: typeof Animated.spring | null = null;
let originalDecay: typeof Animated.decay | null = null;
let originalLoop: typeof Animated.loop | null = null;
let originalSequence: typeof Animated.sequence | null = null;
let originalParallel: typeof Animated.parallel | null = null;

function generateAnimId(): string {
	return `anim-${++animationCounter}-${Date.now()}`;
}

function parseStackTrace(): DetectedAnimation["sourceLocation"] | undefined {
	try {
		const stack = new Error().stack;
		if (!stack) return undefined;

		const lines = stack.split("\n");
		// Skip the first few frames (Error, parseStackTrace, patch wrapper)
		// Look for the first frame that's NOT in this file or node_modules
		for (let i = 3; i < lines.length; i++) {
			const line = lines[i];
			if (
				!line.includes("AnimationDetector") &&
				!line.includes("node_modules") &&
				!line.includes("__bundle_entry")
			) {
				// Parse "at ComponentName (file.js:line:col)" or "file.js:line:col"
				const match = line.match(/(?:at\s+.+?\s+\()?(.+?):(\d+):(\d+)\)?/);
				if (match) {
					return {
						file: match[1].replace(/^.*\//, ""),
						line: Number.parseInt(match[2], 10),
						column: Number.parseInt(match[3], 10),
					};
				}
			}
		}
	} catch {
		// Ignore stack parsing errors
	}
	return undefined;
}

function notifyListeners(): void {
	for (const listener of listeners) {
		listener();
	}
}

function wrapAnimationStart(
	animation: Animated.CompositeAnimation,
	detected: DetectedAnimation,
): Animated.CompositeAnimation {
	const originalStart = animation.start.bind(animation);

	animation.start = (callback?: AnimationCallback) => {
		detected.status = "running";
		detected.startedAt = Date.now();
		activeAnimations.set(detected.id, detected);
		notifyListeners();

		originalStart((result: { finished: boolean }) => {
			detected.status = result.finished ? "completed" : "stopped";
			// Keep completed animations briefly for UI display, then remove
			setTimeout(() => {
				activeAnimations.delete(detected.id);
				notifyListeners();
			}, 2000);
			notifyListeners();
			callback?.(result);
		});
	};

	const originalStop = animation.stop.bind(animation);
	animation.stop = () => {
		detected.status = "stopped";
		activeAnimations.delete(detected.id);
		notifyListeners();
		originalStop();
	};

	return animation;
}

function patchTiming(): void {
	originalTiming = Animated.timing;

	(Animated as Record<string, unknown>).timing = (
		value: Animated.Value | Animated.ValueXY,
		config: Animated.TimingAnimationConfig,
	): Animated.CompositeAnimation => {
		const detected: DetectedAnimation = {
			id: generateAnimId(),
			type: "timing",
			property: "unknown",
			status: "running",
			startedAt: Date.now(),
			duration: config.duration ?? 500,
			toValue: typeof config.toValue === "number" ? config.toValue : undefined,
			easing: config.easing?.toString() ?? "ease",
			useNativeDriver: config.useNativeDriver,
			sourceLocation: parseStackTrace(),
			config: { ...config, toValue: config.toValue },
		};

		const animation = (originalTiming as typeof Animated.timing)(value, config);
		return wrapAnimationStart(animation, detected);
	};
}

function patchSpring(): void {
	originalSpring = Animated.spring;

	(Animated as Record<string, unknown>).spring = (
		value: Animated.Value | Animated.ValueXY,
		config: Animated.SpringAnimationConfig,
	): Animated.CompositeAnimation => {
		const detected: DetectedAnimation = {
			id: generateAnimId(),
			type: "spring",
			property: "unknown",
			status: "running",
			startedAt: Date.now(),
			toValue: typeof config.toValue === "number" ? config.toValue : undefined,
			useNativeDriver: config.useNativeDriver,
			sourceLocation: parseStackTrace(),
			config: {
				toValue: config.toValue,
				stiffness: config.stiffness,
				damping: config.damping,
				mass: config.mass,
				bounciness: config.bounciness,
				speed: config.speed,
			},
		};

		const animation = (originalSpring as typeof Animated.spring)(value, config);
		return wrapAnimationStart(animation, detected);
	};
}

function patchDecay(): void {
	originalDecay = Animated.decay;

	(Animated as Record<string, unknown>).decay = (
		value: Animated.Value | Animated.ValueXY,
		config: Animated.DecayAnimationConfig,
	): Animated.CompositeAnimation => {
		const detected: DetectedAnimation = {
			id: generateAnimId(),
			type: "decay",
			property: "unknown",
			status: "running",
			startedAt: Date.now(),
			useNativeDriver: config.useNativeDriver,
			sourceLocation: parseStackTrace(),
			config: {
				velocity: config.velocity,
				deceleration: config.deceleration,
			},
		};

		const animation = (originalDecay as typeof Animated.decay)(value, config);
		return wrapAnimationStart(animation, detected);
	};
}

function patchLoop(): void {
	originalLoop = Animated.loop;

	(Animated as Record<string, unknown>).loop = (
		animation: Animated.CompositeAnimation,
		config?: { iterations?: number; resetBeforeIteration?: boolean },
	): Animated.CompositeAnimation => {
		const detected: DetectedAnimation = {
			id: generateAnimId(),
			type: "loop",
			property: "unknown",
			status: "running",
			startedAt: Date.now(),
			sourceLocation: parseStackTrace(),
			config: { iterations: config?.iterations ?? -1 },
		};

		const looped = (originalLoop as typeof Animated.loop)(animation, config);
		return wrapAnimationStart(looped, detected);
	};
}

function patchSequence(): void {
	originalSequence = Animated.sequence;

	(Animated as Record<string, unknown>).sequence = (
		animations: Animated.CompositeAnimation[],
	): Animated.CompositeAnimation => {
		const detected: DetectedAnimation = {
			id: generateAnimId(),
			type: "sequence",
			property: "unknown",
			status: "running",
			startedAt: Date.now(),
			sourceLocation: parseStackTrace(),
			config: { count: animations.length },
		};

		const seq = (originalSequence as typeof Animated.sequence)(animations);
		return wrapAnimationStart(seq, detected);
	};
}

function patchParallel(): void {
	originalParallel = Animated.parallel;

	(Animated as Record<string, unknown>).parallel = (
		animations: Animated.CompositeAnimation[],
		config?: { stopTogether?: boolean },
	): Animated.CompositeAnimation => {
		const detected: DetectedAnimation = {
			id: generateAnimId(),
			type: "parallel",
			property: "unknown",
			status: "running",
			startedAt: Date.now(),
			sourceLocation: parseStackTrace(),
			config: { count: animations.length, stopTogether: config?.stopTogether },
		};

		const par = (originalParallel as typeof Animated.parallel)(animations, config);
		return wrapAnimationStart(par, detected);
	};
}

/**
 * Install animation detection patches.
 * Call once at app startup (inside the SDK provider).
 */
export function installAnimationDetector(): void {
	if (installed) return;
	installed = true;

	patchTiming();
	patchSpring();
	patchDecay();
	patchLoop();
	patchSequence();
	patchParallel();
}

/**
 * Remove animation detection patches and restore originals.
 */
export function uninstallAnimationDetector(): void {
	if (!installed) return;
	installed = false;

	if (originalTiming) (Animated as Record<string, unknown>).timing = originalTiming;
	if (originalSpring) (Animated as Record<string, unknown>).spring = originalSpring;
	if (originalDecay) (Animated as Record<string, unknown>).decay = originalDecay;
	if (originalLoop) (Animated as Record<string, unknown>).loop = originalLoop;
	if (originalSequence) (Animated as Record<string, unknown>).sequence = originalSequence;
	if (originalParallel) (Animated as Record<string, unknown>).parallel = originalParallel;

	activeAnimations.clear();
}

/**
 * Patch react-native-reanimated for animation detection.
 * Call this manually if your app uses reanimated:
 *
 * ```ts
 * import * as Reanimated from 'react-native-reanimated';
 * import { patchReanimated } from '@agentation-mobile/react-native-sdk';
 * patchReanimated(Reanimated);
 * ```
 */
export function patchReanimated(reanimated: Record<string, unknown>): void {
	try {
		if (!reanimated) return;

		const origWithTiming = reanimated.withTiming as ((...args: unknown[]) => unknown) | undefined;
		const origWithSpring = reanimated.withSpring as ((...args: unknown[]) => unknown) | undefined;
		const origWithDecay = reanimated.withDecay as ((...args: unknown[]) => unknown) | undefined;

		if (origWithTiming) {
			reanimated.withTiming = (
				toValue: number,
				config?: Record<string, unknown>,
				callback?: (finished: boolean) => void,
			) => {
				const detected: DetectedAnimation = {
					id: generateAnimId(),
					type: "timing",
					property: "reanimated",
					status: "running",
					startedAt: Date.now(),
					duration: (config?.duration as number) ?? 300,
					toValue,
					easing: String(config?.easing ?? "ease"),
					sourceLocation: parseStackTrace(),
					config: { ...config, toValue, library: "reanimated" },
				};
				activeAnimations.set(detected.id, detected);
				notifyListeners();

				// Reanimated animations complete on UI thread, estimate completion
				const duration = (config?.duration as number) ?? 300;
				setTimeout(() => {
					detected.status = "completed";
					notifyListeners();
					setTimeout(() => {
						activeAnimations.delete(detected.id);
						notifyListeners();
					}, 2000);
				}, duration);

				return origWithTiming(toValue, config, callback);
			};
		}

		if (origWithSpring) {
			reanimated.withSpring = (
				toValue: number,
				config?: Record<string, unknown>,
				callback?: (finished: boolean) => void,
			) => {
				const detected: DetectedAnimation = {
					id: generateAnimId(),
					type: "spring",
					property: "reanimated",
					status: "running",
					startedAt: Date.now(),
					toValue,
					sourceLocation: parseStackTrace(),
					config: { ...config, toValue, library: "reanimated" },
				};
				activeAnimations.set(detected.id, detected);
				notifyListeners();

				// Springs typically settle in ~500ms
				setTimeout(() => {
					detected.status = "completed";
					notifyListeners();
					setTimeout(() => {
						activeAnimations.delete(detected.id);
						notifyListeners();
					}, 2000);
				}, 500);

				return origWithSpring(toValue, config, callback);
			};
		}

		if (origWithDecay) {
			reanimated.withDecay = (
				config?: Record<string, unknown>,
				callback?: (finished: boolean) => void,
			) => {
				const detected: DetectedAnimation = {
					id: generateAnimId(),
					type: "decay",
					property: "reanimated",
					status: "running",
					startedAt: Date.now(),
					sourceLocation: parseStackTrace(),
					config: { ...config, library: "reanimated" },
				};
				activeAnimations.set(detected.id, detected);
				notifyListeners();

				setTimeout(() => {
					detected.status = "completed";
					notifyListeners();
					setTimeout(() => {
						activeAnimations.delete(detected.id);
						notifyListeners();
					}, 2000);
				}, 1000);

				return origWithDecay(config, callback);
			};
		}
	} catch {
		// Reanimated not installed — that's fine
	}
}

/**
 * Get all currently active/recent animations.
 */
export function getActiveAnimations(): DetectedAnimation[] {
	return Array.from(activeAnimations.values());
}

/**
 * Subscribe to animation state changes.
 * Returns an unsubscribe function.
 */
export function onAnimationChange(callback: () => void): () => void {
	listeners.add(callback);
	return () => listeners.delete(callback);
}
