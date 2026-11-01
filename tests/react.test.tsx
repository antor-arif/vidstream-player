import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VideoPlayer as ReactVideoPlayer, type VideoPlayerRef } from '../src/react';
import { VideoPlayer } from '../src/components/VideoPlayer';
import { MP4, flushPromises } from './helpers';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

describe('React <VideoPlayer>', () => {
  it('calls onReady exactly once (KI-20)', () => {
    const onReady = vi.fn();
    render(<ReactVideoPlayer source={{ src: MP4 }} onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('calls onReady once and creates one player under StrictMode', () => {
    const onReady = vi.fn();
    const ctor = vi.spyOn(VideoPlayer.prototype as any, 'initialize');
    render(<StrictMode><ReactVideoPlayer source={{ src: MP4 }} onReady={onReady} /></StrictMode>);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('loads the source once on mount (KI-21)', () => {
    const load = vi.spyOn(VideoPlayer.prototype, 'loadSource');
    render(<ReactVideoPlayer source={{ src: MP4 }} />);
    render(<ReactVideoPlayer source={{ src: MP4 }} />); // re-render with an equal (new) object
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads when the source changes', () => {
    const load = vi.spyOn(VideoPlayer.prototype, 'loadSource');
    render(<ReactVideoPlayer source={{ src: MP4 }} />);
    render(<ReactVideoPlayer source={{ src: 'https://cdn.example.com/2.mp4' }} />);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0]).toMatchObject({ src: 'https://cdn.example.com/2.mp4' });
  });

  it('syncs only props that actually changed (KI-22)', () => {
    const update = vi.spyOn(VideoPlayer.prototype, 'updateConfig');
    render(<ReactVideoPlayer source={{ src: MP4 }} theme={{ accentColor: '#111111' }} muted={false} />);
    render(<ReactVideoPlayer source={{ src: MP4 }} theme={{ accentColor: '#111111' }} muted={false} />);
    expect(update).not.toHaveBeenCalled();

    render(<ReactVideoPlayer source={{ src: MP4 }} theme={{ accentColor: '#222222' }} muted={true} />);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual({ theme: { accentColor: '#222222' }, muted: true });
    const element = host.querySelector('video-player') as HTMLElement;
    expect(element.style.getPropertyValue('--vp-accent-color')).toBe('#222222');
    expect(element.querySelector('video')!.muted).toBe(true);
  });

  it('forwards prop changes for chapters, subtitles and controls (KI-22)', () => {
    render(<ReactVideoPlayer source={{ src: MP4 }} />);
    render(
      <ReactVideoPlayer
        source={{ src: MP4 }}
        controls={{ fullscreen: false }}
        subtitles={[{ src: 'en.vtt', label: 'English', language: 'en' }]}
      />
    );
    const element = host.querySelector('video-player')!;
    expect(element.querySelector('.vp-btn-fullscreen')).toBeNull();
    expect(element.querySelectorAll('track')).toHaveLength(1);
  });

  it('unmounts cleanly when the playlist panel re-parented the element (KI-23)', async () => {
    function App() {
      const [show, setShow] = useState(true);
      (App as any).hide = () => setShow(false);
      return (
        <section>
          <h1>Title</h1>
          {show && (
            <ReactVideoPlayer
              source={{ src: MP4 }}
              playlist={[{ src: MP4, title: 'One' }, { src: 'https://cdn.example.com/2.mp4', title: 'Two' }]}
              playlistOptions={{ showPanel: true }}
            />
          )}
          <footer>after</footer>
        </section>
      );
    }
    render(<App />);
    expect(host.querySelector('.vp-layout-wrapper')).not.toBeNull();
    const destroy = vi.spyOn(VideoPlayer.prototype, 'destroy');

    expect(() => act(() => (App as any).hide())).not.toThrow();
    await flushPromises(3);
    expect(host.querySelector('video-player')).toBeNull();
    expect(host.querySelector('.vp-layout-wrapper')).toBeNull();
    expect(host.querySelector('footer')).not.toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('exposes the imperative API through the ref', () => {
    const ref = React.createRef<VideoPlayerRef>();
    render(<ReactVideoPlayer ref={ref} source={{ src: MP4 }} />);
    expect(ref.current?.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(ref.current?.getElement()?.tagName).toBe('VIDEO-PLAYER');
    expect(ref.current?.getState().paused).toBe(true);
  });

  it('reports state through onStateChange on every player event', () => {
    const onStateChange = vi.fn();
    render(<ReactVideoPlayer source={{ src: MP4 }} onStateChange={onStateChange} />);
    const video = host.querySelector('video')!;
    act(() => { void video.play(); });
    expect(onStateChange).toHaveBeenCalled();
    expect(onStateChange.mock.calls.at(-1)![0].playing).toBe(true);
  });
});
