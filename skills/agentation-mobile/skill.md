# agentation-mobile

Mobile UI annotation tool for AI coding agents. Annotate mobile app screens and feed structured feedback to AI agents via MCP.

## Setup

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "agentation-mobile": {
      "command": "npx",
      "args": ["@agentation-mobile/cli", "mcp"]
    }
  }
}
```

## Available MCP Tools

### Session Management
- `agentation_mobile_list_sessions` — List all annotation sessions
- `agentation_mobile_get_session` — Get session details with annotations
- `agentation_mobile_get_pending` — Get pending annotations for a session
- `agentation_mobile_get_all_pending` — Get all pending annotations across sessions
- `agentation_mobile_acknowledge` — Acknowledge an annotation
- `agentation_mobile_resolve` — Mark annotation as resolved
- `agentation_mobile_dismiss` — Dismiss an annotation
- `agentation_mobile_reply` — Reply to an annotation thread
- `agentation_mobile_watch_annotations` — Watch for new annotations (SSE)

### Mobile-Specific
- `agentation_mobile_list_devices` — List connected devices/simulators
- `agentation_mobile_capture_screen` — Capture device screenshot
- `agentation_mobile_get_element_tree` — Get UI element tree
- `agentation_mobile_inspect_element` — Inspect element at coordinates

## Workflow

1. Start the server: `npx agentation-mobile start`
2. Open `http://localhost:4747` in your browser
3. Select a device from the device list
4. Click on elements to create annotations
5. AI agents read annotations via MCP tools and respond
