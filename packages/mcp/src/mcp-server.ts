import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createMcpServer() {
	const server = new McpServer({
		name: "agentation-mobile",
		version: "0.1.0",
	});

	// Session tools
	// TODO: agentation_mobile_list_sessions
	// TODO: agentation_mobile_get_session
	// TODO: agentation_mobile_get_pending
	// TODO: agentation_mobile_get_all_pending
	// TODO: agentation_mobile_acknowledge
	// TODO: agentation_mobile_resolve
	// TODO: agentation_mobile_dismiss
	// TODO: agentation_mobile_reply
	// TODO: agentation_mobile_watch_annotations

	// Mobile-specific tools
	// TODO: agentation_mobile_list_devices
	// TODO: agentation_mobile_capture_screen
	// TODO: agentation_mobile_get_element_tree
	// TODO: agentation_mobile_inspect_element

	return server;
}
