# vidstream-player — known issues and gaps

**Status (2026-11-03):** audit issues KI-01…48 fixed and committed (through `403bd4d`); KI-49…52 came from the low-latency/P2P work and real-stream testing (uncommitted at time of writing). Original note: every issue from the original audit (HEAD `1d5fafa`, v2.0.0) was fixed in one pass. The changes are uncommitted on `main` at the time of writing. Each fix has a regression test in `tests/` (run `npm test`). 61 of the 63 player and React tests fail against the original code, so they really detect the bugs. Media behaviour was also checked in Chrome through the verify harness (thumbnails, HLS and DASH quality on dash.js 5, the UMD/CDN build).

**Keeping this file current:**
- Add new problems to the "Open" section with the next free ID. Fixed IDs below are kept for reference.
- When behaviour looks wrong, check the "Open / limitations" section first, then the fixed list (a regression may have re-broken one).

## Open / limitations (not fixed, by design or untestable here)

| ID | What | Notes |
|---|---|---|
| KI-28b | iPhone fullscreen fallback (`video.webkitEnterFullscreen`, `webkitbegin/endfullscreen`) is implemented but **not device-tested** | Verify on a real iPhone before relying on it. |
| KI-36b | Mini player uses `position:fixed`; an ancestor with `transform`, `filter` or `perspective` breaks it | Fixing it needs a portal to `<body>`, which would mean re-parenting and break React ownership. |
| KI-19b | LMS `watchedPercentage` is the playback *position* (seeking to the end counts as complete) | Changing it would alter LMS semantics. Coverage tracking is a feature request. |
| KI-23b | React unmount with `playlistOptions.showPanel` verified in jsdom + React 18 only | The wrapper now renders a `display:contents` host div so React never removes the re-parented node. Check in `Test/react` if touching it. |
| KI-46 | `Test/react` links the package via `file:`. The package now has `react` as a devDependency (for tests), so linked apps need `resolve.dedupe: ['react','react-dom']` | Already added to `Test/react/vite.config.ts`. Other `file:`-linked apps need the same. |
| — | Touch gestures, PiP and fullscreen need real user activation and devices | See testing.md §5. |
| KI-50 | Real-world P2P/LL results (2026-11-02, local LL-HLS server + 3 headless Chrome viewers): latency strategy holds target exactly but shares ~0% at 3-5 s (parts are not P2P segments; urgent segments go HTTP). Offload settles ~1 segment above target; default offload target 3 s -> 4.8-5.1 s with 22-72% shared, 0 stalls. Not yet tested against the owner's real packager/CDN or across real networks/NAT. | Re-run scripts/p2p-viewers.mjs against the real stream; consider TURN servers for strict NATs. |

## Fixed in the 2026-11-01 pass

| ID | Issue | Fix (where) |
|---|---|---|
| KI-01 | Top-level `chapters` wiped on load | Kept as `initialChapters`. Per-source chapters: own → chaptersVtt → top-level (initial source only) (`VideoPlayer.applyChaptersForSource`) |
| KI-02 | Seek thumbnails never shown | `utils/vtt.ts` parser (trim, NaN-safe); preview mounted in `.vp-progress-container`, stacked above the tooltip, clamped to the bar; sprite URLs resolved against the VTT URL; previous item's thumbnails dropped |
| KI-03 | Autoplay re-played after pause+seek | `autoplayPending` consumed once per load |
| KI-04 | DASH quality broken on dash.js v5 | Feature-detects v5 (`getRepresentationsByType` / `setRepresentationForTypeById`) and v4. `defaultQuality` and `allowedQualities` apply to DASH too |
| KI-05 | HLS media-error retry leaked an Hls instance | `recoverMediaError()`, then `swapAudioCodec()`; other fatal errors restart cleanly |
| KI-06 | Retry budget never refilled; live reconnect unused | Reset on `playing`. Live streams reconnect in the background after retries run out |
| KI-07 | UMD/CDN: bare `import()` failed; no native-HLS fallback | Import failure falls back to `window.Hls` / `window.dashjs`, then native HLS, then a clear `SRC_NOT_SUPPORTED` |
| KI-08 | Dead options | `keyboardShortcuts`, initial `playbackRate`, `security` (signed URL, auth header, token refresh, auth error callback), `sdkAuth` (apiKey and domain check), `controls.progress` (alias of `seekBar`), `pip.enabled` all work. `controls.settings` is documented as reserved |
| KI-09 | Gesture options ignored | `doubleTapSeek`/`seekSeconds` drive double-tap; `longPressSpeed:false` disables it |
| KI-10 | Listener leaks after destroy | `AbortController` in VideoPlayer and ControlsManager; all timers cleared |
| KI-11 | Duplicate `session_start` | One per AnalyticsManager. `setSource()` on source changes |
| KI-12 | Inconsistent error channels | Bus `error` is always a `VidstreamError`; DOM `player-error` is always a `PlayerError` with a `VidstreamErrorCode` and `fatal`. Native `MediaError` codes are mapped. Retried errors are `fatal:false`. New `AUTH_ERROR`; `STREAM_ENDED` emitted for live |
| KI-13 | Event `src` was a blob URL | Uses `config.source.src` |
| KI-14 | Plugin `destroy()` never called | Called in `destroy()`. `init` is wrapped in try/catch |
| KI-15 | `startIndex` not loaded | `playlist[startIndex]` loads when set; otherwise `config.source` plays, the matching item is highlighted and its thumbnails/chapters fill gaps. `PlaylistItem.type` added |
| KI-16 | Async load races / destroy before import | `loadToken` + `destroyed` checks after every await |
| KI-17 | HTML injection | Playlist panel, menus, chapter list and error UI are built with `textContent` |
| KI-18 | startTime/LMS resume re-applied per load | Applied to the initial source only. `seek()` before metadata is remembered |
| KI-19 | LMS timer stacking, double `onComplete` | Interval replaced on re-init; completion once per session; duplicate analytics `ended` removed |
| KI-20 | React `onReady` never fired | Listeners attach before `initialize()`; handlers read the latest props through a ref |
| KI-21 | React double source load | Source key ref; reload only when the source really changes |
| KI-22 | React prop sync narrow/churny | All runtime-safe props synced through structural diff (inline objects OK); `onStateChange` on every event; `onSeek` prop |
| KI-23 | React unmount crash with playlist panel | `display:contents` host div owned by React (see KI-23b) |
| KI-24 | WC enter/exit were toggles | Forward to the real methods |
| KI-25 | WC attribute gaps | poster/title/video-title/src keep each other; chapters, subtitles, theme, controls, autoplay, loop, preload, playback-rate, keyboard-shortcuts and debug update live. `getSubtitleTracks()` works. The `title` tooltip is suppressed |
| KI-26 | WC destroyed on DOM move | Deferred teardown (microtask) cancelled on reconnect; re-init with the last `initialize()` config; explicit `destroy()` sticks |
| KI-27 | Keyboard too eager | Ignores editable targets and Ctrl/Cmd/Alt; Space on buttons is not double-handled; slider is focusable with aria-valuenow/valuetext and Home/End; menus have arrow/Home/End/Esc navigation |
| KI-28 | No iPhone fullscreen | webkit fallbacks (see KI-28b) |
| KI-29 | dblclick toggled play twice | Single-click toggle delayed 250 ms and cancelled by a double-click |
| KI-30 | Logo never rendered | `ThemeManager` renders `img.vp-logo` (position, alt = tenantName) |
| KI-31 | Packaging | `.mjs` ESM entries (old `.js` paths are re-export shims), CJS builds for webcomponent and react, `require` works, `public/` no longer copied, legacy script removed |
| KI-32 | `setQuality` type conflict | Both interfaces accept `QualityLevel \| number \| 'auto'` |
| KI-33 | Stale version constants | `src/version.ts`, injected from package.json (build, dev, tests) |
| KI-34 | Lint broken | `.eslintrc.cjs`; `npm run lint` passes |
| KI-35 | Stale comments, dead stub, no tests | Headers fixed, `resumeService.ts` removed, Vitest + jsdom suite (`npm test`) |
| KI-36 | Mini player quirks | Click on the docked player doesn't toggle playback; × dismisses until the user scrolls back (see KI-36b) |
| KI-37 | EventBus edge cases | `off()` removes `once()` handlers; handlers isolated with try/catch |
| KI-38 | Event ordering | Chapter index reset per load; `playlistIndex` set before emit; `player-seek` and `player-heartbeat` now emitted; seek `fromTime` uses the pre-seek position (it used to equal `toTime`) |
| KI-39 | Big play stayed "replay" | Reset on play |
| KI-41 | Test harness out of sync | `<vidstream-player>` registered as an alias (Vue/Angular demos work); `registerVideoPlayerElement(tag)` subclasses so extra tags never throw |
| KI-42 | Analytics delivery | `keepalive` + flush on `pagehide`/hidden; destroy flushes (it used to drop the queue); one session id shared with the player; heartbeat guard; adapter errors isolated |
| KI-43 | Theme defaults/overrides | Defaults live in `:where(.video-player-container)` (zero specificity) and match `defaultDarkTheme`; only explicit theme values go inline; the playlist panel gets theme vars |
| KI-44 | `updateConfig` shallow | See the JSDoc on `VideoPlayer.updateConfig` for the full list of live-applied keys; controls rebuild when needed |
| KI-47 | (found during the fix pass) ControlsManager kept a reference to the mutating state object, so every `was*` transition check was wrong | Stores a copy |
| KI-51 | (found 2026-11-02 in real-stream testing) hls.js reports a finite duration for live streams, so the player never detected live without mode:'live' (no latency, no LIVE badge) | Live now taken from hls.js LEVEL_LOADED details.live / dash.js isDynamic() |
| KI-52 | (found 2026-11-02) P2P stats counted only P2P-engine HTTP traffic; LL parts / default-loader segments were missing, inflating p2pRatio | Total from hls.js FRAG_LOADED; httpBytes = total - p2pBytes |
| KI-49 | (found 2026-11-02) LIVE badge never visible — inline display:none overrode the .vp-live rule | Badge is now a button with CSS-only visibility; turns grey and jumps to live when behind |
| KI-48 | (found during the fix pass) UMD build: `window.VidstreamPlayer` namespace was overwritten by the SDK object (`VideoPlayer`/`createVideoPlayer` missing for CDN users) | Extends the namespace instead |

## Feature gaps (not bugs) — candidates for new work
- **Captions:** no styling or settings; HLS/DASH in-manifest text and audio tracks are not surfaced (only sidecar `subtitles`).
- **Controls:** no settings menu (`controls.settings` is reserved), no audio-track selector, no frame-step or number-key seeking.
- **Platforms:** no DRM (EME / dash.js protection / hls.js `emeEnabled`), no AirPlay or Chromecast.
- **Internationalisation:** UI strings are hard-coded English.
- **Live streams:** no DVR window or "go to live" button.
- **Resume:** auto-resume was removed in v2. `startTime` and the LMS `initialProgress` are the workarounds.
- **LMS:** coverage-based progress / anti-skip.
