# agentation-mobile

[![npm version](https://img.shields.io/npm/v/agentation-mobile)](https://www.npmjs.com/package/agentation-mobile)

Visual feedback for mobile apps. Point at elements on your phone screen, write feedback, and your AI coding agent gets the exact component name, source file, and bounding box — no more describing "the blue button at the top."

## Install

```bash
npm install agentation-mobile -D
```

## Usage

```bash
npx agentation-mobile start
# Open http://localhost:4747
# Hover to highlight, click to annotate, copy or MCP
```

Your mobile app runs in a simulator/emulator. The web UI mirrors the screen — hover to see component names, click to annotate, write your feedback.

### In-App SDKs

For richer element data (component paths, source files, animations), add the SDK to your app:

**React Native**
```tsx
import { AgentationProvider, AgentationOverlay } from '@agentation-mobile/react-native-sdk';

export default function App() {
  return (
    <AgentationProvider>
      <YourApp />
      <AgentationOverlay />
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

Then tell your agent: _"address my feedback"_ or _"fix annotation 3."_

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
