# vidstream-player — testing and verification

There is no automated test suite. Verification means type-check, build, and then exercising the behaviour in a real browser. Do all three for any behavioural change. Type-checking alone has repeatedly missed broken features in this codebase.

## 1. Static checks (inside `Vidstream-player/`)
```bash
npx tsc --noEmit        # must be 0 errors
npm run build           # must print "Build completed successfully." (CJS-deprecation + "use client" warnings are expected)
```
`npm run build` rewrites `dist/`. That is fine, since dist is gitignored and the `Test/` apps need a fresh build anyway. To check that the build works without touching dist, copy `src scripts public package.json tsconfig.json` to a scratch folder, junction or symlink its `node_modules` to the package's, and run `node scripts/build.js` there.

## 2. Browser harness (preferred for behaviour checks)

Start it from the workspace root, as a background task because it keeps running:
```bash
node .claude/skills/vidstream-player/scripts/verify-server.mjs        # run from the repo root (or the workspace root); package auto-detected; optional port (default 5199)
```

What it does:
- It prints a URL like `http://localhost:5199/@fs/D:/Projects/Vidstream/.claude/skills/vidstream-player/assets/verify.html`.
- It serves the **live `src/`**, so after you edit a file, just reload the page. No rebuild is needed.
- The Vite cache goes to the OS temp dir, so nothing is written into the package.
- The package root is also served, so `http://localhost:5199/index.html` is the old dev demo page.

Globals the page exposes:

| Global | What it is |
|---|---|
| `VS` | Everything exported from `src/index.ts` |
| `STREAMS` | Test URLs: `mp4`, `hls`, `hls2`, `dash`, `dash2`, `poster` |
| `mount(config, slotId?)` | Creates or replaces a player in a slot div and returns the `VideoPlayer`. A default MP4 player is in `slot-1` unless the URL has `?empty`. |
| `players` | The mounted players, keyed by slot id |
| `waitFor(fn, ms)` | Polls until `fn()` is truthy |
| `vttUrl(text)` | Turns inline VTT text into a blob URL |
| `log(...)` | Writes to the on-page log |

Private fields (`p.hls`, `p.dash`, `p.controlsManager`, `p.config`, `p.thumbnailPreview`) are reachable from the console because TypeScript `private` is compile-time only. That is useful for probing.

**With the Claude-in-Chrome tools:**
1. Open a new tab and navigate to the URL.
2. Use `javascript_tool` with top-level `await` to run probes like the ones below.
3. Close the tab and stop the background server when done.

**Without browser tools:** give the user the URL and the exact steps to check.

The React wrapper can't be loaded in this harness, because `react` isn't installed in the package. Use `Test/react` (section 4) for React checks.

### Probe recipes
```js
// Wait for metadata
const p = players['slot-1']; await waitFor(() => p.getDuration() > 0);

// Chapters render (KI-01 regression check)
const c = mount({ source: { src: STREAMS.mp4 }, chapters: [{ id: '1', title: 'A', startTime: 0 }, { id: '2', title: 'B', startTime: 15 }] }, 'slot-2');
await waitFor(() => c.getDuration() > 0); await new Promise(r => setTimeout(r, 300));
({ segments: document.querySelectorAll('#slot-2 .vp-chapter-segment').length,
   button: document.querySelector('#slot-2 [data-dropdown="chapters"]').style.display });   // expect 2, ''

// Seek-thumbnail placement (KI-02 regression check)
const vtt = vttUrl('WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n' + STREAMS.poster + '#xywh=0,0,160,90\n');
const t = mount({ source: { src: STREAMS.mp4 }, thumbnailVtt: vtt }, 'slot-3');
await waitFor(() => t.getDuration() > 0 && t.thumbnailPreview);
const bar = document.querySelector('#slot-3 .vp-progress'), r = bar.getBoundingClientRect();
bar.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width * 0.05, clientY: r.top, bubbles: true }));
const el = document.querySelector('#slot-3 .vp-thumb-preview');
({ exists: !!el, visible: el && getComputedStyle(el).display !== 'none',
   insidePlayer: el && el.getBoundingClientRect().top >= document.getElementById('slot-3').getBoundingClientRect().top });

// HLS quality list + switching
const h = mount({ source: { src: STREAMS.hls } }, 'slot-4');
await waitFor(() => h.getState().qualities.length, 20000);
h.setQuality(720); await new Promise(r => setTimeout(r, 3000)); h.getQuality();

// DASH (KI-04 regression check: expect qualities > 0 and no throw)
const d = mount({ source: { src: STREAMS.dash } }, 'slot-5');
await waitFor(() => d.getDuration() > 0, 20000); await new Promise(r => setTimeout(r, 1500));
let threw = null; try { d.setQuality(720); } catch (e) { threw = e.message; }
({ qualities: d.getState().qualities.length, threw });

// Keyboard shortcuts disabled (KI-08)
let n = 0; const k = mount({ source: { src: STREAMS.mp4 }, keyboardShortcuts: false }, 'slot-6');
k.togglePlay = () => n++;   // instance patch: callbacks resolve this.togglePlay at call time
document.getElementById('slot-6').dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true })); n; // expect 0

// Listener leak after destroy (KI-10): mount twice on the same element; mount() destroys the first one
const ev = [];
const a = mount({ source: { src: STREAMS.mp4 } }, 'slot-7'); a.togglePlay = () => ev.push('a');
const b = mount({ source: { src: STREAMS.mp4 } }, 'slot-7'); b.togglePlay = () => ev.push('b');
document.querySelector('#slot-7 video').click(); ev;   // expect ['b']; ['a','b'] means the destroyed player's listener leaked

// Event channels — collect what fires
const seen = []; const e = players['slot-1'];
['play','pause','seek','timeupdate','ended','error','qualityChange','chapterChange','playlistChange','buffering'].forEach(n => e.on(n, d => seen.push([n, d])));
document.getElementById('slot-1').addEventListener('player-error', ev => seen.push(['dom:player-error', ev.detail.data]));

// Analytics capture
const evs = []; mount({ source: { src: STREAMS.mp4 }, analytics: { enabled: true, adapter: { trackEvent: p => evs.push(p.eventName) } } }, 'slot-8');
```
Media won't autoplay unmuted without a user gesture. For playback probes, pass `muted: true`, or call `video.muted = true` before `play()`.

## 3. Test streams
| Kind | URL |
|---|---|
| MP4 (52 s) | https://media.w3.org/2010/05/sintel/trailer.mp4 |
| HLS VOD, 5 renditions (184p–1080p) | https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 |
| HLS VOD (Tears of Steel) | https://test-streams.mux.dev/tos_ismc/master.m3u8 |
| HLS (Sintel, with subtitles in the manifest) | https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8 |
| DASH VOD (BBB 30fps, ~10 min) | https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd |
| DASH VOD (Angel One) | https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd |
| Poster image | https://peach.blender.org/wp-content/uploads/title_anouncement.jpg |
| Captions file | `Vidstream-player/public/test-captions.vtt` (served at `/test-captions.vtt` by the harness server) |

To test errors, use a 404 URL (`https://example.com/missing.m3u8`) or block the host in DevTools mid-playback to exercise retries.

## 4. `Test/` framework apps (integration through the built package)

They depend on `"vidstream-player": "file:../../Vidstream-player"`, so run `npm run build` in the package first.

| App | Run | Port | State (2026-11-01; port 5174 is taken by another local app's service worker — use e.g. `--host 127.0.0.1 --port 5187`) |
|---|---|---|---|
| `Test/vanilla` | `cd Test/vanilla && npx vite` (run `npm install` if `node_modules` is empty) | 5173 | Not run in the audit. Uses `createVideoPlayer` and `vidstream-player/styles`, so it should work after a build. |
| `Test/react` | `cd Test/react && npx vite` | 5174 | Not run in the audit. Has node_modules. Exercises props, ref, hooks and the analytics plugin. Expect KI-20/21. |
| `Test/vue` | `npm install` first, then `npx vite` | 5175 | **Broken**: uses the `<vidstream-player>` tag, which is never registered (KI-41). |
| `Test/angular` | `npm install` first, then `npx vite` | – | **Broken**: same tag issue; `el.initialize` is undefined. |

Fixing Vue and Angular means changing the tag to `video-player` there (and in `isCustomElement`), or registering a `vidstream-player` alias in the library.

## 5. What needs manual / device testing
These can't be faked meaningfully with synthetic events. Ask the user to check on real devices, or state clearly that they were not verified:
- touch gestures (double-tap zones, swipe volume, long-press speed);
- iOS Safari: native HLS path, fullscreen (KI-28), autoplay policy;
- Picture-in-Picture and fullscreen. These need user activation, so a synthetic call from `javascript_tool` is usually rejected;
- the mini player while scrolling (it can be probed by scrolling the harness page with several slots);
- keyboard focus and screen readers.

## 6. Manual regression checklist (before a release)
1. Run MP4, HLS and DASH through the following: play/pause, seek by click and by drag, ±10 s, volume/mute, speed menu, quality menu (HLS and DASH), fullscreen and PiP.
2. Subtitles: menu on and off, and the `c` key.
3. Chapters: via `source.chapters`, top-level `chapters` and `chaptersVtt`, including segments, the tooltip name and `chapterChange`.
4. Seek thumbnails.
5. Playlist: auto-next, prev and next buttons, the panel with `showPanel`, `startIndex` and `loop`.
6. Mini player on scroll, including close.
7. Live mode with an HLS live stream: the LIVE badge shows and the seek UI is hidden.
8. Error UI and the Retry button with a bad URL.
9. Watermark positions and anti-piracy text movement.
10. React (`Test/react`): `onReady`, prop updates, unmount and remount, StrictMode.
11. Web component: attributes before and after connection, `ready` event.
12. `destroy()` and re-create on the same element (no duplicated handlers).

## 7. Live, LL-HLS and P2P (real streams)
- `node scripts/ll-hls-server.mjs [8099]` — local live stream from ffmpeg-generated media: `/ll/index.m3u8` (LL-HLS: 0.5 s parts, blocking reload, preload hints) and `/seg/index.m3u8` (2 s segments). Media is ~10 min and does NOT loop: check `/stats` `remainingSeconds` and restart before long runs (a frozen edge looks exactly like a player stall bug).
- `assets/p2p-live.html` (via verify-server) shows latency/peers/P2P live; params `src,target,strategy,parts,trackers,p2p=0`.
- `scripts/p2p-viewers.mjs "<p2p-live URL + query>" [viewers] [seconds]` (run from a scratch folder with puppeteer-core installed; Chrome auto-detected, or CHROME_PATH) — N headless Chrome viewers (puppeteer-core + local Chrome) printing latency, stalls and P2P per viewer. Use this, not browser tabs: background tabs never start media and give bogus numbers.
- Browser-tool scripts must finish in < 45 s; split longer measurements.
- Public live HLS for sanity checks: https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8 (1.92 s segments).
