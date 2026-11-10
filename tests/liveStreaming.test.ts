import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TokenRefresher,
  splitTokenUrl,
  redactUrl,
  tokenlessChannelId,
} from '../src/streaming/tokenRefresh';
import { buildHlsConfig } from '../src/streaming/hlsConfig';
import { ErrorRecoveryManager } from '../src/services/errorRecovery';
import { createPlayer } from './helpers';

// ---------------------------------------------------------------------------
// Fake hls.js with DefaultConfig load policies (as in hls.js 1.6)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const instances: any[] = [];
  const order: string[] = [];
  const policy = () => ({
    default: {
      maxTimeToFirstByteMs: 10000,
      maxLoadTimeMs: 20000,
      timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: 1, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
    },
  });

  class FakeHls {
    static isSupported() { return true; }
    static Events = {
      MANIFEST_LOADING: 'manifestLoading', MANIFEST_PARSED: 'manifestParsed', LEVEL_LOADED: 'levelLoaded',
      FRAG_LOADED: 'fragLoaded', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error',
    };
    static DefaultConfig = {
      manifestLoadPolicy: policy(),
      playlistLoadPolicy: policy(),
      fragLoadPolicy: policy(),
      keyLoadPolicy: policy(),
    };
    config: any;
    handlers: Record<string, Function[]> = {};
    levels: any[] = [];
    url: string | null = null;
    destroyed = false;
    constructor(config: any) {
      this.config = config;
      instances.push(this);
    }
    on(event: string, fn: Function) { (this.handlers[event] ??= []).push(fn); }
    off(event: string, fn: Function) { this.handlers[event] = (this.handlers[event] ?? []).filter(h => h !== fn); }
    emit(event: string, data: any) { (this.handlers[event] ?? []).forEach(fn => fn(event, data)); }
    loadSource(src: string) {
      order.push('loadSource');
      this.url = src;
      this.emit(FakeHls.Events.MANIFEST_LOADING, { url: src });
    }
    attachMedia(media: any) { order.push('attachMedia'); (this as any).media = media; }
    startLoad() { (this as any).startLoadCalls = ((this as any).startLoadCalls ?? 0) + 1; }
    recoverMediaError() {}
    swapAudioCodec() {}
    destroy() { this.destroyed = true; }
  }

  return { instances, order, FakeHls };
});

vi.mock('hls.js', () => ({ default: mocks.FakeHls }));

const T1 = 'https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/abr/class-1/ts:master.m3u8';
const T2 = 'https://edge.example.com/t/1700009999/nonceBBBB/sigBBBB/abr/class-1/ts:master.m3u8';
const BUNNY = 'https://zone.b-cdn.net/bcdn_token=abc&expires=123/abr/class-1/ts:master.m3u8';

async function flush(n = 50): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

async function nextHls(before: number): Promise<any> {
  for (let i = 0; i < 200 && mocks.instances.length <= before; i++) await Promise.resolve();
  await flush(5);
  return mocks.instances.at(-1);
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.instances.length = 0;
  mocks.order.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('token URL helpers', () => {
  it('splits our edge token and the Bunny directory token', () => {
    expect(splitTokenUrl(T1)).toEqual({
      origin: 'https://edge.example.com',
      prefix: '/t/1700000000/nonceAAAA/sigAAAA',
      rest: '/abr/class-1/ts:master.m3u8',
    });
    expect(splitTokenUrl(BUNNY)?.prefix).toBe('/bcdn_token=abc&expires=123');
    expect(splitTokenUrl('https://cdn.example.com/abr/class-1/index.m3u8')).toBeNull();
    expect(splitTokenUrl('not a url')).toBeNull();
  });

  it('supports a custom token prefix pattern', () => {
    const pattern = /^(\/auth\/[^/]+)(\/.*)$/;
    expect(splitTokenUrl('https://x.test/auth/abc/live/index.m3u8', pattern)?.prefix).toBe('/auth/abc');
  });

  it('never logs the token', () => {
    expect(redactUrl(T1)).toBe('https://edge.example.com/…/abr/class-1/ts:master.m3u8');
    expect(redactUrl(T1)).not.toContain('sigAAAA');
  });

  it('builds a P2P channel id without the token, keeping the host', () => {
    expect(tokenlessChannelId(T1)).toBe('edge.example.com/abr/class-1/ts:master.m3u8');
    expect(tokenlessChannelId(T2)).toBe(tokenlessChannelId(T1));
    expect(tokenlessChannelId(BUNNY)).toBe('zone.b-cdn.net/abr/class-1/ts:master.m3u8');
  });
});

describe('TokenRefresher', () => {
  it('swaps only the token of same-origin URLs after a refresh', async () => {
    const r = new TokenRefresher({ getFreshUrl: async () => T2 });
    r.setUrl(T1);
    expect(r.rewrite(T1)).toBe(T1);
    await r.refresh('test');
    expect(r.rewrite(T1)).toBe(T2);
    expect(r.rewrite('https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/abr/class-1/720p/seg_42.ts'))
      .toBe('https://edge.example.com/t/1700009999/nonceBBBB/sigBBBB/abr/class-1/720p/seg_42.ts');
    // Other hosts untouched
    expect(r.rewrite('https://other.example.com/t/1/a/b/abr/x/index.m3u8')).toBe('https://other.example.com/t/1/a/b/abr/x/index.m3u8');
  });

  it('de-duplicates concurrent refreshes', async () => {
    const getFreshUrl = vi.fn(async () => T2);
    const r = new TokenRefresher({ getFreshUrl });
    r.setUrl(T1);
    await Promise.all([r.refresh('a'), r.refresh('b'), r.refresh('c')]);
    expect(getFreshUrl).toHaveBeenCalledTimes(1);
  });

  it('allows at most 4 refreshes per minute', async () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const r = new TokenRefresher({ getFreshUrl: async () => T2, onRefreshFailed: failed });
    r.setUrl(T1);
    for (let i = 0; i < 4; i++) await r.refresh('x');
    await expect(r.refresh('x')).rejects.toThrow('too many token refreshes');
    expect(failed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60001);
    await expect(r.refresh('x')).resolves.toBe(T2);
  });

  it('rejects a fresh URL for a different host', async () => {
    const r = new TokenRefresher({ getFreshUrl: async () => 'https://other.example.com/t/1/a/b/abr/class-1/ts:master.m3u8' });
    r.setUrl(T1);
    await expect(r.refresh('x')).rejects.toThrow('different host');
    expect(r.rewrite(T1)).toBe(T1);
  });

  it('rewrites already-parsed fragment and part URLs (P2P loaders fetch these directly)', async () => {
    const r = new TokenRefresher({ getFreshUrl: async () => T2 });
    const frag = { url: 'https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/abr/class-1/seg1.ts' };
    const part = { url: 'https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/abr/class-1/part1.m4s' };
    const hls = new mocks.FakeHls({});
    hls.levels = [{ details: { fragments: [frag], partList: [part] } }];
    r.attach(hls, mocks.FakeHls);
    hls.loadSource(T1);
    await r.refresh('x');
    expect(frag.url).toContain('/t/1700009999/nonceBBBB/sigBBBB/abr/class-1/seg1.ts');
    expect(part.url).toContain('/t/1700009999/nonceBBBB/sigBBBB/abr/class-1/part1.m4s');
  });

  it('retries 403 with a refresh, retries status 0 / timeouts, defers other codes', async () => {
    const getFreshUrl = vi.fn(async () => T2);
    const r = new TokenRefresher({ getFreshUrl });
    r.setUrl(T1);
    const cfg: any = r.hlsConfig(mocks.FakeHls);
    const shouldRetry = cfg.fragLoadPolicy.default.errorRetry.shouldRetry;
    expect(cfg.fragLoadPolicy.default.errorRetry.maxNumRetry).toBe(6);
    // Defaults not mutated
    expect(mocks.FakeHls.DefaultConfig.fragLoadPolicy.default.errorRetry.maxNumRetry).toBe(1);

    expect(shouldRetry({}, 0, false, { code: 403 }, false)).toBe(true);
    await flush();
    expect(getFreshUrl).toHaveBeenCalledTimes(1);
    // A second 403 right after a successful refresh doesn't refresh again (3 s guard)
    expect(shouldRetry({}, 1, false, { code: 403 }, false)).toBe(true);
    await flush();
    expect(getFreshUrl).toHaveBeenCalledTimes(1);
    expect(shouldRetry({}, 6, false, { code: 403 }, true)).toBe(false);

    expect(shouldRetry({}, 0, false, { code: 0 }, false)).toBe(true);
    expect(shouldRetry({}, 0, false, undefined, false)).toBe(true);
    expect(shouldRetry({}, 0, true, { code: 200 }, false)).toBe(true);
    expect(shouldRetry({}, 0, false, { code: 404 }, false)).toBe(false);
    expect(shouldRetry({}, 0, false, { code: 500 }, true)).toBe(true);
  });

  it('AES-128 key requests under the token: a 403 refreshes, and the retry uses the fresh token', async () => {
    const KEY1 = 'https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/vod/AssetAssetAsset01/k/3';
    const getFreshUrl = vi.fn(async () => T2);
    const r = new TokenRefresher({ getFreshUrl });
    r.setUrl(T1);
    const cfg: any = r.hlsConfig(mocks.FakeHls);
    expect(cfg.keyLoadPolicy.default.errorRetry.maxNumRetry).toBe(6);
    expect(cfg.keyLoadPolicy.default.errorRetry.shouldRetry({}, 0, false, { code: 403 }, false)).toBe(true);
    await flush();
    expect(getFreshUrl).toHaveBeenCalledTimes(1);
    const opened: string[] = [];
    const xhr = Object.assign(new XMLHttpRequest(), { open: (_m: string, u: string) => opened.push(u) });
    await cfg.xhrSetup(xhr, KEY1);
    expect(opened).toEqual(['https://edge.example.com/t/1700009999/nonceBBBB/sigBBBB/vod/AssetAssetAsset01/k/3']);
  });

  it('without a refresher a 403 gets only 2 quick retries (no retry loop)', () => {
    const r = new TokenRefresher({ getFreshUrl: async () => null, maxRefreshesPerMinute: 0 });
    const cfg: any = r.hlsConfig(mocks.FakeHls);
    const shouldRetry = cfg.fragLoadPolicy.default.errorRetry.shouldRetry;
    expect(shouldRetry({}, 0, false, { code: 403 }, false)).toBe(true);
    expect(shouldRetry({}, 1, false, { code: 403 }, false)).toBe(true);
    expect(shouldRetry({}, 2, false, { code: 403 }, false)).toBe(false);
  });

  it('xhrSetup waits for an in-flight refresh, then re-opens the request with the fresh token', async () => {
    let resolve!: (url: string) => void;
    const r = new TokenRefresher({ getFreshUrl: () => new Promise<string>(res => { resolve = res; }) });
    r.setUrl(T1);
    const user = vi.fn();
    const cfg: any = r.hlsConfig(mocks.FakeHls, user);
    const xhr = new XMLHttpRequest();
    const open = vi.spyOn(xhr, 'open');

    const refreshing = r.refresh('x');
    const setup = cfg.xhrSetup(xhr, T1);
    await flush();
    expect(open).not.toHaveBeenCalled();
    resolve(T2);
    await refreshing;
    await setup;
    expect(open).toHaveBeenCalledWith('GET', T2, true);
    expect(user).toHaveBeenCalledWith(xhr, T2);
  });

  it('a null result means "credential refreshed out of band" and keeps the URL', async () => {
    const r = new TokenRefresher({ getFreshUrl: async () => null });
    r.setUrl(T1);
    await expect(r.refresh('x')).resolves.toBeNull();
    expect(r.rewrite(T1)).toBe(T1);
  });
});

// ---------------------------------------------------------------------------
// hls.js config: live.latencyMode (priority) > lowLatency > defaults, user hlsConfig on top
// ---------------------------------------------------------------------------

describe('buildHlsConfig latency presets', () => {
  const xhrSetup = () => {};
  const ll = { targetLatency: 4, maxLatency: 7, maxCatchUpRate: 1.1, partLoading: true };

  it("'standard': no LL mode, 3-segment sync, bounded latency and back buffer", () => {
    const c = buildHlsConfig({ lowLatency: null, latencyMode: 'standard', p2p: false, strategy: 'latency', xhrSetup });
    expect(c).toMatchObject({ lowLatencyMode: false, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10, backBufferLength: 30 });
  });

  it("'low': LL mode and NO liveSync* (PART-HOLD-BACK targeting)", () => {
    const c = buildHlsConfig({ lowLatency: null, latencyMode: 'low', p2p: false, strategy: 'latency', xhrSetup });
    expect(c).toMatchObject({ lowLatencyMode: true, maxLiveSyncPlaybackRate: 1.1 });
    for (const key of Object.keys(c)) expect(key.startsWith('liveSync')).toBe(false);
    expect(c.liveMaxLatencyDuration).toBeUndefined();
  });

  it('latencyMode takes priority over lowLatency', () => {
    const c = buildHlsConfig({ lowLatency: ll, latencyMode: 'low', p2p: false, strategy: 'latency', xhrSetup });
    expect(c.liveSyncDuration).toBeUndefined();
  });

  it('lowLatency still works when latencyMode is not set', () => {
    const c = buildHlsConfig({ lowLatency: ll, p2p: false, strategy: 'latency', xhrSetup });
    expect(c.liveSyncDuration).toBe(4);
  });

  it('user hlsConfig is merged last (except xhrSetup, which the player wraps)', () => {
    const userXhr = () => {};
    const c = buildHlsConfig({
      lowLatency: null, latencyMode: 'standard', p2p: false, strategy: 'latency', xhrSetup,
      userConfig: { liveSyncDurationCount: 4, maxBufferLength: 12, xhrSetup: userXhr },
    });
    expect(c.liveSyncDurationCount).toBe(4);
    expect(c.maxBufferLength).toBe(12);
    expect(c.xhrSetup).toBe(xhrSetup);
  });
});

// ---------------------------------------------------------------------------
// Retry budget
// ---------------------------------------------------------------------------

describe('ErrorRecoveryManager live budget', () => {
  it('caps the backoff at maxRetryDelay', () => {
    vi.useFakeTimers();
    const m = new ErrorRecoveryManager({ maxRetries: 20, retryDelay: 2000 });
    const fn = vi.fn();
    for (let i = 0; i < 6; i++) {
      m.scheduleRetry(fn);
      vi.advanceTimersByTime(30000);
    }
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('uses liveMaxRetries for live streams', () => {
    const m = new ErrorRecoveryManager({ maxRetries: 3 });
    m.setLive(true);
    for (let i = 0; i < 9; i++) m.scheduleRetry(() => {});
    expect(m.canRetry()).toBe(true);
    m.scheduleRetry(() => {});
    expect(m.canRetry()).toBe(false);
    m.destroy();
  });

  it('never runs out while a live viewer is offline', () => {
    const m = new ErrorRecoveryManager({ maxRetries: 1, liveMaxRetries: 1 });
    m.setLive(true);
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    for (let i = 0; i < 20; i++) m.scheduleRetry(() => {});
    expect(m.canRetry()).toBe(true);
    expect(m.getRetryCount()).toBe(0);
    spy.mockRestore();
    m.destroy();
  });

  it('resetCount refills the budget without cancelling a pending retry', () => {
    vi.useFakeTimers();
    const m = new ErrorRecoveryManager({ maxRetries: 1, retryDelay: 100 });
    const fn = vi.fn();
    m.scheduleRetry(fn);
    expect(m.canRetry()).toBe(false);
    m.resetCount();
    expect(m.canRetry()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Player integration
// ---------------------------------------------------------------------------

describe('VideoPlayer live HLS integration', () => {
  it('calls onHlsCreated before loadSource/attachMedia and exposes getHls()', async () => {
    const onHlsCreated = vi.fn(() => mocks.order.push('onHlsCreated'));
    const { player } = createPlayer({ source: { src: T1 }, mode: 'live', onHlsCreated });
    const hls = await nextHls(0);
    expect(onHlsCreated).toHaveBeenCalledWith(hls, mocks.FakeHls);
    expect(mocks.order).toEqual(['onHlsCreated', 'loadSource', 'attachMedia']);
    expect(player.getHls()).toBe(hls);
    expect(player.getDash()).toBeNull();
    player.destroy();
  });

  it('applies live.latencyMode and user hlsConfig to hls.js', async () => {
    const { player } = createPlayer({
      source: { src: T1 }, live: { latencyMode: 'standard' }, hlsConfig: { maxBufferLength: 12 },
    });
    const hls = await nextHls(0);
    expect(hls.config).toMatchObject({ lowLatencyMode: false, liveSyncDurationCount: 3, maxBufferLength: 12 });
    expect(hls.config.fragLoadPolicy.default.errorRetry.maxNumRetry).toBe(6);
    player.destroy();
  });

  it('a token refresh never changes config.source.src and restarts use the fresh token', async () => {
    const refreshed = vi.fn();
    const { player, container } = createPlayer({
      source: { src: T1 },
      mode: 'live',
      security: { refreshPlaybackToken: async () => T2 },
    });
    container.addEventListener('player-token-refreshed', (e: any) => refreshed(e.detail.data));
    const busRefreshed = vi.fn();
    player.on('tokenRefreshed', busRefreshed);
    const hls = await nextHls(0);
    expect(hls.url).toBe(T1);

    // hls.js reports 403 through the retry policy
    hls.config.fragLoadPolicy.default.errorRetry.shouldRetry({}, 0, false, { code: 403 }, false);
    await flush();
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(refreshed.mock.calls[0][0]).toMatchObject({ reason: '403', host: 'edge.example.com' });
    expect(JSON.stringify(refreshed.mock.calls[0][0])).not.toContain('sigBBBB');
    expect(busRefreshed).toHaveBeenCalledTimes(1);
    expect((player as any).config.source.src).toBe(T1);

    // Engine rebuild (e.g. after a decode error) loads the fresh URL, not the expired one
    (player as any).restartPlayback();
    const next = await nextHls(1);
    expect(next.url).toBe(T2);
    player.destroy();
  });

  it('fatal network error with a refresher: fresh URL then hls.loadSource (last resort)', async () => {
    vi.useFakeTimers();
    const { player } = createPlayer({
      source: { src: T1 },
      mode: 'live',
      security: { refreshPlaybackUrl: async () => T2 },
      errorRecovery: { retryDelay: 10 },
    });
    const hls = await nextHls(0);
    hls.levels = [{}];
    hls.emit('error', { fatal: true, type: 'networkError', details: 'fragLoadError', response: { code: 403 } });
    vi.advanceTimersByTime(10);
    await flush();
    expect(hls.url).toBe(T2);
    expect(player.getState().error?.fatal ?? false).toBe(false);
    player.destroy();
  });

  it('without a refresher a fatal 403 shows the auth error (no infinite retry)', async () => {
    const errors: any[] = [];
    const { player, container } = createPlayer({ source: { src: T1 }, mode: 'live' });
    container.addEventListener('player-error', (e: any) => errors.push(e.detail.data));
    const hls = await nextHls(0);
    hls.emit('error', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 403 } });
    await flush();
    expect(errors.at(-1)).toMatchObject({ code: 'AUTH_ERROR', fatal: true });
    expect(container.querySelector('.vp-error')).not.toBeNull();
    player.destroy();
  });

  it('refills the retry budget only after 10 s of healthy playback', async () => {
    vi.useFakeTimers();
    const { player, video } = createPlayer({ source: { src: T1 }, errorRecovery: { maxRetries: 1, retryDelay: 10 } });
    await nextHls(0);
    const recovery = (player as any).errorRecovery as ErrorRecoveryManager;
    recovery.scheduleRetry(() => {});
    expect(recovery.canRetry()).toBe(false);

    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(5000);
    expect(recovery.canRetry()).toBe(false);
    video.dispatchEvent(new Event('waiting')); // stall resets the clock
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(9999);
    expect(recovery.canRetry()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(recovery.canRetry()).toBe(true);
    player.destroy();
  });
});
