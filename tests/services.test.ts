import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseVttTime, parseChaptersVtt, parseVttThumbnails } from '../src/utils/vtt';
import { isDomainAllowed } from '../src/utils/security';
import { EventBus } from '../src/services/eventBus';
import { ErrorRecoveryManager } from '../src/services/errorRecovery';
import { LMSProgressManager } from '../src/services/lmsProgressService';
import { AnalyticsManager, HttpAnalyticsAdapter } from '../src/services/analyticsAdapter';
import type { AnalyticsEventPayload } from '../src/types';

afterEach(() => {
  vi.useRealTimers();
});

describe('WebVTT parsing', () => {
  it('parses timestamps in every form', () => {
    expect(parseVttTime('00:00:10.000')).toBe(10);
    expect(parseVttTime('01:02.5')).toBe(62.5);
    expect(parseVttTime('1:00:00.000')).toBe(3600);
    expect(parseVttTime(' 00:05.000 ')).toBe(5);
    expect(parseVttTime('')).toBeNaN();
    expect(parseVttTime('abc')).toBeNaN();
  });

  it('parses thumbnail cues with real end times (KI-02 regression)', () => {
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nsprite.jpg#xywh=0,0,160,90\n\n00:00:10.000 --> 00:00:20.000 line:0\nsprite.jpg#xywh=160,0,160,90\n';
    const cues = parseVttThumbnails(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startTime: 0, endTime: 10, x: 0, y: 0, w: 160, h: 90 });
    expect(cues[1]).toMatchObject({ startTime: 10, endTime: 20, x: 160 });
  });

  it('resolves relative sprite URLs against the VTT URL', () => {
    const vtt = 'WEBVTT\n\n00:00.000 --> 00:05.000\nimages/sprite.jpg#xywh=0,0,10,10\n\n00:05.000 --> 00:10.000\nhttps://other.example.com/abs.jpg#xywh=0,0,10,10\n';
    const cues = parseVttThumbnails(vtt, 'https://cdn.example.com/thumbs/index.vtt');
    expect(cues[0].url).toBe('https://cdn.example.com/thumbs/images/sprite.jpg');
    expect(cues[1].url).toBe('https://other.example.com/abs.jpg');
  });

  it('accepts whole-image cues without #xywh', () => {
    const cues = parseVttThumbnails('WEBVTT\n\n00:00.000 --> 00:05.000\nframe1.jpg\n', 'https://x.test/a.vtt');
    expect(cues[0]).toMatchObject({ url: 'https://x.test/frame1.jpg', w: 0, h: 0 });
  });

  it('parses chapter files with CRLF line endings and cue identifiers', () => {
    const vtt = 'WEBVTT\r\n\r\nintro\r\n00:00:00.000 --> 00:01:00.000\r\nIntroduction\r\n\r\n00:01:00.000 --> 00:02:00.000\r\nPart <b>Two</b>\r\n';
    expect(parseChaptersVtt(vtt)).toEqual([
      { id: '1', title: 'Introduction', startTime: 0, endTime: 60 },
      { id: '2', title: 'Part <b>Two</b>', startTime: 60, endTime: 120 },
    ]);
  });
});

describe('isDomainAllowed', () => {
  it('matches exact hosts, wildcards and "*"', () => {
    expect(isDomainAllowed('example.com', ['example.com'])).toBe(true);
    expect(isDomainAllowed('app.example.com', ['*.example.com'])).toBe(true);
    expect(isDomainAllowed('example.com', ['*.example.com'])).toBe(true);
    expect(isDomainAllowed('evil-example.com', ['*.example.com'])).toBe(false);
    expect(isDomainAllowed('other.com', ['example.com'])).toBe(false);
    expect(isDomainAllowed('anything.io', ['*'])).toBe(true);
    expect(isDomainAllowed('example.com', ['https://Example.com:8443/path'])).toBe(true);
  });
});

describe('EventBus', () => {
  it('off() removes a once() handler by its original reference (KI-37)', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('x', handler);
    bus.off('x', handler);
    bus.emit('x');
    expect(handler).not.toHaveBeenCalled();
  });

  it('once() fires exactly once', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('x', handler);
    bus.emit('x', 1);
    bus.emit('x', 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('a throwing handler does not stop the others (KI-37)', () => {
    const bus = new EventBus();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    bus.on('x', () => { throw new Error('boom'); });
    bus.on('x', after);
    bus.emit('x');
    expect(after).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('ErrorRecoveryManager', () => {
  it('backs off exponentially and refills after resetRetries (KI-06)', () => {
    vi.useFakeTimers();
    const manager = new ErrorRecoveryManager({ maxRetries: 2, retryDelay: 100 });
    const retry = vi.fn();

    manager.scheduleRetry(retry);
    vi.advanceTimersByTime(99);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledTimes(1);

    manager.scheduleRetry(retry);
    vi.advanceTimersByTime(200);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(manager.canRetry()).toBe(false);

    manager.resetRetries();
    expect(manager.canRetry()).toBe(true);
  });

  it('replaces a pending retry instead of stacking timers', () => {
    vi.useFakeTimers();
    const manager = new ErrorRecoveryManager({ maxRetries: 5, retryDelay: 100 });
    const first = vi.fn();
    const second = vi.fn();
    manager.scheduleRetry(first);
    manager.scheduleRetry(second);
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('LMSProgressManager', () => {
  it('does not stack save timers when initialize() runs per source (KI-19)', () => {
    vi.useFakeTimers();
    const onProgressSave = vi.fn();
    const lms = new LMSProgressManager({ enabled: true, videoId: 'v1', saveInterval: 1000, onProgressSave });
    lms.initialize(100);
    lms.initialize(100);
    lms.initialize(100);
    vi.advanceTimersByTime(1000);
    expect(onProgressSave).toHaveBeenCalledTimes(1);
    lms.destroy();
  });

  it('fires onComplete once across the 95% threshold and `ended` (KI-19)', () => {
    const onComplete = vi.fn();
    const onMilestoneReached = vi.fn();
    const lms = new LMSProgressManager({ enabled: true, videoId: 'v1', onComplete, onMilestoneReached });
    lms.updateProgress(96, 100);
    lms.updateProgress(97, 100);
    lms.handleCompletion();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onMilestoneReached.mock.calls.map(c => c[0])).toEqual([25, 50, 75, 90, 100]);
  });

  it('honours custom milestones', () => {
    const onMilestoneReached = vi.fn();
    const lms = new LMSProgressManager({ enabled: true, videoId: 'v1', milestones: [10, 60], onMilestoneReached });
    lms.updateProgress(65, 100);
    expect(onMilestoneReached.mock.calls.map(c => c[0])).toEqual([10, 60]);
  });
});

describe('AnalyticsManager', () => {
  const state = { currentTime: 0, duration: 0, volume: 1, muted: false, playbackRate: 1 };

  it('tracks session_start once and uses the provided session id (KI-11, KI-42)', () => {
    const events: AnalyticsEventPayload[] = [];
    const manager = new AnalyticsManager({ enabled: true, adapter: { trackEvent: p => { events.push(p); } } }, 'session-123');
    manager.initialize('a.mp4');
    manager.initialize('b.mp4');
    manager.trackEvent('play', state);
    expect(events.filter(e => e.eventName === 'session_start')).toHaveLength(1);
    expect(events.every(e => e.sessionId === 'session-123')).toBe(true);
    expect(events.at(-1)?.sourceUrl).toBe('b.mp4');
  });

  it('does not stack heartbeat intervals (KI-42)', () => {
    vi.useFakeTimers();
    const trackEvent = vi.fn();
    const manager = new AnalyticsManager({ enabled: true, heartbeatInterval: 1000, adapter: { trackEvent } });
    manager.startHeartbeat(() => state);
    manager.startHeartbeat(() => state);
    vi.advanceTimersByTime(1000);
    expect(trackEvent.mock.calls.filter(c => c[0].eventName === 'heartbeat')).toHaveLength(1);
    manager.destroy();
  });

  it('survives an adapter that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = new AnalyticsManager({ enabled: true, adapter: { trackEvent: () => { throw new Error('down'); } } });
    expect(() => manager.trackEvent('play', state)).not.toThrow();
  });
});

describe('HttpAnalyticsAdapter', () => {
  it('flushes queued events with keepalive on destroy (KI-42)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    (globalThis as any).fetch = fetchMock;
    const adapter = new HttpAnalyticsAdapter({ endpoint: 'https://api.example.com/events', batchSize: 50, retryOnFailure: false });
    await adapter.trackEvent({ eventName: 'play' } as AnalyticsEventPayload);
    expect(fetchMock).not.toHaveBeenCalled();
    adapter.destroy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.keepalive).toBe(true);
  });

  it('flushes when the page is hidden', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    (globalThis as any).fetch = fetchMock;
    const adapter = new HttpAnalyticsAdapter({ endpoint: 'https://api.example.com/events', batchSize: 50 });
    await adapter.trackEvent({ eventName: 'pause' } as AnalyticsEventPayload);
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });
});
