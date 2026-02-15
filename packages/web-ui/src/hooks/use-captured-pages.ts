import { useCallback, useRef, useState } from "react";
import type { CapturedPage, MobileElement } from "../types";

interface UseCapturedPagesResult {
	pages: CapturedPage[];
	activePageId: string | null;
	capturePage: (
		screenshotUrl: string,
		elements: MobileElement[],
		screenWidth: number,
		screenHeight: number,
		screenId: string | null,
	) => void;
	deletePage: (id: string) => void;
	setActivePage: (id: string | null) => void;
	renamePage: (id: string, label: string) => void;
}

let pageCounter = 0;

export function useCapturedPages(): UseCapturedPagesResult {
	const [pages, setPages] = useState<CapturedPage[]>([]);
	const [activePageId, setActivePageId] = useState<string | null>(null);
	const blobUrlsRef = useRef<Map<string, string>>(new Map());

	const capturePage = useCallback(
		(
			screenshotUrl: string,
			elements: MobileElement[],
			screenWidth: number,
			screenHeight: number,
			screenId: string | null,
		) => {
			// Clone the screenshot blob so it survives frame revocation
			fetch(screenshotUrl)
				.then((res) => res.blob())
				.then((blob) => {
					const clonedUrl = URL.createObjectURL(blob);
					const id = `page-${++pageCounter}`;
					blobUrlsRef.current.set(id, clonedUrl);

					const page: CapturedPage = {
						id,
						screenshotUrl: clonedUrl,
						elements: structuredClone(elements),
						screenWidth,
						screenHeight,
						screenId,
						timestamp: Date.now(),
					};

					setPages((prev) => [...prev, page]);
				});
		},
		[],
	);

	const deletePage = useCallback((id: string) => {
		const url = blobUrlsRef.current.get(id);
		if (url) {
			URL.revokeObjectURL(url);
			blobUrlsRef.current.delete(id);
		}
		setPages((prev) => prev.filter((p) => p.id !== id));
		setActivePageId((prev) => (prev === id ? null : prev));
	}, []);

	const renamePage = useCallback((id: string, label: string) => {
		setPages((prev) => prev.map((p) => (p.id === id ? { ...p, label } : p)));
	}, []);

	return {
		pages,
		activePageId,
		capturePage,
		deletePage,
		setActivePage: setActivePageId,
		renamePage,
	};
}
