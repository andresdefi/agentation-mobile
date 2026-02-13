# agentation-mobile — Roadmap to Feature Parity

Goal: Make agentation-mobile the definitive "Agentation for mobile apps" — same zero-friction visual feedback loop, but for React Native, Flutter, iOS, and Android.

---

## Phase 1: Core Agent Value (The "Why It Works" Features)

These are what make Agentation useful for AI agents. Without them, the tool is just a screenshot annotator.

### 1.1 Hands-Free Watch Mode (Blocking + Batch Window)

The most powerful Agentation workflow: agent calls `watch_annotations`, blocks waiting for new annotations, developer annotates freely in the browser, agent picks up batches and fixes autonomously in a loop.

**Current state:** `watch_annotations` returns current pending immediately. No blocking, no batching.

**Changes:**

- [x] Add `mode` parameter to `watch_annotations` tool: `"poll"` (current behavior) or `"blocking"` (new)
- [x] Add `batchWindowMs` parameter (default 10000ms) — how long to collect annotations before returning
- [x] Add `maxWaitMs` parameter (default 300000ms / 5min) — max time to block before returning empty
- [x] Implement blocking logic: subscribe to EventBus `annotation:created` events, accumulate during batch window, return batch
- [x] Return count of new annotations since last watch call for agent context
- [x] Update MCP tool description to explain the two modes

**Files:**
- `packages/mcp/src/mcp-server.ts` — watch_annotations tool
- `packages/mcp/src/mcp-server.test.ts` — test both modes

### 1.2 Surface Source File References in Annotations

Agentation gives agents greppable output like `App > Dashboard > Button` and `button.cta`. agentation-mobile has `componentFile` and `componentPath` but doesn't include element context when creating annotations from the web UI.

**Current state:** Web UI creates annotations with position + comment but does NOT auto-inspect the element at click coordinates. Element data only available via separate `inspect_element` call.

**Changes:**

- [x] Web UI: On click, call `GET /api/devices/:deviceId/inspect?x=<px>&y=<py>` before showing annotation form
- [x] Pre-populate element info in annotation form (show component name, file, path)
- [x] Include element data in `POST /api/annotations` body
- [x] MCP `get_session` and `get_pending` responses: ensure `element.componentFile` and `element.componentPath` are prominently included
- [x] Add `sourceRef` summary field to MCP output: `"Button (src/screens/Login.tsx:42)"` — one line the agent can grep
- [x] Test: annotation created from web UI includes element context

**Files:**
- `packages/web-ui/src/App.tsx` — handleScreenClick
- `packages/web-ui/src/hooks/use-annotations.ts` — createAnnotation
- `packages/server/src/server.ts` — POST /api/annotations (accept element field)
- `packages/mcp/src/mcp-server.ts` — format output with sourceRef

### 1.3 Copy-to-Clipboard Structured Markdown

Agentation's default mode is copy structured markdown — no server needed, works with any AI tool (paste into ChatGPT, Claude web, etc).

**Current state:** Export menu downloads JSON/Markdown files. No quick copy button.

**Changes:**

- [x] Add "Copy" button to web UI toolbar (next to Export menu)
- [x] Format all session annotations as structured markdown optimized for AI agents
- [x] Include for each annotation: comment, intent, severity, status, component path, source file, position
- [x] Copy to clipboard with `navigator.clipboard.writeText()`
- [x] Show toast/feedback on copy ("Copied 5 annotations")
- [x] Keyboard shortcut: `C` to copy all annotations

**Files:**
- `packages/web-ui/src/App.tsx` — add copy button + shortcut
- `packages/web-ui/src/components/CopyButton.tsx` — new component (or inline)
- `packages/core/src/export.ts` — add `exportToAgentMarkdown()` function (compact, greppable format)

---

## Phase 2: Platform Completeness

### 2.1 Flutter SDK (Dart Overlay Widget)

**Current state:** Dart files exist (`lib/` with Provider, Overlay, Pin, Models) but the TypeScript `src/index.ts` is a placeholder. The Dart code mirrors the React Native SDK pattern.

**Changes:**

- [x] Verify Flutter SDK Dart code is complete and functional (Provider, Overlay, Pin widget, Models)
- [ ] Test with a real Flutter app: `agentation_mobile` package import, Provider wrapping, Overlay rendering
- [x] Add README for Flutter SDK with usage instructions
- [x] Ensure annotation creation works: long-press → form → POST to server
- [x] Ensure annotation pins render at correct positions
- [x] Ensure connection indicator shows server status
- [x] Add to pubspec.yaml any missing dependencies (http package for REST calls)
- [x] Verify `flutter pub get` works cleanly

**Files:**
- `sdks/flutter/lib/src/*.dart` — verify all implementations
- `sdks/flutter/pubspec.yaml` — verify dependencies
- `sdks/flutter/README.md` — create usage docs

### 2.2 iOS Element Tree Extraction

**Current state:** `bridge-ios` uses `xcrun simctl ui <deviceId> accessibility` which returns accessibility hierarchy. Parsing works but is limited to accessibility-level properties. No source file mapping (inherent iOS limitation without debug symbols).

**Changes:**

- [x] Improve `parseAccessibilityTree()` to handle more element types and edge cases
- [x] Add `inspectElement(deviceId, x, y)` — find element at coordinates using bounding box intersection from accessibility tree
- [x] Add class name extraction from accessibility output where available
- [ ] Add view controller hierarchy detection via `simctl ui` or `instruments`
- [x] Document iOS limitations: no source file mapping without in-app SDK
- [ ] Test with a real iOS simulator app
- [x] Fallback: when accessibility tree is empty, return a single root element with screenshot only

**Files:**
- `packages/bridges/bridge-ios/src/ios-bridge.ts` — parseAccessibilityTree, inspectElement
- `packages/bridges/bridge-ios/src/ios-bridge.test.ts` — unit tests for parsing

---

## Phase 3: Web UI Polish

### 3.1 Multi-Device UI (Device Tabs)

**Current state:** Web UI supports one device at a time. API supports multi-device sessions but UI has single `selectedDevice` state.

**Changes:**

- [x] Replace single device selector with tabbed device bar
- [x] Each tab maintains: device info, session ID, screen mirror connection, annotation list
- [x] Add "+" button to add another device to the session
- [x] Show device name + platform icon in each tab
- [ ] Side-by-side view option: show 2 device screens simultaneously
- [x] Annotations scoped to active tab's device (using `getSessionAnnotationsByDevice`)
- [x] Tab close button to remove device from session

**Files:**
- `packages/web-ui/src/App.tsx` — tabbed state management
- `packages/web-ui/src/components/DeviceTabs.tsx` — new component
- `packages/web-ui/src/hooks/use-screen-mirror.ts` — support multiple connections

### 3.2 Resolution Animations

**Current state:** SSE events fire on status changes but web UI just updates annotation status text. No visual celebration.

**Changes:**

- [x] On `annotation:status` event with `resolved` status: animate the pin
- [x] Pin animation: scale up briefly + color transition to green + checkmark icon + fade/shrink after 2s
- [x] Use `motion/react` for the animation (per project conventions)
- [x] Respect `prefers-reduced-motion` — skip animation, just update color
- [ ] Optional: brief confetti/sparkle on the pin position
- [x] Toast notification: "Annotation resolved by agent"

**Files:**
- `packages/web-ui/src/components/ScreenMirror.tsx` — pin animation logic
- `packages/web-ui/src/hooks/use-annotations.ts` — track recently-resolved for animation trigger

### 3.3 Keyboard Shortcuts

**Current state:** Escape, 1-4 (status filters), R (back to list). Missing intent filters and actions.

**Changes:**

- [x] `F` — filter by "fix" intent
- [x] `Q` — filter by "question" intent
- [x] `G` — filter by "change" intent (C is taken by copy)
- [x] `A` — filter by "approve" intent
- [x] `C` — copy annotations to clipboard
- [x] `E` — open export menu
- [ ] `D` — toggle device panel
- [x] `T` — toggle element tree panel
- [x] `N` — next annotation
- [x] `P` — previous annotation
- [x] Show keyboard shortcut hints in UI (small `?` button or help overlay)

**Files:**
- `packages/web-ui/src/App.tsx` — keyboard handler
- `packages/web-ui/src/components/KeyboardShortcuts.tsx` — help overlay (optional)

---

## Phase 4: Advanced Features

### 4.1 Text Selection / OCR on Screenshots

Allow selecting text visible in mobile screenshots to flag typos or content issues.

**Changes:**

- [x] Research OCR options: Tesseract.js (client-side) vs server-side OCR
- [x] Add "Text mode" toggle to web UI toolbar
- [x] In text mode: OCR the current screenshot frame, overlay detected text regions
- [x] Allow click-to-select text regions
- [x] Include `selectedText` field in annotation
- [x] Add `selectedText` to `MobileAnnotation` schema

**Files:**
- `packages/core/src/schemas/mobile-annotation.ts` — add selectedText field
- `packages/web-ui/src/components/ScreenMirror.tsx` — text selection overlay
- `packages/web-ui/src/hooks/use-ocr.ts` — new hook for OCR processing
- `packages/server/src/server.ts` — optional server-side OCR endpoint

### 4.2 Area/Region Selection

Allow drag-selecting empty space or layout regions for feedback on spacing, gaps, or missing content.

**Changes:**

- [x] Add "Area mode" toggle to web UI toolbar
- [x] In area mode: click + drag draws a selection rectangle
- [x] Store selection as `{ x, y, width, height }` in percentages
- [x] Add `selectedArea` field to `MobileAnnotation` schema
- [x] Show selection rectangle as annotation overlay (dashed border)
- [x] Include area dimensions in MCP output

**Files:**
- `packages/core/src/schemas/mobile-annotation.ts` — add selectedArea field
- `packages/web-ui/src/components/ScreenMirror.tsx` — drag selection handler
- `packages/web-ui/src/components/AreaSelection.tsx` — selection rectangle component

### 4.3 Output Detail Levels

Agentation has Compact/Standard/Detailed/Forensic levels. Useful for controlling token usage.

**Changes:**

- [x] Add `detailLevel` parameter to MCP export/get tools: `"compact"` | `"standard"` | `"detailed"` | `"forensic"`
- [x] Compact: comment + intent + severity only
- [x] Standard: + position, device, component name (default)
- [x] Detailed: + element tree context, bounding boxes, thread
- [x] Forensic: + full element properties, accessibility, styles, nearby elements
- [ ] Settings in web UI to select default detail level
- [ ] Apply detail level to copy-to-clipboard output

**Files:**
- `packages/core/src/export.ts` — detail level formatting
- `packages/mcp/src/mcp-server.ts` — detailLevel parameter on relevant tools

---

## Phase 5: Ecosystem

### 5.1 Published Annotation Schema

**Changes:**

- [x] Create `schema/annotation.v1.json` — JSON Schema for `MobileAnnotation`
- [x] Generate from Zod schema using `zod-to-json-schema`
- [x] Document the schema fields with descriptions
- [x] Version the schema (`v1`)
- [ ] Reference in README

**Files:**
- `packages/core/src/schema-export.ts` — JSON Schema generator
- `schema/annotation.v1.json` — generated schema file

### 5.2 Privacy-First Local Mode

Agentation stores annotations in localStorage by default, no server needed. For mobile, this means the in-app SDK should work without a running server for basic annotation capture.

**Changes:**

- [x] React Native SDK: add local-only mode (AsyncStorage for annotations)
- [x] Flutter SDK: add local-only mode (SharedPreferences for annotations)
- [x] In local mode: annotations stored on device, exportable via share sheet
- [x] Server connection is opt-in, not required
- [x] Copy/share annotations as structured text from the app

**Files:**
- `sdks/react-native/src/AgentationProvider.tsx` — local storage fallback
- `sdks/flutter/lib/src/agentation_provider.dart` — local storage fallback

### 5.3 SDK-First Getting Started

Make the in-app SDK the primary path for React Native and Flutter developers, like Agentation's `<Agentation />`.

**Changes:**

- [ ] README: lead with SDK usage, CLI/web UI as secondary
- [ ] SDK auto-discovers server if running (scan localhost:4747)
- [ ] SDK works standalone without server (local mode, see 5.2)
- [ ] Add `npx agentation-mobile init` CLI command that generates SDK setup code for the detected framework
- [ ] One-liner setup: `npx agentation-mobile init` → detects RN/Flutter → adds Provider + Overlay to app entry point

**Files:**
- `README.md` — restructure getting started
- `packages/cli/src/index.ts` — add `init` command

### 5.4 Annotation Schema Published Spec

- [ ] Publish JSON Schema at a URL (or include in package)
- [ ] Add schema validation utility function
- [ ] Version the schema for future evolution

---

## Execution Order

| Order | Phase | Items | Estimated Scope |
|-------|-------|-------|-----------------|
| 1 | 1.1 | Hands-free watch mode | Small — MCP tool changes only |
| 2 | 1.2 | Source file refs in annotations | Medium — web UI + server + MCP |
| 3 | 1.3 | Copy-to-clipboard | Small — web UI + export function |
| 4 | 2.1 | Flutter SDK verification | Medium — test existing Dart code |
| 5 | 2.2 | iOS element tree improvement | Medium — bridge parsing |
| 6 | 3.1 | Multi-device UI | Large — web UI architecture change |
| 7 | 3.2 | Resolution animations | Small — CSS/motion animations |
| 8 | 3.3 | Keyboard shortcuts | Small — event handler additions |
| 9 | 4.1 | Text selection / OCR | Large — new feature + dependency |
| 10 | 4.2 | Area/region selection | Medium — drag interaction |
| 11 | 4.3 | Output detail levels | Medium — formatting logic |
| 12 | 5.1 | Published schema | Small — schema generation |
| 13 | 5.2 | Local mode | Medium — SDK storage layer |
| 14 | 5.3 | SDK-first getting started | Medium — CLI init command + README |
