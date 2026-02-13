# agentation-mobile

Mobile UI annotation tool for AI coding agents.

## Project Structure

pnpm monorepo with Turborepo. All TypeScript packages use tsup for bundling (dual CJS+ESM).

### Packages

- `packages/core` — Zod schemas, shared types, SQLite store
- `packages/server` — Express HTTP API, SSE events, WebSocket screen feed
- `packages/mcp` — MCP server (stdio + HTTP transport), 13 tools
- `packages/cli` — CLI binary (Commander.js)
- `packages/web-ui` — React SPA (Vite + Tailwind CSS)
- `packages/bridges/bridge-core` — IPlatformBridge interface
- `packages/bridges/bridge-android` — ADB + UIAutomator
- `packages/bridges/bridge-react-native` — CDP/Hermes fiber tree
- `packages/bridges/bridge-flutter` — Dart VM Service
- `packages/bridges/bridge-ios` — xcrun simctl + accessibility
- `sdks/react-native` — In-app dev overlay (React Native)
- `sdks/flutter` — In-app dev overlay (Dart/Flutter)
- `sdks/swift` — In-app dev overlay (Swift/SwiftUI, iOS native)
- `sdks/kotlin` — In-app dev overlay (Kotlin/Jetpack Compose, Android native)

### Dependency Graph

```
core → bridge-core → bridge-{android,react-native,flutter,ios}
core → server (uses all bridges)
core + server → mcp
server + mcp → cli
web-ui (standalone, talks to server via HTTP/WS)
```

## Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (topological order)
pnpm dev              # Dev mode with watch
pnpm test             # Run tests
pnpm check            # Biome lint + format check
pnpm check:fix        # Auto-fix lint/format issues
```

## Code Conventions

- TypeScript strict mode
- Biome for linting and formatting (tabs, double quotes, semicolons)
- Zod for all runtime validation and schema definitions
- Functional patterns preferred, classes only for bridge implementations
- Named exports only
- All packages use tsup with dual CJS+ESM output

## Key Data Types

- `MobileElement` — Universal UI element representation across all platforms
- `MobileAnnotation` — Annotation with position (0-100% x/y), device context, feedback, element, status, thread
- `Session` — Groups annotations for a device/session
- `IPlatformBridge` — Interface all platform bridges implement

## Testing

Vitest for unit tests. Test files go next to source files as `*.test.ts`.
