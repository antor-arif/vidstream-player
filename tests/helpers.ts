import { mediaModel } from './setup';
import { VideoPlayer } from '../src/components/VideoPlayer';
import type { PlayerConfig } from '../src/types';

export const MP4 = 'https://cdn.example.com/video.mp4';

/** A fresh container attached to document.body */
export function makeContainer(width = 640): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = `${width}px`;
  document.body.appendChild(el);
  return el;
}

export function videoOf(container: Element): HTMLVideoElement {
  const video = container.querySelector('video');
  if (!video) throw new Error('no <video> in container');
  return video;
}

/** Simulate metadata arriving for the current source */
export function loadMetadata(video: HTMLVideoElement, duration = 120): void {
  mediaModel(video).duration = duration;
  video.dispatchEvent(new Event('loadedmetadata'));
}

export function fire(video: HTMLVideoElement, type: string): void {
  video.dispatchEvent(new Event(type));
}

export function setMediaError(video: HTMLVideoElement, code: number, message = ''): void {
  mediaModel(video).error = { code, message };
  video.dispatchEvent(new Event('error'));
}

export function createPlayer(config: Partial<PlayerConfig> = {}, container = makeContainer()) {
  const player = new VideoPlayer(container, { source: { src: MP4 }, ...config } as PlayerConfig);
  return { player, container, video: videoOf(container) };
}

/** Let pending promise callbacks (fetch mocks, async source loading) run */
export async function flushPromises(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

export function mockFetchText(map: Record<string, string>): void {
  (globalThis as any).fetch = async (url: string) => {
    const body = map[url];
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(body, { status: 200 });
  };
}

/** Make getBoundingClientRect return a fixed box (jsdom has no layout) */
export function stubRect(el: Element, rect: { left?: number; top?: number; width: number; height?: number }): void {
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const height = rect.height ?? 10;
  el.getBoundingClientRect = () => ({
    left, top, width: rect.width, height,
    right: left + rect.width, bottom: top + height, x: left, y: top,
    toJSON() { return this; },
  }) as DOMRect;
}
