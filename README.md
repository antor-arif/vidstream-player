# vidstream-player

**The last video player you'll ever need.**

A production-ready, framework-agnostic video player SDK with adaptive streaming, fully configurable theming, playlists, chapters, Picture-in-Picture, mini player, touch gestures, progress tracking, an analytics plugin interface, and full TypeScript support — all in one package.

[![npm version](https://img.shields.io/npm/v/vidstream-player?color=%23e50914&style=flat-square)](https://www.npmjs.com/package/vidstream-player)
[![npm downloads](https://img.shields.io/npm/dm/vidstream-player?style=flat-square)](https://www.npmjs.com/package/vidstream-player)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-blue?style=flat-square)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/vidstream-player?style=flat-square)](https://bundlephobia.com/package/vidstream-player)

---

## Why vidstream-player?

Most video players do one thing. This one does everything.

| What you normally need | vidstream-player |
|------------------------|-----------------|
| HLS player + DASH player + quality selector | ✅ Built-in, lazy-loaded |
| Full custom theme — your colors, fonts, radius | ✅ Config object, CSS variables |
| Playlist with sidebar panel | ✅ Renders to the right of player |
| Chapter markers + VTT chapters | ✅ Built-in |
| Picture-in-Picture + floating mini player | ✅ Built-in |
| Mobile touch gestures | ✅ Built-in |
| Volume animation feedback | ✅ Icon + bar + percentage |
| Analytics plugin slot | ✅ Built-in |
| Progress tracking + milestones | ✅ Built-in |
| React wrapper + hooks | ✅ Built-in |
| Web Component for Vue / Angular | ✅ Built-in |
| Full TypeScript types | ✅ Built-in |

No extra dependencies. No stitching together five libraries. Import, configure, ship.

---

## Features at a glance

- **Adaptive streaming** — HLS (`.m3u8`) via hls.js and DASH (`.mpd`) via dash.js, both lazy-loaded as separate chunks so they never bloat your initial bundle
- **Config-driven theming** — pass a `theme` object with your brand colors, radii, fonts, and logo. Every detail is a CSS custom property you can also override directly
- **Watermark & anti-piracy** — image or text watermarks with full color, opacity, size, and position control. Randomized anti-piracy text overlay with configurable intervals
- **Playlist sidebar** — multi-item queue with auto-next, looping, and a built-in panel that renders **to the right** of the player in a flex row. Drop one element; both appear side-by-side
- **Chapters** — inline config or WebVTT file; chapter-change events on the event bus
- **Quality selector** — ABR levels from HLS/DASH manifests surfaced automatically; manual override supported
- **Subtitles & captions** — WebVTT tracks with an in-player language switcher
- **Picture-in-Picture** — browser-native PiP
- **Mini / floating player** — scroll past the video and the entire player snaps to a fixed corner; click to scroll back; click × to dismiss. Works by repositioning the whole container — no video-element cloning or sync issues
- **Touch gestures** — double-tap to seek, swipe right-half up/down for volume, long-press for speed boost
- **Volume animation** — any volume change (swipe or `↑`/`↓` key) shows a volume icon + percentage + fill-bar overlay that fades out after 1.5 s
- **Error recovery** — exponential-backoff retry with configurable max attempts
- **Progress tracking** — milestone events (25 / 50 / 75 / 100 %), completion callback, periodic save with localStorage and API helpers
- **Analytics plugin** — drop in any provider via a simple `init(player)` interface; exposes a full event bus (`on/off/once`)
- **Session ID** — every player instance gets a UUID `sessionId` for correlation across events
- **React wrapper** — `forwardRef` component with `usePlayerState` and `usePlayerControls` hooks
- **Web Component** — works in Vue, Angular, Svelte, or plain HTML with zero framework glue
- **TypeScript-first** — every option, event, and method is fully typed

---

## Install

```bash
npm install vidstream-player
# or
yarn add vidstream-player
# or
pnpm add vidstream-player
```

### Peer dependencies

`hls.js` and `dashjs` are **optional peer dependencies** — install whichever streaming formats you need:

```bash
# For HLS (.m3u8) streams
npm install hls.js

# For DASH (.mpd) streams
npm install dashjs

# Both
npm install hls.js dashjs
```

If you only serve MP4 or WebM, you don't need either. The player lazy-loads them only when a matching source is played.

---

## Quick start

### Vanilla JS

```js
import 'vidstream-player/styles';
import { createVideoPlayer } from 'vidstream-player';

const player = createVideoPlayer(document.getElementById('player'), {
  source: { src: 'https://example.com/video.m3u8', type: 'hls' },
  theme:  { accentColor: '#e50914', progressColor: '#e50914' },
  controls: { quality: true, pip: true, subtitles: true },
});
```

### React

```tsx
import 'vidstream-player/styles';
import VidstreamPlayer from 'vidstream-player/react';

export default function App() {
  return (
    <VidstreamPlayer
      source={{ src: 'https://example.com/video.m3u8', type: 'hls' }}
      theme={{ accentColor: '#e50914', progressColor: '#e50914' }}
      controls={{ quality: true, pip: true }}
      onPlay={() => console.log('playing')}
    />
  );
}
```

### Vue 3

```ts
// main.ts — tell Vue this is a custom element
app.config.compilerOptions.isCustomElement = (tag) => tag === 'vidstream-player';
```

```ts
import 'vidstream-player/styles';
import 'vidstream-player'; // registers <vidstream-player>
```

```vue
<template>
  <vidstream-player ref="playerEl" style="width:100%;aspect-ratio:16/9" />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
const playerEl = ref<any>(null);

onMounted(() => {
  playerEl.value.initialize({
    source: { src: 'https://example.com/video.m3u8', type: 'hls' },
    theme:  { accentColor: '#42b883' },
  });
});
</script>
```

### Angular

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import 'vidstream-player/styles';
import 'vidstream-player';

@Component({
  selector: 'app-root',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<vidstream-player #player style="width:100%;aspect-ratio:16/9"></vidstream-player>`,
})
export class AppComponent {
  // call player.initialize(config) in ngAfterViewInit
}
```

---

## Configuration

Every option is optional except `source`.

```ts
import type { PlayerConfig } from 'vidstream-player';
```

### Core options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | `VideoSource` | — | **Required.** `{ src, type, title?, poster?, chapters? }` |
| `mode` | `'vod' \| 'live'` | `'vod'` | VOD shows full controls; live hides seek bar and speed |
| `theme` | `PlayerTheme` | defaults | Brand colors, radius, font, logo — see Theming |
| `autoplay` | `boolean` | `false` | Autoplay on load (subject to browser policy) |
| `muted` | `boolean` | `false` | Start muted |
| `loop` | `boolean` | `false` | Loop playback |
| `startTime` | `number` | — | Seek to this time (seconds) on load |
| `preload` | `'none' \| 'metadata' \| 'auto'` | `'metadata'` | HTML video preload hint |
| `keyboardShortcuts` | `boolean` | `true` | Space / arrows / F / M keyboard control |
| `debug` | `boolean` | `false` | Log lifecycle events to console |

### Source types

```ts
type VideoSourceType = 'hls' | 'dash' | 'mp4' | 'webm' | 'auto';

// 'auto' detects from the extension (.m3u8 → hls, .mpd → dash)
{ src: 'https://example.com/video.m3u8', type: 'auto' }
```

### Controls

Pass only the controls you want. Omitted controls are hidden.

```ts
controls: {
  quality:       true,  // quality selector
  pip:           true,  // picture-in-picture button
  subtitles:     true,  // subtitle track switcher
  playbackSpeed: true,  // speed menu
  chapters:      true,  // chapter markers
  playlist:      true,  // prev/next buttons
  forward:       true,  // skip-forward button
  rewind:        true,  // skip-back button
  seekDuration:  10,    // seconds per skip
}
```

---

## Theming

There are no preset theme names. You pass a plain object with exactly the colors you want. Every field is optional — omit it and the built-in default applies.

```ts
{
  theme: {
    primaryColor:  '#ffffff',          // icon and text color
    accentColor:   '#e50914',          // progress bar, active highlights
    textColor:     '#ffffff',
    controlBg:     'rgba(0,0,0,0.8)',  // control bar background
    progressColor: '#e50914',
    bufferColor:   'rgba(255,255,255,0.3)',
    hoverColor:    '#ff1a1a',
    borderRadius:  '4px',
    fontFamily:    'Inter, sans-serif',
    iconSize:      '24px',
    tooltipBg:     'rgba(0,0,0,0.9)',
    logoUrl:       'https://cdn.example.com/logo.png',
    logoPosition:  'top-left',    // 'top-left' | 'top-right'
    tenantName:    'My Platform',
  }
}
```

### Change theme at runtime

```ts
player.updateConfig({
  theme: { accentColor: '#6366f1', progressColor: '#6366f1' },
});
```

### CSS custom properties

Every theme value maps to a CSS variable on `.video-player-container`. Override directly for global or per-instance changes:

```css
.video-player-container {
  --vp-accent-color:   #e50914;
  --vp-primary-color:  #ffffff;
  --vp-control-bg:     rgba(0,0,0,0.85);
  --vp-progress-color: #e50914;
  --vp-border-radius:  4px;
  --vp-font-family:    'Inter', sans-serif;
  --vp-text-color:     #ffffff;
  --vp-hover-color:    #ff1a1a;
  --vp-tooltip-bg:     rgba(0,0,0,0.9);
  --vp-icon-size:      24px;
}
```

---

## Watermark & Anti-Piracy

### Watermark

Full control over color, size, opacity, and position:

```ts
{
  watermark: {
    enabled:    true,
    text:       'MyPlatform',           // text watermark
    // imageUrl: 'https://.../logo.svg', // OR image watermark
    opacity:    0.45,
    position:   'top-right',  // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'random'
    imageWidth: '80px',
    className:  'my-watermark',  // add your own CSS for full control
  },
}
```

### Anti-Piracy Text

Randomized floating text to deter screen recording:

```ts
{
  antiPiracyText: {
    enabled:     true,
    text:        'user@example.com',
    color:       'rgba(255,255,255,0.15)',
    fontSize:    '14px',
    opacity:     0.15,
    minInterval: 5000,
    maxInterval: 12000,
    className:   'my-anti-piracy',
  },
}
```

---

## Adaptive Streaming — HLS & DASH

HLS.js and dash.js are loaded **on demand** as separate chunks — they add nothing to your initial bundle if the viewer only watches MP4.

```ts
// HLS
{ source: { src: 'https://cdn.example.com/hls/master.m3u8', type: 'hls' } }

// DASH
{ source: { src: 'https://cdn.example.com/dash/manifest.mpd', type: 'dash' } }

// Quality control
quality: {
  showAuto:         true,
  defaultQuality:   1080,
  allowedQualities: [1080, 720, 480],
}
```

---

## Playlist

When `showPanel: true`, a 280 px sidebar is automatically rendered **to the right** of the player in a flex row. You pass a single container element; both the player and the sidebar appear side-by-side without any extra layout work.

```ts
{
  playlist: [
    { src: 'https://cdn.example.com/ep1.m3u8', title: 'Episode 1', poster: '...', duration: 1440, chapters: [{ id: '1', title: 'Intro', startTime: 0, endTime: 120 }] },
    { src: 'https://cdn.example.com/ep2.m3u8', title: 'Episode 2', poster: '...' },
  ],
  playlistOptions: {
    autoNext:  true,
    loop:      false,
    showPanel: true,   // sidebar renders to the right automatically
  },
}
```

```ts
player.next();    // advance
player.prev();    // go back
player.goTo(2);   // jump to index
```

---

## Chapters

### Inline

```ts
{
  chapters: [
    { id: '1', title: 'Introduction', startTime: 0,   endTime: 120 },
    { id: '2', title: 'Main Content', startTime: 120, endTime: 600 },
    { id: '3', title: 'Conclusion',   startTime: 600, endTime: 720 },
  ],
  controls: { chapters: true },
}
```

### From a WebVTT file

```ts
{ chaptersVtt: 'https://cdn.example.com/chapters.vtt' }
```

---

## Picture-in-Picture & Mini Player

```ts
{
  pip: { enabled: true },

  miniPlayer: {
    enabled:  true,
    position: 'bottom-right',  // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
    width:    320,             // px; height is computed 16:9
  },
}
```

The mini player activates automatically via `IntersectionObserver` when the player scrolls out of view. The **entire player container** (video + controls) is repositioned to a fixed corner of the screen — no element cloning or sync issues. Click the mini player body to scroll back to the original position. Click × to dismiss permanently.

In mini player mode, controls are automatically reduced to **Play/Pause + Mute + Fullscreen** so they fit in the compact overlay without crowding.

```ts
player.togglePip();  // browser-native PiP
```

---

## Responsive / container scaling

The player uses a `ResizeObserver` to watch its **container width** — not the viewport — so it adapts correctly whether it is full-width, embedded in a sidebar, or rendered inside a narrow column.

| Container width | CSS class | Controls hidden |
|----------------|-----------|----------------|
| ≥ 720 px | _(none)_ | All shown |
| 560–719 px | `vp-size-lg` | — |
| 400–559 px | `vp-size-md` | Volume slider, PiP, speed/quality labels |
| 280–399 px | `vp-size-sm` | + Time display, rewind/forward, chapters/subtitles dropdowns |
| < 280 px | `vp-size-xs` | All non-essential controls hidden |

This is the same mechanism used internally for the mini player. Because it uses container width rather than `@media` viewport queries, it works correctly when the player is embedded in any layout — grid, flex, sidebar, modal, or full-page.

---

## Touch Gestures

```ts
{
  gestures: {
    enabled:        true,
    doubleTapSeek:  10,    // seconds to seek on double-tap (default: 10)
    swipeVolume:    true,  // swipe right half up/down → volume
    longPressSpeed: true,  // hold → 2× speed (true = 2×, or pass a number)
  },
}
```

**Volume feedback**: any volume change — swipe or `↑`/`↓` keyboard — shows a centered overlay with a volume icon, a percentage readout, and a horizontal fill bar. It fades out after 1.5 s automatically.

---

## Error Recovery

```ts
{
  errorRecovery: {
    maxRetries: 5,
    retryDelay: 2000,     // ms (doubles each attempt)
    maxRetryDelay: 30000, // backoff cap
    liveMaxRetries: 10,   // live streams; unlimited while the browser is offline
  },
}
```

The retry budget refills after 10 s of uninterrupted playback, so a long live class survives any number of separate network blips.

---

## Progress Tracking

Track milestone completion, save progress, and restore on return. Works with both `vod` and `live` modes:

```ts
{
  lmsProgress: {
    enabled:    true,
    videoId:    'course-101-lesson-1',
    userId:     'user-abc-123',
    milestones: [25, 50, 75, 100],
    onMilestoneReached: (pct, data) => {
      api.recordMilestone({ videoId: data.videoId, milestone: pct });
    },
    onComplete: (data) => {
      api.markComplete(data.videoId);
    },
    onProgressSave: (data) => {
      // called every 5 s automatically
      localStorage.setItem('progress_' + data.videoId, JSON.stringify(data));
    },
    initialProgress: {
      currentTime:      240,  // resume from 4:00
      watchedPercentage: 33,
    },
  },
}
```

### Storage helpers

```ts
import {
  saveProgressToStorage,
  loadProgressFromStorage,
  clearProgressFromStorage,
  createProgressAPICallbacks, // ready-made fetch callbacks for a REST API
} from 'vidstream-player';

const saved = loadProgressFromStorage('course-101-lesson-1');
```

---

## Live Streaming

```ts
{
  mode:   'live',
  source: { src: 'https://live.example.com/stream.m3u8', type: 'hls' },
}
```

In `live` mode the seek bar and duration are hidden, a **LIVE** badge is shown, speed selector and chapter controls are disabled. When playback falls behind the live edge the badge turns grey — click it (or call `player.seekToLive()`) to jump back.

### Live classes in production (signed URLs, lifecycle, P2P)

#### Latency presets: `live.latencyMode`

`live.latencyMode` takes priority over `lowLatency`, which in turn overrides the player's defaults.

| `latencyMode` | Use with | hls.js settings | Measured latency |
|---|---|---|---|
| `'standard'` | HLS (TS), e.g. 3 s segments | `lowLatencyMode: false`, `liveSyncDurationCount: 3`, `liveMaxLatencyDurationCount: 10` | ~9 s |
| `'low'` | LL-HLS (`EXT-X-PART`) | `lowLatencyMode: true`, `maxLiveSyncPlaybackRate: 1.1`, **no `liveSync*`** (follows `PART-HOLD-BACK`) | ~1.5 s with 0.5 s parts |

`'low'` is not recommended for students far from the edge (RTT of 150 ms or more): with 0.5 s parts there is almost no buffer to absorb a slow request, so stalls are much more likely. Use `'standard'` for them.

**Start-up for far-away viewers:**
- `live.startLevel` (default `'lowest'`): the first segment comes from the smallest rendition, then ABR switches up. Use `'auto'` for the hls.js bandwidth guess, or a level index. `hlsConfig.startLevel` and `quality.defaultQuality` win.
- `live.minSegmentsToStart` (default 4 with `'standard'`, 0 otherwise): someone joining in the first seconds of a class stays in `waiting` until the playlist holds that many segments, so playback starts with a real buffer instead of 0.2–2 s. The hold ends early if the edge's playlist window is already sliding (it keeps fewer segments than asked).

Never combine `'low'` with `liveSyncDuration*` (via `hlsConfig`): it overrides part-hold-back targeting (measured 9.5 s instead of 1.5 s). Live streams also default to `backBufferLength: 30`, so memory stays flat on low-end phones during multi-hour classes.

Need any other hls.js setting? Pass `hlsConfig` (merged last; a custom `xhrSetup` still runs). Use `onHlsCreated(hls, Hls)` to reach the instance before it loads, or call `player.getHls()` / `player.getDash()` afterwards.

#### Signed, IP-bound URLs (token in the path)

URLs such as `https://EDGE/t/{exp}/{nonce}/{sig}/{app}/{stream}/{file}` or Bunny's `https://ZONE/bcdn_token=…/{app}/{stream}/{file}` expire, and they stop working when the viewer's IP changes (Wi-Fi → 4G). The server then answers **403**. Give the player a way to get a fresh URL:

```ts
{
  security: {
    // A full fresh URL for the SAME stream on the SAME host (same edge / same Bunny zone):
    // hosts number segments differently.
    refreshPlaybackUrl: async () => (await api.get(`/classes/${id}/playback-url`)).url,
    // tokenPrefixPattern: /^(\/auth\/[^/]+)(\/.*)$/,   // other CDNs: group 1 = token, group 2 = rest of path
  },
}
```

- **No reload:** the player swaps only the token part of every URL in place, so the ~9 s HLS buffer keeps playing. It covers future requests, segment URLs hls.js has already parsed (P2P loaders fetch these themselves) and pending retries.
- **Retries:** 403s, status 0 and timeouts are retried with backoff, which rides out a network switch.
- **Refresh limits:** a 403 burst triggers a single refresh, and there are at most 4 refreshes per minute.
- **Last resort:** reload with a fresh URL.
- **Your app's state is untouched:** `config.source.src` never changes, so React never reloads the stream.
- **Native HLS:** old iOS without MSE re-sets `video.src` (a short interruption).
- **Old API still works:** `refreshPlaybackToken` returning a full `https://` URL does the same. Returning a bare token still means "new auth header", as before.
- **Events:** `tokenRefreshed` / `tokenRefreshFailed`. Tokens never appear in events or debug logs.

Without a refresher, an expired URL ends in a clear `AUTH_ERROR` overlay within a few seconds: two quick retries in case the 403 was transient, then loading stops and the live state becomes `error`. There is no retry loop. Retry starts over.

#### Stream lifecycle

With `mode: 'live'` (or any `live` config), viewers see the stream's state instead of a generic error:

| State | When | Overlay |
|---|---|---|
| `waiting` | Manifest 404 or an empty playlist before the first frame | "Live class hasn't started yet" (polls every `live.offlinePollInterval`, default 5 s, and starts automatically) |
| `reconnecting` | Playlist stopped advancing, or network errors after the start | Spinner + "Reconnecting…" (retries indefinitely; no error screen) |
| `ended` | Playlist stuck for `live.endedTimeout` (20 s) **and** 404s, `#EXT-X-ENDLIST`, or `player.markStreamEnded()` | "Live class has ended" (no Retry; loading stops) |
| `offline` | Browser `offline` event | "No internet connection" (resumes at once on `online`) |
| `error` | A fatal error is shown (e.g. `AUTH_ERROR`) | The error overlay only; the live overlay hides. Retry (or `loadSource`) starts over |

Expected states are not errors: polling a class that hasn't started, a 404 while a class ends, and the end itself emit `liveStateChange` / `streamEnded`, never `error`. `getLiveStats()` drops a stall that is still open when the class ends, and rebuffer time only runs in `playing` / `reconnecting`.

```ts
player.on('liveStateChange', ({ state, previous }) => {});
player.on('streamEnded', () => {});
player.markStreamEnded();      // e.g. when your backend pushes its `stream.ended` webhook
player.getLiveState();         // 'idle' | 'waiting' | 'playing' | 'reconnecting' | 'ended' | 'offline' | 'error'
```

Translate the texts with `live.messages: { waiting, reconnecting, ended, offline, tapToUnmute, goLive }`. Set `live.overlays: false` to draw your own UI from `liveStateChange`.

#### Go live, seeking and autoplay

- **LIVE badge:** it turns grey and clickable when playback is more than ~1.5 × the target latency behind (also while paused). Click it, or call `player.goToLive()`, to jump back. Each change emits `liveEdgeChange { atLiveEdge, latencySec }`.
- **Resume after a pause:** playback rejoins the live edge (`live.resumeAtLiveEdge`, default `true`).
- **No seeking inside the live window:** `←`, `Home`/`End`, and double-click or double-tap on the left do nothing. `→` and the right-side double-click or double-tap jump to live.
- **Autoplay:** if the browser blocks it, a live stream starts muted with a "Tap to unmute" pill and emits `autoplayBlocked { mutedFallback }`.
- **Quality menu:** hidden when the stream has a single rendition.
- **Live detection:** a stream loaded without `mode: 'live'` is detected from the playlist, and the live restrictions apply anyway.

#### SwarmCloud P2P

```bash
npm install @swarmcloud/hls
```

```ts
p2p: {
  enabled: true,
  provider: 'swarmcloud',
  token: 'YOUR_SWARMCLOUD_TOKEN',   // required for the custom channel id below
  // trackerZone: 'hk',              // tracker region, see below; default 'hk' (Hong Kong)
  // channelId: url => …,           // default: host + path with the URL token removed (host kept on purpose)
  // swarmcloud: { …raw P2pEngineHls options }
}
```

**`trackerZone`: which SwarmCloud tracker viewers connect to.** The tracker introduces viewers of the same channel to each other, so:
- **One zone per class:** viewers only share segments with peers on the same tracker. Every viewer of a stream must use the same zone; don't pick it per viewer.
- **Pick the region nearest most of your viewers:** connecting is faster and the tracker sees all of them.
- **Default:** the player uses `'hk'` (Hong Kong) for South and East Asian audiences. SwarmCloud's own default is `'eu'`.

| `trackerZone` | Tracker region |
|---|---|
| `'hk'` (player default) | Hong Kong |
| `'eu'` | Europe (SwarmCloud's default) |
| `'us'` | United States |
| `'cn'` | Mainland China |

**When P2P is off.** Playback never depends on P2P: anything that disables it falls back to HTTP. The player tells your app once per source with `p2pUnavailable { provider, reason, code?, message? }`:
- `reason: 'rejected'`: the SwarmCloud tracker refused this viewer (invalid token, domain not allowed, quota). `code` is `TRACKER_EXPT`, or `P2P_DISABLED` when SwarmCloud switched itself off without an error.
- `reason: 'not-installed'`: the provider's package is missing.
- `reason: 'unsupported'`: the browser can't do P2P.
- `reason: 'config'`: `channelId` was set without `token`.
- `reason: 'error'`: the engine failed to start.

The token never appears in the payload. Temporary tracker outages (5xx, network) are retried by SwarmCloud and are not reported.

```ts
player.on('p2pUnavailable', ({ reason, code }) => log('p2p off', reason, code));
```

The engine is created after the token refresher, so it always fetches segments with a valid token. Stats arrive as `p2pStats`. Without a `token`, SwarmCloud falls back to its own channel id (the full URL), so viewers with different signed URLs won't share; the player logs a warning. `p2p-media-loader` (above) remains the default provider.

#### Watch time instead of percentages

A live class has no fixed duration, so in live mode:
- **LMS:** `lmsProgress.onProgressSave` receives `isLive: true`, `watchedSeconds` (time actually played), `joinedAt` and `lastSeenAt`. Milestones and completion don't fire.
- **Analytics:** heartbeats carry `customData.live` (`watchedSeconds`, `rebufferCount`, `rebufferSeconds`, `averageLatency`, `qualitySwitches`, `tokenRefreshes`, `latency`, `liveState`).
- **API:** `player.getLiveStats()` returns the same numbers.
- **No `Infinity`:** payloads never contain it (live `duration` is reported as `0`).

#### Support tools

- `controls: { stats: true }` adds a statistics overlay, toggled with the `i` key or `player.toggleStats()`. It shows latency, buffer, resolution, bitrate, dropped frames and P2P share. `'visible'` shows it from the start.
- **OS media controls** (lock screen, notification) show the title and poster with play/pause, and offer no seek actions for live. Turn them off with `mediaSession: false`.
- `live.wakeLock: true` keeps the screen on during live playback.

#### Complete example: an Instructly live class

```ts
import { createVideoPlayer } from 'vidstream-player';
import 'vidstream-player/styles';

// Your backend signs for the viewer's IP (Media Engine tools/sign-url.js or Bunny's signer)
const fetchUrl = async (host?: string) =>
  (await api.get(`/classes/${classId}/playback-url`, { params: { host } })).url as string;

const firstUrl = await fetchUrl();
const host = new URL(firstUrl).host;

const player = createVideoPlayer('#player', {
  mode: 'live',
  autoplay: true,
  source: { src: firstUrl, type: 'hls', title: 'Physics 101 · Live', poster: '/img/class.jpg' },

  live: {
    latencyMode: 'standard',          // HLS ts:master.m3u8 (~10 s). For LL-HLS master.m3u8 use 'low' (~1.5 s)
    endedTimeout: 20000,
    wakeLock: true,
    messages: { waiting: 'Class starts soon…' },
  },

  security: {
    // Same host as the current URL — the edge numbers segments differently from the origin
    refreshPlaybackUrl: () => fetchUrl(host),
  },

  p2p: { enabled: true, provider: 'swarmcloud', token: SWARMCLOUD_TOKEN },

  lmsProgress: {
    enabled: true,
    videoId: classId,
    userId,
    onProgressSave: ({ watchedSeconds, joinedAt, lastSeenAt }) =>
      api.post(`/classes/${classId}/attendance`, { watchedSeconds, joinedAt, lastSeenAt }),
  },
});

player.on('streamEnded', () => showFeedbackForm());
realtime.subscribe(`class:${classId}`, (msg) => {
  if (msg.type === 'stream.ended') player.markStreamEnded();
});
```

React: the same options are props (`live`, `hlsConfig`, `p2p`, `security`, `mediaSession`, `onHlsCreated`), the events are `onTokenRefreshed`, `onTokenRefreshFailed`, `onLiveStateChange`, `onLiveEdgeChange`, `onStreamEnded`, `onAutoplayBlocked`, `onP2PStats` and `onP2PUnavailable`, and the ref adds `goToLive()`, `markStreamEnded()`, `getLiveState()`, `getLiveStats()`, `getHls()`, `getDash()` and `toggleStats()`. Web component: the same methods on the element, plus a `latency-mode="standard|low"` attribute.

### Low latency (3–5 s)

```ts
{
  mode: 'live',
  source: { src: 'https://live.example.com/stream.m3u8' },
  lowLatency: true,                       // 4 s target, 7 s max, 1.1× catch-up
  // or fine-tune:
  // lowLatency: { targetLatency: 3.5, maxLatency: 6, maxCatchUpRate: 1.15, partLoading: true },
}
```

Works with **LL-HLS** (`EXT-X-PART`; partial segments are loaded automatically) and with **short-segment HLS** (use 1–2 s segments — a 4 s target needs at least two segments of headroom). The player holds `targetLatency` behind live, speeds up to `maxCatchUpRate` when it drifts behind, and jumps back if latency exceeds `maxLatency`. After a stall hls.js temporarily widens the target, then converges again.

```ts
player.on('latency', ({ latency, targetLatency, atLiveEdge, playbackRate }) => { /* ~1/s */ });
player.getLiveLatency();   // latest snapshot or null
player.seekToLive();
```

### Peer-to-peer delivery (P2P mesh)

HLS and LL-HLS segments can be shared between viewers over WebRTC using [p2p-media-loader](https://github.com/Novage/p2p-media-loader). Install the optional peer dependency (requires hls.js ≥ 1.5):

```bash
npm install hls.js p2p-media-loader-hlsjs
```

```ts
{
  source: { src: 'https://live.example.com/stream.m3u8' },
  lowLatency: true,
  p2p: {
    enabled: true,
    trackers: ['wss://tracker.example.com'],      // your WebTorrent tracker(s); default: public trackers
    swarmId: 'channel-42',                        // default: source URL without query string
    strategy: 'latency',                          // 'latency' (default) | 'offload'
    // iceServers: [{ urls: 'stun:stun.example.com' }], uploadDisabled, maxPeers,
    // core: { ...raw p2p-media-loader core options }
  },
}
```

| `strategy` | Behaviour |
|---|---|
| `'latency'` (default) | LL-HLS parts and segments needed right now come from the CDN; peers serve only what they already have, with a 1 s HTTP fallback. Latency stays exactly on target, but at 3–5 s almost nothing is shared. |
| `'offload'` | Whole segments only (no LL parts); waits briefly for peers before HTTP. Playback settles about one segment above `targetLatency` (default target 3 s → ~5 s actual with 2 s segments). |

Measured with 3 viewers on a local live stream (2 s segments, 0.5 s LL parts), 40 s each:

| Config | Actual latency | Stalls | Viewers' traffic from peers |
|---|---|---|---|
| `lowLatency: true` (no P2P), LL-HLS | 4.03–4.08 s | 0 | — |
| `p2p: { strategy: 'latency' }`, LL-HLS, target 4 | 4.0 s | 0 | 0 % |
| `p2p: { strategy: 'offload' }`, target 3 (default) | **4.8–5.1 s** | **0** | **22–72 %** |
| `p2p: { strategy: 'offload' }`, target 6 | ~8 s | 0 | 52–74 % |

**Recommended for 3–5 s with P2P:** `lowLatency: true, p2p: { enabled: true, strategy: 'offload' }` with 2 s (or shorter) segments.

**Safety net:** if P2P waiting ever causes repeated stalls on a live stream (2 within 20 s), the player switches that viewer to fast HTTP fallback automatically (`getP2PStats().safeMode === true`); peers stay connected and playback recovers.

Reliability: if `p2p-media-loader-hlsjs` isn't installed, WebRTC is unavailable, or the P2P engine fails to start, playback continues over plain HTTP automatically. `security.authToken` is also sent on the P2P engine's own HTTP requests. For sharing to work, **segment URLs must be identical for every viewer** (per-viewer tokens in segment URLs split the swarm).

```ts
player.on('p2pStats', ({ httpBytes, p2pBytes, uploadedBytes, peers, p2pRatio }) => { /* ~every 2 s */ });
player.getP2PStats();
```

Web component: `<video-player src="…" low-latency target-latency="4" p2p p2p-trackers="wss://a,wss://b" p2p-swarm-id="channel-42" p2p-strategy="latency">`. React: `lowLatency`, `p2p`, `onLatency` and `onP2PStats` props. CDN/UMD: load the `hls.js` and `p2p-media-loader-hlsjs` IIFE builds (globals `Hls`, `p2pml.hlsjs`) before `player.umd.js`.

---

## Analytics Plugin

```ts
import type { VidstreamAnalyticsPlugin } from 'vidstream-player';

const myPlugin: VidstreamAnalyticsPlugin = {
  name: 'my-analytics',
  init(player) {
    console.log('Session:', player.sessionId);

    player.on('play',          () => track('video_play'));
    player.on('pause',         () => track('video_pause'));
    player.on('seek',          (e) => track('seek', { from: e.fromTime, to: e.toTime }));
    player.on('qualityChange', (e) => track('quality', { level: e.toQuality }));
    player.on('ended',         () => track('video_complete'));
    player.on('timeupdate',    (e) => {
      if (Math.floor(e.currentTime) % 10 === 0) track('heartbeat', e);
    });
  },
  destroy() {},
};

createVideoPlayer(el, {
  source:  { src: '...', type: 'hls' },
  plugins: { analytics: myPlugin },
});
```

### Event bus

```ts
player.on('play', handler);    // subscribe
player.off('play', handler);   // unsubscribe
player.once('ended', handler); // fire once then remove
```

### Available events

| Event | Payload |
|-------|---------|
| `play` | `{ currentTime, src, sessionId }` |
| `pause` | `{ currentTime, src, sessionId }` |
| `ended` | `{ src, sessionId }` |
| `seek` | `{ fromTime, toTime, src, sessionId }` |
| `timeupdate` | `{ currentTime, duration, percent, sessionId }` |
| `qualityChange` | `{ fromQuality, toQuality, auto, sessionId }` |
| `chapterChange` | `{ chapter, index, sessionId }` |
| `playlistChange` | `{ index, item, sessionId }` |
| `buffering` | `{ currentTime, duration, sessionId }` |
| `error` | `{ code, message }`: real failures only. Not emitted for expected live states (waiting for a class, a class ending) |
| `latency` | `{ latency, targetLatency, atLiveEdge, playbackRate, sessionId }` (live, ~1/s) |
| `liveEdgeChange` | `{ atLiveEdge, latencySec, sessionId }` |
| `liveStateChange` | `{ state, previous, sessionId }` |
| `streamEnded` | `{ src, sessionId }` |
| `autoplayBlocked` | `{ mutedFallback, sessionId }` |
| `tokenRefreshed` / `tokenRefreshFailed` | `{ reason, host?, error?, sessionId }` |
| `p2pStats` | `{ httpBytes, p2pBytes, uploadedBytes, peers, p2pRatio, safeMode, sessionId }` |
| `p2pUnavailable` | `{ provider, reason, code?, message?, sessionId }`: P2P is off for this source (once per source) |
| `hlsCreated` | `{ hls, Hls, sessionId }` |

---

## React — Hooks & Ref

### `usePlayerState`

```tsx
import VidstreamPlayer, { usePlayerState } from 'vidstream-player/react';
import type { VidstreamPlayerRef } from 'vidstream-player/react';
import { useRef } from 'react';

function VideoPage() {
  const ref = useRef<VidstreamPlayerRef>(null);
  const state = usePlayerState(ref); // { playing, currentTime, duration, volume, ... }

  return (
    <>
      <VidstreamPlayer
        ref={ref}
        source={{ src: 'https://example.com/video.m3u8', type: 'hls' }}
        theme={{ accentColor: '#e50914', progressColor: '#e50914' }}
        controls={{ quality: true, pip: true }}
      />
      <p>{state.currentTime.toFixed(0)}s / {state.duration.toFixed(0)}s</p>
    </>
  );
}
```

### `usePlayerControls`

```tsx
const controls = usePlayerControls(ref);

<button onClick={controls.togglePlay}>Play / Pause</button>
<button onClick={() => controls.seek(60)}>Jump to 1 min</button>
<button onClick={controls.togglePip}>PiP</button>
```

### Full ref API

```ts
ref.current?.play()
ref.current?.pause()
ref.current?.seek(seconds)
ref.current?.setVolume(0.8)
ref.current?.setMuted(true)
ref.current?.setSpeed(1.5)
ref.current?.toggleFullscreen()
ref.current?.togglePip()
ref.current?.next()
ref.current?.prev()
ref.current?.goTo(index)
ref.current?.on('play', handler)
ref.current?.once('ended', handler)
ref.current?.getState()    // full PlayerState snapshot
ref.current?.sessionId     // UUID string
```

---

## TypeScript

```ts
import type {
  PlayerConfig,
  VideoSource,
  PlayerMode,           // 'vod' | 'live'
  PlayerTheme,          // theme config object
  PlayerState,
  GesturesConfig,
  ErrorRecoveryConfig,
  PipConfig,
  MiniPlayerConfig,
  PlaylistItem,
  PlaylistOptions,
  Chapter,
  QualityLevel,
  SubtitleTrack,
  WatermarkConfig,
  AntiPiracyTextConfig,
  LMSProgressConfig,
  LMSProgressData,
  ProgressMilestone,
  VidstreamPlayerInstance,
  VidstreamAnalyticsPlugin,
  ChapterChangeEvent,
  PlaylistChangeEvent,
  PluginsConfig,
  LiveConfig,
  LiveLatencyMode,
  LiveState,
  LiveWatchStats,
  TokenRefreshEvent,
  P2PConfig,
} from 'vidstream-player';
```

---

## Player API reference

```ts
// Playback
player.play()
player.pause()
player.seek(seconds)
player.setVolume(0–1)
player.setMuted(boolean)
player.setSpeed(rate)           // 0.25 – 4
player.toggleFullscreen()
player.togglePip()
player.loadSource(VideoSource)  // swap source without re-init

// Playlist
player.next()
player.prev()
player.goTo(index)

// State
player.getState()               // PlayerState snapshot
player.getCurrentTime()
player.getDuration()
player.getVolume()
player.isPaused()
player.getQuality()

// Live
player.goToLive()               // alias: seekToLive()
player.markStreamEnded()
player.getLiveState()
player.getLiveLatency()
player.getLiveStats()
player.getP2PStats()
player.toggleStats(force?)
player.getHls()                 // hls.js instance or null
player.getDash()

// Config
player.updateConfig(Partial<PlayerConfig>)

// Event bus
player.on(event, handler)
player.off(event, handler)
player.once(event, handler)

// Meta
player.sessionId                // UUID string
player.isReady()                // boolean

// Cleanup
player.destroy()
```

---

## Web Component API (Vue / Angular / plain HTML)

```html
<vidstream-player id="p"></vidstream-player>
<script type="module">
  import 'vidstream-player/styles';
  import 'vidstream-player'; // registers the custom element

  const el = document.getElementById('p');
  el.initialize({
    source: { src: 'https://example.com/video.m3u8', type: 'hls' },
    theme:  { accentColor: '#e50914' },
  });

  el.play();
  el.seek(30);
  el.setMuted(true);

  el.addEventListener('player-play',           () => console.log('play'));
  el.addEventListener('player-pause',          () => console.log('pause'));
  el.addEventListener('player-quality-change', (e) => console.log(e.detail.data));
</script>
```

### DOM events

| DOM event | Fires when |
|-----------|-----------|
| `player-ready` | Player fully initialized |
| `player-play` | Playback started |
| `player-pause` | Playback paused |
| `player-ended` | Playback finished |
| `player-timeupdate` | Every animation frame during playback |
| `player-quality-change` | ABR level changed |
| `player-chapter-change` | Chapter boundary crossed |
| `player-playlist-change` | Playlist item changed |
| `player-error` | Playback error |
| `player-live-state-change` | Live lifecycle state changed |
| `player-live-edge-change` | Fell behind / back at the live edge |
| `player-stream-ended` | Live stream ended |
| `player-autoplay-blocked` | Browser blocked autoplay |
| `player-p2p-unavailable` | P2P is off for this source (library missing, unsupported, token rejected, …) |
| `player-token-refreshed` / `player-token-refresh-failed` | Signed URL refreshed / refresh failed |
| `player-hls-created` | hls.js instance created |
| `player-pip` | PiP entered or exited |
| `player-buffering` | Buffering state changed |

---

## Framework compatibility

| Framework | Import path | Notes |
|-----------|-------------|-------|
| Vanilla JS | `vidstream-player` | `createVideoPlayer(el, config)` |
| React 17+ | `vidstream-player/react` | Full wrapper with hooks |
| Vue 3 | `vidstream-player` | Web component; add `isCustomElement` |
| Angular 14+ | `vidstream-player` | Web component; add `CUSTOM_ELEMENTS_SCHEMA` |
| Svelte | `vidstream-player` | Web component; no extra config |
| Next.js | `vidstream-player/react` | Use `dynamic(..., { ssr: false })` |
| Nuxt 3 | `vidstream-player` | Wrap in `<ClientOnly>` |
| Astro | `vidstream-player` | Add `client:only="vanilla"` directive |

---

## Bundle impact

| Chunk | Size (gzip) | Loaded when |
|-------|------------|-------------|
| Core player (ESM) | ~38 kB | Always |
| React wrapper | ~2.4 kB | React only |
| UMD bundle | ~34 kB | UMD consumers |
| hls.js (peer dep) | ~195 kB | HLS source played |
| dashjs (peer dep) | ~282 kB | DASH source played |

`hls.js` and `dashjs` are **peer dependencies** — they are NOT bundled into `vidstream-player`. Install them separately only if you use HLS or DASH. They are lazy-loaded at runtime and add **nothing** to your initial bundle.

A pure MP4 deployment ships ~38 kB gzipped with zero streaming overhead.

> **Previous behavior (< 1.0):** Both were bundled into the package, inflating the install size to ~11 MB with source maps. The current approach reduces the published package to ~400 KB.

---

## Full example

```ts
import 'vidstream-player/styles';
import { createVideoPlayer } from 'vidstream-player';
import type { VidstreamAnalyticsPlugin, PlayerConfig } from 'vidstream-player';

const analyticsPlugin: VidstreamAnalyticsPlugin = {
  name: 'my-tracker',
  init(player) {
    player.on('play',       () => track('play',     { session: player.sessionId }));
    player.on('ended',      () => track('complete', { session: player.sessionId }));
    player.on('timeupdate', (e) => {
      if (Math.floor(e.currentTime) % 30 === 0) track('heartbeat', e);
    });
  },
};

const config: PlayerConfig = {
  source: {
    src:    'https://cdn.example.com/course/intro.m3u8',
    type:   'hls',
    title:  'Lesson 1 — Introduction',
    poster: '/thumb.jpg',
  },
  mode: 'vod',

  // Brand colors — full control, no preset strings
  theme: {
    accentColor:   '#10b981',
    progressColor: '#10b981',
    hoverColor:    '#34d399',
    controlBg:     'rgba(0,0,0,0.75)',
    borderRadius:  '6px',
  },

  // Playlist — sidebar renders automatically to the right
  playlist: [
    { src: 'https://cdn.example.com/ep1.m3u8', title: 'Episode 1' },
    { src: 'https://cdn.example.com/ep2.m3u8', title: 'Episode 2' },
    { src: 'https://cdn.example.com/ep3.m3u8', title: 'Episode 3' },
  ],
  playlistOptions: { autoNext: true, showPanel: true },

  // Chapters
  chapters: [
    { id: '1', title: 'Intro',    startTime: 0,   endTime: 60  },
    { id: '2', title: 'Concepts', startTime: 60,  endTime: 300 },
    { id: '3', title: 'Exercise', startTime: 300, endTime: 540 },
  ],

  // Controls
  quality:  { showAuto: true },
  controls: { quality: true, subtitles: true, chapters: true, playlist: true, pip: true },

  // Features
  pip:           { enabled: true },
  miniPlayer:    { enabled: true, position: 'bottom-right', width: 320 },
  gestures:      { enabled: true, doubleTapSeek: 10, swipeVolume: true, longPressSpeed: true },
  errorRecovery: { maxRetries: 5, retryDelay: 2000 },

  // Branding
  watermark: {
    enabled:  true,
    text:     'MyPlatform',
    position: 'top-right',
    opacity:  0.4,
  },
  antiPiracyText: {
    enabled:     true,
    text:        'Licensed to user@example.com',
    color:       'rgba(255,255,255,0.12)',
    fontSize:    '13px',
    minInterval: 8000,
    maxInterval: 15000,
  },

  // Progress tracking
  lmsProgress: {
    enabled:    true,
    videoId:    'course-101-lesson-1',
    userId:     'user-abc-123',
    milestones: [25, 50, 75, 100],
    onMilestoneReached: (pct) => api.recordMilestone(pct),
    onComplete:         ()    => api.markComplete('course-101-lesson-1'),
  },

  // Analytics
  plugins: { analytics: analyticsPlugin },
};

const player = createVideoPlayer(document.getElementById('player')!, config);
```

---

## Documentation

Full API reference, advanced recipes, and a live playground are available at:

**[docs-url]**

---

## License

MIT — free for personal and commercial use.

A **Pro tier** with advanced features (DRM / Widevine, server-side analytics, white-label builds, priority support) is coming. Star the repo to be notified.

---

## Contributing

Found a bug or want a feature? Open an issue or PR at [github.com/antor-arif/vidstream-player](https://github.com/antor-arif/vidstream-player).

---

<p align="center">Made with care for VOD platforms, live streaming apps, and every project in between.</p>
