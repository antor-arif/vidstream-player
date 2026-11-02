# Docs vs code drift, and site issues

**Update 2026-11-03:** the docs site is untouched since this audit and still pins npm `vidstream-player@2.0.0` (frozen — the player is GitHub-only now). Since then the player gained features the docs never mention: `lowLatency`, `p2p` (p2p-media-loader), `seekToLive()/getLiveLatency()/getP2PStats()`, `latency`/`p2pStats` events, LIVE badge as a go-live button, `<vidstream-player>` alias, `security`/`sdkAuth` implementations, normalized error codes, `.mjs`/`.cjs` builds. Most "broken in code" rows in section 2 are now fixed in the player (see the player skill's known-issues). The player README is the up-to-date reference; its install section still says `npm install vidstream-player` (should be the GitHub form).

Audit date 2026-11-01. The docs repo is at `5f89dcd` and the player at `1d5fafa` (v2.0.0). When you fix an item, delete it here. "Correct" means what the player code actually does. Paths are relative to `vidstream-player-docs/src/app/docs/` unless noted. KI-xx refers to the player skill's `references/known-issues.md`.

## Contents
1. Docs claims that contradict the code
2. Docs documenting features that are broken in the code
3. Contradictions between docs pages
4. Site bugs
5. Broken or invalid code samples
6. Coverage gaps and dead code

---

## 1. Docs claims that contradict the code

| Docs claim | Where | Correct |
|---|---|---|
| Custom element is `<vidstream-player>` | `frameworks/web-component`, changelog ~L69, landing page, `frameworks/angular`, `frameworks/svelte` | The library registers **`<video-player>`** (`registerVideoPlayerElement(tag)` can add another name). `api/events` ~L30 and migration ~L60/73 already say `video-player`. Fix the docs, or add a library alias (see KI-41). |
| Web component events carry `e.detail.currentTime` / `e.detail.chapter.title` | `frameworks/web-component` ~L96/100, landing `QuickStart` ~L77 | `e.detail = { type, state, data, timestamp }`. Use `e.detail.data.chapter.title` and `e.detail.state.currentTime`. |
| Web component observed attributes are `src, autoplay, muted, loop, theme` | `frameworks/web-component` | The full list is in `vidstream-player/references/architecture.md` §13. `theme` is JSON only, and most attributes are read only at init. |
| EventBus `seek` payload is `{ from, to, … }` | `api/events`, `api/types` | `{ fromTime, toTime, src, sessionId }` (`SeekEvent` type) |
| `player.emit` exists | changelog ~L65 | There is no public `emit`; only `on`, `off` and `once`. |
| `updateConfig` handles `controls` | changelog ~L66, Playground | Only `theme`, `mode` (CSS only), `watermark` and `antiPiracyText` apply live. `controls.seekDuration` works incidentally (KI-44). |
| Mini player detaches the `<video>` into a floating overlay | `features/mini-player` ~L18-21, 57-59 | The whole container is repositioned `position:fixed`, with a spacer holding its place (the README is correct). |
| Safari skips hls.js and uses native HLS | `features/hls-dash`, installation | hls.js is always imported first. Native HLS is used only if `Hls.isSupported()` is false. If hls.js isn't installed, HLS fails with no native fallback (KI-07). |
| Without the peer dependencies, the player falls back to native `<video>` | installation ~L88-99, `features/hls-dash` ~L112-122 | Not true for HLS or DASH (KI-07). MP4 and WebM work without peers. |
| "zero-dependency", "HLS and DASH built in" | introduction ~L16, L31 | No runtime dependencies, but `hls.js` and `dashjs` must be installed by the consumer for those formats. |
| `--vp-primary` is an alias of `--vp-accent-color` (#3b82f6) | `features/theming` ~L78-79 | `--vp-primary: var(--vp-primary-color)` (white `#ffffff`). The effective accent default is `#3b82f6` (base CSS fallback `#e50914`). |
| `--vp-controls-bg` | `features/theming` ~L68 | `--vp-control-bg` |
| `--vp-bg` is the "player background" (#0f0f0f) | `features/theming` example | `--vp-bg` aliases `--vp-control-bg` (controls background). |
| Theme vars can be overridden in CSS | `features/theming` | `theme` values are inline styles on the container. A stylesheet needs `!important`, or use the `theme` option (KI-43). |
| `gestures.enabled` defaults to true on touch devices | `api/config`, `features/touch-gestures` | It's always `true` unless set to `false`. Touch handlers simply never fire on desktop. |
| `fontFamily` default "system-ui, sans-serif" | `api/config` | `'system-ui, -apple-system, sans-serif'` |
| Error-recovery timeline 1 s, 2 s, 4 s, 8 s | `features/error-recovery` ~L41-47 | Defaults `retryDelay 2000`, `maxRetries 3` give 2 s, 4 s and 8 s, then the error UI. |
| `setQuality(level: number|'auto')` vs `setQuality(QualityLevel|'auto')` | `api/player-instance` ~L127 vs ~L165 | The implementation accepts `QualityLevel | number | 'auto'` (KI-32). |
| `VidstreamPlayerInstance` used to type the player in the Vue, Angular and Svelte samples, then `loadSource()` called on it | `frameworks/vue` ~L87, `angular` ~L66, `svelte` ~L82 | `VidstreamPlayerInstance` has no `loadSource`, `getState` or `updateConfig`. Type the instance as `VideoPlayer` (the class). |
| "~33.5 kb gzipped" | introduction ~L16, `Stats.tsx` | The ESM shared chunk is ~39.5 kB gzip and UMD ~35 kB gzip (hls.js and dash.js not included). |
| Changelog v2.0.0 has no Removed or Breaking section | `changelog/page.mdx` | Auto-resume (`resume`, `resumeService`) was removed in v2, and the migration guide lists renames and removals. Add a Breaking/Removed section. |
| `pip` → `miniPlayer.enabled` (rename) | migration ~L46 | Both exist: `pip: PipConfig` is native PiP and `miniPlayer` is the scroll player. |
| `qualitySelector` renamed to `quality` | migration ~L45 | `controls.qualitySelector` is still accepted as an alias. |
| Playground shows `muted: false` as non-default | `PlaygroundPage.tsx` | The `PlayerConfig.muted` default is `false` (LiveDemo's own default is `true`). |

## 2. Docs documenting features that are broken in the code
Until the player is fixed, these pages promise behaviour users won't get. Either fix the player (preferred) or add a warning Callout.

| Feature | Page(s) | Code issue |
|---|---|---|
| Top-level `chapters: [...]` | `features/chapters`, `api/config`, React/Vue/etc. samples | Wiped on load. Only `source.chapters` and `chaptersVtt` work (KI-01). |
| Seek thumbnails (`thumbnailVtt`, `source.thumbnails`) | `features/seek-thumbnail`, quick-start, React | Never displayed (KI-02). |
| DASH quality selection | `features/quality-selector`, `features/hls-dash` | Broken with dash.js 5, which the docs themselves install (KI-04). |
| `keyboardShortcuts: false` | `api/config`, changelog | Ignored (KI-08). |
| `playbackRate` initial value | `api/config` | Ignored (KI-08). |
| `gestures.doubleTapSeek` / `seekSeconds` | `features/touch-gestures` ~L43-57, React ~L54 | Ignored; double-tap uses `controls.seekDuration` (KI-09). `api/config` already says this. |
| `playlistOptions.startIndex` | `features/playlist`, `api/config` | Highlights the item but doesn't load it (KI-15). |
| React `onReady` | `frameworks/react` | Never fires (KI-20). |
| `<video-player>` `enterFullscreen()` / `enterPip()` | `api/player-instance` (via the element) | Implemented as toggles (KI-24). |
| CDN `player.umd.js` with HLS | installation, vanilla-js | HLS/DASH dynamic imports fail from a script tag (KI-07). |
| `security`, `sdkAuth` | `api/types` | Typed only; there is no implementation (KI-08). |

## 3. Contradictions between docs pages
- The double-tap amount: `features/touch-gestures` says it works, while `api/config` and the Playground comment say "not implemented". The changelog says `seekDuration` covers double-tap.
- The custom element tag name (section 1).
- `e.detail` shape: the events page uses `.data`; the web-component page and landing don't.
- `qualityChange` payload: the events and types pages say `{ fromQuality, toQuality, auto }`. React reads `quality.height`, which is correct for the React `onQualityChange` prop because it receives a `QualityLevel`. Svelte types it as `{ quality: { height } }`.
- Buffering: the bus `BufferingEvent` has no boolean (start only), while the DOM/React event has `{ buffering: boolean }`. Both are correct, but the docs should say they are different channels.
- Error type: bus `error` is documented as `PlayerError` (never defined on the types page), while `onError` uses `VidstreamError`. The code emits both shapes (KI-12).
- `playlist` is `required: true` on `features/playlist` but optional elsewhere.
- Feature counts: "9 production-ready features" vs "10+".
- Introduction says "every feature module is instantiated at startup" and also "tree-shakeable".
- Per-source thumbnails are named `source.thumbnails`, but `PlaylistItem.thumbnailVtt`. Both are correct in code; explain it once.
- `api/types` references `ControlsConfig`, `AnalyticsConfig`, `LMSProgressConfig`, `SecurityConfig`, `SDKAuthConfig`, `SubtitleTrack` and `PlayerError` without defining them.
- The `auto-resume` page header says "Automatic playback position persistence" with `badge="Feature"`, while its body says "Not available". Its sample comment says "every 5 seconds", but the code writes on every `timeupdate`.

## 4. Site bugs
Found in the audit; the ones marked † were confirmed from the built HTML, the rest by reading code.
- **Sidebar active state never matches**† (`components/layout/Sidebar.tsx`, `MobileNav.tsx`): they compare `pathname === item.href`, but `trailingSlash: true` makes the pathname end in `/`. Normalise both sides.
- **TOC goes stale on client navigation** (`components/layout/TableOfContents.tsx`): it reads headings once in `useEffect([])` inside the persistent layout. Key it by pathname.
- **Heading anchors open a new tab**† (`mdx-components.tsx` `a` mapping): treat `#…` hrefs as internal.
- **Syntax highlighting has no colours**: rehype-pretty-code's dual theme emits only `--shiki-light`/`--shiki-dark` vars, and no CSS maps them (`[data-theme] span { color: var(--shiki-light) } .dark … var(--shiki-dark)`). The `code` mapping also gives block code inline-code classes, and the `pre` mapping drops `data-language` and other attributes.
- **LiveDemo may clip the player controls** (unverified): `.player-demo-container` (globals.css ~L155-158) forces 16:9 with `overflow:hidden` on the outer div that also holds the label. Check in a browser.
- **Callout colours are dark-mode only** (`text-blue-200` etc.), so contrast is poor in light mode.
- **Metadata has no `metadataBase`.** The OG URL `https://vidstream-player.dev` is hard-coded.

## 5. Broken or invalid code samples
- `frameworks/nextjs` ~L133-152:
  - reads `params.id` synchronously (Next 15 `params` is a Promise);
  - uses `<VideoPlayerSection>` and `getVideo`, which are undefined (the component is named `PlayerSection`).
- `frameworks/nextjs` ~L27-38 renders the React wrapper from a server component. This works because `dist/react-wrapper.js` starts with `"use client"`, but say so explicitly.
- `frameworks/angular` ~L90: `@Component({ ... })` is not valid TypeScript, and the NgZone callout uses `NgZone` without importing it.
- `frameworks/svelte`:
  - ~L82: `$: if (player && source) player.loadSource(source)` double-loads the first source;
  - ~L166: `let container: HTMLDivElement = $state()` fails strict TypeScript.
- `api/events` ~L24-25, L142, L176-179: `(e) => { ... }` placeholder bodies are not valid JS.
- Undefined placeholders: `setLoading` (react ~L74, hls-dash ~L104), `myAnalyticsPlugin` (react ~L66).
- Vue Pinia sample sets `isBuffering = true` and never resets it.
- Playground sends `antiPiracyText: { enabled: false }` without the required `text`.

## 6. Coverage gaps and dead code
- **No pages for:**
  - features: watermark & anti-piracy text, subtitles/captions, native PiP, live mode, keyboard shortcuts;
  - integrations: the analytics plugin and adapters (`HttpAnalyticsAdapter`, batching), LMS progress tracking (`lmsProgress`, milestones, storage helpers);
  - the full web-component attribute list;
  - styling via `vidstream-player/styles` (optional, since CSS is injected at runtime).
- **Undocumented events:**
  - DOM `player-loaded`, `player-volumechange`, `player-fullscreen`, `player-pip`, `player-ratechange`, `player-milestone`, `player-progress-saved`, and the web component's `ready`;
  - `player-seek` is listed as an old name but is never emitted.
- **Unused imports:**
  - `Callout` in `api/events`;
  - `PropsTable` in `api/player-instance`, `features/hls-dash` and `frameworks/react`;
  - `Steps`/`Step` in `getting-started/installation`.
- **Unused components and dependencies:**
  - `FrameworkTabs`/`TabPanel`, and LiveDemo's `logoUrl`/`logoPosition` props;
  - every `@radix-ui/*` package, `framer-motion`, `class-variance-authority`, `@mdx-js/react`.
- **Assets:** `public/bbb-poster.jpg` (535 KB), `hero-poster.svg` and `react-logo.svg` are unused. `bbb-poster.png` (2.9 MB) is used by the Hero and should be compressed or converted.
