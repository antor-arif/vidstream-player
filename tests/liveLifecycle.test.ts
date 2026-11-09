import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveLifecycle, DEFAULT_LIVE_MESSAGES, type LiveLifecycleHost } from '../src/streaming/liveLifecycle';
import { P2PStatsTracker, resetP2PEngineCache } from '../src/streaming/p2p';
import { createPlayer } from './helpers';
import type { LiveState } from '../src/types';

// ---------------------------------------------------------------------------
// Fake hls.js + SwarmCloud
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const instances: any[] = [];
  const swarm: any[] = [];
  class FakeHls {
    static isSupported() { return true; }
    static Events = {
      MANIFEST_LOADING: 'manifestLoading', MANIFEST_PARSED: 'manifestParsed', LEVEL_LOADED: 'levelLoaded',
      FRAG_LOADED: 'fragLoaded', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error',
    };
    config: any;
    handlers: Record<string, Function[]> = {};
    levels: any[] = [];
    liveSyncPosition: number | null = null;
    latency: number | null = null;
    targetLatency: number | null = null;
    url: string | null = null;
    stopped = 0;
    destroyed = false;
    constructor(config: any) { this.config = config; instances.push(this); }
    on(event: string, fn: Function) { (this.handlers[event] ??= []).push(fn); }
    off(event: string, fn: Function) { this.handlers[event] = (this.handlers[event] ?? []).filter(h => h !== fn); }
    emit(event: string, data: any) { (this.handlers[event] ?? []).forEach(fn => fn(event, data)); }
    loadSource(src: string) { this.url = src; }
    attachMedia() {}
    startLoad() {}
    stopLoad() { this.stopped++; }
    destroy() { this.destroyed = true; }
  }
  class FakeSwarm {
    static isSupported() { return true; }
    config: any;
    destroyed = false;
    constructor(config: any) { this.config = config; swarm.push(this); }
    destroy() { this.destroyed = true; }
  }
  return { instances, swarm, FakeHls, FakeSwarm };
});
vi.mock('hls.js', () => ({ default: mocks.FakeHls }));
vi.mock('@swarmcloud/hls', () => ({ default: mocks.FakeSwarm }));

const SRC = 'https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/abr/class-1/ts:master.m3u8';

async function flush(n = 60): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
async function nextHls(before: number): Promise<any> {
  for (let i = 0; i < 300 && mocks.instances.length <= before; i++) await Promise.resolve();
  await flush(10);
  return mocks.instances.at(-1);
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.instances.length = 0;
  mocks.swarm.length = 0;
  resetP2PEngineCache();
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
function makeLifecycle(config: Record<string, unknown> = {}) {
  const states: LiveState[] = [];
  const host: LiveLifecycleHost & { restarts: number; resumed: number; stopped: number; ended: number } = {
    restarts: 0, resumed: 0, stopped: 0, ended: 0,
    restart() { this.restarts++; },
    resumeLoading() { this.resumed++; },
    stopLoading() { this.stopped++; },
    onStateChange(state) { states.push(state); },
    onEnded() { this.ended++; },
  };
  const container = document.createElement('div');
  const ac = new AbortController();
  const lc = new LiveLifecycle(container, host, () => config, ac.signal);
  lc.setActive(true);
  return { lc, host, states, container, ac };
}

describe('LiveLifecycle', () => {
  it('waiting: polls until the stream starts, then plays', () => {
    vi.useFakeTimers();
    const { lc, host, states, container } = makeLifecycle({ offlinePollInterval: 5000 });
    lc.streamUnavailable();
    expect(lc.getState()).toBe('waiting');
    expect(container.querySelector('.vp-live-overlay-text')?.textContent).toBe(DEFAULT_LIVE_MESSAGES.waiting);
    vi.advanceTimersByTime(4999);
    expect(host.restarts).toBe(0);
    vi.advanceTimersByTime(1);
    expect(host.restarts).toBe(1);
    lc.streamUnavailable();
    vi.advanceTimersByTime(5000);
    expect(host.restarts).toBe(2);
    lc.playing();
    expect(lc.getState()).toBe('playing');
    expect((container.querySelector('.vp-live-overlay') as HTMLElement).hidden).toBe(true);
    expect(states).toEqual(['waiting', 'playing']);
    // No more polling once playing
    vi.advanceTimersByTime(20000);
    expect(host.restarts).toBe(2);
  });

  it('stuck playlist → reconnecting; advancing again → playing', () => {
    vi.useFakeTimers();
    const { lc } = makeLifecycle();
    lc.playing();
    lc.playlistUpdate(10, true, 3);
    vi.advanceTimersByTime(9000);
    expect(lc.getState()).toBe('reconnecting');
    lc.playlistUpdate(11, true, 3);
    expect(lc.getState()).toBe('playing');
  });

  it('ended: stuck for endedTimeout AND 404s', () => {
    vi.useFakeTimers();
    const { lc, host, container } = makeLifecycle({ endedTimeout: 20000 });
    lc.playing();
    lc.playlistUpdate(10, true, 3);
    vi.advanceTimersByTime(25000);
    // Stuck but no 404 yet: still reconnecting (could be a network problem)
    expect(lc.getState()).toBe('reconnecting');
    lc.httpStatus(404);
    vi.advanceTimersByTime(1000);
    expect(lc.getState()).toBe('ended');
    expect(host.stopped).toBe(1);
    expect(host.ended).toBe(1);
    expect(container.querySelector('.vp-live-overlay-text')?.textContent).toBe(DEFAULT_LIVE_MESSAGES.ended);
    // Terminal
    lc.playing();
    lc.streamUnavailable();
    expect(lc.getState()).toBe('ended');
  });

  it('ENDLIST after playback started ends the stream', () => {
    const { lc } = makeLifecycle();
    lc.playing();
    lc.playlistUpdate(5, false, 3);
    expect(lc.getState()).toBe('ended');
  });

  it('offline / online', () => {
    const { lc, host, container } = makeLifecycle({ messages: { offline: 'Sin conexión' } });
    lc.playing();
    window.dispatchEvent(new Event('offline'));
    expect(lc.getState()).toBe('offline');
    expect(container.querySelector('.vp-live-overlay-text')?.textContent).toBe('Sin conexión');
    window.dispatchEvent(new Event('online'));
    expect(host.resumed).toBe(1);
    expect(lc.getState()).toBe('reconnecting');
    lc.playing();
    expect(lc.getState()).toBe('playing');
  });

  it('removes window listeners with its signal', () => {
    const { lc, ac } = makeLifecycle();
    lc.playing();
    ac.abort();
    window.dispatchEvent(new Event('offline'));
    expect(lc.getState()).toBe('playing');
  });
});

describe('P2PStatsTracker totals (SwarmCloud)', () => {
  it('uses reported totals and peer count', () => {
    const t = new P2PStatsTracker('s');
    t.setTotals({ httpBytes: 1000, p2pBytes: 3000, uploadedBytes: 500 });
    t.setPeerCount(4);
    expect(t.snapshot()).toMatchObject({ httpBytes: 1000, p2pBytes: 3000, uploadedBytes: 500, peers: 4, p2pRatio: 0.75 });
  });
});

// ---------------------------------------------------------------------------
// Player integration
// ---------------------------------------------------------------------------
describe('VideoPlayer live UX', () => {
  it('manifest 404 before start → waiting overlay, no error UI; markStreamEnded → ended', async () => {
    const events: string[] = [];
    const { player, container } = createPlayer({ source: { src: SRC }, mode: 'live' });
    container.addEventListener('player-live-state-change', (e: any) => events.push(e.detail.data.state));
    const ended = vi.fn();
    player.on('streamEnded', ended);
    const hls = await nextHls(0);
    hls.emit('error', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 404 } });
    expect(player.getLiveState()).toBe('waiting');
    expect(container.querySelector('.vp-error')).toBeNull();
    expect(container.querySelector('.vp-live-overlay')).not.toBeNull();

    player.markStreamEnded();
    expect(player.getLiveState()).toBe('ended');
    expect(ended).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['waiting', 'ended']);
    player.destroy();
    expect(container.querySelector('.vp-live-overlay')).toBeNull();
  });

  it('live mode: arrows and double-click sides never seek; ArrowRight / right side = go live', async () => {
    const { player, container } = createPlayer({ source: { src: SRC }, mode: 'live' });
    await nextHls(0);
    const seek = vi.spyOn(player, 'seek');
    const goLive = vi.spyOn(player, 'seekToLive');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON() {} });
    container.dispatchEvent(new MouseEvent('dblclick', { clientX: 10, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('dblclick', { clientX: 290, clientY: 100, bubbles: true }));
    expect(seek).not.toHaveBeenCalled();
    expect(goLive).toHaveBeenCalledTimes(2);
    player.destroy();
  });

  it('VOD keeps arrow seeking', async () => {
    const { player, container } = createPlayer({});
    const seek = vi.spyOn(player, 'seek');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(seek).toHaveBeenCalledTimes(1);
    player.destroy();
  });

  it('hides the quality button with a single rendition', async () => {
    const { player, container } = createPlayer({ source: { src: SRC }, mode: 'live' });
    const hls = await nextHls(0);
    const btn = container.querySelector('.vp-btn-quality') as HTMLElement;
    hls.emit('manifestParsed', { levels: [{ height: 720, width: 1280, bitrate: 1e6 }] });
    expect(btn.style.display).toBe('none');
    player.destroy();

    const second = createPlayer({ source: { src: SRC }, mode: 'live' });
    const hls2 = await nextHls(1);
    hls2.emit('manifestParsed', { levels: [{ height: 720, width: 1280, bitrate: 1e6 }, { height: 360, width: 640, bitrate: 4e5 }] });
    expect((second.container.querySelector('.vp-btn-quality') as HTMLElement).style.display).toBe('');
    second.player.destroy();
  });

  it('autoplay blocked on live → muted fallback + "Tap to unmute" pill', async () => {
    const { player, container, video } = createPlayer({ source: { src: SRC }, mode: 'live', autoplay: true });
    await nextHls(0);
    const blocked = vi.fn();
    player.on('autoplayBlocked', blocked);
    let calls = 0;
    video.play = vi.fn(() => {
      calls++;
      return calls === 1 ? Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })) : Promise.resolve();
    });
    video.dispatchEvent(new Event('canplay'));
    await flush();
    expect(video.muted).toBe(true);
    expect(blocked).toHaveBeenCalledWith(expect.objectContaining({ mutedFallback: true }));
    const pill = container.querySelector('.vp-unmute-pill') as HTMLButtonElement;
    expect(pill.textContent).toBe('Tap to unmute');
    pill.click();
    expect(video.muted).toBe(false);
    expect(container.querySelector('.vp-unmute-pill')).toBeNull();
    player.destroy();
  });

  it('resumes at the live edge after a pause', async () => {
    vi.useFakeTimers();
    const { player, video } = createPlayer({ source: { src: SRC }, mode: 'live' });
    const hls = await nextHls(0);
    hls.liveSyncPosition = 500;
    video.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(60000);
    video.dispatchEvent(new Event('play'));
    expect(video.currentTime).toBe(500);
    player.destroy();
  });

  it('SwarmCloud provider: engine created before loadSource with a tokenless channel id; destroyed on teardown', async () => {
    const { player } = createPlayer({ source: { src: SRC }, mode: 'live', p2p: { enabled: true, provider: 'swarmcloud', token: 'tok' } });
    const hls = await nextHls(0);
    await flush(30);
    expect(mocks.swarm).toHaveLength(1);
    const cfg = mocks.swarm[0].config;
    expect(cfg.hlsjsInstance).toBe(hls);
    expect(cfg.live).toBe(true);
    expect(cfg.token).toBe('tok');
    expect(cfg.channelId(SRC)).toBe('edge.example.com/abr/class-1/ts:master.m3u8');
    expect(hls.url).toBe(SRC);
    cfg.getStats(10, 0, 30, 0);
    cfg.getPeersInfo(['a', 'b']);
    expect(player.getP2PStats()).toMatchObject({ p2pBytes: 10240, httpBytes: 30720, peers: 2 });
    player.destroy();
    expect(mocks.swarm[0].destroyed).toBe(true);
  });

  it('SwarmCloud without a token: no custom channelId (SwarmCloud would throw half-attached)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { player } = createPlayer({ source: { src: SRC }, mode: 'live', p2p: { enabled: true, provider: 'swarmcloud' } });
    await nextHls(0);
    await flush(30);
    expect(mocks.swarm).toHaveLength(1);
    expect('channelId' in mocks.swarm[0].config).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('p2p.token'));
    player.destroy();

    // An explicit channelId without a token: refuse rather than half-attach
    createPlayer({ source: { src: SRC }, mode: 'live', p2p: { enabled: true, provider: 'swarmcloud', channelId: 'x' } });
    await nextHls(1);
    await flush(30);
    expect(mocks.swarm).toHaveLength(1);
    warn.mockRestore();
  });
});
