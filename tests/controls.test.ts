// Control buttons must work on the first click / tap (reported from vidstream-embed, 2026-11-11):
// - mouse: human-speed clicks were dropped because state updates swapped the icon under the pointer
// - touch: after auto-hide the first tap only revealed the controls; hidden controls stopped taking
//   taps the instant they started fading; tapping a control didn't keep them up
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mediaModel } from './setup';
import { createPlayer, videoOf, fire, loadMetadata } from './helpers';
import { ControlsManager } from '../src/components/PlayerControls';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function startPlaying(video: HTMLVideoElement) {
  loadMetadata(video, 600);
  mediaModel(video).paused = false;
  fire(video, 'play');
  fire(video, 'playing');
}

function pointerdown(target: Element, pointerType: 'mouse' | 'touch') {
  const e = new Event('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

const visible = (c: Element) => !!c.querySelector('.vp-controls')?.classList.contains('visible');
const root = (c: Element) => c.querySelector('.video-player-container') ?? c;

describe('control buttons: first click always counts', () => {
  it('state updates do not replace a button icon that did not change (the node under the pointer survives)', () => {
    const { container } = createPlayer();
    const video = videoOf(container);
    startPlaying(video);
    const svgBefore = container.querySelector('.vp-btn-play .vp-btn-inner svg');
    const volBefore = container.querySelector('.vp-btn-volume .vp-btn-inner svg');
    const fsBefore = container.querySelector('.vp-btn-fullscreen .vp-btn-inner svg');
    for (let i = 0; i < 10; i++) {
      mediaModel(video).currentTime = i;
      fire(video, 'timeupdate');
      fire(video, 'progress');
    }
    expect(svgBefore).toBeTruthy();
    expect(container.querySelector('.vp-btn-play .vp-btn-inner svg')).toBe(svgBefore);
    expect(container.querySelector('.vp-btn-volume .vp-btn-inner svg')).toBe(volBefore);
    expect(container.querySelector('.vp-btn-fullscreen .vp-btn-inner svg')).toBe(fsBefore);
    // a real change still swaps the icon
    mediaModel(video).paused = true;
    fire(video, 'pause');
    expect(container.querySelector('.vp-btn-play .vp-btn-inner svg')).not.toBe(svgBefore);
    expect(container.querySelector('.vp-btn-play')?.getAttribute('aria-label')).toBe('Play');
  });

  it('the button, never its icon, receives the pointer (CSS)', () => {
    createPlayer();
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/\.vp-control-btn > \*,\s*\.vp-control-btn svg,[^{]*\{\s*pointer-events: none;/);
  });
});

describe('touch has no hover', () => {
  it('idle :hover rules that revive hidden controls only apply to mouse-pointer devices', () => {
    createPlayer();
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const rules = [...css.matchAll(/([^{}]*\.vp-idle:hover[^{}]*)\{[^}]*\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const m of rules) {
      if (!/\.vp-controls|\.vp-gradient|\.vp-title/.test(m[1])) continue;
      const before = css.slice(0, m.index);
      const open = before.lastIndexOf('@media (pointer: fine)');
      const closed = before.lastIndexOf('}\n    }') > open;
      expect(open > -1 && !closed, `not inside @media (pointer: fine): ${m[1].trim()}`).toBe(true);
    }
  });
});

describe('controls auto-hide', () => {
  it('mouse: hide after 3 s; touch: after 5 s', () => {
    vi.useFakeTimers();
    const mouse = createPlayer();
    pointerdown(root(mouse.container), 'mouse');
    startPlaying(mouse.video);
    vi.advanceTimersByTime(ControlsManager.HIDE_AFTER_MOUSE_MS + 50);
    expect(visible(mouse.container)).toBe(false);

    const touch = createPlayer();
    pointerdown(root(touch.container), 'touch');
    startPlaying(touch.video);
    vi.advanceTimersByTime(ControlsManager.HIDE_AFTER_MOUSE_MS + 50);
    expect(visible(touch.container)).toBe(true);
    vi.advanceTimersByTime(ControlsManager.HIDE_AFTER_TOUCH_MS - ControlsManager.HIDE_AFTER_MOUSE_MS);
    expect(visible(touch.container)).toBe(false);
  });

  it('hidden controls keep taking taps through the fade + grace, then stop', () => {
    vi.useFakeTimers();
    const { container, video } = createPlayer();
    startPlaying(video);
    vi.advanceTimersByTime(ControlsManager.HIDE_AFTER_MOUSE_MS + 10);
    const c = root(container);
    expect(c.classList.contains('vp-idle')).toBe(true);
    expect(c.classList.contains('vp-idle-settled')).toBe(false); // still tappable
    vi.advanceTimersByTime(ControlsManager.IDLE_GRACE_MS);
    expect(c.classList.contains('vp-idle-settled')).toBe(true); // now taps reveal first
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/\.vp-idle\.vp-idle-settled \.vp-controls \{\s*pointer-events: none;/);
    // no rule (normal or fullscreen) turns taps off before the grace has passed
    expect(css).not.toMatch(/\.vp-playing\.vp-idle \.vp-controls \{[^}]*pointer-events: none/);
    expect(css).toMatch(/:fullscreen\.vp-playing\.vp-idle\.vp-idle-settled \.vp-controls \{\s*pointer-events: none;/);
  });

  it('a tap on a control keeps the controls up (restarts the timer)', () => {
    vi.useFakeTimers();
    const { container, video } = createPlayer();
    pointerdown(root(container), 'touch');
    startPlaying(video);
    vi.advanceTimersByTime(4000);
    pointerdown(container.querySelector('.vp-btn-volume')!, 'touch');
    vi.advanceTimersByTime(4000);
    expect(visible(container)).toBe(true);
    vi.advanceTimersByTime(1100);
    expect(visible(container)).toBe(false);
  });
});
