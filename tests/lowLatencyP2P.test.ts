import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveLowLatency, buildHlsConfig, buildP2PCoreConfig, stableSwarmId } from '../src/streaming/hlsConfig';
import { resetP2PEngineCache } from '../src/streaming/p2p';
import { createPlayer, loadMetadata, fire } from './helpers';
import { mediaModel } from './setup';
import '../src/webcomponent';

// ---------------------------------------------------------------------------
// Fake hls.js + p2p-media-loader-hlsjs (jsdom has no MSE / WebRTC)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const state = { p2pAvailable: true, mixinThrows: false };
  const instances: any[] = [];

  class FakeHls {
    static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: 'manifestParsed', LEVEL_LOADED: 'levelLoaded', FRAG_LOADED: 'fragLoaded', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error' };
    config: any;
    handlers: Record<string, Function[]> = {};
    latency: number | null = null;
    targetLatency: number | null = null;
    liveSyncPosition: number | null = null;
    destroyed = false;
    p2pConfig: any = undefined;
    constructor(config: any) {
      this.config = config;
      instances.push(this);
    }
    on(event: string, fn: Function) { (this.handlers[event] ??= []).push(fn); }
    loadSource(src: string) { (this as any).src = src; }
    attachMedia(media: any) { (this as any).media = media; }
    destroy() { this.destroyed = true; }
  }

  function makeEngine() {
    const listeners: Record<string, Set<Function>> = {};
    return {
      listeners,
      addEventListener(name: string, fn: Function) { (listeners[name] ??= new Set()).add(fn); },
      removeEventListener(name: string, fn: Function) { listeners[name]?.delete(fn); },
      fire(name: string, ...args: unknown[]) { listeners[name]?.forEach(fn => fn(...args)); },
    };
  }

  const HlsJsP2PEngine = {
    injectMixin(Base: any) {
      if (state.mixinThrows) throw new Error('mixin failed');
      return class extends Base {
        p2pEngine = Object.assign(makeEngine(), { applyDynamicConfig: (cfg: unknown) => { (this as any).dynamicConfigs.push(cfg); } });
        dynamicConfigs: unknown[] = [];
        constructor(config: any) {
          const { p2p, ...rest } = config;
          super(rest);
          this.p2pConfig = p2p;
        }
      };
    },
  };

  return { state, instances, FakeHls, HlsJsP2PEngine };
});

vi.mock('hls.js', () => ({ default: mocks.FakeHls }));
vi.mock('p2p-media-loader-hlsjs', () => ({
  get HlsJsP2PEngine() { return mocks.state.p2pAvailable ? mocks.HlsJsP2PEngine : undefined; },
}));

const LIVE = 'https://live.example.com/channel/index.m3u8';

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.instances.length = 0;
  mocks.state.p2pAvailable = true;
  mocks.state.mixinThrows = false;
  resetP2PEngineCache();
  (window as any).RTCPeerConnection = function RTCPeerConnection() {};
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as any).RTCPeerConnection;
});

/** Wait (microtasks only — safe with fake timers) until a new hls.js instance exists */
async function nextHlsInstance(before: number): Promise<any> {
  for (let i = 0; i < 200 && mocks.instances.length <= before; i++) await Promise.resolve();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return mocks.instances.at(-1);
}

async function createLive(config: Record<string, unknown> = {}) {
  const before = mocks.instances.length;
  const result = createPlayer({ source: { src: LIVE }, ...config });
  const hls = await nextHlsInstance(before);
  return { ...result, hls };
}

// ---------------------------------------------------------------------------
// Pure config builders
// ---------------------------------------------------------------------------

describe('resolveLowLatency', () => {
  it('is null when disabled', () => {
    expect(resolveLowLatency(undefined, undefined)).toBeNull();
    expect(resolveLowLatency(false, undefined)).toBeNull();
    expect(resolveLowLatency({ enabled: false }, undefined)).toBeNull();
  });

  it('uses 3-5 s friendly defaults', () => {
    expect(resolveLowLatency(true, undefined)).toEqual({
      targetLatency: 4, maxLatency: 7, maxCatchUpRate: 1.1, partLoading: true,
    });
  });

  it('keeps maxLatency above the target and clamps the catch-up rate', () => {
    const ll = resolveLowLatency({ targetLatency: 5, maxLatency: 3, maxCatchUpRate: 9 }, undefined)!;
    expect(ll.maxLatency).toBeGreaterThan(5);
    expect(ll.maxCatchUpRate).toBe(2);
    expect(resolveLowLatency({ targetLatency: -1 }, undefined)!.targetLatency).toBe(4);
  });

  it('defaults the offload sync point to 3 s (measured: settles ~2 s higher, ~5 s actual)', () => {
    expect(resolveLowLatency(true, 'offload')!.targetLatency).toBe(3);
    expect(resolveLowLatency({ targetLatency: 4 }, 'offload')!.targetLatency).toBe(4);
  });

  it('skips LL-HLS parts under the offload strategy unless told otherwise', () => {
    expect(resolveLowLatency(true, 'offload')!.partLoading).toBe(false);
    expect(resolveLowLatency({ partLoading: true }, 'offload')!.partLoading).toBe(true);
    expect(resolveLowLatency(true, 'latency')!.partLoading).toBe(true);
  });
});

describe('buildHlsConfig', () => {
  const xhrSetup = () => {};

  it('maps low latency onto hls.js live sync settings', () => {
    const config = buildHlsConfig({ lowLatency: resolveLowLatency(true, undefined), p2p: false, strategy: 'latency', xhrSetup });
    expect(config).toMatchObject({
      lowLatencyMode: true,
      liveSyncDuration: 4,
      liveMaxLatencyDuration: 7,
      maxLiveSyncPlaybackRate: 1.1,
      backBufferLength: 30,
    });
  });

  it('pins the live sync point with P2P so p2p-media-loader cannot push playback far behind live', () => {
    expect(buildHlsConfig({ lowLatency: null, p2p: true, strategy: 'latency', xhrSetup }).liveSyncDurationCount).toBe(3);
    expect(buildHlsConfig({ lowLatency: null, p2p: true, strategy: 'offload', xhrSetup }).liveSyncDurationCount).toBeUndefined();
    expect(buildHlsConfig({ lowLatency: null, p2p: false, strategy: 'latency', xhrSetup }).liveSyncDurationCount).toBeUndefined();
  });
});

describe('buildP2PCoreConfig', () => {
  it('derives a token-free swarm id from the source URL', () => {
    expect(stableSwarmId('https://cdn.example.com/live/master.m3u8?token=abc#x')).toBe('https://cdn.example.com/live/master.m3u8');
    const core = buildP2PCoreConfig({ p2p: { enabled: true }, lowLatency: null, sourceUrl: 'https://a.example.com/s.m3u8?sig=1' });
    expect(core.swarmId).toBe('https://a.example.com/s.m3u8');
  });

  it('passes trackers, ICE servers, upload and peer limits', () => {
    const core = buildP2PCoreConfig({
      p2p: { enabled: true, swarmId: 'event-42', trackers: ['wss://t.example.com'], iceServers: [{ urls: 'stun:s.example.com' }], uploadDisabled: true, maxPeers: 8 },
      lowLatency: null,
      sourceUrl: 'x',
    });
    expect(core).toMatchObject({
      swarmId: 'event-42',
      announceTrackers: ['wss://t.example.com'],
      rtcConfig: { iceServers: [{ urls: 'stun:s.example.com' }] },
      isP2PUploadDisabled: true,
      p2pMaxPeers: 8,
    });
  });

  it('latency strategy falls back to HTTP fast; offload waits for peers', () => {
    const latency = buildP2PCoreConfig({ p2p: { enabled: true }, lowLatency: resolveLowLatency(true, undefined), sourceUrl: 'x' });
    expect(latency).toMatchObject({ httpDownloadInitialTimeoutMs: 0, p2pNotReceivingBytesTimeoutMs: 1000, highDemandTimeWindow: 4 });
    const offload = buildP2PCoreConfig({ p2p: { enabled: true, strategy: 'offload' }, lowLatency: null, sourceUrl: 'x' });
    expect(offload).toMatchObject({ httpDownloadInitialTimeoutMs: 1500, highDemandTimeWindow: 2 });
  });

  it('lets raw core options override the presets', () => {
    const core = buildP2PCoreConfig({ p2p: { enabled: true, core: { highDemandTimeWindow: 9, cachedSegmentsCount: 50 } }, lowLatency: null, sourceUrl: 'x' });
    expect(core).toMatchObject({ highDemandTimeWindow: 9, cachedSegmentsCount: 50 });
  });
});

// ---------------------------------------------------------------------------
// Player integration
// ---------------------------------------------------------------------------

describe('player: low latency', () => {
  it('configures hls.js for a 4 s target by default', async () => {
    const { hls } = await createLive({ lowLatency: true });
    expect(hls.config).toMatchObject({ liveSyncDuration: 4, liveMaxLatencyDuration: 7, maxLiveSyncPlaybackRate: 1.1, lowLatencyMode: true });
  });

  it('keeps the previous hls.js behaviour when lowLatency is off', async () => {
    const { hls } = await createLive();
    expect(hls.config.lowLatencyMode).toBe(true);
    expect(hls.config.liveSyncDuration).toBeUndefined();
  });

  it('emits latency, greys the LIVE badge when behind and jumps back with seekToLive()', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { player, container, video, hls } = await createLive({ lowLatency: true });
    loadMetadata(video, Infinity);
    hls.targetLatency = 4;
    hls.latency = 4.3;
    hls.liveSyncPosition = 1000;

    const events: any[] = [];
    player.on('latency', (e: any) => events.push(e));
    vi.advanceTimersByTime(1100);
    fire(video, 'timeupdate');
    expect(events.at(-1)).toMatchObject({ latency: 4.3, targetLatency: 4, atLiveEdge: true });

    const badge = container.querySelector<HTMLElement>('.vp-live-badge')!;
    expect(badge.style.display).toBe(''); // visibility comes from CSS (.vp-live)
    expect(badge.classList.contains('vp-live-behind')).toBe(false);

    hls.latency = 12;
    vi.advanceTimersByTime(1100);
    fire(video, 'timeupdate');
    expect(events.at(-1).atLiveEdge).toBe(false);
    expect(badge.classList.contains('vp-live-behind')).toBe(true);

    badge.click();
    expect(video.currentTime).toBe(1000);
    expect(badge.classList.contains('vp-live-behind')).toBe(false);
    expect(player.getLiveLatency()?.latency).toBe(12);
  });

  it('applies hysteresis so the badge does not flicker around the threshold', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { player, video, hls } = await createLive({ lowLatency: true });
    loadMetadata(video, Infinity);
    hls.targetLatency = 4;
    const edges: boolean[] = [];
    player.on('latency', (e: any) => edges.push(e.atLiveEdge));
    for (const latency of [5.9, 6.5, 5.5, 4.8]) {
      hls.latency = latency;
      vi.advanceTimersByTime(1100);
      fire(video, 'timeupdate');
    }
    // live ≤ target+2 → behind > target+2; behind → live only once ≤ target+1
    expect(edges).toEqual([true, false, false, true]);
  });

  it('rebuilds the engine when lowLatency changes at runtime', async () => {
    const { player, hls } = await createLive({ lowLatency: true });
    const before = mocks.instances.length;
    player.updateConfig({ lowLatency: { targetLatency: 3 } });
    await nextHlsInstance(before);
    expect(hls.destroyed).toBe(true);
    expect(mocks.instances.at(-1).config.liveSyncDuration).toBe(3);
  });

  it('detects live from the hls.js playlist even though the duration is finite (real-stream regression)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { player, container, video, hls } = await createLive({ lowLatency: true });
    loadMetadata(video, 75.5); // hls.js reports the live window, not Infinity
    expect(player.getLiveLatency()).toBeNull();
    hls.handlers.levelLoaded.forEach((fn: Function) => fn('levelLoaded', { details: { live: true } }));
    expect(container.classList.contains('vp-live')).toBe(true);
    hls.latency = 4.1;
    hls.targetLatency = 4;
    vi.advanceTimersByTime(1100);
    fire(video, 'timeupdate');
    expect(player.getLiveLatency()?.latency).toBe(4.1);
    // a later loadedmetadata (finite) must not clear it
    loadMetadata(video, 80);
    expect(player.getState().isLive).toBe(true);
  });

  it('getLiveLatency() is null for VOD', async () => {
    const { player } = await createLive();
    expect(player.getLiveLatency()).toBeNull();
  });
});

describe('player: P2P', () => {
  it('loads hls.js through the P2P mixin with a stable swarm and trackers', async () => {
    const { hls } = await createLive({
      source: { src: `${LIVE}?token=viewer-1` },
      p2p: { enabled: true, trackers: ['wss://tracker.example.com'] },
      lowLatency: true,
    });
    expect(hls.p2pEngine).toBeDefined();
    expect(hls.p2pConfig.core).toMatchObject({ swarmId: LIVE, announceTrackers: ['wss://tracker.example.com'] });
    expect(hls.config.liveSyncDuration).toBe(4);
    expect(hls.config.p2p).toBeUndefined();
  });

  it('reports traffic and peers through getP2PStats() and p2pStats events', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { player, container, hls } = await createLive({ p2p: { enabled: true } });
    const engine = hls.p2pEngine;
    engine.fire('onChunkDownloaded', 100, 'http');
    engine.fire('onChunkDownloaded', 300, 'p2p');
    engine.fire('onChunkUploaded', 50, 'peer-a');
    engine.fire('onPeerConnect', { peerId: 'peer-a' });
    engine.fire('onPeerConnect', { peerId: 'peer-b' });
    engine.fire('onPeerClose', { peerId: 'peer-b' });

    expect(player.getP2PStats()).toMatchObject({ httpBytes: 100, p2pBytes: 300, uploadedBytes: 50, peers: 1, p2pRatio: 0.75 });

    const dom: any[] = [];
    container.addEventListener('player-p2p-stats', (e) => dom.push((e as CustomEvent).detail.data));
    vi.advanceTimersByTime(2000);
    expect(dom[0]).toMatchObject({ p2pBytes: 300, sessionId: player.sessionId });
  });

  it('counts fragments hls.js loaded over its own HTTP loader (LL parts) as HTTP traffic', async () => {
    const { player, hls } = await createLive({ p2p: { enabled: true } });
    hls.p2pEngine.fire('onChunkDownloaded', 1000, 'p2p');
    hls.handlers.fragLoaded.forEach((fn: Function) => fn('fragLoaded', { payload: new ArrayBuffer(1000), frag: { stats: { loaded: 1000 } } }));
    hls.handlers.fragLoaded.forEach((fn: Function) => fn('fragLoaded', { payload: new ArrayBuffer(0), frag: {}, part: { stats: { loaded: 3000 } } }));
    expect(player.getP2PStats()).toMatchObject({ httpBytes: 3000, p2pBytes: 1000, p2pRatio: 0.25 });
  });

  it('stall guard: repeated live stalls switch P2P to fast HTTP fallback (safe mode)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { player, video, hls } = await createLive({ p2p: { enabled: true, strategy: 'offload' }, lowLatency: true });
    loadMetadata(video, Infinity);
    fire(video, 'waiting'); // during startup grace period — ignored
    vi.advanceTimersByTime(6000);
    fire(video, 'waiting');
    expect(player.getP2PStats()!.safeMode).toBe(false);
    vi.advanceTimersByTime(5000);
    fire(video, 'waiting');
    expect(player.getP2PStats()!.safeMode).toBe(true);
    expect(hls.dynamicConfigs[0]).toMatchObject({ core: { httpDownloadInitialTimeoutMs: 0, p2pNotReceivingBytesTimeoutMs: 1000 } });
    expect(warn).toHaveBeenCalled();
  });

  it('stall guard ignores isolated stalls and VOD', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { player, video } = await createLive({ p2p: { enabled: true } });
    loadMetadata(video, 120); // VOD
    vi.advanceTimersByTime(6000);
    fire(video, 'waiting');
    fire(video, 'waiting');
    expect(player.getP2PStats()!.safeMode).toBe(false);
  });

  it('stops stats and detaches from the engine on destroy', async () => {
    const { player, hls } = await createLive({ p2p: { enabled: true } });
    expect(hls.p2pEngine.listeners.onChunkDownloaded.size).toBe(1);
    player.destroy();
    expect(hls.p2pEngine.listeners.onChunkDownloaded.size).toBe(0);
    expect(player.getP2PStats()).toBeNull();
  });

  it('sends the auth header (and byte range) on P2P-engine HTTP requests', async () => {
    const { hls } = await createLive({ p2p: { enabled: true }, security: { authToken: 'secret' } });
    const setup = hls.p2pConfig.core.httpRequestSetup;
    const request: Request = await setup('https://cdn.example.com/seg1.ts', undefined, undefined, { start: 0, end: 999 });
    expect(request.headers.get('Authorization')).toBe('Bearer secret');
    expect(request.headers.get('Range')).toBe('bytes=0-999');
  });

  it('falls back to plain HTTP hls.js when the P2P library is missing', async () => {
    mocks.state.p2pAvailable = false;
    const { player, hls } = await createLive({ p2p: { enabled: true } });
    expect(hls.p2pEngine).toBeUndefined();
    expect((hls as any).src).toBe(LIVE);
    expect(player.getP2PStats()).toBeNull();
  });

  it('falls back to plain HTTP hls.js when the P2P engine fails to start', async () => {
    mocks.state.mixinThrows = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { hls } = await createLive({ p2p: { enabled: true } });
    expect(hls.p2pEngine).toBeUndefined();
    expect((hls as any).src).toBe(LIVE);
    expect(warn).toHaveBeenCalled();
  });

  it('skips P2P without WebRTC', async () => {
    delete (window as any).RTCPeerConnection;
    const { hls } = await createLive({ p2p: { enabled: true } });
    expect(hls.p2pEngine).toBeUndefined();
  });

  it('offload strategy requests whole segments (no LL parts)', async () => {
    const { hls } = await createLive({ p2p: { enabled: true, strategy: 'offload' }, lowLatency: true });
    expect(hls.config.lowLatencyMode).toBe(false);
    expect(hls.p2pConfig.core.httpDownloadInitialTimeoutMs).toBe(1500);
    expect(hls.config.liveSyncDuration).toBe(3);
  });

  it('turning P2P on at runtime rebuilds the engine with the mixin', async () => {
    const { player, hls } = await createLive();
    expect(hls.p2pEngine).toBeUndefined();
    const before = mocks.instances.length;
    player.updateConfig({ p2p: { enabled: true } });
    await nextHlsInstance(before);
    expect(hls.destroyed).toBe(true);
    expect(mocks.instances.at(-1).p2pEngine).toBeDefined();
  });
});

describe('<video-player> attributes', () => {
  it('maps low-latency, target-latency and p2p-* attributes', async () => {
    const el = document.createElement('video-player') as any;
    el.setAttribute('src', LIVE);
    el.setAttribute('target-latency', '3.5');
    el.setAttribute('p2p', '');
    el.setAttribute('p2p-trackers', 'wss://a.example.com, wss://b.example.com');
    el.setAttribute('p2p-strategy', 'offload');
    const before = mocks.instances.length;
    document.body.appendChild(el);
    const hls = await nextHlsInstance(before);
    expect(hls.config.liveSyncDuration).toBe(3.5);
    expect(hls.p2pConfig.core.announceTrackers).toEqual(['wss://a.example.com', 'wss://b.example.com']);
    expect(hls.config.lowLatencyMode).toBe(false);
    expect(typeof el.seekToLive).toBe('function');
    mediaModel(el.querySelector('video')).duration = Infinity;
  });
});
