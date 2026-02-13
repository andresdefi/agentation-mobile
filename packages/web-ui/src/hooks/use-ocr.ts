import { useCallback, useRef, useState } from "react";
import { type Worker, createWorker } from "tesseract.js";

export interface TextRegion {
	text: string;
	/** Bounding box in percentage coordinates (0-100) relative to image */
	x: number;
	y: number;
	width: number;
	height: number;
	confidence: number;
}

interface UseOcrResult {
	regions: TextRegion[];
	loading: boolean;
	error: string | null;
	runOcr: (imageUrl: string) => Promise<void>;
	clear: () => void;
}

export function useOcr(): UseOcrResult {
	const [regions, setRegions] = useState<TextRegion[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const workerRef = useRef<Worker | null>(null);

	const runOcr = useCallback(async (imageUrl: string) => {
		setLoading(true);
		setError(null);
		setRegions([]);

		try {
			// Create worker if not already created
			if (!workerRef.current) {
				workerRef.current = await createWorker("eng");
			}

			const result = await workerRef.current.recognize(imageUrl);
			const { words } = result.data;

			if (!words || words.length === 0) {
				setRegions([]);
				setLoading(false);
				return;
			}

			// Get image dimensions from the result
			const imgWidth = result.data.width || 1;
			const imgHeight = result.data.height || 1;

			// Group words into lines based on their vertical position
			const lineThreshold = 10; // pixels
			const lines: (typeof words)[] = [];
			let currentLine: typeof words = [];
			let lastY = Number.NEGATIVE_INFINITY;

			const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
			for (const word of sorted) {
				if (word.bbox.y0 - lastY > lineThreshold && currentLine.length > 0) {
					lines.push(currentLine);
					currentLine = [];
				}
				currentLine.push(word);
				lastY = word.bbox.y0;
			}
			if (currentLine.length > 0) {
				lines.push(currentLine);
			}

			// Convert lines to text regions with percentage coordinates
			const textRegions: TextRegion[] = lines
				.map((lineWords) => {
					const text = lineWords.map((w) => w.text).join(" ");
					const x0 = Math.min(...lineWords.map((w) => w.bbox.x0));
					const y0 = Math.min(...lineWords.map((w) => w.bbox.y0));
					const x1 = Math.max(...lineWords.map((w) => w.bbox.x1));
					const y1 = Math.max(...lineWords.map((w) => w.bbox.y1));
					const avgConfidence =
						lineWords.reduce((sum, w) => sum + w.confidence, 0) / lineWords.length;

					return {
						text: text.trim(),
						x: (x0 / imgWidth) * 100,
						y: (y0 / imgHeight) * 100,
						width: ((x1 - x0) / imgWidth) * 100,
						height: ((y1 - y0) / imgHeight) * 100,
						confidence: avgConfidence,
					};
				})
				.filter((r) => r.text.length > 0 && r.confidence > 30);

			setRegions(textRegions);
		} catch (err) {
			setError(err instanceof Error ? err.message : "OCR failed");
		} finally {
			setLoading(false);
		}
	}, []);

	const clear = useCallback(() => {
		setRegions([]);
		setError(null);
	}, []);

	return { regions, loading, error, runOcr, clear };
}
