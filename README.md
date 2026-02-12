# agentation-mobile

Mobile UI annotation tool for AI coding agents. Like [Agentation](https://agentation.dev), but for mobile apps.

Annotate React Native, Flutter, iOS, and Android app screens — then feed structured feedback to AI agents via MCP, API, or in-app SDKs.

## Features

- **Web UI** — Browser-based annotator with live screen mirroring at `localhost:4747`
- **MCP Server** — 13 tools for AI agent integration (Claude Code, Cursor, etc.)
- **Multi-platform** — React Native, Flutter, iOS native, Android native
- **In-app SDKs** — Dev overlay components for React Native and Flutter

## Quick Start

```bash
# Install and start
npx agentation-mobile start

# Open http://localhost:4747 in your browser
```

### MCP Integration

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

## Architecture

```
agentation-mobile/
├── packages/
│   ├── core/                    # Zod schemas, types, SQLite store
│   ├── server/                  # Express HTTP API, SSE, WebSocket screen feed
│   ├── mcp/                     # MCP server (stdio + HTTP transport)
│   ├── cli/                     # CLI binary
│   ├── web-ui/                  # React SPA (Vite + Tailwind)
│   └── bridges/
│       ├── bridge-core/         # IPlatformBridge interface
│       ├── bridge-react-native/ # CDP/Hermes fiber tree inspection
│       ├── bridge-flutter/      # Dart VM Service widget inspection
│       ├── bridge-android/      # ADB + UIAutomator
│       └── bridge-ios/          # xcrun simctl + accessibility
├── sdks/
│   ├── react-native/            # In-app dev overlay
│   └── flutter/                 # In-app dev overlay (Dart)
└── skills/                      # Claude Code skill
```

## Platform Support

| Platform | Device Discovery | Screenshots | Component Tree | Source Locations | Styles |
|----------|-----------------|-------------|----------------|-----------------|--------|
| React Native | Metro bundler | ADB / simctl | Fiber tree (CDP) | `_debugSource` | `memoizedProps.style` |
| Flutter | Dart VM Service | VM Service / ADB | Widget tree | `creationLocation` | Widget properties |
| Android Native | ADB | `screencap` | UIAutomator XML | No | Limited |
| iOS Native | `simctl` | `simctl screenshot` | Accessibility tree | No | No |

## MCP Tools

### Session Management
| Tool | Description |
|------|-------------|
| `agentation_mobile_list_sessions` | List all annotation sessions |
| `agentation_mobile_get_session` | Get session details with annotations |
| `agentation_mobile_get_pending` | Get pending annotations for a session |
| `agentation_mobile_get_all_pending` | Get all pending annotations across sessions |
| `agentation_mobile_acknowledge` | Acknowledge an annotation |
| `agentation_mobile_resolve` | Mark annotation as resolved |
| `agentation_mobile_dismiss` | Dismiss an annotation |
| `agentation_mobile_reply` | Reply to an annotation thread |
| `agentation_mobile_watch_annotations` | Watch for new annotations (SSE) |

### Mobile-Specific
| Tool | Description |
|------|-------------|
| `agentation_mobile_list_devices` | List connected devices/simulators |
| `agentation_mobile_capture_screen` | Capture device screenshot |
| `agentation_mobile_get_element_tree` | Get UI element tree |
| `agentation_mobile_inspect_element` | Inspect element at coordinates |

## Development

```bash
# Clone and install
git clone https://github.com/andresdefi/agentation-mobile.git
cd agentation-mobile
pnpm install

# Build all packages
pnpm build

# Dev mode (watch)
pnpm dev
```

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict)
- **Bundler**: tsup (dual CJS+ESM)
- **Web UI**: Vite + React + Tailwind CSS
- **Schemas**: Zod
- **Database**: SQLite (better-sqlite3)
- **HTTP**: Express
- **MCP**: @modelcontextprotocol/sdk
- **CLI**: Commander.js
- **Linting**: Biome
- **Testing**: Vitest

## License

MIT
