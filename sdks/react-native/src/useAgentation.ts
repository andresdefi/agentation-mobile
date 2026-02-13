import { useContext } from "react";
import { AgentationContext } from "./AgentationProvider";
import type { AgentationContextValue } from "./AgentationProvider";

/**
 * Hook to access the Agentation context.
 * Must be used within an AgentationProvider.
 */
export function useAgentation(): AgentationContextValue {
	const context = useContext(AgentationContext);
	if (!context) {
		throw new Error(
			"useAgentation must be used within an AgentationProvider. " +
				"Wrap your app with <AgentationProvider> to use this hook.",
		);
	}
	return context;
}
