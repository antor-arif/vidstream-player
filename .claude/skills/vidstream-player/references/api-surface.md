# vidstream-player — public API surface (v2.0.0)

> **Updated 2026-11-01:** written during the pre-fix audit. Bugs and "doesn't work" notes here were fixed the same day — see known-issues.md (fixed list) for current behaviour. Structure, file roles and data flow are still accurate. Additions since: `src/utils/vtt.ts`, `src/utils/security.ts`, `src/version.ts`, `<vidstream-player>` alias tag, `.mjs`/`.cjs` build outputs, `tests/`. Added 2026-11-02: `src/streaming/` (low latency + P2P), `lowLatency`/`p2p` config, `seekToLive()`/`getLiveLatency()`/`getP2PStats()`, `player-latency`/`player-p2p-stats` events, live detection from hls.js/dash.js, LIVE badge button — see SKILL.md "Low latency + P2P" and the README.

Everything in this file is public contract. Additions are fine. Renames and removals need a major version (see SKILL.md rule 1). The "Works?" column records what the code actually does as of the 2026-11-01 audit. "Docs" pages may claim more.

## Contents
1. Package entry points
2. Exports
3. PlayerConfig, option by option
4. Methods
5. Events (DOM, EventBus, analytics)
6. CSS custom properties
7. Input shortcuts

---

## 1. Package entry points (`package.json` exports)

| Import | ESM file | Notes |
|---|---|---|
| `vidstream-player` | `dist/player.esm.js` (require → `dist/player.umd.js`) | Main barrel. Importing it also registers `<video-player>`, because index.ts re-exports webcomponent.ts. |
| `vidstream-player/webcomponent` | `dist/player.webcomponent.js` | Registers `<video-player>`. Import condition only. |
| `vidstream-player/react` | `dist/react-wrapper.js` | `"use client"` prepended. ESM only, although the map also lists it for `require`. |
| `vidstream-player/styles` | `dist/player.css` | Optional, since the CSS is injected at runtime anyway. Contains base styles only. |
| CDN | `dist/player.umd.js` → `window.VidstreamPlayer` (namespace of all exports) | HLS/DASH are broken in this build (bare dynamic imports, KI-07). |

hls.js (>=1) and dashjs (>=4) are optional peer dependencies, loaded with `import()` only when a stream of that type is played.

## 2. Exports

`src/index.ts`:
- Values:
  - `VideoPlayer`, `createVideoPlayer`
  - `VideoPlayerElement`, `registerVideoPlayerElement`, `VidstreamPlayer`
  - `ControlsManager`, `defaultControlsConfig`
  - `WatermarkManager`, `AntiPiracyTextManager`, `createWatermark`, `createAntiPiracyText`, `getWatermarkStyles`
  - `ThemeManager`, `createThemeManager`, `getBaseStyles`, `defaultDarkTheme`
  - `Icons`, `createIcon`
  - `EventBus`, `ErrorRecoveryManager`, `ThumbnailPreview`, `MiniPlayer`, `PlaylistManager`
  - `AnalyticsManager`, `ConsoleAnalyticsAdapter`, `HttpAnalyticsAdapter`, `createAnalyticsAdapter`, `createExampleBackendAdapter`
  - `LMSProgressManager`, `saveProgressToStorage`, `loadProgressFromStorage`, `clearProgressFromStorage`, `getAllProgressFromStorage`, `createProgressAPICallbacks`
  - `VERSION` (hard-coded `'1.0.0'`, see KI-33)
- Types:
  - Source and config: `VideoSource`, `VideoSourceType`, `PlayerConfig`, `PlayerMode`, `PlayerTheme`, `ControlsConfig`
  - Watermark and quality: `WatermarkConfig`, `WatermarkPosition`, `AntiPiracyTextConfig`, `QualityConfig`
  - Analytics: `AnalyticsConfig`, `AnalyticsAdapter`, `AnalyticsEventName`, `AnalyticsEventPayload`
  - LMS and security: `LMSProgressConfig`, `LMSProgressData`, `ProgressMilestone`, `SecurityConfig`, `SDKAuthConfig`
  - Media: `Chapter`, `SubtitleTrack`, `QualityLevel`
  - Player state and API: `PlayerState`, `PlayerAPI`, `PlayerError`, `VidstreamPlayerInstance`
  - Events: `PlayerEventDetail`, `PlayerEvents`, `PlayerCustomEvent`, `PlayEvent`, `PauseEvent`, `SeekEvent`, `EndedEvent`, `TimeUpdateEvent`, `QualityChangeEvent`, `BufferingEvent`, `ChapterChangeEvent`, `PlaylistChangeEvent`
  - Feature configs: `GesturesConfig`, `ErrorRecoveryConfig`, `VidstreamError`, `VidstreamErrorCode`, `PipConfig`, `MiniPlayerConfig`, `PlaylistItem`, `PlaylistOptions`, `VidstreamAnalyticsPlugin`, `PluginsConfig`
  - Utility: `DeepPartial`

`src/react/index.ts`:
- Values: `VideoPlayer` (also the default export), `usePlayerState`, `usePlayerControls`.
- Types: `VideoPlayerProps`, `VideoPlayerRef`, `VidstreamPlayerRef`, plus re-exports of the common config/state types and `ChapterChangeEvent`/`PlaylistChangeEvent`.

Not exported but importable via deep paths: `ControlsCallbacks`, `parseVttThumbnails`, `VttCue`, `HttpAdapterOptions`, `thumbnailPreviewStyles`/`miniPlayerStyles`/`playlistStyles`.

## 3. PlayerConfig, option by option

| Option | Type / default | Works? |
|---|---|---|
| `source` | `VideoSource` (required) `{ src, type?='auto', title?, poster?, thumbnails?, chapters? }` | yes. `thumbnails` → see KI-02 |
| `mode` | `'vod'|'live'` = `'vod'` | yes. Live hides seek/time/rewind/forward/speed/subtitles/chapters and shows the LIVE badge. A runtime change via updateConfig only restyles. |
| `theme` | `PlayerTheme` merged over `defaultDarkTheme` | yes. `logoUrl/logoPosition/tenantName` only set CSS vars and nothing renders a logo (KI-30). |
| `controls` | `ControlsConfig`, all `true`, `seekDuration 10` | yes at init. `updateConfig({controls})` only changes `seekDuration` behaviour, not button visibility. |
| `controls.quality` / `qualitySelector` | boolean aliases | yes |
| `controls.settings` | boolean | **no**: there is no settings menu |
| `controls.progress` | boolean | **no**: only `seekBar` matters |
| `gestures` | `{ enabled=true (always, not touch-only), doubleTapSeek, seekSeconds, doubleTapZones=true, swipeVolume=true, longPressSpeed=2 }` | partly. `doubleTapSeek`/`seekSeconds` are ignored (double-tap uses `controls.seekDuration`), and `longPressSpeed:false` still applies 2×. KI-09 |
| `quality` | `{ allowedQualities?, defaultQuality?, showAuto=true }` | HLS only. DASH quality is broken with dash.js v5 (KI-04). |
| `subtitles` | `SubtitleTrack[] { src, label, language, kind?, default? }` | yes. Becomes `<track>` elements, plus a menu and the `c` key. |
| `chapters` | `Chapter[] { id, title, startTime, time?, endTime?, thumbnail?, description? }` | **no**: wiped by `loadSource` unless given on `source.chapters` (KI-01). `thumbnail`/`description` are unused. |
| `chaptersVtt` | URL | yes. Loaded async and overrides `chapters`. |
| `thumbnailVtt` | URL (sprite VTT `#xywh=`) | **no**: KI-02 |
| `errorRecovery` | `{ enabled=true, maxRetries=3, retryDelay=2000, onError? }` | mostly. See KI-05/06/12. |
| `pip` | `{ enabled=true, button=true }` | only hides the button |
| `miniPlayer` | `{ enabled=false, position='bottom-right', width=320 }` | yes |
| `playlist` / `playlistOptions` | `PlaylistItem[] { src, title?, poster?, duration?, thumbnailVtt?, chapters? }` / `{ autoNext=true, loop=false, showPanel=false, startIndex=0 }` | yes, but `startIndex` only highlights the item and does not load it (KI-15). Items have no `type` field, so type is detected from the extension. |
| `plugins.analytics` | `VidstreamAnalyticsPlugin { name, apiKey?, init(player), destroy? }` | `init` is called. `destroy` is never called (KI-14). |
| `watermark` | `{ enabled, svgContent?, imageUrl?, text?, opacity=0.5, imageWidth='50px', imageHeight='auto', position='top-right', className? }` | yes. Positions are top-left/top-right/top-center/center/center-bottom/bottom-left/bottom-right/bottom-center/random. `svgContent` is injected as raw HTML. |
| `antiPiracyText` | `{ enabled, text, opacity=0.3, fontSize='12px', color='rgba(255,255,255,0.8)', minInterval=3000, maxInterval=8000, className? }` | yes (removable via DevTools; no tamper protection) |
| `analytics` | `{ enabled, tenantId?, userId?, videoId?, heartbeatInterval=30000, timeUpdateThrottle=1000, adapter?=Console, platform='web', customData? }` | yes (with double `session_start`, KI-11) |
| `lmsProgress` | `{ enabled, videoId, userId?, saveInterval=5000, milestones?, initialProgress?, onProgressSave?, onMilestoneReached?, onFirstPlay?, onComplete? }` | yes, with KI-19 (interval leak) and `onComplete` firing twice. Custom `milestones` are honoured (default 25/50/75/90/100), but 100 is always forced on completion. |
| `security` | `{ getSignedPlaybackUrl?, refreshPlaybackToken?, onPlaybackAuthorizationError?, tokenHeaderName?, authToken? }` | **no**: never read (KI-08) |
| `sdkAuth` | `{ apiKey, allowedDomains?, onAuthError? }` | **no**: never read (KI-08) |
| `autoplay` | `false` | yes, but it re-plays after a pause followed by a seek (KI-03) |
| `muted` / `loop` / `preload` | `false` / `false` / `'metadata'` | yes |
| `startTime` | seconds | yes, but it is re-applied on every `loadedmetadata`, including every playlist item |
| `playbackRate` | number | **no**: never applied (KI-08) |
| `keyboardShortcuts` | `true` | **no**: shortcuts are always on (KI-08, browser-verified) |
| `debug` | `false` | logs init/destroy only |

## 4. Methods

`VideoPlayer` implements `PlayerAPI` and `VidstreamPlayerInstance`:
- **Playback**: `play(): Promise<void>` (swallows autoplay rejections), `pause()`, `togglePlay()`, `seek(t)` (clamped to `[0, duration]`, so it does nothing before metadata loads).
- **Audio**: `setVolume(0..1)`, `toggleMute()`, `setMuted(b)`.
- **Speed**: `setPlaybackRate(r)` (clamped 0.25–4), `setSpeed(r)`.
- **Fullscreen**: `enterFullscreen()` (also tries `screen.orientation.lock('landscape')`), `exitFullscreen()`, `toggleFullscreen()`.
- **PiP**: `enterPip()`, `exitPip()`, `togglePip()`.
- **Quality and subtitles**: `setQuality(QualityLevel | number | 'auto')`, `setSubtitle(track | null)` (matches by `language`).
- **Source and config**: `loadSource(VideoSource)`, `updateConfig(Partial<PlayerConfig>)`, `setChapters(Chapter[])`.
- **State**: `getState(): PlayerState` (a copy), `isReady()`.
- **Getters**: `getCurrentTime()`, `getDuration()`, `getVolume()`, `isPaused()`, `isFullscreen()`, `getQuality()` (label or `'auto'`), `sessionId` (UUID v4 getter).
- **Playlist**: `next()`, `prev()`, `goTo(i)`.
- **Event bus**: `on(e, fn)`, `off(e, fn)`, `once(e, fn)`. There is no public `emit`.
- **Lifecycle**: `destroy()`.

The type conflict on `setQuality` is KI-32: `PlayerAPI` declares `QualityLevel | 'auto'`, `VidstreamPlayerInstance` declares `number | 'auto'`, and the implementation accepts both.

`VideoPlayerElement` (`<video-player>`) adds:
- `initialize(config)`, `getQualityLevels()`, `getSubtitleTracks()` (always `[]`) and `setChapters()`;
- properties `currentTime` (settable), `duration`, `paused`, `volume`, `muted`, `playbackRate`, `isFullscreen`, `isPip`, `src`, `sourceType`, `theme`, `watermark`, `antiPiracyText`, `controls`, `quality`, `analytics`, `lmsProgress`, `keyboardShortcuts` and `accentColor`, with kebab-case and lowercase aliases.

React `VideoPlayerRef` has the same surface as the player, plus `getElement()`.

## 5. Events

### DOM CustomEvents
These are dispatched on the container element, which is `<video-player>` for the web component and React. They bubble. `e.detail = { type, state: PlayerState, data, timestamp }`.

| Event | `detail.data` | Fired on |
|---|---|---|
| `player-ready` | `{}` | end of constructor |
| `player-loaded` | `{}` | `loadedmetadata` |
| `player-play` / `player-pause` / `player-ended` | `{}` | video events |
| `player-timeupdate` | `{ currentTime, duration }` | `timeupdate` |
| `player-volumechange` | `{ volume, muted }` | |
| `player-ratechange` | `{ rate }` | |
| `player-fullscreen` | `{ fullscreen }` | document `fullscreenchange` |
| `player-pip` | `{ pip }` | |
| `player-buffering` | `{ buffering: boolean }` | `waiting` (true) / `playing` (false) |
| `player-quality-change` | `QualityLevel` | HLS `LEVEL_SWITCHED`, DASH `QUALITY_CHANGE_RENDERED` |
| `player-error` | `PlayerError { code, message, originalError? }` | native/HLS errors (not DASH) |
| `player-chapter-change` | `ChapterChangeEvent { chapter, index, sessionId }` | |
| `player-playlist-change` | `PlaylistChangeEvent { index, item, sessionId }` | |
| `player-milestone` | `{ milestone }` | LMS |
| `player-progress-saved` | `LMSProgressData` | LMS |
| `player-seek` / `player-heartbeat` | declared in `PlayerEvents` but **never emitted** | |

The web component also dispatches `ready` (unprefixed) with `detail.player`.

### EventBus (`player.on(name, fn)`)

| Name | Payload |
|---|---|
| `play` / `pause` | `{ currentTime, src*, sessionId }` |
| `ended` | `{ src*, sessionId }` |
| `seek` | `{ fromTime, toTime, src*, sessionId }`, emitted on `seeked` |
| `timeupdate` | `{ currentTime, duration, percent (0–1), src*, sessionId }` |
| `buffering` | `{ currentTime, duration, sessionId }`, start only |
| `qualityChange` | `{ fromQuality, toQuality, auto, sessionId }` (HLS only) |
| `chapterChange` | `ChapterChangeEvent` |
| `playlistChange` | `PlaylistChangeEvent` |
| `error` | `PlayerError` (native) **or** `VidstreamError { code, message, fatal, timestamp }` (HLS/DASH), see KI-12 |

\* `src` is `video.src`, which is a `blob:` URL for HLS/DASH (KI-13).

### Analytics event names (`AnalyticsEventName`)
`player_loaded`\*\*, `source_loaded`, `play`, `pause`, `ended`, `seek_start`, `seek_end`, `time_update`, `quality_changed`, `volume_changed`, `mute_toggled`\*\*, `fullscreen_enter`, `fullscreen_exit`, `pip_enter`, `pip_exit`, `playback_rate_changed`, `subtitle_changed`, `error`, `buffering`, `can_play`, `heartbeat`, `session_start`, `session_end`, `milestone_reached`, `progress_saved`\*\*. (\*\* declared but never tracked.)

## 6. CSS custom properties
These are set inline on `.video-player-container`.

- Theme-driven:
  - colours: `--vp-primary-color`, `--vp-accent-color`, `--vp-text-color`, `--vp-control-bg`, `--vp-progress-color`, `--vp-buffer-color`, `--vp-hover-color`, `--vp-tooltip-bg`
  - shape and type: `--vp-border-radius`, `--vp-font-family`, `--vp-icon-size`
  - logo and tenant (no renderer): `--vp-logo-url`, `--vp-logo-position`, `--vp-tenant-name`
- Aliases: `--vp-primary`, `--vp-bg`, `--vp-text`, `--vp-radius`, `--vp-font`.
- Internal: `--vp-transition`, `--vp-overlay-bg`, `--vp-progress-height`, `--vp-control-size`, `--vp-control-padding`.

## 7. Input shortcuts
- Keyboard (focus on the player): Space/`k`, ←/→, ↑/↓, `f`, `m`, `c`, Esc.
- Mouse: click toggles play; double-click thirds do −seek/fullscreen/+seek.
- Touch: double-tap thirds, right-half vertical swipe for volume, long-press for 2× speed, single tap toggles controls.
