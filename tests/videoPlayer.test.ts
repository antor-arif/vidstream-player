import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoPlayer } from '../src/components/VideoPlayer';
import { FakeIntersectionObserver, mediaModel } from './setup';
import {
  MP4, createPlayer, makeContainer, videoOf, loadMetadata, fire, setMediaError,
  flushPromises, mockFetchText, stubRect,
} from './helpers';

beforeEach(() => {
  document.body.innerHTML = '';
  FakeIntersectionObserver.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('chapters', () => {
  it('keeps top-level config.chapters after the initial load (KI-01)', () => {
    const { container, video } = createPlayer({
      chapters: [
        { id: 'a', title: 'Intro', startTime: 0 },
        { id: 'b', title: 'Middle', time: 60 } as any,
      ],
    });
    loadMetadata(video, 120);
    expect(container.querySelectorAll('.vp-chapter-segment')).toHaveLength(2);
    const button = container.querySelector<HTMLElement>('[data-dropdown="chapters"]')!;
    expect(button.style.display).toBe('');
  });

  it('emits chapterChange from 0 again after switching source (KI-38)', () => {
    const { player, video } = createPlayer({ source: { src: MP4, chapters: [{ id: '1', title: 'A', startTime: 0 }] } });
    const seen: number[] = [];
    player.on('chapterChange', (e: any) => seen.push(e.index));
    loadMetadata(video);
    fire(video, 'timeupdate');
    player.loadSource({ src: 'https://cdn.example.com/b.mp4', chapters: [{ id: '1', title: 'B', startTime: 0 }] });
    loadMetadata(video);
    fire(video, 'timeupdate');
    expect(seen).toEqual([0, 0]);
  });

  it('does not apply the main video chapters to other playlist items', () => {
    const { player, container, video } = createPlayer({
      chapters: [{ id: '1', title: 'Main', startTime: 0 }, { id: '2', title: 'Two', startTime: 10 }],
      playlist: [{ src: MP4 }, { src: 'https://cdn.example.com/2.mp4' }],
    });
    loadMetadata(video);
    expect(container.querySelectorAll('.vp-chapter-segment')).toHaveLength(2);
    player.next();
    loadMetadata(video);
    expect(container.querySelectorAll('.vp-chapter-segment')).toHaveLength(0);
  });
});

describe('autoplay and start time', () => {
  it('autoplays once per source, not after every canplay (KI-03)', () => {
    const { video } = createPlayer({ autoplay: true });
    const play = vi.spyOn(video, 'play');
    fire(video, 'canplay');
    video.pause();
    fire(video, 'canplay'); // e.g. after a seek
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('applies startTime to the initial source only (KI-18)', () => {
    const { player, video } = createPlayer({ startTime: 30 });
    loadMetadata(video, 120);
    expect(video.currentTime).toBe(30);
    player.loadSource({ src: 'https://cdn.example.com/other.mp4' });
    mediaModel(video).currentTime = 0;
    loadMetadata(video, 120);
    expect(video.currentTime).toBe(0);
  });

  it('remembers a seek requested before metadata', () => {
    const { player, video } = createPlayer();
    player.seek(42);
    loadMetadata(video, 100);
    expect(video.currentTime).toBe(42);
  });

  it('applies the initial playbackRate (KI-08)', () => {
    const { video } = createPlayer({ playbackRate: 1.5 });
    expect(video.playbackRate).toBe(1.5);
    expect(video.defaultPlaybackRate).toBe(1.5);
  });
});

describe('keyboard', () => {
  it('ignores shortcuts when keyboardShortcuts is false (KI-08)', () => {
    const { player, container } = createPlayer({ keyboardShortcuts: false });
    const toggle = vi.spyOn(player, 'togglePlay');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(toggle).not.toHaveBeenCalled();
  });

  it('leaves modifier shortcuts and editable fields alone (KI-27)', () => {
    const { player, container } = createPlayer();
    const fullscreen = vi.spyOn(player, 'toggleFullscreen');
    const toggle = vi.spyOn(player, 'togglePlay');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(fullscreen).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('does not double-toggle when Space activates a focused button', () => {
    const { player, container } = createPlayer();
    const toggle = vi.spyOn(player, 'togglePlay');
    const muteButton = container.querySelector('.vp-btn-volume')!;
    muteButton.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(toggle).not.toHaveBeenCalled();
  });

  it('keeps the progress slider aria values current (KI-27)', () => {
    const { container, video } = createPlayer();
    loadMetadata(video, 100);
    video.currentTime = 25;
    const bar = container.querySelector('.vp-progress')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(bar.getAttribute('aria-valuetext')).toBe('0:25 of 1:40');
    expect(bar.getAttribute('tabindex')).toBe('0');
  });
});

describe('gestures', () => {
  function touch(target: Element, type: string, x: number) {
    const event = new Event(type, { bubbles: true, cancelable: true }) as any;
    const point = { clientX: x, clientY: 50 };
    event.touches = type === 'touchend' ? [] : [point];
    event.changedTouches = [point];
    target.dispatchEvent(event);
  }

  it('double-tap seeks by gestures.doubleTapSeek (KI-09)', () => {
    const { player, container, video } = createPlayer({ gestures: { doubleTapSeek: 5 } });
    stubRect(container, { width: 300, height: 170 });
    loadMetadata(video, 100);
    video.currentTime = 50;
    const seek = vi.spyOn(player, 'seek');
    const surface = videoOf(container);
    touch(surface, 'touchstart', 280);
    touch(surface, 'touchend', 280);
    touch(surface, 'touchstart', 280);
    touch(surface, 'touchend', 280);
    expect(seek).toHaveBeenCalledWith(55);
  });

  it('longPressSpeed: false disables the long-press speed boost (KI-09)', () => {
    vi.useFakeTimers();
    const { player, container } = createPlayer({ gestures: { longPressSpeed: false } });
    const rate = vi.spyOn(player, 'setPlaybackRate');
    touch(videoOf(container), 'touchstart', 100);
    vi.advanceTimersByTime(800);
    expect(rate).not.toHaveBeenCalled();
  });
});

describe('click handling', () => {
  it('a double-click does not toggle playback (KI-29)', () => {
    vi.useFakeTimers();
    const { player, container } = createPlayer();
    const toggle = vi.spyOn(player, 'togglePlay');
    const video = videoOf(container);
    video.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    video.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    vi.advanceTimersByTime(500);
    expect(toggle).not.toHaveBeenCalled();

    video.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(500);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle and leaks', () => {
  it('a destroyed player leaves no listeners behind on a reused container (KI-10)', () => {
    vi.useFakeTimers();
    const container = makeContainer();
    const first = new VideoPlayer(container, { source: { src: MP4 } });
    const firstToggle = vi.spyOn(first, 'togglePlay');
    first.destroy();
    const second = new VideoPlayer(container, { source: { src: MP4 } });
    const secondToggle = vi.spyOn(second, 'togglePlay');

    videoOf(container).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(500);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(firstToggle).not.toHaveBeenCalled();
    expect(secondToggle).toHaveBeenCalledTimes(2);
  });

  it('removes every document listener it added on destroy (KI-10)', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const { player } = createPlayer();
    const signals = add.mock.calls
      .map(call => (call[2] as AddEventListenerOptions | undefined)?.signal)
      .filter(Boolean) as AbortSignal[];
    expect(signals.length).toBeGreaterThanOrEqual(4);
    expect(add.mock.calls.every(call => (call[2] as AddEventListenerOptions | undefined)?.signal)).toBe(true);
    player.destroy();
    expect(signals.every(s => s.aborted)).toBe(true);
  });

  it('calls the analytics plugin destroy() (KI-14)', () => {
    const plugin = { name: 'test', init: vi.fn(), destroy: vi.fn() };
    const { player } = createPlayer({ plugins: { analytics: plugin } });
    expect(plugin.init).toHaveBeenCalledWith(player);
    player.destroy();
    expect(plugin.destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores async engine work that finishes after destroy (KI-16)', async () => {
    const { player, container } = createPlayer({ source: { src: 'https://cdn.example.com/live.m3u8' } });
    player.destroy();
    await flushPromises(20);
    expect(container.querySelector('video')).toBeNull();
    expect((player as any).hls).toBeNull();
  });
});

describe('events', () => {
  it('reports the configured source URL, not video.src (KI-13)', () => {
    const { player, video } = createPlayer({ source: { src: 'media/clip.mp4' } });
    const payloads: any[] = [];
    player.on('play', (e: any) => payloads.push(e));
    void video.play();
    expect(video.src).not.toBe('media/clip.mp4');
    expect(payloads[0].src).toBe('media/clip.mp4');
  });

  it('emits player-seek and a seek payload with the real origin (KI-38)', () => {
    const { player, container, video } = createPlayer();
    loadMetadata(video, 100);
    video.currentTime = 10;
    const dom: any[] = [];
    const bus: any[] = [];
    container.addEventListener('player-seek', (e) => dom.push((e as CustomEvent).detail.data));
    player.on('seek', (e: any) => bus.push(e));
    player.seek(70);
    expect(dom).toEqual([{ from: 10, to: 70 }]);
    expect(bus[0]).toMatchObject({ fromTime: 10, toTime: 70 });
  });

  it('emits player-heartbeat while playing (KI-38)', () => {
    vi.useFakeTimers();
    const { container, video } = createPlayer({ analytics: { enabled: false, heartbeatInterval: 1000 } });
    const beats = vi.fn();
    container.addEventListener('player-heartbeat', beats);
    void video.play();
    vi.advanceTimersByTime(3000);
    video.pause();
    vi.advanceTimersByTime(3000);
    expect(beats).toHaveBeenCalledTimes(3);
  });

  it('sets playlistIndex before player-playlist-change fires (KI-38)', () => {
    const { player, container } = createPlayer({ playlist: [{ src: MP4 }, { src: 'https://cdn.example.com/2.mp4' }] });
    let indexInEvent: number | undefined;
    container.addEventListener('player-playlist-change', (e) => {
      indexInEvent = (e as CustomEvent).detail.state.playlistIndex;
    });
    player.next();
    expect(indexInEvent).toBe(1);
  });

  it('shares one session id between analytics and the player (KI-42)', () => {
    const events: any[] = [];
    const { player } = createPlayer({ analytics: { enabled: true, adapter: { trackEvent: (p) => { events.push(p); } } } });
    expect(events.filter(e => e.eventName === 'session_start')).toHaveLength(1);
    expect(events.every(e => e.sessionId === player.sessionId)).toBe(true);
  });
});

describe('errors', () => {
  it('normalises native errors and retries before going fatal (KI-12)', () => {
    vi.useFakeTimers();
    const { player, container, video } = createPlayer({ errorRecovery: { maxRetries: 1, retryDelay: 100 } });
    const bus: any[] = [];
    const dom: any[] = [];
    player.on('error', (e: any) => bus.push(e));
    container.addEventListener('player-error', (e) => dom.push((e as CustomEvent).detail.data));

    setMediaError(video, 2, 'net down');
    expect(bus[0]).toMatchObject({ code: 'NETWORK_ERROR', fatal: false });
    expect(container.querySelector('.vp-error')).toBeNull();

    vi.advanceTimersByTime(100); // retry runs
    setMediaError(video, 2, 'still down');
    expect(bus[1]).toMatchObject({ code: 'NETWORK_ERROR', fatal: true });
    expect(dom[1]).toMatchObject({ code: 'NETWORK_ERROR', fatal: true });
    expect(player.getState().error?.code).toBe('NETWORK_ERROR');
    expect(container.querySelector('.vp-error-message')?.textContent).toBe('still down');
  });

  it('maps MEDIA_ERR_SRC_NOT_SUPPORTED without retrying', () => {
    const { player, container, video } = createPlayer();
    const bus: any[] = [];
    player.on('error', (e: any) => bus.push(e));
    setMediaError(video, 4);
    expect(bus).toHaveLength(1);
    expect(bus[0]).toMatchObject({ code: 'SRC_NOT_SUPPORTED', fatal: true });
    expect(container.querySelector('.vp-error')).not.toBeNull();
  });

  it('never renders error messages as HTML (KI-17)', () => {
    const { container, video } = createPlayer({ errorRecovery: { enabled: false } });
    setMediaError(video, 3, '<img src=x onerror="window.__pwned=1">');
    const message = container.querySelector('.vp-error-message')!;
    expect(message.querySelector('img')).toBeNull();
    expect(message.textContent).toContain('<img');
  });

  it('reports STREAM_ENDED when a live stream ends', () => {
    const { player, video } = createPlayer({ mode: 'live' });
    const bus: any[] = [];
    player.on('error', (e: any) => bus.push(e));
    fire(video, 'ended');
    expect(bus[0]).toMatchObject({ code: 'STREAM_ENDED', fatal: false });
  });
});

describe('playlist', () => {
  const items = [
    { src: 'https://cdn.example.com/1.mp4', title: 'One' },
    { src: 'https://cdn.example.com/2.mp4', title: 'Two' },
    { src: 'https://cdn.example.com/3.mp4', title: 'Three' },
  ];

  it('loads playlist[startIndex] when startIndex is set (KI-15)', () => {
    const { player, video } = createPlayer({ playlist: items, playlistOptions: { startIndex: 2, showPanel: true } });
    expect(video.getAttribute('src')).toBe(items[2].src);
    expect(player.getState().playlistIndex).toBe(2);
    const active = document.querySelector('.vp-playlist-item.active') as HTMLElement;
    expect(active.dataset.index).toBe('2');
  });

  it('highlights the playlist item matching config.source', () => {
    createPlayer({ source: { src: items[1].src }, playlist: items, playlistOptions: { showPanel: true } });
    const active = document.querySelector('.vp-playlist-item.active') as HTMLElement;
    expect(active.dataset.index).toBe('1');
  });

  it('renders titles as text, not HTML (KI-17)', () => {
    createPlayer({
      playlist: [{ src: MP4, title: '<img src=x onerror="window.__pwned=1">' }],
      playlistOptions: { showPanel: true },
    });
    const panel = document.querySelector('.vp-playlist-panel')!;
    expect(panel.querySelector('img[src="x"]')).toBeNull();
    expect(panel.querySelector('.vp-playlist-title')!.textContent).toContain('<img');
  });

  it('restores the DOM when destroyed (wrapper removed, width returned)', () => {
    const parent = document.createElement('section');
    document.body.appendChild(parent);
    const container = document.createElement('div');
    container.style.width = '500px';
    parent.appendChild(container);
    const player = new VideoPlayer(container, { source: { src: MP4 }, playlist: items, playlistOptions: { showPanel: true } });
    expect(container.parentElement?.className).toBe('vp-layout-wrapper');
    player.destroy();
    expect(container.parentElement).toBe(parent);
    expect(parent.querySelector('.vp-layout-wrapper')).toBeNull();
    expect(container.style.width).toBe('500px');
  });

  it('gives the side panel the theme variables', () => {
    createPlayer({ theme: { accentColor: '#ff0000' }, playlist: items, playlistOptions: { showPanel: true } });
    const panel = document.querySelector<HTMLElement>('.vp-playlist-panel')!;
    expect(panel.style.getPropertyValue('--vp-accent-color')).toBe('#ff0000');
  });

  it('accepts a per-item source type', () => {
    const { player } = createPlayer({ playlist: [{ src: MP4 }, { src: 'https://cdn.example.com/stream', type: 'hls' }] });
    const load = vi.spyOn(player as any, 'loadHLSSource');
    player.next();
    expect(load).toHaveBeenCalled();
  });
});

describe('seek thumbnails', () => {
  it('mounts the preview inside the progress bar with resolved sprite URLs (KI-02)', async () => {
    mockFetchText({
      'https://cdn.example.com/thumbs/thumbs.vtt':
        'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nsprite.jpg#xywh=0,0,160,90\n\n00:00:10.000 --> 00:02:00.000\nsprite.jpg#xywh=160,0,160,90\n',
    });
    const { container, video } = createPlayer({ thumbnailVtt: 'https://cdn.example.com/thumbs/thumbs.vtt' });
    loadMetadata(video, 120);
    await flushPromises(10);

    const bar = container.querySelector('.vp-progress')!;
    stubRect(bar, { width: 600 });
    bar.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, bubbles: true }));

    const preview = container.querySelector<HTMLElement>('.vp-thumb-preview')!;
    expect(preview).not.toBeNull();
    expect(preview.parentElement?.classList.contains('vp-progress-container')).toBe(true);
    expect(preview.style.display).toBe('block');
    expect(preview.querySelector('img')!.src).toBe('https://cdn.example.com/thumbs/sprite.jpg');
  });

  it("drops the previous item's thumbnails when the next item has none (KI-02)", async () => {
    mockFetchText({ 'https://cdn.example.com/t.vtt': 'WEBVTT\n\n00:00.000 --> 01:00.000\ns.jpg#xywh=0,0,10,10\n' });
    const { player } = createPlayer({ playlist: [{ src: MP4, thumbnailVtt: 'https://cdn.example.com/t.vtt' }, { src: 'https://cdn.example.com/2.mp4' }] });
    await flushPromises(10);
    expect((player as any).thumbnailPreview).not.toBeNull();
    player.next();
    expect((player as any).thumbnailPreview).toBeNull();
  });
});

describe('quality', () => {
  function fakeDashV5() {
    const reps = [
      { id: 'v1', height: 360, width: 640, bandwidth: 800_000 },
      { id: 'v2', height: 720, width: 1280, bandwidth: 2_500_000 },
      { id: 'v2b', height: 720, width: 1280, bandwidth: 1_800_000 },
    ];
    return {
      getRepresentationsByType: vi.fn(() => reps),
      setRepresentationForTypeById: vi.fn(),
      updateSettings: vi.fn(),
      getSettings: () => ({ streaming: { abr: { autoSwitchBitrate: { video: true } } } }),
      destroy: vi.fn(),
    };
  }

  it('lists and switches DASH qualities with the dash.js v5 API (KI-04)', () => {
    const { player } = createPlayer();
    const dash = fakeDashV5();
    (player as any).dash = dash;
    (player as any).setRawQualities((player as any).getDashRepresentations(dash));

    expect(player.getState().qualities.map(q => q.label)).toEqual(['360p', '720p']);
    expect(() => player.setQuality(720)).not.toThrow();
    expect(dash.setRepresentationForTypeById).toHaveBeenCalledWith('video', 'v2', true);
    player.setQuality('auto');
    expect(dash.updateSettings).toHaveBeenLastCalledWith({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
  });

  it('still supports the dash.js v4 API', () => {
    const { player } = createPlayer();
    const dash = {
      getBitrateInfoListFor: vi.fn(() => [{ height: 480, width: 854, bitrate: 1e6, qualityIndex: 0 }, { height: 1080, width: 1920, bitrate: 5e6, qualityIndex: 1 }]),
      setQualityFor: vi.fn(),
      updateSettings: vi.fn(),
      destroy: vi.fn(),
    };
    (player as any).dash = dash;
    (player as any).setRawQualities((player as any).getDashRepresentations(dash));
    player.setQuality({ height: 1080, label: '1080p' });
    expect(dash.setQualityFor).toHaveBeenCalledWith('video', 1, true);
  });

  it('applies quality.defaultQuality and allowedQualities', () => {
    const { player } = createPlayer({ quality: { defaultQuality: 720, allowedQualities: [720] } });
    const dash = fakeDashV5();
    (player as any).dash = dash;
    (player as any).setRawQualities((player as any).getDashRepresentations(dash));
    expect(player.getState().qualities.map(q => q.height)).toEqual([720]);
    expect(dash.setRepresentationForTypeById).toHaveBeenCalledWith('video', 'v2', true);
  });
});

describe('pip', () => {
  it('pip.enabled: false blocks enterPip() (KI-08)', async () => {
    const { player, video } = createPlayer({ pip: { enabled: false } });
    const request = vi.spyOn(video, 'requestPictureInPicture');
    await player.enterPip();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('updateConfig', () => {
  it('rebuilds controls when controls change (KI-44)', () => {
    const { player, container } = createPlayer();
    expect(container.querySelector('.vp-btn-fullscreen')).not.toBeNull();
    player.updateConfig({ controls: { fullscreen: false } });
    expect(container.querySelector('.vp-btn-fullscreen')).toBeNull();
    expect(container.querySelectorAll('.vp-controls')).toHaveLength(1);
  });

  it('updates poster and title in place, reloads on a new src', () => {
    const { player, container, video } = createPlayer({ source: { src: MP4, title: 'Old' } });
    const load = vi.spyOn(player, 'loadSource');
    player.updateConfig({ source: { src: MP4, title: 'New', poster: 'https://cdn.example.com/p.jpg' } });
    expect(load).not.toHaveBeenCalled();
    expect(container.querySelector('.vp-title')!.textContent).toBe('New');
    expect(video.getAttribute('poster')).toBe('https://cdn.example.com/p.jpg');
    player.updateConfig({ source: { src: 'https://cdn.example.com/next.mp4' } });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('applies muted, loop and playbackRate live', () => {
    const { player, video } = createPlayer();
    player.updateConfig({ muted: true, loop: true, playbackRate: 2 });
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playbackRate).toBe(2);
  });

  it('switches keyboard shortcuts off at runtime', () => {
    const { player, container } = createPlayer();
    player.updateConfig({ keyboardShortcuts: false });
    const toggle = vi.spyOn(player, 'togglePlay');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(toggle).not.toHaveBeenCalled();
  });

  it('progress: false hides the seek bar like seekBar: false (KI-08)', () => {
    const { container } = createPlayer({ controls: { progress: false } });
    expect(container.querySelector('.vp-progress-container')).toBeNull();
  });
});

describe('theme', () => {
  it('writes only explicit theme values inline (KI-43)', () => {
    const { container } = createPlayer({ theme: { accentColor: '#ff0000' } });
    expect(container.style.getPropertyValue('--vp-accent-color')).toBe('#ff0000');
    expect(container.style.getPropertyValue('--vp-progress-color')).toBe('');
    expect(document.getElementById('video-player-styles')!.textContent).toContain(':where(.video-player-container)');
  });

  it('renders the logo from theme.logoUrl (KI-30)', () => {
    const { player, container } = createPlayer({ theme: { logoUrl: 'https://cdn.example.com/logo.png', logoPosition: 'top-left', tenantName: 'Acme' } });
    const logo = container.querySelector<HTMLImageElement>('img.vp-logo')!;
    expect(logo.src).toBe('https://cdn.example.com/logo.png');
    expect(logo.classList.contains('left')).toBe(true);
    expect(logo.alt).toBe('Acme');
    player.updateConfig({ theme: { logoUrl: undefined } });
    expect(container.querySelector('img.vp-logo')).toBeNull();
  });
});

describe('security', () => {
  it('blocks playback on a domain outside sdkAuth.allowedDomains', () => {
    const onAuthError = vi.fn();
    const { player, container, video } = createPlayer({ sdkAuth: { apiKey: 'k', allowedDomains: ['example.com'], onAuthError } });
    const bus: any[] = [];
    player.on('error', (e: any) => bus.push(e));
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(video.getAttribute('src')).toBeNull();
    expect(container.querySelector('.vp-error')).not.toBeNull();
    expect(player.getState().error?.code).toBe('AUTH_ERROR');
  });

  it('allows the current domain and rejects an empty apiKey', () => {
    const allowed = createPlayer({ sdkAuth: { apiKey: 'k', allowedDomains: [location.hostname] } });
    expect(allowed.video.getAttribute('src')).toBe(MP4);
    const onAuthError = vi.fn();
    createPlayer({ sdkAuth: { apiKey: '', onAuthError } });
    expect(onAuthError).toHaveBeenCalled();
  });

  it('plays the URL returned by getSignedPlaybackUrl', async () => {
    const getSignedPlaybackUrl = vi.fn(async (url: string) => `${url}?sig=abc`);
    const { video } = createPlayer({ security: { getSignedPlaybackUrl } });
    await flushPromises();
    expect(getSignedPlaybackUrl).toHaveBeenCalledWith(MP4);
    expect(video.getAttribute('src')).toBe(`${MP4}?sig=abc`);
  });

  it('refreshes the token once when signing fails, then reports AUTH_ERROR', async () => {
    const getSignedPlaybackUrl = vi.fn(async () => { throw new Error('expired'); });
    const refreshPlaybackToken = vi.fn(async () => 'new-token');
    const onPlaybackAuthorizationError = vi.fn();
    const { player } = createPlayer({ security: { getSignedPlaybackUrl, refreshPlaybackToken, onPlaybackAuthorizationError } });
    await flushPromises(30);
    expect(refreshPlaybackToken).toHaveBeenCalledTimes(1);
    expect(getSignedPlaybackUrl).toHaveBeenCalledTimes(2);
    expect(onPlaybackAuthorizationError).toHaveBeenCalledTimes(1);
    expect(player.getState().error?.code).toBe('AUTH_ERROR');
  });
});

describe('mini player', () => {
  it('re-arms after × once the user scrolls back to the player (KI-36)', () => {
    vi.useFakeTimers();
    const { container } = createPlayer({ miniPlayer: { enabled: true } });
    vi.advanceTimersByTime(250);
    const io = FakeIntersectionObserver.instances.at(-1)!;

    io.trigger(container, true);
    io.trigger(container, false);
    expect(container.classList.contains('vp-mini-active')).toBe(true);

    (container.querySelector('.vp-mini-close') as HTMLElement).click();
    expect(container.classList.contains('vp-mini-active')).toBe(false);
    vi.advanceTimersByTime(250);
    io.trigger(container, false);
    expect(container.classList.contains('vp-mini-active')).toBe(false); // dismissed

    io.trigger(container, true); // scrolled back
    io.trigger(container, false); // scrolled away again
    expect(container.classList.contains('vp-mini-active')).toBe(true);
  });

  it('a click on the docked player does not toggle playback (KI-36)', () => {
    vi.useFakeTimers();
    const { player, container } = createPlayer({ miniPlayer: { enabled: true } });
    vi.advanceTimersByTime(250);
    const io = FakeIntersectionObserver.instances.at(-1)!;
    io.trigger(container, true);
    io.trigger(container, false);
    const toggle = vi.spyOn(player, 'togglePlay');
    videoOf(container).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(500);
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe('controls', () => {
  it('resets the big play icon to "play" after a replay (KI-39)', () => {
    const { container, video } = createPlayer();
    loadMetadata(video);
    void video.play();
    fire(video, 'ended');
    const big = container.querySelector('.vp-big-play')!;
    expect(big.getAttribute('aria-label')).toBe('Replay video');
    video.pause();
    void video.play();
    expect(big.getAttribute('aria-label')).toBe('Play video');
  });

  it('builds menu items as text (KI-17)', () => {
    const { container, video } = createPlayer({
      source: { src: MP4, chapters: [{ id: '1', title: '<b>bold</b>', startTime: 0 }] },
      subtitles: [{ src: 'en.vtt', label: '<i>English</i>', language: 'en' }],
    });
    loadMetadata(video);
    (container.querySelector('[data-dropdown="chapters"] .vp-dropdown-btn') as HTMLElement).click();
    expect(container.querySelector('.vp-chapter-title')!.innerHTML).toBe('&lt;b&gt;bold&lt;/b&gt;');
    (container.querySelector('[data-dropdown="subtitles"] .vp-dropdown-btn') as HTMLElement).click();
    const labels = Array.from(container.querySelectorAll('[data-dropdown="subtitles"] .vp-dropdown-item-label')).map(l => l.innerHTML);
    expect(labels).toContain('&lt;i&gt;English&lt;/i&gt;');
  });
});
