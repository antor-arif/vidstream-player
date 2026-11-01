import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideoPlayerElement, registerVideoPlayerElement, VidstreamPlayer } from '../src/webcomponent';
import { VideoPlayer } from '../src/components/VideoPlayer';
import { VERSION } from '../src/index';
import pkg from '../package.json';
import { MP4, flushPromises } from './helpers';

beforeEach(() => {
  document.body.innerHTML = '';
});

function make(tag = 'video-player', attrs: Record<string, string> = {}): VideoPlayerElement {
  const el = document.createElement(tag) as VideoPlayerElement;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

const microtasks = () => flushPromises(3);

describe('<video-player> / <vidstream-player>', () => {
  it('registers both tag names (KI-41)', () => {
    expect(customElements.get('video-player')).toBe(VideoPlayerElement);
    expect(customElements.get('vidstream-player')).toBeDefined();
    const alias = make('vidstream-player', { src: MP4 });
    document.body.appendChild(alias);
    expect(alias).toBeInstanceOf(VideoPlayerElement);
    expect(alias.isReady()).toBe(true);
  });

  it('can register an extra custom tag after the defaults', () => {
    expect(() => registerVideoPlayerElement('my-brand-player')).not.toThrow();
    const el = make('my-brand-player', { src: MP4 });
    document.body.appendChild(el);
    expect(el.isReady()).toBe(true);
  });

  it('reports the package version (KI-33)', () => {
    expect(VERSION).toBe(pkg.version);
    expect(VidstreamPlayer.version).toBe(pkg.version);
  });

  it('initializes from attributes when connected, not while detached', () => {
    const el = make('video-player', { src: MP4 });
    expect(el.isReady()).toBe(false);
    el.setAttribute('poster', 'https://cdn.example.com/p.jpg');
    document.body.appendChild(el);
    expect(el.isReady()).toBe(true);
    expect(el.querySelector('video')!.getAttribute('poster')).toBe('https://cdn.example.com/p.jpg');
  });

  it('enterFullscreen/enterPip call the real methods, not toggles (KI-24)', async () => {
    const enterFs = vi.spyOn(VideoPlayer.prototype, 'enterFullscreen').mockResolvedValue();
    const exitFs = vi.spyOn(VideoPlayer.prototype, 'exitFullscreen').mockResolvedValue();
    const enterPip = vi.spyOn(VideoPlayer.prototype, 'enterPip').mockResolvedValue();
    const toggleFs = vi.spyOn(VideoPlayer.prototype, 'toggleFullscreen');
    const el = make('video-player', { src: MP4 });
    document.body.appendChild(el);
    await el.enterFullscreen();
    await el.exitFullscreen();
    await el.enterPip();
    expect(enterFs).toHaveBeenCalledTimes(1);
    expect(exitFs).toHaveBeenCalledTimes(1);
    expect(enterPip).toHaveBeenCalledTimes(1);
    expect(toggleFs).not.toHaveBeenCalled();
  });

  it('applies attribute changes after init (KI-25)', () => {
    const el = make('video-player', { src: MP4, 'video-title': 'First' });
    document.body.appendChild(el);
    const video = el.querySelector('video')!;
    const load = vi.spyOn(VideoPlayer.prototype, 'loadSource');

    el.setAttribute('poster', 'https://cdn.example.com/new.jpg');
    el.setAttribute('video-title', 'Second');
    expect(video.getAttribute('poster')).toBe('https://cdn.example.com/new.jpg');
    expect(el.querySelector('.vp-title')!.textContent).toBe('Second');
    expect(load).not.toHaveBeenCalled();

    el.setAttribute('loop', '');
    el.setAttribute('playback-rate', '1.25');
    expect(video.loop).toBe(true);
    expect(video.playbackRate).toBe(1.25);

    el.setAttribute('controls', JSON.stringify({ fullscreen: false }));
    expect(el.querySelector('.vp-btn-fullscreen')).toBeNull();

    el.setAttribute('theme', JSON.stringify({ accentColor: '#00ff00' }));
    expect(el.style.getPropertyValue('--vp-accent-color')).toBe('#00ff00');

    el.setAttribute('src', 'https://cdn.example.com/next.mp4');
    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      src: 'https://cdn.example.com/next.mp4',
      poster: 'https://cdn.example.com/new.jpg',
      title: 'Second',
    }));
  });

  it('applies chapters/subtitles attributes and lists subtitle tracks (KI-25)', () => {
    const subtitles = [{ src: 'en.vtt', label: 'English', language: 'en' }];
    const el = make('video-player', { src: MP4, subtitles: JSON.stringify(subtitles) });
    document.body.appendChild(el);
    expect(el.getSubtitleTracks()).toEqual(subtitles);
    el.setAttribute('chapters', JSON.stringify([{ id: '1', title: 'A', startTime: 0 }]));
    expect((el.querySelector('[data-dropdown="chapters"]') as HTMLElement).style.display).toBe('');
  });

  it('cancels the native tooltip of the global title attribute', () => {
    const el = make('video-player', { src: MP4, title: 'My video' });
    document.body.appendChild(el);
    expect(el.querySelector('video')!.getAttribute('title')).toBe('');
    expect(el.querySelector('.vp-title')!.textContent).toBe('My video');
  });

  it('survives being moved in the DOM (KI-26)', async () => {
    const el = make('video-player', { src: MP4 });
    document.body.appendChild(el);
    const destroy = vi.spyOn(VideoPlayer.prototype, 'destroy');
    const other = document.createElement('div');
    document.body.appendChild(other);
    other.appendChild(el);
    await microtasks();
    expect(destroy).not.toHaveBeenCalled();
    expect(el.isReady()).toBe(true);
  });

  it('destroys when removed and re-initializes a programmatic player on reattach (KI-26)', async () => {
    const el = make('video-player');
    document.body.appendChild(el);
    el.initialize({ source: { src: MP4 } });
    expect(el.isReady()).toBe(true);

    el.remove();
    await microtasks();
    expect(el.isReady()).toBe(false);

    document.body.appendChild(el);
    expect(el.isReady()).toBe(true);
    expect(el.querySelector('video')!.getAttribute('src')).toBe(MP4);
  });

  it('stays destroyed after an explicit destroy()', () => {
    const el = make('video-player', { src: MP4 });
    document.body.appendChild(el);
    el.destroy();
    el.remove();
    document.body.appendChild(el);
    expect(el.isReady()).toBe(false);
  });

  it('builds the playlist layout around the element without destroying it', async () => {
    const el = make('video-player');
    document.body.appendChild(el);
    el.initialize({
      source: { src: MP4 },
      playlist: [{ src: MP4, title: 'One' }, { src: 'https://cdn.example.com/2.mp4', title: 'Two' }],
      playlistOptions: { showPanel: true },
    });
    await microtasks();
    expect(el.parentElement?.className).toBe('vp-layout-wrapper');
    expect(el.isReady()).toBe(true);
    expect(document.querySelectorAll('video')).toHaveLength(1);
  });
});
