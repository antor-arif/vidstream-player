import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveSessionStats } from '../src/services/liveSessionStats';
import { LMSProgressManager } from '../src/services/lmsProgressService';
import { AnalyticsManager } from '../src/services/analyticsAdapter';
import { createPlayer } from './helpers';

const mocks = vi.hoisted(() => {
  const instances: any[] = [];
  class FakeHls {
    static isSupported() { return true; }
    static Events = {
      MANIFEST_LOADING: 'manifestLoading', MANIFEST_PARSED: 'manifestParsed', LEVEL_LOADED: 'levelLoaded',
      FRAG_LOADED: 'fragLoaded', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error',
    };
    config: any; handlers: Record<string, Function[]> = {}; levels: any[] = []; currentLevel = -1; loadLevel = 0;
    constructor(config: any) { this.config = config; instances.push(this); }
    on(event: string, fn: Function) { (this.handlers[event] ??= []).push(fn); }
    off() {}
    emit(event: string, data: any) { (this.handlers[event] ?? []).forEach(fn => fn(event, data)); }
    loadSource() {} attachMedia() {} startLoad() {} stopLoad() {} destroy() {}
  }
  return { instances, FakeHls };
});
vi.mock('hls.js', () => ({ default: mocks.FakeHls }));

const SRC = 'https://edge.example.com/t/1700000000/nonceAAAA/sigAAAA/abr/class-1/ts:master.m3u8';
async function nextHls(before: number): Promise<any> {
  for (let i = 0; i < 300 && mocks.instances.length <= before; i++) await Promise.resolve();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return mocks.instances.at(-1);
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.instances.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  delete (navigator as any).mediaSession;
  delete (navigator as any).wakeLock;
});

describe('LiveSessionStats', () => {
  it('counts only time actually played, plus rebuffers, latency, switches, refreshes', () => {
    let t = 1_000_000;
    const s = new LiveSessionStats(() => t);
    s.onPlaying();
    t += 30_000;
    s.onWaiting();           // rebuffer 2 s
    t += 2_000;
    s.onPlaying();
    t += 10_000;
    s.onStopped();           // pause 60 s
    t += 60_000;
    s.onPlaying();
    t += 5_000;
    s.onLatency(9);
    s.onLatency(11);
    s.onQualitySwitch();     // initial rendition: not a switch
    s.onQualitySwitch();
    s.onWaiting(true);       // seek stall: not a rebuffer
    s.onPlaying();
    s.onTokenRefresh();
    const snap = s.snapshot();
    expect(snap).toMatchObject({
      watchedSeconds: 45, rebufferCount: 1, rebufferSeconds: 2, averageLatency: 10, qualitySwitches: 1, tokenRefreshes: 1,
    });
    expect(snap.joinedAt).toBe(new Date(1_000_000).toISOString());
    expect(snap.lastSeenAt).toBe(new Date(t).toISOString());
  });

  it('a stall before the first frame is not a rebuffer', () => {
    const s = new LiveSessionStats();
    s.onWaiting();
    expect(s.snapshot().rebufferCount).toBe(0);
  });
});

describe('LMS progress for live', () => {
  it('reports watch time instead of percentage, never Infinity, no milestones/completion', () => {
    const saved: any[] = [];
    const milestone = vi.fn();
    const complete = vi.fn();
    const m = new LMSProgressManager({ enabled: true, videoId: 'class-1', onProgressSave: p => { saved.push(p); }, onMilestoneReached: milestone, onComplete: complete });
    m.setLiveStats(() => ({ watchedSeconds: 42, joinedAt: 'J', lastSeenAt: 'L', rebufferCount: 0, rebufferSeconds: 0, averageLatency: null, qualitySwitches: 0, tokenRefreshes: 0 }));
    m.initialize(Infinity);
    m.updateProgress(120, 130);
    m.handleCompletion();
    m.saveProgress();
    m.destroy();
    expect(saved[0]).toMatchObject({ isLive: true, watchedSeconds: 42, joinedAt: 'J', lastSeenAt: 'L', duration: 0, watchedPercentage: 0 });
    expect(JSON.stringify(saved[0])).not.toContain('null,"isLive"');
    expect(milestone).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('analytics payloads', () => {
  it('never send Infinity', () => {
    const events: any[] = [];
    const a = new AnalyticsManager({ enabled: true, adapter: { trackEvent: p => { events.push(p); } } } as any, 'sid');
    a.trackEvent('play', { currentTime: 5, duration: Infinity, volume: 1, muted: false, playbackRate: 1 });
    expect(events.at(-1).duration).toBe(0);
    expect(JSON.stringify(events.at(-1))).not.toContain('null,"sourceUrl"');
    a.destroy();
  });

  it('live heartbeats carry watch statistics', async () => {
    vi.useFakeTimers();
    const events: any[] = [];
    const { player, video } = createPlayer({
      source: { src: SRC }, mode: 'live',
      analytics: { enabled: true, heartbeatInterval: 1000, adapter: { trackEvent: (p: any) => { events.push(p); } } } as any,
    });
    await nextHls(0);
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(3000);
    const hb = events.filter(e => e.eventName === 'heartbeat').at(-1);
    expect(hb.customData.live).toMatchObject({ rebufferCount: 0, liveState: 'playing' });
    expect(hb.customData.live.watchedSeconds).toBeGreaterThanOrEqual(2);
    expect(player.getLiveStats()?.watchedSeconds).toBeGreaterThanOrEqual(2);
    player.destroy();
  });
});

describe('Media Session, wake lock, stats overlay', () => {
  it('live: play/pause handlers only; VOD: seek handlers too; cleared on destroy', async () => {
    const handlers: Record<string, unknown> = {};
    (navigator as any).mediaSession = { metadata: null, playbackState: 'none', setActionHandler: (a: string, h: unknown) => { handlers[a] = h; } };
    (globalThis as any).MediaMetadata = class { constructor(public init: any) {} };
    const { player, video } = createPlayer({ source: { src: SRC, title: 'Physics 101', poster: 'https://x.test/p.jpg' }, mode: 'live' });
    await nextHls(0);
    video.dispatchEvent(new Event('play'));
    expect((navigator as any).mediaSession.metadata.init).toMatchObject({ title: 'Physics 101', artwork: [{ src: 'https://x.test/p.jpg' }] });
    expect(typeof handlers.play).toBe('function');
    expect(typeof handlers.pause).toBe('function');
    expect(handlers.seekto).toBeNull();
    expect(handlers.seekforward).toBeNull();
    player.destroy();
    expect(handlers.play).toBeNull();

    const vod = createPlayer({});
    vod.video.dispatchEvent(new Event('play'));
    expect(typeof handlers.seekto).toBe('function');
    vod.player.destroy();
  });

  it('live.wakeLock requests a screen wake lock while playing and releases it on pause', async () => {
    const release = vi.fn();
    const request = vi.fn(async () => ({ release, addEventListener() {} }));
    (navigator as any).wakeLock = { request };
    const { player, video } = createPlayer({ source: { src: SRC }, mode: 'live', live: { wakeLock: true } });
    await nextHls(0);
    video.dispatchEvent(new Event('playing'));
    await Promise.resolve(); await Promise.resolve();
    expect(request).toHaveBeenCalledWith('screen');
    video.dispatchEvent(new Event('pause'));
    expect(release).toHaveBeenCalled();
    player.destroy();
  });

  it('controls.stats: `i` toggles the overlay; text-only rendering', async () => {
    const { player, container } = createPlayer({ source: { src: SRC }, mode: 'live', controls: { stats: true } });
    await nextHls(0);
    expect(container.querySelector('.vp-stats')).toBeNull();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    const panel = container.querySelector('.vp-stats') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('Buffer');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    expect(panel.hidden).toBe(true);
    player.destroy();
    expect(container.querySelector('.vp-stats')).toBeNull();
  });

  it('without controls.stats the `i` key does nothing', () => {
    const { player, container } = createPlayer({});
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    expect(container.querySelector('.vp-stats')).toBeNull();
    player.destroy();
  });
});
