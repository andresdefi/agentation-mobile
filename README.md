# agentation-mobile

[![npm version](https://img.shields.io/npm/v/agentation-mobile)](https://www.npmjs.com/package/agentation-mobile)

Visual feedback for mobile apps. Point at elements on your phone screen, write feedback, and your AI coding agent gets the exact component name, source file, and bounding box — no more describing "the blue button at the top."

## Install

```bash
npm install agentation-mobile -D
```

Or use yarn, pnpm, or bun.

## Choose your setup

- **Just want annotations?** Basic Setup below (copy-paste to agent)
- **Using Claude Code?** Add the `/agentation-mobile` skill (sets up SDK + MCP server)
- **Building a custom agent?** Run MCP server manually for real-time sync

Most users: Basic Setup. Claude Code users: Use the skill for full auto-setup.

## Basic Setup

Add the SDK to your mobile app for component-level annotation data:

**React Native**
```tsx
import { AgentationProvider, AgentationOverlay } from '@agentation-mobile/react-native-sdk';

export default function App() {
  return (
    <AgentationProvider>
      <YourApp />
      {__DEV__ && <AgentationOverlay />}
    </AgentationProvider>
  );
}
```

**Flutter**
```dart
import 'package:agentation_mobile/agentation_mobile.dart';

void main() {
  runApp(
    AgentationProvider(
      child: AgentationOverlay(child: MyApp()),
    ),
  );
}
```

SDKs are also available for **Swift/SwiftUI** and **Kotlin/Jetpack Compose**.

The overlay appears in dev/debug builds. It auto-connects to the server at `localhost:4747`.

## Claude Code

Set up agentation-mobile automatically with the `/agentation-mobile` skill:

```bash
npx skills add andresdefi/agentation-mobile
```

Then in Claude Code:

```
/agentation-mobile
```

Detects your framework, installs the SDK, wires it into your app, and configures the MCP server for auto-start.

## Agent Integration

Connect agentation-mobile to any AI coding agent that supports MCP. The MCP server auto-starts the HTTP server and web UI — one command does everything.

**Configure your agent:**

```bash
claude mcp add agentation-mobile -- npx @agentation-mobile/cli mcp
```

Or add to your project's `.mcp.json` for team-wide config:

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

The web UI opens at `http://localhost:4747`. Hover to highlight elements, click to annotate, write your feedback. Annotations sync to the agent in real-time.

Other agents: Any tool that supports MCP can connect. Point your agent's MCP config to `npx @agentation-mobile/cli mcp` and it will have access to annotation tools like `agentation_mobile_get_all_pending`, `agentation_mobile_list_sessions`, and `agentation_mobile_resolve`.

## Features

- **Click to annotate** — Hover to highlight, click any element with automatic component identification
- **Text selection** — OCR + native text regions for annotating specific text
- **Area selection** — Drag to annotate any region, even empty space
- **Captured pages** — Save screenshots with element trees for offline review and annotation
- **Multi-platform** — React Native, Flutter, iOS native, Android native
- **In-app SDKs** — Dev overlay with component paths, source files, and animation detection
- **MCP server** — 18 tools for AI agent integration (Claude Code, Cursor, etc.)
- **Watch mode** — Agent blocks waiting for new annotations, fixes them in a loop
- **Structured output** — Copy markdown with component names, source paths, and context
- **Live mirroring** — View device screens in the browser via scrcpy or screenshot polling
- **Multi-device** — Tabbed UI for annotating across multiple devices simultaneously
- **Animation detection** — Pause, inspect, and track animations across all platforms

## How it works

agentation-mobile captures component names, source file paths, and bounding boxes so AI agents can find the exact code you're referring to. Instead of describing "the login button below the email field," you give the agent `LoginButton (src/screens/Login.tsx:42)` and your feedback.

## Requirements

- Node.js 20+
- **React Native** — Metro bundler running, ADB (Android) or Xcode (iOS)
- **Flutter** — `flutter run` with Dart VM Service
- **Android native** — ADB installed, device/emulator connected
- **iOS native** — Xcode with `simctl`, simulator running

Everything runs locally. No servers, no accounts, no data leaves your machine.

## License

MIT
