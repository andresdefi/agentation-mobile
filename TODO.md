# What's Left

## Ready to Ship

The project is feature-complete with 114 passing tests, clean lint, and all builds passing. Below is what remains before a public release.

## Must Do

### 1. Publish to npm

Packages are configured but not yet published. Run:

```shell
pnpm publish:all
```

This builds all packages and publishes the 10 public ones. You'll need to be logged in to npm (`npm login`) and the `@agentation-mobile` scope must be available (or use `--access public` which is already configured).

### 2. Test on real devices

Everything was built against platform APIs but needs hands-on testing:

- [ ] Android emulator + physical device via ADB
- [ ] iOS simulator via simctl
- [ ] React Native app (Metro + Hermes CDP)
- [ ] Flutter app (Dart VM Service)
- [ ] WiFi connect/pair flow on Android
- [ ] Animation pause/resume on each platform
- [ ] Screen mirroring (scrcpy vs screenshot polling)
- [ ] `npx agentation-mobile init` in a real RN and Flutter project

### 3. Update Claude Code skill

`skills/agentation-mobile/skill.md` should be updated to include:

- Phase 4 tools: `capture_and_resolve`, `add_device_to_session`, `connect_wifi`, `export`
- Animation control tools: `pause_animations`, `resume_animations`
- Updated workflow with export and multi-device steps
- Watch mode (`blocking` mode) usage examples

## Nice to Have

### 4. CI/CD pipeline

- GitHub Actions workflow for `pnpm build && pnpm test && pnpm check`
- Auto-publish on version tag push
- Matrix test across Node 20/22

### 5. Demo / screenshots

- Record a GIF or short video showing the workflow
- Add to README for visual documentation
- Screenshot of the web UI with annotations

### 6. Scoped package naming

Currently `@agentation-mobile/*` — decide if this should be under a different npm org or simplified (e.g. just `agentation-mobile` as the single publishable package that bundles everything).

### 7. Changelog

Add a CHANGELOG.md before first public release documenting v0.1.0 features.

### 8. Error handling hardening

- Server routes don't have global error middleware
- Bridge failures could surface better error messages in the web UI
- MCP tools silently fail on some edge cases (disconnected device mid-call)

### 9. Web UI polish

- Mobile-responsive layout (the web UI itself isn't responsive for small browser windows)
- Annotation position indicators on the screen mirror when hovering list items
- Drag to reorder device tabs
- Search/filter in element tree panel

### 10. Performance monitoring

The caching (findBridge 30s TTL, Flutter VM URL 60s TTL) works but could be smarter:
- Invalidate cache when devices connect/disconnect
- Persistent bridge cache across server restarts
- Connection pooling for Flutter VM Service WebSockets

## Project Stats

- 12 packages in monorepo
- 114 tests (60 core, 19 iOS bridge, 35 MCP)
- 4 platform bridges (Android, iOS, React Native, Flutter)
- 2 in-app SDKs (React Native, Flutter)
- 18 MCP tools
- 10 CLI commands
