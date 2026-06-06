# vidstream-player

**The last video player you'll ever need.**

A production-ready, framework-agnostic video player SDK with adaptive streaming, fully configurable theming, playlists, chapters, Picture-in-Picture, mini player, touch gestures, auto-resume, progress tracking, an analytics plugin interface, and full TypeScript support — all in one package.

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
| Auto-resume from last position | ✅ Built-in |
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
- **Auto-resume** — saves position to `localStorage`, optional prompt on return
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
| `source` | `VideoSource` | — | **Required.** `{ src, type, title?, poster? }` |
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
    { src: 'https://cdn.example.com/ep1.m3u8', title: 'Episode 1', poster: '...', duration: 1440 },
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

```ts
player.togglePip();  // browser-native PiP
```

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

## Auto-Resume

```ts
{
  resume: {
    enabled:      true,
    storageKey:   'my-app-resume',
    promptUser:   true,   // show resume dialog (false = seek silently)
    minWatchTime: 10,     // only resume if viewer watched > 10 s
  },
}
```

---

## Error Recovery

```ts
{
  errorRecovery: {
    maxRetries: 5,
    retryDelay: 2000,  // ms (doubles each attempt)
  },
}
```

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

In `live` mode the seek bar and duration are hidden, a **LIVE** badge is shown, speed selector and chapter controls are disabled.

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
| `error` | `{ code, message }` |

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
  ResumeConfig,
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
| Core player | ~38 kB | Always |
| React wrapper | ~2.4 kB | React only |
| HLS engine | ~195 kB | HLS source provided |
| DASH engine | ~282 kB | DASH source provided |

HLS.js and dash.js are **never loaded** unless the viewer plays that stream type. A pure MP4 deployment ships ~38 kB gzipped.

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
  resume:        { enabled: true, storageKey: 'my-app-v1', promptUser: true },
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
