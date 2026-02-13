# agentation-mobile

Visual feedback for mobile apps. Point at elements on your phone screen, write feedback, and your AI coding agent gets the exact component name, source file, and bounding box — no more describing "the blue button at the top."

## Install

```shell
npm install agentation-mobile -D
```

Or run directly:

```shell
npx agentation-mobile start
```

## Usage

### Web UI

```shell
npx agentation-mobile start
# Open http://localhost:4747
# Click elements to annotate, agents read via MCP
```

### MCP

Add to your Claude Code config (`~/.claude/mcp.json`):

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

Then just tell your agent: _"address my feedback"_ or _"fix annotation 3."_

## Features

- **Live screen mirroring** — View device screens in the browser via scrcpy or screenshot polling
- **Click-to-annotate** — Click any element to create a positioned annotation with component info
- **Multi-platform** — React Native, Flutter, iOS native, Android native
- **MCP server** — 18 tools for AI agent integration (Claude Code, Cursor, etc.)
- **Element tree inspection** — Full UI component trees with source file locations
- **Text selection** — OCR + native text regions for annotating specific text
- **Area selection** — Drag to select a region for layout or spacing feedback
- **Animation control** — Pause/resume device animations for stable screenshots
- **Multi-device** — Annotate across multiple devices with tabbed interface
- **Before/after screenshots** — Capture resolution screenshots for visual diff comparison
- **In-app SDKs** — Dev overlay components for React Native and Flutter
- **Export** — JSON, Markdown, or GitHub Issues directly via `gh`
- **WiFi debugging** — Connect to Android devices wirelessly

## How you use it

1. Start the server with `npx agentation-mobile start`
2. Open `http://localhost:4747` in your browser
3. Select your device from the device picker
4. Click any element on the mirrored screen to annotate it
5. Write your feedback with intent (fix / change / question / approve) and severity
6. Press `C` to copy structured markdown, or use MCP so agents see it automatically

## How agents use it

agentation-mobile works best with AI tools that have access to your codebase (Claude Code, Cursor, etc.). When your agent reads annotations via MCP, it gets:

- **Component names** to find the right file (`LoginButton`, `ProfileCard`)
- **Source file paths** to grep your codebase (`src/screens/Login.tsx:42`)
- **Bounding boxes** to understand layout and positioning
- **Your feedback** with intent and priority

Without agentation-mobile, you'd have to describe the element ("the login button below the email field") and hope the agent guesses right. With agentation-mobile, you give it `LoginButton (src/screens/Login.tsx:42)` and it can find that directly.

## Agents talk back

With MCP integration, agents don't just read your annotations — they respond:

- _"What annotations do I have?"_ — List all feedback across sessions
- _"Should this be 24px or 16px?"_ — Agent asks for clarification via thread reply
- _"Fixed the padding"_ — Agent resolves with an after-screenshot for visual diff
- _"Clear all annotations"_ — Dismiss everything at once

Your feedback becomes a conversation, not a one-way ticket into the void.

## CLI

```shell
agentation-mobile start                # Start server + web UI
agentation-mobile mcp                  # Start MCP server (stdio)
agentation-mobile mcp --transport http # Start MCP server (HTTP)
agentation-mobile devices              # List connected devices
agentation-mobile capture              # Capture a screenshot
agentation-mobile inspect 100 200      # Inspect element at coordinates
agentation-mobile status               # Show pending annotations
agentation-mobile connect 192.168.1.5  # Connect to device over WiFi
agentation-mobile pair 192.168.1.5 37000 123456  # Pair Android device
agentation-mobile export -s <id>       # Export annotations
agentation-mobile export -s <id> -f github  # Create GitHub issues
```

## Requirements

- Node.js 20+
- **React Native** — Metro bundler running, ADB (Android) or Xcode (iOS)
- **Flutter** — `flutter run` with Dart VM Service
- **Android native** — ADB installed, device/emulator connected
- **iOS native** — Xcode with `simctl`, simulator running

Everything runs locally on your machine. No servers, no accounts, no data leaves your device.

## License

MIT
