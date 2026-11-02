# vidstream-player — architecture reference

> **Updated 2026-11-01:** written during the pre-fix audit. Bugs and "doesn't work" notes here were fixed the same day — see known-issues.md (fixed list) for current behaviour. Structure, file roles and data flow are still accurate. Additions since: `src/utils/vtt.ts`, `src/utils/security.ts`, `src/version.ts`, `<vidstream-player>` alias tag, `.mjs`/`.cjs` build outputs, `tests/`. Added 2026-11-02: `src/streaming/` (low latency + P2P), `lowLatency`/`p2p` config, `seekToLive()`/`getLiveLatency()`/`getP2PStats()`, `player-latency`/`player-p2p-stats` events, live detection from hls.js/dash.js, LIVE badge button — see SKILL.md "Low latency + P2P" and the README.

Line numbers refer to HEAD `1d5fafa` (v2.0.0). They drift as code changes, so treat them as "look near here".

## Contents
1. Initialization sequence
2. DOM tree, CSS classes and injected styles
3. State and rendering
4. Theming
5. Source loading and quality
6. Error recovery
7. Playlist
8. Chapters
9. Seek thumbnails
10. Mini player
11. Gestures and keyboard
12. Analytics and LMS
13. Web component wrapper
14. React wrapper
15. Build pipeline

---

## 1. Initialization sequence

`new VideoPlayer(container: HTMLElement | string, config: PlayerConfig)` (VideoPlayer.ts:106)
- A string container goes through `document.querySelector`, which throws if nothing is found.
- `config = { ...defaultConfig, ...config }`. The defaults are `mode 'vod', autoplay false, muted false, loop false, preload 'metadata', keyboardShortcuts true, debug false`.
- `initialize()` (L123) then runs **synchronously** in this order:
  1. `injectExtraStyles()` writes `<style id="vp-extra-styles">`, which holds the thumbnail, mini-player and playlist CSS.
  2. The container gets class `video-player-container` and `tabindex=0`.
  3. `ThemeManager(container, {...defaultDarkTheme, ...config.theme}, mode).initialize()` injects `<style id="video-player-styles">` (the base CSS), writes the CSS vars inline and sets `data-theme="custom"` and `data-mode`.
  4. `createVideoElement()` creates `<video class="video-player-video" playsinline>` with preload, poster, muted and loop applied, then calls `bindVideoEvents()`.
  5. `initializeControls()` sets up the ControlsManager, applying the live-mode overrides and the PiP button flag. It also sets chapters, subtitles and the title.
  6. WatermarkManager and AntiPiracyTextManager are created if `enabled`.
  7. `AnalyticsManager` is created if `analytics.enabled` and calls `initialize(src)`, which tracks `session_start`.
  8. `LMSProgressManager` is created if `lmsProgress.enabled`. Its callbacks are wrapped so they also save to localStorage and emit events.
  9. `ErrorRecoveryManager` is always created.
  10. `initializePlaylist()` runs if `playlist.length` is non-zero. With `showPanel` it wraps the container in `.vp-layout-wrapper` next to `.vp-playlist-panel`.
  11. `MiniPlayer` is created if `miniPlayer.enabled`.
  12. `loadSource(config.source)`.
  13. If `thumbnailVtt ?? source.thumbnails` is set, `loadThumbnailVtt()` runs (async fetch).
  14. If `chaptersVtt` is set, `loadChaptersVtt()` runs (async fetch, then it overwrites `config.chapters`).
  15. `isInitialized = true` and `emitEvent('player-ready')`. This happens inside the constructor, so listeners attached after construction miss it.
  16. `plugins.analytics.init(this)`.

`destroy()` (L1128) does the following:
- ends the analytics session;
- saves LMS progress;
- destroys every manager;
- destroys hls and dash;
- unloads and removes the `<video>`;
- removes the container class.

It does **not**:
- remove the `document` or `container` listeners (KI-10);
- unwrap the playlist wrapper;
- call `plugins.analytics.destroy`.

## 2. DOM tree, CSS classes and injected styles

Children of the container (`.video-player-container`):
```
video.video-player-video
div.vp-gradient-top / div.vp-gradient-bottom        (.visible toggled)
div.vp-title                                         (source.title; .visible)
div.vp-poster-overlay[.hidden] > button.vp-big-play > .vp-big-play-icon
div.vp-action-indicator[.animate] > .vp-action-indicator-circle > .vp-action-indicator-icon
div.vp-controls[.visible]
  div.vp-progress-container                         (only if controls.seekBar)
    div.vp-progress-tooltip[.visible] (> .vp-tooltip-chapter + .vp-tooltip-time when chapters)
    div.vp-progress[role=slider][.vp-progress--chaptered]
      .vp-progress-buffer .vp-progress-hover .vp-progress-filled
      .vp-chapter-segment[data-chapter-index] > .vp-chapter-segment-buffer + .vp-chapter-segment-fill   (per chapter)
      .vp-progress-thumb
  div.vp-control-row
    div.vp-control-group.vp-control-left
      .vp-btn-prev  .vp-btn-play  .vp-btn-next  .vp-btn-rewind  .vp-btn-forward
      .vp-volume-container > .vp-btn-volume + .vp-volume-slider-wrapper > .vp-volume-slider > .vp-volume-level + .vp-volume-thumb
      .vp-time > .vp-time-current / .vp-time-duration
      .vp-live-badge
    div.vp-control-group.vp-control-right
      .vp-dropdown-wrapper[data-dropdown=chapters|speed|subtitles|quality] > button.vp-dropdown-btn + .vp-dropdown-menu[.open]
         (menu items: .vp-dropdown-header, button.vp-dropdown-item[.active], .vp-dropdown-empty)
      .vp-btn-pip  (only if document.pictureInPictureEnabled)
      .vp-btn-fullscreen
div.vp-loading[.visible] > .vp-spinner
transient: .vp-seek-feedback-left/right, .vp-volume-feedback, .vp-speed-feedback, .vp-error (.vp-error-icon/.vp-error-message/.vp-error-retry)
optional:  .vp-watermark, .vp-anti-piracy-text, .vp-thumb-preview > img.vp-thumb-img, .vp-mini-controls > .vp-mini-close
```

State classes and attributes on the container:
- `vp-playing` / `vp-paused`
- `vp-idle` (controls auto-hidden)
- `vp-dragging`
- `vp-live`
- `vp-size-xs` (<280px), `vp-size-sm` (<400), `vp-size-md` (<560), `vp-size-lg` (<720), from a ResizeObserver; ≥720px gets no class
- `vp-mini-active`
- `vp-playlist-host`
- attributes `data-theme="custom"`, `data-mode="vod|live"`

The playlist panel uses:
- `.vp-layout-wrapper` (flex row; becomes a column under 900px viewport width)
- `.vp-playlist-panel`, `.vp-playlist-header`, `.vp-playlist-item[.active][data-index]`
- `.vp-playlist-thumb`, `.vp-playlist-title`, `.vp-playlist-duration`
- `.vp-equalizer-bar`

The docs site (`vidstream-player-docs/src/app/globals.css` ~L160-235) restyles several of these classes. Renaming any of them breaks the docs and real consumers.

Injected style elements (shared by all players on the page, rewritten on every player construction):
- `#video-player-styles` holds `getBaseStyles()`.
- `#vp-extra-styles` holds `thumbnailPreviewStyles + miniPlayerStyles + playlistStyles`.

The container base styles are `aspect-ratio: 16/9; width: 100%; overflow: hidden; position: relative; container-type: inline-size`. Anything absolutely positioned outside the container's box is clipped.

## 3. State and rendering

`PlayerState` (types L485) is a private object that is mutated in place by the video event handlers.
- `getState()` returns a shallow copy.
- `updateState()` sends it to `controlsManager.updateState()`, which redraws the following:
  - the play/pause icon;
  - the poster overlay (shown until the first play and again after `ended`, which also switches the big icon to replay);
  - the auto-hide timer (3 s, not while paused or while a dropdown is open);
  - progress (per-chapter segment fills when chapters exist);
  - the buffer, time, volume and mute icons;
  - fullscreen and PiP icons;
  - the spinner (`buffering`);
  - the speed label.
- The chapter segments are re-rendered when `duration` changes.

`emitEvent()` attaches `getState()` to every DOM event. That is how the React `usePlayerState` hook gets state.

## 4. Theming

`defaultDarkTheme` (PlayerTheme.ts:21) is merged with `config.theme`, and every key in `themeVariableMap` becomes an inline `--vp-<kebab>` var on the container:

```
primaryColor  → --vp-primary-color   accentColor  → --vp-accent-color   textColor → --vp-text-color
controlBg     → --vp-control-bg      progressColor→ --vp-progress-color bufferColor → --vp-buffer-color
hoverColor    → --vp-hover-color     borderRadius → --vp-border-radius  fontFamily → --vp-font-family
iconSize      → --vp-icon-size       tooltipBg    → --vp-tooltip-bg
logoUrl → --vp-logo-url (as url()), logoPosition → --vp-logo-position, tenantName → --vp-tenant-name   (no element renders a logo; see KI-30)
```

- Aliases are defined in the base CSS: `--vp-primary` (primary color, white), `--vp-bg` (control bg), `--vp-text`, `--vp-radius` and `--vp-font`.
- Other base vars: `--vp-transition`, `--vp-overlay-bg`, `--vp-progress-height` (set to 0 in live mode), `--vp-control-size`, `--vp-control-padding`.
- The base CSS hard-codes fallback values of red accent `#e50914` and hover `#f43f5e`. Because `defaultDarkTheme` is always applied inline, the **effective default accent is blue `#3b82f6`**. `dist/player.css` on its own (with no JS) would show red.
- There are **no theme presets** in the code, even though the file header mentions them. Presets were removed or never shipped.
- `updateConfig({ theme })` calls `applyTheme` (merging), and `updateConfig({ mode })` calls `applyModeStyles`, which only changes CSS vars. Controls are not rebuilt.

## 5. Source loading and quality

`loadSource(source)` (L642) works as follows:
1. It destroys any existing hls or dash instance, removes `.vp-error` and resets retries.
2. It picks the type: `source.type`, or for `'auto'` `detectSourceType` uses the URL extension after stripping the query (`m3u8`→hls, `mpd`→dash, `webm`, otherwise mp4).
3. It applies the poster.
4. For hls it calls `loadHLSSource`, for dash `loadDashSource`; both are async and not awaited. Otherwise it sets `video.src` and calls `load()`.
5. It sets `config.source = source` and calls `analytics.initialize`, which sends another `session_start`.
6. It sets the title.
7. It re-creates `<track>` elements from `config.subtitles`.
8. It calls `setChapters(source.chapters ?? [])`. This **overwrites `config.chapters`**, which is the cause of KI-01.

HLS (L696):
- `await import('hls.js')`. If `Hls.isSupported()`, it creates `new Hls({ enableWorker: true, lowLatencyMode: true })`, then `loadSource` and `attachMedia`.
- Otherwise, if the browser can play `application/vnd.apple.mpegurl` natively, it sets `video.src`.
- On `MANIFEST_PARSED`, the levels are processed:
  - levels with no height are dropped;
  - levels are deduped by height, keeping the highest bitrate;
  - `allowedQualities` is applied with a ±100px tolerance;
  - the result is passed to `controlsManager.updateQualities(levels, showAuto)`;
  - `defaultQuality` is applied by an exact height match on the raw level list.
- `LEVEL_SWITCHED` emits `player-quality-change` and `qualityChange`. In auto mode the button label becomes "Auto • 720p".
- `ERROR`:
  - A fatal network error is retried with `hls.startLoad()`.
  - A fatal media error calls `loadHLSSource` again (this leaks, KI-05).
  - Once retries run out, the error UI is shown.
  - A non-fatal network error also schedules `startLoad`.

DASH (L792) works as follows:
- `dashjs.MediaPlayer().create().initialize(video, src, false)` with ABR on.
- Quality detection and switching use `getBitrateInfoListFor`, `getQualityFor` and `setQualityFor`. These are **dash.js v4 APIs that no longer exist in v5**. v5 uses `getRepresentationsByType('video')`, `getCurrentRepresentationForType` and `setRepresentationForTypeByIndex`.

`setQuality(q)` accepts a `QualityLevel`, a height number or `'auto'`.
- On HLS it sets `hls.currentLevel` (an immediate switch).
- On DASH it toggles `autoSwitchBitrate` and calls `setQualityFor`.
- The controls track a manual pick in `currentQuality`. `null` means Auto.

## 6. Error recovery

`ErrorRecoveryManager`:
- Defaults: `enabled true, maxRetries 3, retryDelay 2000`.
- `scheduleRetry` waits `retryDelay * 2^retryCount` (2 s, 4 s, 8 s).
- `resetRetries` is called on `loadSource` and on `seeked`, but not after recovered playback (KI-06).
- `reportError(code, msg, fatal)` builds a `VidstreamError` and calls `config.onError`.
- `startLiveReconnect` exists but is never called.

Error UI is created by `showErrorUI(message, allowRetry)`. It builds `.vp-error` with a Retry button that calls `loadSource(config.source)`.

Error channels are inconsistent (KI-12):
- A native `<video>` error emits DOM `player-error` and bus `error` with a `PlayerError` (`code:'MEDIA_ERROR'`).
- An HLS fatal error emits DOM `player-error` (a `PlayerError` with the hls type as its code) and bus `error` (a `VidstreamError`).
- A DASH error emits only bus `error`.

## 7. Playlist

`PlaylistManager(items, options)`:
- Defaults are `autoNext true, loop false, showPanel false, startIndex 0`.
- `next()`, `prev()` and `goTo()` move the index, fire `onChange` and update the panel.
- With `loop`, `hasNext`/`hasPrev` are true whenever there is more than one item.

`VideoPlayer.initializePlaylist()`:
- `onChange` builds a `VideoSource` from the item (src, title, poster, chapters).
- It loads the item's `thumbnailVtt`, then calls `loadSource`.
- It emits `player-playlist-change` and bus `playlistChange`, then sets `state.playlistIndex` (after emitting).
- With `showPanel` it wraps the container in `.vp-layout-wrapper` and moves any inline width from the container to the wrapper.

The `ended` event auto-advances when `autoNext !== false`. `next()`, `prev()` and `goTo()` call `play()`.

The first video played is `config.source`, not `playlist[startIndex]` (KI-15). Consumers are expected to pass `source = playlist[0]`.

The panel's only toggle is `togglePanel()` on the manager, which is not exposed.

## 8. Chapters

There are three inputs: `config.chapters`, `source.chapters` (or `PlaylistItem.chapters`) and `config.chaptersVtt`.
- `normalizeChapters` maps `time` to `startTime`.
- `ControlsManager.updateChapters` shows the chapters button and renders the segments.
- `checkChapterChange` runs on `timeupdate` against `config.chapters`. It emits `player-chapter-change` and bus `chapterChange` when the index changes, and never for index -1.
- `parseChaptersVtt` takes `start --> end` blocks with the title on the following line(s) and gives them ids `"1"`, `"2"`, ….
- Chapter clicks call both `onChapterSeek` and `onSeek` (two seeks, which is harmless).

## 9. Seek thumbnails

`ThumbnailPreview.load(url)` fetches the VTT and parses cues of the form `start --> end` followed by a line `sprite.jpg#xywh=x,y,w,h`.

Hovering over the progress bar calls `show(time, pct)`, which lazily creates `.vp-thumb-preview > img` and crops the sprite with `object-position`.

This feature is non-functional today (KI-02):
- end-time parse bug;
- wrong mount point;
- sprite URLs are not resolved relative to the VTT.

## 10. Mini player

`MiniPlayer(container, {enabled, position='bottom-right', width=320})`:
1. 200 ms after init it observes the container with threshold 0.2.
2. Once the container has been in view and then leaves, `attach()` runs:
   - saves the inline styles;
   - inserts a spacer of the same size;
   - makes the container `position:fixed` (16:9 at `width`, 20px from the chosen corner);
   - adds `vp-mini-active` and a close button;
   - switches the observer to the spacer.
3. When the spacer comes back into view, `detach()` restores everything.
4. Clicking the mini player scrolls back to the spacer. The close button detaches permanently.

Caveat: an ancestor with `transform` or `filter` breaks `position:fixed`.

## 11. Gestures and keyboard

Touch handlers are on the container and ignore touches on controls, the poster or the big play button.
- **Long-press** (500 ms) sets the speed to `longPressSpeed` (a number, or 2) and restores it on release.
- A **vertical swipe on the right half** changes volume (×1.5 sensitivity), with a volume overlay.
- A **double-tap within 300 ms in the same third**: left or right seek by `controls.seekDuration` (not `gestures.doubleTapSeek`); the centre toggles fullscreen.
- A **single tap** (after 200 ms) toggles control visibility.
- `gestures.enabled === false` disables long-press and swipe. `doubleTapZones === false` disables double-tap.

Desktop:
- A **double-click** by thirds does rewind / fullscreen / forward.
- A **click** on the container (outside the controls) toggles play.

The keyboard handler is on the container (which is focusable) and is always bound:

| Key | Action |
|---|---|
| Space / `k` | play/pause |
| ←/→ | ±`seekDuration` |
| ↑/↓ | ±0.1 volume with overlay |
| `f` | fullscreen |
| `m` | mute |
| `c` | toggle the first subtitle track |
| Esc | close dropdowns |

Only `<input>` targets are ignored.

## 12. Analytics and LMS

`AnalyticsManager`:
- has its own sessionId (`Date.now()-random`, which is *not* `player.sessionId`);
- throttles `time_update` (default 1000 ms) and runs a heartbeat while playing (default 30 s);
- `adapter` defaults to `ConsoleAnalyticsAdapter`;
- `HttpAnalyticsAdapter` supports batching (`batchSize`, `batchTimeout`), retries with backoff, `transformPayload` and `onSuccess`/`onError`;
- `createExampleBackendAdapter(baseUrl, token)` is a template.

`LMSProgressManager`:
- `initialize(duration)` starts a save `setInterval` (default 5 s) on every `loadedmetadata` (KI-19).
- Milestones are 25/50/75/90/100. Completion happens at ≥95 % position.
- If `initialProgress.currentTime > 0` and the video is not completed, `shouldResume()` makes the player seek there on `loadedmetadata`.
- VideoPlayer wraps `onProgressSave` so it also writes localStorage and emits `player-progress-saved`.
- `onMilestoneReached` also emits `player-milestone` and tracks analytics.
- `createProgressAPICallbacks(apiConfig)` builds fetch-based callbacks with a localStorage fallback.

## 13. Web component wrapper (`webcomponent.ts`)

- The tag is `<video-player>`, auto-registered on import in a browser. `registerVideoPlayerElement(tag)` can register another name.
- `SSRHTMLElement` makes the import SSR-safe.

Lifecycle:
- `connectedCallback` → `initializePlayer()`, but only if a `src` attribute exists.
- A `src` attribute change before init also initializes.
- `disconnectedCallback` → `destroy()`, so moving the element in the DOM destroys the player.
- `initialize(config)` is the programmatic path used by React, Vue and Angular demos. It ignores attributes and calls `updateConfig` if already initialized.
- It dispatches a non-prefixed `ready` event (`detail.player`). `player-ready` also bubbles up from the inner player.

Observed attributes:
- source: `src, source-type, poster, title`
- `mode, accent-color, theme` (JSON only)
- `autoplay, muted, loop, preload, playback-rate`
- `controls` (JSON), `keyboard-shortcuts`
- `watermark-enabled|text|image|position|opacity`
- `antipiracy-enabled|text|opacity|color`
- `quality-allowed` (CSV), `quality-default`, `quality-show-auto`
- `analytics-enabled|tenant-id|user-id|video-id`, `lms-enabled|video-id|user-id`
- `debug`

`chapters` and `subtitles` JSON attributes are read once at init but are not observed.

After init, `handleAttributeChange` reacts only to `src` (type only; it drops poster and title), `mode`, `accent-color`, `muted`, `watermark-*`, `antipiracy-*` and `quality-*`.

Element API:
- It forwards the player API.
- `enterFullscreen`, `exitFullscreen`, `enterPip` and `exitPip` are implemented as toggles (KI-24).
- `getSubtitleTracks()` always returns `[]`.
- There are property aliases in camelCase, kebab-case and lowercase (`antiPiracyText`, `'anti-piracy-text'`, `antipiracytext`, …).
- `setChapters()`.

`VidstreamPlayer` global: `{ version: '1.0.0', create(container, config), register(tag) }`, also assigned to `window.VidstreamPlayer`.

## 14. React wrapper (`react/VideoPlayer.tsx`)

- It renders `React.createElement('video-player', { ref, class, style })`.
- The init effect (empty deps) builds `PlayerConfig` from props and calls `element.initialize(config)`, then sets `isInitialized`.
- The sync effect calls `updateConfig({ mode, theme, watermark, antiPiracyText, controls })` whenever those prop identities change. Inline object props therefore re-sync on every render, so memoize them.
- The source effect calls `loadSource(source)` on `[source.src, source.type, isInitialized]`, which includes the first time `isInitialized` flips (KI-21).
- An events effect maps DOM `player-*` events to the `on*` props. Because it runs after the init effect, `onReady` is never called (KI-20).
- `useImperativeHandle` exposes `VideoPlayerRef` (PlayerAPI + playlist + bus + getters + `getElement()`).
- `usePlayerState(ref)` listens for six DOM events and returns `detail.state`. `usePlayerControls(ref)` returns memoized callbacks.
- `"use client"` is stripped by Rollup and re-prepended to `dist/react-wrapper.js` by the build script.

## 15. Build pipeline (`scripts/build.js`)

1. It runs `rm -rf dist`.
2. It runs a Vite lib build (no config file) with three ES entries: `player` (src/index.ts, written as `player.esm.js`), `player.webcomponent` and `react-wrapper`.
   - Externals: `react, react-dom, hls.js, dashjs`.
   - Shared code lands in `webcomponent-<hash>.mjs`.
   - Vite's default `publicDir` copies `public/test-captions.vtt` into dist, so it ships to npm.
3. It prepends `"use client";` to `react-wrapper.js`.
4. It runs a UMD build of src/index.ts with global `VidstreamPlayer`. The dynamic `import('hls.js')` and `import('dashjs')` remain bare inside the UMD (KI-07).
5. It writes `dist/player.css`, extracted from the `getBaseStyles` template by regex.
6. It runs `tsc --emitDeclarationOnly --outDir dist/types`, then writes `types/react-wrapper.d.ts` (re-exporting `./react` plus default) and `types/styles.d.ts`.

`vite.config.ts` is used only by `npm run dev`. `scripts/copy-react-wrapper.js` is legacy and unused.

`package.json` `exports`:
- `.` → types / import `player.esm.js` / require `player.umd.js`.
- `./webcomponent` → import only.
- `./react` → `react-wrapper.js` for import, require and default alike. It is an ESM file, so `require()` fails (KI-31).
- `./styles` → `player.css`. Importing it is optional because the CSS is also injected at runtime.

`files: ["dist", "README.md"]`.
