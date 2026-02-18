# Direct Simulator/IDE Integration Strategy

> Research and architecture notes for moving agentation-mobile beyond the web UI mirror approach to direct simulator and IDE integration.

## Problem Statement

Currently, agentation-mobile's annotation workflow requires a separate browser tab running the web UI, which screen-mirrors the simulator device. The goal is to bring the annotation experience directly onto or next to the simulator/emulator, similar to how tools like RocketSim overlay on top of the iOS Simulator.

## Competitive Landscape

### Existing Tools (Single-Platform, No AI Agent Integration)

| Tool | Platform | What It Does | AI Integration |
|------|----------|-------------|----------------|
| [RocketSim](https://www.rocketsim.app) | iOS/Xcode only | macOS companion app: floating panel next to Simulator with grids, rulers, color picker, Figma design overlay, network monitor, recording | None |
| [UIInspector](https://forums.swift.org/t/uiinspector-runtime-ui-debugging-tool-for-ios/80109) | iOS only | In-app runtime overlay: dimension measurement, 3D hierarchy, color picker, property inspector, grid overlay | None |
| [DebugSwift](https://github.com/DebugSwift/DebugSwift) | iOS only | In-app toolkit: grid overlay, 3D view hierarchy, touch indicators, SwiftUI render tracking | None |
| [Android Layout Inspector](https://developer.android.com/studio/debug/layout-inspector) | Android only | Built into Android Studio: real-time view hierarchy, 3D mode, Compose recomposition tracking, property inspection | None |
| [uhufor/inspector](https://github.com/uhufor/inspector) | Android only | Debug overlay library for visual layout element inspection | None |
| [Agentation](https://agentation.dev/) (web) | Web only | Click elements, annotate with intent/severity, structured output for AI agents. MCP integration. React component detection. Sessions, webhooks | Full MCP |

### Key Insight

Every existing tool is locked to one platform. No tool combines:
1. Runtime UI inspection (element trees, bounding boxes, component hierarchies)
2. Structured annotation for AI agents (intent, severity, MCP tools, threaded conversations)
3. Cross-platform support (Swift, Kotlin, React Native, Flutter)

agentation-mobile is the only project at this intersection.

### Agentation (Web) 2.0 Feature Parity

Agentation 2.0 added: MCP integration, sessions, annotation schema with intent/severity, webhooks, React component detection. agentation-mobile already has all of this, plus multi-device sessions, native platform bridges, recording engine, SQLite persistence, SSE event streaming, and 18+ MCP tools.

## What We Already Have

### Bridge Architecture (Already Connects to Simulators)

The bridges already integrate directly with simulators via native tooling:

| Bridge | Connection Method | Element Source | Screenshot | Source Locations |
|--------|------------------|---------------|------------|-----------------|
| **Android** | ADB (`adb shell uiautomator dump`) | UIAutomator XML + SDK HTTP (port 4748) | `adb exec-out screencap -p` | SDK provides |
| **iOS** | `xcrun simctl` | Accessibility API + SDK HTTP (port 4748) | `xcrun simctl io screenshot` | SDK provides |
| **React Native** | CDP/Hermes WebSocket via Metro | React fiber tree + native fallback | Delegates to native | Fiber `_debugSource` |
| **Flutter** | Dart VM Service WebSocket | Widget tree + render objects | Delegates to native | `creationLocation` in VM |

All bridges implement the `IPlatformBridge` interface and use a dual data source approach:
- **System API** (UIAutomator, Accessibility, CDP, VM Service) for broad coverage
- **In-app SDK** (HTTP server on port 4748) for source locations and enriched data
- Merged via spatial overlap matching (50%+ bounding box intersection)

### In-App SDKs (Already Exist)

| SDK | Status | What It Does |
|-----|--------|-------------|
| `sdks/react-native` | Functional | Fiber tree walker, `AgentationOverlay` component, `AgentationProvider` context, animation detection, webhook support |
| `sdks/kotlin` | Functional | HTTP server on port 4748, element tree endpoint, hit-test endpoint, `ElementInspector` integration |
| `sdks/swift` | Functional | HTTP server on port 4748 (BSD sockets + GCD), same endpoints as Kotlin SDK |
| `sdks/flutter` | Placeholder | Minimal config package. Flutter integration relies on Dart VM Service inspector extensions |

### The Gap

The bridges and SDKs already do the hard work (element extraction, screenshots, source mapping). The web UI is just a visualization/interaction layer. The question is about providing a better UX for the annotation step itself.

## Integration Paths

### Path 1: macOS Companion App (RocketSim Approach)

**Effort:** Medium | **Impact:** High | **Recommended: Yes (primary)**

A native macOS SwiftUI app that overlays on/beside any simulator window.

**Technical approach:**
- Use `CGWindowListCopyWindowInfo` to find Simulator.app / Android Emulator windows by process name
- Create a transparent `NSWindow` with `level = .floating` positioned relative to the simulator window
- Track simulator window position/size changes in real-time (via accessibility observer or polling)
- Render annotation UI (element highlighting, click-to-annotate, comment panel) on the overlay
- Translate click coordinates on overlay to device coordinates using screen size ratio
- Communicate with agentation-mobile server via HTTP (same as web UI)

**Key macOS APIs:**
- `CGWindowListCopyWindowInfo(_:_:)` - enumerate windows, get bounds
- `NSWindow` with `.floating` level, `isOpaque = false`, transparent background
- `AXObserver` / accessibility notifications for window move/resize tracking
- `NSEvent.addGlobalMonitorForEvents` for click interception when needed

**Why this is the RocketSim model:**
RocketSim is NOT an Xcode extension - it's a standalone macOS app that detects the Simulator window and positions itself accordingly. This is the proven approach.

**Pros:**
- Works with ALL simulators (iOS Simulator, Android Emulator, any device mirror)
- No IDE dependency
- Unified experience across all platforms
- Single codebase (Swift/SwiftUI)

**Cons:**
- macOS-only (acceptable since simulators run on macOS anyway)
- Requires separate app install
- Need to handle various simulator window configurations

**Implementation structure:**
```
apps/
  macos-companion/
    AgentationMobile/
      App.swift                    # Main app entry
      SimulatorTracker.swift       # CGWindowListCopyWindowInfo + window tracking
      OverlayWindow.swift          # NSWindow overlay management
      AnnotationPanel.swift        # Side panel UI (SwiftUI)
      ElementHighlighter.swift     # Overlay rendering for element boundaries
      ServerClient.swift           # HTTP client to agentation-mobile server
      CoordinateMapper.swift       # Screen-to-device coordinate translation
```

### Path 2: Enhanced In-App SDK Overlays (UIInspector/DebugSwift Approach)

**Effort:** Low-Medium | **Impact:** Medium | **Recommended: Yes (parallel)**

Enhance existing SDKs to render annotation overlays directly inside the running app.

**Interaction model:**
- Long-press or shake gesture activates inspection mode
- Overlay highlights elements as finger moves, showing component name/hierarchy
- Tap to select element, type comment
- Annotation is sent to server and immediately available to AI agent via MCP

**Per-platform work:**

| SDK | Current State | Work Needed |
|-----|--------------|-------------|
| React Native | `AgentationOverlay` exists | Enhance with element highlighting on touch, annotation input UI, gesture activation |
| Swift (iOS) | HTTP server only | Add `UIWindow`-level overlay with hit-testing, element highlight views, annotation sheet |
| Kotlin (Android) | HTTP server only | Add `WindowManager` overlay or `FrameLayout` overlay with touch interception, element highlighting |
| Flutter | Placeholder | Build Dart package with `Overlay` widget, element tree walker using `WidgetInspectorService`, annotation UI |

**Pros:**
- Cross-platform, works everywhere the app runs
- Works on physical devices (not just simulators)
- No additional macOS app needed
- Developers already integrate the SDK

**Cons:**
- 4 separate overlay implementations to maintain
- Flutter SDK needs to be built from scratch in Dart
- Requires SDK integration in every app being tested
- Cannot annotate native screens outside the app (splash screens, system dialogs)

### Path 3: IDE Extensions

**Effort:** High | **Impact:** High per IDE | **Recommended: Later phase**

#### VS Code Extension (React Native + Flutter developers)
- WebView-based side panel showing live device mirror + annotation tools
- Tree view showing element hierarchy from bridge data
- Click element in panel -> highlights on device, click in tree -> scrolls to source file
- Uses VS Code's `registerWebviewViewProvider` API
- Communicates with agentation-mobile server via HTTP

#### Android Studio / IntelliJ Plugin
- Custom `ToolWindow` with embedded JCEF (Chromium) WebView
- Could integrate with existing Layout Inspector data
- Show annotation panel alongside emulator panel
- Uses [IntelliJ Platform Plugin SDK](https://plugins.jetbrains.com/docs/intellij/android-studio.html)

#### Xcode
- **Not feasible as extension.** XcodeKit Source Editor Extensions can only modify source text, not add UI panels
- The macOS companion app (Path 1) IS the Xcode integration story
- Could add "Open in Agentation" menu item via Source Editor Extension that launches companion app

**Pros:** Deep IDE integration, feels native
**Cons:** 3 separate implementations, high maintenance, Xcode barely supports it

### Path 4: Enhanced Web UI with OS-Level Integration

**Effort:** Low | **Impact:** Medium | **Recommended: Quick wins**

Keep web UI but make it feel more native:

- **Tauri/Electron wrapper**: `agentation-mobile open` launches frameless desktop window that can be positioned alongside simulator
- **Always-on-top mode**: Browser window stays above other windows
- **Deep links to IDE**: Click annotation -> opens `vscode://file/{path}:{line}` or `xed --line {line} {path}` (Xcode)
- **OS notifications**: Desktop notifications when new annotation arrives while web UI is in background
- **Keyboard shortcuts**: Global hotkeys to toggle annotation mode

## Recommended Phased Approach

### Phase 1: Quick Wins (Path 4)
- Add deep link support (annotation -> IDE) to web UI
- Add `agentation-mobile open` CLI command that launches web UI in default browser with specific window size
- Test usability improvement

### Phase 2: SDK Overlays (Path 2)
- Enhance React Native `AgentationOverlay` with tap-to-annotate flow
- Add visual overlay to Swift SDK (UIWindow-level)
- Add visual overlay to Kotlin SDK (WindowManager)
- Build Flutter SDK with Dart overlay
- This gives direct-on-device annotation for all 4 platforms

### Phase 3: macOS Companion App (Path 1)
- Build SwiftUI macOS app
- Implement simulator window tracking
- Overlay annotation UI on top of any simulator
- Distribute via Homebrew cask / direct download
- This is the premium experience and the main differentiator

### Phase 4: IDE Extensions (Path 3)
- VS Code extension first (largest developer audience for RN + Flutter)
- Android Studio plugin second
- Xcode: handled by macOS companion app

## Architecture Note

The AI agent loop (MCP tools, event bus, server, store) remains unchanged regardless of which frontend is used. The annotation can come from:
- Web UI click
- SDK overlay tap
- macOS companion app click
- IDE extension interaction
- Direct API call

All paths converge on the same HTTP API -> EventBus -> MCP pipeline. This is a strength of the current architecture.

## References

- [RocketSim](https://www.rocketsim.app) - macOS companion app model
- [RocketSim GitHub Issues](https://github.com/AvdLee/RocketSimApp/issues/102) - window positioning discussion
- [CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/1455137-cgwindowlistcopywindowinfo) - macOS window enumeration
- [NSWindow](https://developer.apple.com/documentation/appkit/nswindow) - overlay window creation
- [UIInspector](https://forums.swift.org/t/uiinspector-runtime-ui-debugging-tool-for-ios/80109) - in-app overlay model
- [DebugSwift](https://github.com/DebugSwift/DebugSwift) - iOS debugging toolkit
- [Android Layout Inspector](https://developer.android.com/studio/debug/layout-inspector) - Android Studio built-in
- [Agentation 2.0](https://agentation.dev/blog/introducing-agentation-2) - web-only predecessor
- [XcodeKit](https://developer.apple.com/documentation/xcodekit/creating-a-source-editor-extension) - limited Xcode extension API
- [IntelliJ Platform Plugin SDK](https://plugins.jetbrains.com/docs/intellij/android-studio.html) - Android Studio plugins
- [ADB UI hierarchy extraction](https://www.repeato.app/extracting-layout-and-view-information-via-adb/) - UIAutomator dump details
