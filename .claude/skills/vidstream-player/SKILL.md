---
name: vidstream-player
description: Architecture, conventions, change recipes and known bugs for the vidstream-player video SDK in Vidstream-player/ (VideoPlayer core, ControlsManager UI, CSS-in-TS theming, HLS/DASH loading, quality selector, playlist, chapters, seek thumbnails, mini player, touch gestures, keyboard shortcuts, watermark/anti-piracy, analytics + LMS progress, the React wrapper and the <video-player> web component). Use this skill for ANY bug fix, new feature, refactor, review or "how does X work" question about the player — including small edits like adding a config option, event, control button or CSS tweak — and before editing anything under Vidstream-player/src. Also use it when the user reports player misbehaviour (playback, controls, events, React/Vue/Angular integration) so you check the known-issues audit first.
---

# vidstream-player SDK

**Repo state (2026-11-03):**
- Committed on `main` up to `403bd4d` (audit fixes, test suite, the owner's dropdown change, `prepare` script).
- **Uncommitted:** the low-latency and P2P feature — `src/streaming/`, its wiring in VideoPlayer/controls/theme/React/web component/types/build, `tests/lowLatencyP2P.test.ts`, README section, and package.json/lock (p2p peer + devDependency).
- The owner commits and pushes themselves.
- Version is still 2.0.0 (no tag yet).

**Distribution:** as of 2026-11-02 the owner no longer publishes to npm. Projects install it from the public GitHub repo: `npm install github:antor-arif/vidstream-player` (pin a tag or commit: `#v2.1.0`). `dist/` is not committed; the `prepare` script (`npm run build`) builds it when npm installs the git dependency, so the build must keep working on a fresh clone with only `npm ci`. Never run `npm publish`. The old npm 2.0.0 release is frozen.

`vidstream-player` (v2.0.0) is a framework-agnostic video player written in plain TypeScript + DOM, with a React wrapper and a custom element on top. This skill is the map: read it before changing code, then open the reference file that matches the task.

## Where these skills live

The canonical copy is **in the player repo**: `Vidstream-player/.claude/skills/` (committed, so it travels to any device that clones the repo). A mirror exists at `D:ProjectsVidstream.claudeskills` on the original machine. When you change a skill, change the repo copy and mirror it to the workspace copy if that exists. Paths like `D:ProjectsVidstream` below describe the original machine; on another device the sibling folders (`vidstream-player-docs`, `Test`) may not exist.

## Workspace layout

```
D:\Projects\Vidstream\            ← not a git repo; each child below is its own repo
├─ Vidstream-player\              ← the SDK (git: github.com/antor-arif/vidstream-player, branch main). Source of truth.
├─ vidstream-player-docs\         ← Next.js docs site. Installs the PUBLISHED npm vidstream-player@2.0.0,
│                                    not this source → use the `vidstream-docs` skill for it
├─ Test\                          ← hand-run demo apps (vanilla/react/vue/angular) that depend on
│                                    "file:../../Vidstream-player" → they run Vidstream-player\dist, so rebuild first
└─ graphify-out\                  ← generated knowledge graph from June 2026 (stale; ignore unless asked)
```

Source files (`Vidstream-player/src`):

| File | Role |
|---|---|
| `components/VideoPlayer.ts` | The orchestrator class. Owns the `<video>`, state, source loading (HLS/DASH/native), all subsystems, both event channels, public API. Also `parseChaptersVtt`, `createVideoPlayer`. |
| `components/PlayerControls.ts` | `ControlsManager`: every piece of control UI, dropdowns (speed/quality/subtitles/chapters), progress bar + chapter segments, gestures, keyboard, auto-hide. Talks to the player only through `ControlsCallbacks`. `updateState()` is the single render path. |
| `components/PlayerTheme.ts` | `ThemeManager` (writes CSS vars inline on the container) + `getBaseStyles()` — the whole stylesheet as one template string (~1,350 lines of CSS). |
| `components/ThumbnailPreview.ts` | WebVTT `#xywh=` sprite parser + hover preview. |
| `components/PlaylistManager.ts` | Playlist index/navigation + side panel DOM + `playlistStyles`. |
| `components/MiniPlayer.ts` | Scroll-away floating player (repositions the whole container `position:fixed`; uses a spacer + IntersectionObserver). |
| `components/WatermarkOverlay.ts` | `WatermarkManager` (svg/image/text, 9 positions) and `AntiPiracyTextManager` (text that jumps to random positions). Inline styles only. |
| `components/Icons.ts` | Inline SVG strings keyed by name (`play pause … chapters next prev`). |
| `services/eventBus.ts` | Tiny `on/off/once/emit` bus exposed through `player.on()`. |
| `services/errorRecovery.ts` | `ErrorRecoveryManager`: exponential backoff `retryDelay * 2^n`. |
| `services/analyticsAdapter.ts` | `AnalyticsManager` + Console/Http adapters (batching, retries). |
| `services/lmsProgressService.ts` | `LMSProgressManager` (milestones, completion at 95 %, periodic save) + localStorage helpers (`vidstream_video_progress_<videoId>`). |
| `services/resumeService.ts` | Empty stub — auto-resume was removed (commit 815007a). Don't revive it silently. |
| `types/index.ts` | Every public type. `PlayerConfig`, `PlayerState`, `PlayerEvents`, `PlayerAPI`, `VidstreamPlayerInstance`. |
| `webcomponent.ts` | `VideoPlayerElement`, auto-registers **`<video-player>`**, `VidstreamPlayer` global (`window.VidstreamPlayer`). |
| `react/VideoPlayer.tsx`, `react/index.ts` | `forwardRef` wrapper that renders `<video-player>` and calls `element.initialize(config)`; `usePlayerState`, `usePlayerControls`. |
| `index.ts` | Main barrel (all classes, helpers, types, `VERSION`). |

## Commands (run inside `Vidstream-player/`)

- `npx tsc --noEmit` — strict mode, `noUnusedLocals/Parameters`. Must stay at zero errors.
- `npm run build` → `node scripts/build.js`. Deletes and rebuilds `dist/`: ESM entries (`player.esm.js`, `player.webcomponent.js`, `react-wrapper.js` + one shared `webcomponent-<hash>.mjs` chunk), `player.umd.js`, `player.css` (extracted from `getBaseStyles()` by regex), `types/` via tsc. Takes ~5 s. The Vite CJS-deprecation and stripped `"use client"` warnings are expected.
- `npm run dev` → Vite on :3000 serving the root `index.html` demo page (uses the web component).
- `npm run lint` → ESLint 8 with `.eslintrc.cjs`; must pass with 0 errors.
- `npm test` → Vitest + jsdom suite in `tests/` (126 tests in 5 files, ~8 s; `tests/lowLatencyP2P.test.ts` mocks hls.js + p2p-media-loader). `tests/setup.ts` stubs the media element; `tests/helpers.ts` has `createPlayer`, `loadMetadata`, `setMediaError`, `stubRect`, `mockFetchText`. Add a regression test for every bug you fix.
- Build output: ESM entries are `.mjs` (`player.esm.mjs`, `player.webcomponent.mjs`, `react-wrapper.mjs`); the `.js` files with the same names are re-export shims; CJS builds are `*.cjs`; `VERSION` is injected from package.json via `__VIDSTREAM_VERSION__` (`src/version.ts`).

## How the player works (short version — details in references/architecture.md)

`new VideoPlayer(container, config)` merges config with defaults, then `initialize()` runs synchronously in this order: inject extra styles → ThemeManager (inject base CSS, inline CSS vars) → create `<video>` and bind its events → ControlsManager → watermark / anti-piracy → analytics → LMS → ErrorRecoveryManager → playlist (may wrap the container in `.vp-layout-wrapper`) → mini player → `loadSource(config.source)` → thumbnail VTT and chapters VTT fetches (async) → emit `player-ready` → `plugins.analytics.init(this)`.

Every `<video>` event updates the private `state` object and then calls `controlsManager.updateState(state)`, which re-renders the controls. The controls never touch the video; they call `ControlsCallbacks` that route back to public player methods. `ControlsManager` stores a *copy* of the state (`{ ...state }`) so its `was*` transition checks work.

**Dropdown dismissal (owner's UI change, commit 75874ea):** while a menu is open, a click or tap on the video surface only closes the menu. It does not toggle playback or control visibility. A document click outside any `.vp-dropdown-wrapper` closes menus, including clicks inside the player. `ControlsManager.closeAllDropdowns()` and `hasOpenDropdown()` are public for this, and `VideoPlayer`'s container click handler calls them before its delayed play toggle. Keep this behaviour when touching click, tap or menu code; tests cover it.

**Three parallel event channels** — keep them consistent when you add or change behaviour:
1. **DOM CustomEvents** `player-*` dispatched on the container (`bubbles: true`), `detail = { type, state, data, timestamp }`. Used by the React wrapper, the web component, and plain DOM consumers.
2. **EventBus** camelCase names (`play`, `pause`, `seek`, `timeupdate`, `ended`, `buffering`, `error`, `qualityChange`, `chapterChange`, `playlistChange`) with flat typed payloads (`PlayEvent`, `SeekEvent`, …) that include `sessionId`. Consumed through `player.on()` and analytics plugins.
3. **AnalyticsManager.trackEvent** snake_case names (`play`, `seek_end`, `quality_changed`, …) when `config.analytics.enabled`.

The full event tables are in references/api-surface.md.

## Low latency + P2P (added 2026-11-02)

Config: `lowLatency: true | { targetLatency, maxLatency, maxCatchUpRate, partLoading }` and `p2p: { enabled, trackers, swarmId, iceServers, strategy: 'latency' | 'offload', uploadDisabled, maxPeers, core }`.

- **`src/streaming/hlsConfig.ts`** (pure builders; unit-test any change here):
  - `resolveLowLatency`: defaults are a 4 s target, max = target + 3, 1.1× catch-up, and parts on unless the strategy is 'offload'.
  - `buildHlsConfig`: sets `liveSyncDuration`, `liveMaxLatencyDuration`, `maxLiveSyncPlaybackRate`, `lowLatencyMode` and `backBufferLength`.
  - `buildP2PCoreConfig`: swarmId defaults to the source URL without its query string; adds trackers and strategy presets; raw `p2p.core` is merged last.
- **`src/streaming/p2p.ts`**: `loadP2PEngine()` lazily imports the optional peer `p2p-media-loader-hlsjs` (v4), falling back to the IIFE global `window.p2pml.hlsjs`. `P2PStatsTracker` turns engine events into `P2PStats`.
- **`VideoPlayer.createHls()`**:
  - It uses `HlsJsP2PEngine.injectMixin(Hls)` when `p2p.enabled` is set and WebRTC exists. Any failure falls back to plain hls.js, because P2P must never block playback.
  - `trackLatency()` runs on timeupdate (throttled to 1/s) and emits `player-latency` / bus `latency`. The badge uses hysteresis: it goes "behind" above target + 2 s and back to live at or below target + 1 s.
  - Public API: `seekToLive()`, `getLiveLatency()`, `getP2PStats()`. `player-p2p-stats` / bus `p2pStats` fire every 2 s.
  - Changing `lowLatency` or `p2p` at runtime restarts the engine.
- **Gotcha:** p2p-media-loader rewrites hls.js `liveSyncDurationCount` (up to 120 s behind live) unless the live sync point is set explicitly. `buildHlsConfig` always sets it when P2P is on.
- LL-HLS parts are not P2P segments in the library, so they always go over HTTP. P2P only serves whole segments.
- **LIVE badge:** a `<button class="vp-live-badge">`, with `.vp-live-behind` when behind, wired to the `onGoLive` callback. Its visibility comes from CSS only; an inline `display` used to hide it permanently (KI-49).
- **Tests:** `tests/lowLatencyP2P.test.ts` mocks hls.js and the p2p module.
- **Manual check:** open `assets/p2p-live.html` (through the verify server) in 2+ tabs. Query params: `?src=&target=&strategy=&trackers=&p2p=0`.
- **Default live test stream:** https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8 (1.92 s segments, no parts).
- Measured results, the stall guard (`checkP2PStall` → `safeMode`), the offload default (target 3 s ≈ 5 s actual) and the real-stream test tooling are in known-issues KI-50 and testing.md §7. Recommended 3–5 s + P2P config: `lowLatency: true, p2p: { enabled: true, strategy: 'offload' }`.

## Signed / IP-bound live URLs (added 2026-11-09, branch feat/live-streaming)

Instructly Media Engine URLs carry the token in the **path** (`/t/{exp}/{nonce}/{sig}/…`, Bunny `/bcdn_token=…/…`) and are bound to the viewer's IP; the edge answers 403 on expiry or an IP change.
- **`src/streaming/tokenRefresh.ts`** (`TokenRefresher`): TypeScript port of the Media Engine's `tools/player/hls-token-refresh.js`. One refresher per loaded source, attached to every hls.js instance rebuilt for it. It handles:
  - the `xhrSetup` URL swap, which waits for an in-flight refresh;
  - load policies with `maxNumRetry: 6` and a `shouldRetry` that refreshes on 401/403 and retries status 0 / timeouts;
  - rewriting already-parsed fragment/part URLs (needed by P2P loaders);
  - a limit of 4 refreshes per minute.
- **Configuration:** enabled by `security.refreshPlaybackUrl`, or by `security.refreshPlaybackToken` when it resolves to an `http(s)://` URL. A bare token still means "new auth header".
  - The token pattern is configurable with `security.tokenPrefixPattern`.
  - `config.source.src` is never changed, because the React wrapper would reload. Restarts use `tokenRefresher.rewrite(src)`.
- **Load policies:** installed for every hls.js load. Without a refresher, a 401/403 keeps hls.js's default (no retry, then the AUTH_ERROR UI).
- **Fatal network error with a refresher:** refresh, then `hls.loadSource(fresh)` (the last resort), within the `errorRecovery` budget.
- **Native HLS:** on `error`, or on `stalled` plus a probe that returns 403, the player refreshes and sets `video.src` again.
- **Retry budget:** refilled after 10 s of uninterrupted playback, not on the first `playing` event. Live streams use `errorRecovery.liveMaxRetries` (default 10), the backoff is capped at `maxRetryDelay` (30 s), and the budget is unlimited while `navigator.onLine === false`.
- **hls.js config precedence:** `live.latencyMode` ('standard' | 'low'; 'low' never sets `liveSync*`) wins over `lowLatency`, which wins over the legacy defaults. `config.hlsConfig` merges on top. The token-refresh settings come last, and a consumer's own `*LoadPolicy` wins.
  - Live back buffer is 30 s, and `liveMaxLatencyDurationCount` is 10 for count-based sync, applied at LEVEL_LOADED when the playlist is live.
- **API:** `onHlsCreated(hls, Hls)` runs before `loadSource`/`attachMedia`. Also bus `hlsCreated`, DOM `player-hls-created`, `getHls()` and `getDash()`.
- **Events:** `tokenRefreshed` / `tokenRefreshFailed` (DOM: `player-token-refreshed`, `player-token-refresh-failed`). They never contain the token. Use `redactUrl()` when logging URLs.
- **Test server:** `scripts/signed-live-server.mjs [8098]` is a local stand-in for the edge.
  - It uses the same token algorithm as `sign-url.js`, a 3 s TS ladder (720p + 360p) and LL-HLS 0.5 s parts.
  - The fake backend is `/api/sign?ttl=&kind=hls|llhls`. `/admin/ip?ip=` simulates a network switch, and `/admin/state?s=waiting|live|ended` drives the lifecycle.
  - It generates its media with ffmpeg, or with Docker `linuxserver/ffmpeg` when ffmpeg isn't on PATH.

## Rules that protect users of the package

1. **The public API only grows.** Never rename or remove anything exported from `src/index.ts` or `src/react/index.ts`, any `PlayerConfig` key, a public method, a DOM event name, a CSS class consumers may style (`vp-*`, `video-player-container`), or the `<video-player>` tag. Add aliases instead and mark the old name `@deprecated` in JSDoc. Breaking changes need a major version bump plus a migration note in the docs site.
2. **CSS lives in TypeScript template strings.** The base stylesheet is the template literal returned by `getBaseStyles()`. `scripts/build.js` extracts it with a regex to make `dist/player.css`, so inside that literal: no backticks and no `${…}` interpolation, and it must keep the exact shape `export function getBaseStyles(): string {\n  return \`…\`;\n}`. Feature-specific CSS (`thumbnailPreviewStyles`, `miniPlayerStyles`, `playlistStyles`) is injected only at runtime into `<style id="vp-extra-styles">` and is **not** in `dist/player.css`. Put new CSS in one of those two places deliberately.
3. **Theme values are inline styles on the container.** `ThemeManager.applyTheme` writes all `--vp-*` vars inline (merged with `defaultDarkTheme`), so a consumer stylesheet cannot override them without `!important`. New theme tokens must go in the `PlayerTheme` type, `defaultDarkTheme`, and `themeVariableMap`, and be used in CSS as `var(--vp-x, fallback)`.
4. **hls.js and dash.js stay lazy and external.** They are optional peer dependencies loaded with `await import()` and marked external in the build. Never import them statically, and never bundle them. Feature-detect APIs because consumers can have dash.js v4 or v5 (the v4-only API calls currently break DASH quality, see KI-04).
5. **Every subsystem cleans up after itself.** Anything that adds a listener to `document` or `window`, a timer, an observer, or async work must undo it in `destroy()`. Async work that resumes after an `await` must check that the player wasn't destroyed or the source didn't change in the meantime. Store bound handlers in fields (`private onX = () => …`) so they can be removed. This matters because consumers mount and unmount players constantly (React StrictMode, SPA routes, playlists).
6. **Escape user-provided strings.** Titles, chapter names, subtitle labels and error messages reach the DOM. Use `textContent` or an `escapeHtml` helper, never raw `innerHTML` interpolation, for anything that comes from config or the network. The current code violates this in several places (KI-17), so don't copy that pattern.
7. **Keep the wrappers in sync with the core.** A feature isn't done until it is reachable from vanilla JS, the React wrapper (prop, ref method or event prop) and the web component (attribute or property and method) as appropriate, and its types are exported.
8. **Types and code are the spec, not the docs.** The docs site has drifted (the wrong custom-element tag, wrong event payloads, features documented that don't work). When docs and code disagree, trust the code and flag the drift. Don't "fix" the code to match the docs without asking.

## Recipes

### Add a config option
1. `types/index.ts`: add the field with a JSDoc comment that states the default. Put it on the right sub-interface (`ControlsConfig`, `GesturesConfig`, …) or on `PlayerConfig`.
2. Set the default where that sub-config is merged: `defaultConfig` in VideoPlayer.ts, `defaultControlsConfig` in PlayerControls.ts, or the manager's constructor. Use `??`, not `||`, so `false`/`0` survive.
3. Wire it in. Many existing options are typed but never read (KI-08), so grep to make sure your option is actually consumed.
4. If it should change at runtime, handle it in `VideoPlayer.updateConfig()`. That method only does a shallow merge plus special-casing for theme/mode/watermark/antiPiracyText, so nothing else is live-updated automatically.
5. React: add it to `VideoPlayerProps`, destructure it, and include it in the config object in the init effect. If it's live-updatable, add it to the sync effect.
6. Web component: if it fits as an attribute, add it to `OBSERVED_ATTRIBUTES`, `buildConfigFromAttributes()` and `handleAttributeChange()`, and optionally a property getter/setter.
7. Export any new type from `src/index.ts` and, if React users need it, from `src/react/index.ts`.
8. Run `npx tsc --noEmit`, then `npm run build`. Then update the docs site (config page, types page, feature page) and README per the `vidstream-docs` skill.

### Add or change an event
Emit it on both channels where it makes sense: `this.emitEvent('player-foo', data)` (DOM) and `this.eventBus.emit('foo', payload)` with a typed payload interface that includes `sessionId`. Then:
- add the DOM event to `PlayerEvents`;
- export the payload type;
- add a React event prop and handler entry (`react/VideoPlayer.tsx`);
- document it on the events page.

Use `this.config.source.src` rather than `video.src` for `src` fields, because `video.src` is a `blob:` URL under HLS/DASH (KI-13).

### Add a control button
1. Add the SVG to `Icons` if needed (24×24 viewBox, `fill="currentColor"`).
2. Add a flag to `ControlsConfig` and `defaultControlsConfig`.
3. Create the button in `ControlsManager.createControls()` with `createButton(icon, label, cb)`, which handles stopPropagation and the aria-label. Add a class `vp-btn-<name>` and place it in `leftGroup` or `rightGroup`.
4. Route the action through a new `ControlsCallbacks` member that `VideoPlayer.initializeControls()` implements.
5. Reflect state in `updateState()`.
6. Decide whether it hides in live mode (the override block in `initializeControls`), in the mini player (the hide list in `miniPlayerStyles`) and at small sizes (the `vp-size-xs/sm` rules in base CSS, plus the docs `globals.css` overrides).

### Add a subsystem or manager
Follow the existing shape:
- `constructor(container, config)` → `initialize()` → `destroy()`;
- instantiate it in `VideoPlayer.initialize()` behind an `enabled` flag;
- null-check it at every call site (`this.x?.foo()`);
- call `destroy()` in `VideoPlayer.destroy()`;
- export the class from `src/index.ts`.

Styles go in an exported `xStyles` string appended in `injectExtraStyles()`.

## Verifying a change

1. `npx tsc --noEmit` and `npm run build` must both succeed.
2. **Behaviour must be checked in a real browser.** It's a media/DOM library, and several "obvious" features turned out not to work when exercised (thumbnails, top-level chapters, DASH quality). Use the harness in this skill: `node .claude/skills/vidstream-player/scripts/verify-server.mjs` (from the repo root or the workspace root; the package is auto-detected).
   - It serves the live `src/` through Vite without touching `dist/` or the package's Vite cache.
   - Drive it with the Claude-in-Chrome tools if they're available, or give the user the URL.
   - Probe recipes, test stream URLs and what needs manual or touch testing are in references/testing.md.
3. For React, Vue or Angular integration, rebuild and run the matching app in `Test/`; see references/testing.md first, because two of those apps are currently broken.

## Known issues — read before fixing or explaining behaviour

references/known-issues.md lists the open limitations and every fixed issue (KI-01…KI-52, audit fixes of 2026-11-01 plus real-stream findings of 2026-11-02), each with where and how it was fixed. Use it to:
- recognise a reported bug (or a regression of a fixed one);
- avoid re-introducing a pattern;
- check for collateral damage when you touch an area.

Add newly found problems to its "Open" section with the next free ID.

Note: `references/architecture.md` and `references/api-surface.md` were written during the pre-fix audit. Where they say an option "doesn't work", or describe a bug, the fixed list in known-issues.md is authoritative. The structural descriptions are still accurate.

## Reference files

- `references/architecture.md`: init sequence, DOM tree and CSS class map, state flow, source loading and quality pipeline, error recovery, playlist, chapters, mini player, gestures/keyboard, both wrappers, build pipeline internals. Read when working inside a subsystem.
- `references/api-surface.md`: package `exports` map, every export, a `PlayerConfig` table showing which options are actually implemented, methods, DOM/EventBus/analytics event tables, CSS variables. Read when adding or changing API, or answering "is X supported?".
- `references/known-issues.md`: the bug and gap audit described above.
- `references/testing.md`: browser harness usage, probe snippets, test streams, the `Test/` apps, a manual test checklist.
