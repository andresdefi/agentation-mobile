# agentation-mobile

**agentation-mobile** is a visual feedback tool for mobile apps. Annotate React Native, Flutter, iOS, and Android screens — then feed structured feedback to AI coding agents via MCP.

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

## Features

- **Live screen mirroring** — View device screens in the browser at `localhost:4747`
- **Click-to-annotate** — Click any element to create a positioned annotation with component info
- **MCP server** — 18 tools for AI agent integration (Claude Code, Cursor, etc.)
- **Multi-platform** — React Native, Flutter, iOS native, Android native
- **Multi-device** — Annotate across multiple devices in a single session
- **Before/after screenshots** — Capture resolution screenshots for visual diff comparison
- **Component tree inspection** — Get full UI element trees with source file locations
- **In-app SDKs** — Dev overlay components for React Native and Flutter
- **Export** — Export annotations as JSON or Markdown for reports and GitHub issues
- **WiFi debugging** — Connect to Android devices wirelessly

## How it works

You start the server and open the web UI in your browser. The UI connects to your running mobile app via platform bridges (ADB for Android, simctl for iOS, CDP for React Native, Dart VM Service for Flutter) to mirror the screen and inspect the component tree. When you click an element, an annotation is created with the exact position, component path, source file location, and your feedback. AI agents consume these annotations via MCP tools — they can acknowledge, resolve, dismiss, reply in threads, and capture after-screenshots to verify their fixes.

## Requirements

- Node.js 20+
- **React Native** — Metro bundler running, ADB (Android) or Xcode (iOS)
- **Flutter** — `flutter run` with Dart VM Service
- **Android native** — ADB installed, device/emulator connected
- **iOS native** — Xcode with `simctl`, simulator running

## License

MIT
