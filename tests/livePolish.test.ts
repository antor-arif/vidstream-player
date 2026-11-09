// Fixes from the real-edge test run (LIVE_PLAYER_ISSUES.md): auth failure state, rebuffer accounting
// at class end, no error events for expected live states, thin-playlist start hold, safe start level.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveLifecycle, type LiveLifecycleHost } from '../src/streaming/liveLifecycle';
import { LiveSessionStats } from '../src/services/liveSessionStats';
import { createPlayer } from './helpers';
import type { LiveState } from '../src/types';

const mocks = vi.hoisted(() => {
  const instances: any[] = [];
  class FakeHls {
    static isSupported() { return true; }
    static Events = {
      MANIFEST_LOADING: 'manifestLoading', MANIFEST_PARSED: 'manifestParsed', LEVEL_LOADED: 'levelLoaded',
      FRAG_LOADED: 'fragLoaded', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error',
    };
    config: any;
    handlers: Record<string, Function[]> = {};
    levels: any[] = [];
    url: string | null = null;
    stopped = 0;
    started = 0;
    startLevel: number | undefined;
    constructor(config: any) { this.config = config; instances.push(this); }
    on(event: string, fn: Function) { (this.handlers[event] ??= []).push(fn); }
    off(event: string, fn: Function) { this.handlers[event] = (this.handlers[event] ?? []).filter(h => h !== fn); }
    emit(event: string, data: any) { (this.handlers[event] ?? []).forEach(fn => fn(event, data)); }
    loadSource(src: string) { this.url = src; }
    attachMedia() {}
    startLoad() { this.started++; }
    stopLoad() { this.stopped++; }
    destroy() {}
  }
  return { instances, FakeHls };
});
vi.mock('hls.js', () => ({ default: mocks.FakeHls }));

const SRC = 'https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/abr/class-1/ts:master.m3u8';

async function flush(n = 60): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
async function nextHls(before: number): Promise<any> {
  for (let i = 0; i < 300 && mocks.instances.length <= before; i++) await Promise.resolve();
  await flush(10);
  return mocks.instances.at(-1);
}
function frags(n: number) {
  return Array.from({ length: n }, (_, i) => ({ sn: i }));
}
function levelLoaded(hls: any, fragments: number, startSN = 0) {
  hls.levels = [{ height: 720 }];
  hls.emit('levelLoaded', {
    details: { live: true, endSN: startSN + fragments - 1, startSN, targetduration: 3, fragments: frags(fragments) },
  });
}
/** Live player that has started playing */
async function startedLivePlayer(config: Record<string, unknown> = {}) {
  const ctx = createPlayer({ source: { src: SRC }, mode: 'live', ...config });
  const hls = await nextHls(0);
  levelLoaded(hls, 5);
  ctx.video.dispatchEvent(new Event('playing'));
  return { ...ctx, hls };
}
const visible = (el: Element | null) => !!el && !(el as HTMLElement).hidden;

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.instances.length = 0;
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// 1. Auth failure: one overlay, `error` state, fast failure, clean retry
// ---------------------------------------------------------------------------
describe('auth failure without a refresher', () => {
  it('fails on the 3rd 403, stops loading, shows only the error overlay, state `error`', async () => {
    const { player, container, hls } = await startedLivePlayer();
    const errors: any[] = [];
    const states: LiveState[] = [];
    player.on('error', (e: any) => errors.push(e));
    player.on('liveStateChange', (e: any) => states.push(e.state));

    const err403 = { type: 'networkError', details: 'fragLoadError', fatal: false, response: { code: 403 } };
    hls.emit('error', err403);
    hls.emit('error', err403);
    await flush();
    expect(errors).toEqual([]);
    expect(container.querySelector('.vp-error')).toBeNull();

    hls.emit('error', err403);
    await flush();
    expect(hls.stopped).toBeGreaterThan(0);
    expect(errors.at(-1)).toMatchObject({ code: 'AUTH_ERROR', fatal: true });
    expect(container.querySelector('.vp-error')).not.toBeNull();
    expect(visible(container.querySelector('.vp-live-overlay'))).toBe(false);
    expect(player.getLiveState()).toBe('error');
    expect(states.at(-1)).toBe('error');
    player.destroy();
  });

  it('error replaces a visible "Reconnecting…" overlay', async () => {
    const { player, container, hls } = await startedLivePlayer();
    // fatal network error, retry budget exhausted → reconnecting overlay first
    hls.emit('error', { type: 'networkError', details: 'levelLoadError', fatal: false, response: { code: 0 } });
    (player as any).liveLifecycle.networkFailure();
    expect(visible(container.querySelector('.vp-live-overlay'))).toBe(true);
    hls.emit('error', { type: 'networkError', details: 'levelLoadError', fatal: true, response: { code: 403 } });
    await flush();
    expect(container.querySelector('.vp-error')).not.toBeNull();
    expect(visible(container.querySelector('.vp-live-overlay'))).toBe(false);
    expect(player.getLiveState()).toBe('error');
    player.destroy();
  });

  it('a successful load in between resets the count (transient 403s)', async () => {
    const { player, hls } = await startedLivePlayer();
    const errors: any[] = [];
    player.on('error', (e: any) => errors.push(e));
    const err403 = { type: 'networkError', details: 'fragLoadError', fatal: false, response: { code: 403 } };
    hls.emit('error', err403);
    hls.emit('error', err403);
    hls.emit('fragLoaded', { frag: { stats: { loaded: 10 } } });
    hls.emit('error', err403);
    hls.emit('error', err403);
    await flush();
    expect(errors).toEqual([]);
    expect(player.getLiveState()).toBe('playing');
    player.destroy();
  });

  it('Retry restarts the lifecycle cleanly', async () => {
    const { player, container, hls, video } = await startedLivePlayer();
    hls.emit('error', { type: 'networkError', details: 'manifestLoadError', fatal: true, response: { code: 403 } });
    await flush();
    expect(player.getLiveState()).toBe('error');
    (container.querySelector('.vp-error-retry') as HTMLButtonElement).click();
    const next = await nextHls(1);
    expect(next).not.toBe(hls);
    expect(container.querySelector('.vp-error')).toBeNull();
    expect(player.getLiveState()).toBe('reconnecting');
    levelLoaded(next, 5, 10);
    video.dispatchEvent(new Event('playing'));
    expect(player.getLiveState()).toBe('playing');
    player.destroy();
  });

  it('with a refresher, 403s keep going through the refresh path (no fast fail)', async () => {
    const { player, hls } = await startedLivePlayer({
      security: { refreshPlaybackUrl: async () => SRC },
    });
    const errors: any[] = [];
    player.on('error', (e: any) => errors.push(e));
    const err403 = { type: 'networkError', details: 'fragLoadError', fatal: false, response: { code: 403 } };
    for (let i = 0; i < 5; i++) hls.emit('error', err403);
    await flush();
    expect(errors).toEqual([]);
    expect(hls.stopped).toBe(0);
    player.destroy();
  });
});

describe('LiveLifecycle error state', () => {
  function make() {
    const states: LiveState[] = [];
    const host: LiveLifecycleHost = {
      restart() {}, resumeLoading() {}, stopLoading() {}, onEnded() {},
      onStateChange(state) { states.push(state); },
    };
    const container = document.createElement('div');
    const ac = new AbortController();
    const lc = new LiveLifecycle(container, host, () => ({}), ac.signal);
    lc.setActive(true);
    return { lc, states, container, ac };
  }

  it('fail → error (overlay hidden); offline does not override it; retrying → reconnecting/idle', () => {
    const { lc, container, ac } = make();
    lc.playing();
    lc.networkFailure();
    expect(visible(container.querySelector('.vp-live-overlay'))).toBe(true);
    lc.fail();
    expect(lc.getState()).toBe('error');
    expect(visible(container.querySelector('.vp-live-overlay'))).toBe(false);
    window.dispatchEvent(new Event('offline'));
    expect(lc.getState()).toBe('error');
    lc.networkFailure();
    lc.streamUnavailable();
    expect(lc.getState()).toBe('error');
    lc.retrying();
    expect(lc.getState()).toBe('reconnecting');
    lc.setActive(false);
    ac.abort();

    const fresh = make();
    fresh.lc.fail();
    fresh.lc.retrying();
    expect(fresh.lc.getState()).toBe('idle');
    fresh.lc.setActive(false);
    fresh.ac.abort();
  });
});

// ---------------------------------------------------------------------------
// 2. Rebuffer accounting around the class end
// ---------------------------------------------------------------------------
describe('LiveSessionStats around the end of a class', () => {
  it('a trailing stall that ends in `ended` is not counted (time or count)', () => {
    let t = 1_000_000;
    const s = new LiveSessionStats(() => t);
    s.onLiveState('playing');
    s.onPlaying();
    t += 10_000;
    s.onWaiting();              // real rebuffer, 2 s
    t += 2_000;
    s.onPlaying();
    t += 29_300;                // tutor stops; playback drains the buffer
    s.onWaiting();              // trailing stall
    t += 6_000;
    s.onLiveState('reconnecting');
    t += 15_000;
    s.onLiveState('ended');
    t += 30_000;                // page stays open
    const snap = s.snapshot();
    expect(snap.watchedSeconds).toBe(39.3);
    expect(snap.rebufferCount).toBe(1);
    expect(snap.rebufferSeconds).toBe(2);
  });

  it('stall time stops at offline / error / idle and resumes for the same stall', () => {
    let t = 1_000_000;
    const s = new LiveSessionStats(() => t);
    s.onLiveState('playing');
    s.onPlaying();
    t += 5_000;
    s.onWaiting();
    t += 1_000;
    s.onLiveState('offline');
    t += 60_000;                 // not counted
    s.onLiveState('reconnecting');
    t += 1_000;
    s.onPlaying();
    s.onLiveState('playing');
    expect(s.snapshot()).toMatchObject({ rebufferCount: 1, rebufferSeconds: 2 });

    s.onWaiting();
    t += 1_000;
    s.onLiveState('error');
    t += 100_000;
    expect(s.snapshot()).toMatchObject({ rebufferCount: 2, rebufferSeconds: 3 });
  });

  it('a stall that starts while offline is counted only once the stream is back', () => {
    let t = 1_000_000;
    const s = new LiveSessionStats(() => t);
    s.onLiveState('playing');
    s.onPlaying();
    t += 5_000;
    s.onLiveState('offline');
    s.onWaiting();
    t += 10_000;
    expect(s.snapshot()).toMatchObject({ rebufferCount: 0, rebufferSeconds: 0 });
    s.onLiveState('reconnecting');
    t += 1_500;
    s.onPlaying();
    expect(s.snapshot()).toMatchObject({ rebufferCount: 1, rebufferSeconds: 1.5 });
  });

  it('player: trailing reconnecting → ended leaves rebuffer stats untouched', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const { player, video } = await startedLivePlayer();
    vi.advanceTimersByTime(5000);
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(4000);          // watchdog: playlist stuck ≥ 9 s → reconnecting
    expect(player.getLiveState()).toBe('reconnecting');
    (player as any).liveLifecycle.httpStatus(404);
    vi.advanceTimersByTime(12000);         // ≥ endedTimeout (20 s) since the last advance → ended
    expect(player.getLiveState()).toBe('ended');
    vi.advanceTimersByTime(60000);
    expect(player.getLiveStats()).toMatchObject({ rebufferCount: 0, rebufferSeconds: 0 });
    player.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Expected live states are not errors
// ---------------------------------------------------------------------------
describe('no error events for expected live states', () => {
  it('waiting for the class: manifest 404 polls emit no error, only liveStateChange', async () => {
    const { player } = createPlayer({ source: { src: SRC }, mode: 'live' });
    const errors: any[] = [];
    const states: LiveState[] = [];
    player.on('error', (e: any) => errors.push(e));
    player.on('liveStateChange', (e: any) => states.push(e.state));
    const hls = await nextHls(0);
    hls.emit('error', { type: 'networkError', details: 'manifestLoadError', fatal: true, response: { code: 404 } });
    hls.emit('error', { type: 'networkError', details: 'levelEmptyError', fatal: true });
    await flush();
    expect(errors).toEqual([]);
    expect(states).toEqual(['waiting']);
    player.destroy();
  });

  it('404 after the class started: reconnecting quietly, then ended without error events', async () => {
    const { player, hls } = await startedLivePlayer();
    const errors: any[] = [];
    const ended: any[] = [];
    player.on('error', (e: any) => errors.push(e));
    player.on('streamEnded', (e: any) => ended.push(e));
    hls.emit('error', { type: 'networkError', details: 'levelLoadError', fatal: true, response: { code: 404 } });
    await flush();
    expect(errors).toEqual([]);
    expect(player.getLiveState()).toBe('reconnecting');
    player.markStreamEnded();
    expect(errors).toEqual([]);
    expect(ended).toHaveLength(1);
    player.destroy();
  });

  it('real errors still emit: fatal media error', async () => {
    const { player, hls } = await startedLivePlayer();
    const errors: any[] = [];
    player.on('error', (e: any) => errors.push(e));
    hls.emit('error', { type: 'mediaError', details: 'bufferAppendError', fatal: true });
    expect(errors.at(-1)).toMatchObject({ code: 'DECODE_ERROR' });
    player.destroy();
  });

  it('real errors still emit: network errors after start (non-404)', async () => {
    const { player, hls } = await startedLivePlayer();
    const errors: any[] = [];
    player.on('error', (e: any) => errors.push(e));
    hls.emit('error', { type: 'networkError', details: 'fragLoadError', fatal: true, response: { code: 502 } });
    expect(errors.at(-1)).toMatchObject({ code: 'NETWORK_ERROR' });
    player.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Thin playlist start hold
// ---------------------------------------------------------------------------
describe('live.minSegmentsToStart', () => {
  it('standard mode: holds in `waiting` until the playlist has 4 segments', async () => {
    const { player } = createPlayer({ source: { src: SRC }, mode: 'live', live: { latencyMode: 'standard', offlinePollInterval: 1000 } });
    const hls = await nextHls(0);
    levelLoaded(hls, 2);
    expect(hls.stopped).toBe(1);
    expect(player.getLiveState()).toBe('waiting');

    // the poll rebuilds the engine; now 4 segments → start
    await new Promise(r => setTimeout(r, 1100));
    const next = await nextHls(1);
    levelLoaded(next, 4);
    expect(next.stopped).toBe(0);
    player.destroy();
  });

  it('a sliding window (edge keeps fewer segments) releases the hold', async () => {
    const { player } = createPlayer({ source: { src: SRC }, mode: 'live', live: { latencyMode: 'standard', minSegmentsToStart: 6 } });
    const hls = await nextHls(0);
    levelLoaded(hls, 3, 0);
    expect(hls.stopped).toBe(1);
    levelLoaded(hls, 3, 2);   // startSN moved: the window is full at 3 segments
    expect(hls.stopped).toBe(1);
    player.destroy();
  });

  it('low mode and the legacy config do not hold; the option is configurable', async () => {
    for (const live of [{ latencyMode: 'low' }, undefined, { latencyMode: 'standard', minSegmentsToStart: 0 }]) {
      document.body.innerHTML = '';
      mocks.instances.length = 0;
      const { player } = createPlayer({ source: { src: SRC }, mode: 'live', live: live as any });
      const hls = await nextHls(0);
      levelLoaded(hls, 1);
      expect(hls.stopped).toBe(0);
      player.destroy();
    }
    mocks.instances.length = 0;
    const { player } = createPlayer({ source: { src: SRC }, mode: 'live', live: { minSegmentsToStart: 3 } });
    const hls = await nextHls(0);
    levelLoaded(hls, 2);
    expect(hls.stopped).toBe(1);
    player.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Start level
// ---------------------------------------------------------------------------
describe('live.startLevel', () => {
  const LEVELS = [{ height: 720, bitrate: 2_500_000 }, { height: 360, bitrate: 800_000 }];
  async function startLevelFor(config: Record<string, unknown>) {
    document.body.innerHTML = '';
    mocks.instances.length = 0;
    const { player } = createPlayer({ source: { src: SRC }, ...config });
    const hls = await nextHls(0);
    hls.emit('manifestParsed', { levels: LEVELS });
    player.destroy();
    return hls.startLevel;
  }

  it('defaults to the lowest rendition for live', async () => {
    expect(await startLevelFor({ mode: 'live' })).toBe(1);
  });
  it("'auto' leaves hls.js alone, a number is passed through", async () => {
    expect(await startLevelFor({ mode: 'live', live: { startLevel: 'auto' } })).toBeUndefined();
    expect(await startLevelFor({ mode: 'live', live: { startLevel: 0 } })).toBe(0);
  });
  it('hlsConfig.startLevel, quality.defaultQuality and VOD are not touched', async () => {
    expect(await startLevelFor({ mode: 'live', hlsConfig: { startLevel: 0 } })).toBeUndefined();
    expect(await startLevelFor({ mode: 'live', quality: { defaultQuality: 720 } })).toBeUndefined();
    expect(await startLevelFor({})).toBeUndefined();
  });
});
