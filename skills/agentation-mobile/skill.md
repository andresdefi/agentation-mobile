---
name: agentation-mobile
description: Add agentation-mobile visual feedback to a mobile app project. Use when the user asks to "set up agentation," "add annotations," "install agentation-mobile," or wants AI-powered visual feedback for their React Native, Flutter, Swift, or Kotlin app.
---

# agentation-mobile Setup

Set up the agentation-mobile annotation tool in this project. Detects your mobile framework, installs the SDK, wires it into your app, and configures the MCP server.

## Steps

1. **Check if already installed**
   - Look for any of these in package.json, pubspec.yaml, Package.swift, or build.gradle.kts:
     - `@agentation-mobile/react-native-sdk`
     - `agentation_mobile` (Flutter/Dart)
     - `AgentationMobile` (Swift package)
     - `com.agentationmobile` (Kotlin)
   - If found, skip to step 5

2. **Check if already configured**
   - Search for `AgentationProvider` or `AgentationOverlay` in the source code
   - If found, report that agentation-mobile is already set up and skip to step 5

3. **Detect framework**
   - **React Native**: `react-native` in package.json dependencies
   - **Flutter**: `pubspec.yaml` exists at project root
   - **Swift/SwiftUI**: `*.xcodeproj` directory or `Package.swift` exists
   - **Kotlin/Compose**: `build.gradle.kts` with `androidx.compose` dependencies
   - If none detected, ask the user which framework they're using

4. **Install the SDK and add to app**

   **React Native:**
   - Install: `npm install @agentation-mobile/react-native-sdk` (or pnpm/yarn based on lockfile)
   - Find the app entry point: `App.tsx`, `App.js`, or the root component
   - Add the import and wrap the app:
   ```tsx
   import { AgentationProvider, AgentationOverlay } from '@agentation-mobile/react-native-sdk';

   // Wrap your root component:
   export default function App() {
     return (
       <AgentationProvider>
         <YourApp />
         {__DEV__ && <AgentationOverlay />}
       </AgentationProvider>
     );
   }
   ```

   **Flutter:**
   - Add to `pubspec.yaml` under dependencies: `agentation_mobile: ^0.1.0`
   - Run: `flutter pub get`
   - Find the app entry point: `lib/main.dart`
   - Add the import and wrap the app:
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

   **Swift/SwiftUI:**
   - Add SPM dependency: `https://github.com/andresdefi/agentation-mobile` (sdks/swift package)
   - Find the app entry point: `*App.swift` or the main SwiftUI view
   - Add the import and wrap the app:
   ```swift
   import AgentationMobile

   @main
   struct MyApp: App {
     var body: some Scene {
       WindowGroup {
         AgentationProvider {
           AgentationOverlay {
             ContentView()
           }
         }
       }
     }
   }
   ```

   **Kotlin/Jetpack Compose:**
   - Add Gradle dependency: `implementation("com.agentationmobile:sdk:0.1.0")`
   - Sync Gradle
   - Find the main Activity or Composable entry point
   - Add the import and wrap the app:
   ```kotlin
   import com.agentationmobile.AgentationProvider
   import com.agentationmobile.AgentationOverlay

   @Composable
   fun MyApp() {
     AgentationProvider {
       AgentationOverlay {
         YourApp()
       }
     }
   }
   ```

5. **Confirm component setup**
   - Tell the user the SDK is configured for their framework

6. **Check if MCP server already configured**
   - Run `claude mcp list` to check if `agentation-mobile` MCP server is already registered
   - If yes, skip to step 8

7. **Configure Claude Code MCP server**
   - Run: `claude mcp add agentation-mobile -- npx @agentation-mobile/cli mcp`
   - This registers the MCP server with Claude Code automatically

8. **Confirm full setup**
   - Tell the user both components are set up:
     - SDK component for in-app annotations (`AgentationProvider` + `AgentationOverlay`)
     - MCP server configured to auto-start with Claude Code
   - Tell user to restart Claude Code to load the MCP server
   - Remind them to have a simulator/emulator running with their app
   - The web UI opens at `http://localhost:4747` — hover to highlight elements, click to annotate

## Notes

- The `__DEV__` / debug check ensures the overlay only loads in development
- The MCP server auto-starts when Claude Code launches (uses npx, no global install needed)
- Port 4747 is used by default for the HTTP server and web UI
- Everything runs locally — no servers, no accounts, no data leaves the machine
- The SDK provides richer data than bridge-only mode: component paths, source file locations, animation detection
- Without the SDK, agentation-mobile still works via platform bridges (ADB, simctl, CDP, Dart VM) but with less detail
