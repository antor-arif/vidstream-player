// jsdom has no media pipeline: give HTMLMediaElement a small, controllable model.
// Tests drive it with helpers in ./helpers.ts (setDuration, fire, …).

interface MediaModel {
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  defaultPlaybackRate: number;
  volume: number;
  muted: boolean;
  error: { code: number; message: string } | null;
}

const models = new WeakMap<HTMLMediaElement, MediaModel>();

export function mediaModel(el: HTMLMediaElement): MediaModel {
  let model = models.get(el);
  if (!model) {
    model = {
      currentTime: 0,
      duration: NaN,
      paused: true,
      playbackRate: 1,
      defaultPlaybackRate: 1,
      volume: 1,
      muted: false,
      error: null,
    };
    models.set(el, model);
  }
  return model;
}

const proto = HTMLMediaElement.prototype;

function define<K extends keyof MediaModel>(key: K, onSet?: (el: HTMLMediaElement) => void, readonly = false) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get(this: HTMLMediaElement) {
      return mediaModel(this)[key];
    },
    set: readonly
      ? undefined
      : function (this: HTMLMediaElement, value: MediaModel[K]) {
          const model = mediaModel(this);
          if (model[key] === value) return;
          model[key] = value;
          onSet?.(this);
        },
  });
}

define('currentTime', el => {
  el.dispatchEvent(new Event('seeking'));
  el.dispatchEvent(new Event('timeupdate'));
  el.dispatchEvent(new Event('seeked'));
});
define('duration', undefined, true);
define('paused', undefined, true);
define('playbackRate', el => el.dispatchEvent(new Event('ratechange')));
define('defaultPlaybackRate');
define('volume', el => el.dispatchEvent(new Event('volumechange')));
define('muted', el => el.dispatchEvent(new Event('volumechange')));
define('error', undefined, true);

proto.play = function (this: HTMLMediaElement) {
  const model = mediaModel(this);
  if (model.paused) {
    model.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
  }
  return Promise.resolve();
};
proto.pause = function (this: HTMLMediaElement) {
  const model = mediaModel(this);
  if (!model.paused) {
    model.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
};
proto.load = function () {};
proto.canPlayType = () => '';

if (!('textTracks' in proto)) {
  Object.defineProperty(proto, 'textTracks', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return Array.from(this.querySelectorAll('track')).map(t => ({
        language: (t as HTMLTrackElement).srclang,
        label: (t as HTMLTrackElement).label,
        mode: 'disabled',
      }));
    },
  });
}

Element.prototype.scrollIntoView = function () {};

HTMLVideoElement.prototype.requestPictureInPicture = function () {
  return Promise.resolve({} as PictureInPictureWindow);
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** IntersectionObserver stub that records instances so tests can deliver entries */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  targets = new Set<Element>();
  constructor(public callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  takeRecords() { return []; }
  /** Deliver an intersection change for `target` (only if currently observed) */
  trigger(target: Element, isIntersecting: boolean) {
    if (!this.targets.has(target)) return;
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

(globalThis as any).ResizeObserver = NoopResizeObserver;
(globalThis as any).IntersectionObserver = FakeIntersectionObserver;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
