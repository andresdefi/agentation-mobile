/** Minimal cn utility for conditional class merging */
export function cn(...inputs: Array<string | false | null | undefined>): string {
	return inputs.filter(Boolean).join(" ");
}
