// VTT sprite-sheet thumbnail preview for the progress bar

import { parseVttThumbnails, type VttCue } from '../utils/vtt';

export { parseVttThumbnails };
export type { VttCue };

/** Width used for cues that reference a whole image (no #xywh fragment) */
const FULL_IMAGE_WIDTH = 160;

export class ThumbnailPreview {
  private cues: VttCue[] = [];
  private el: HTMLElement | null = null;
  private img: HTMLImageElement | null = null;
  private container: HTMLElement;
  private mountTarget: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async load(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const text = await res.text();
      // Sprite paths inside the VTT are relative to the VTT file, not the page
      const base = typeof location !== 'undefined' ? new URL(url, location.href).href : url;
      this.cues = parseVttThumbnails(text, base);
    } catch {
      // graceful degradation — no thumbnails, just timestamps
    }
  }

  hasCues(): boolean {
    return this.cues.length > 0;
  }

  getCueAt(time: number): VttCue | null {
    return this.cues.find(c => time >= c.startTime && time < c.endTime)
      ?? this.cues.find(c => time === c.endTime)
      ?? null;
  }

  /** Mount the preview inside `parent` (the progress container) so it is positioned relative to the bar. */
  mount(parent: HTMLElement): void {
    this.mountTarget = parent;
    const el = this.ensureElement();
    if (el.parentElement !== parent) parent.appendChild(el);
  }

  /**
   * Show the thumbnail for `time` above the bar at a horizontal position (0–100%).
   * `clearance` is the height (px) to keep free above the bar — normally the time/chapter tooltip.
   */
  show(time: number, leftPct: number, clearance?: number): void {
    const cue = this.getCueAt(time);
    if (!cue) {
      this.hide();
      return;
    }

    const el = this.ensureElement();
    const img = this.img!;
    if (img.src !== cue.url) img.src = cue.url;

    const width = cue.w || FULL_IMAGE_WIDTH;
    img.style.cssText = cue.w
      ? `width:${cue.w}px;height:${cue.h}px;object-fit:none;object-position:-${cue.x}px -${cue.y}px;display:block;`
      : `width:${FULL_IMAGE_WIDTH}px;height:auto;object-fit:cover;display:block;`;
    el.style.display = 'block';
    if (clearance !== undefined) el.style.bottom = `calc(100% + ${Math.round(clearance)}px)`;

    // Keep the preview inside the bar horizontally instead of overflowing at either end
    const parentWidth = el.parentElement?.clientWidth ?? 0;
    if (parentWidth > 0) {
      const half = width / 2 + 2;
      const x = Math.max(half, Math.min(parentWidth - half, (leftPct / 100) * parentWidth));
      el.style.left = `${x}px`;
    } else {
      el.style.left = `${leftPct}%`;
    }
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
  }

  destroy(): void {
    this.el?.remove();
    this.el = null;
    this.img = null;
  }

  private ensureElement(): HTMLElement {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'vp-thumb-preview';
      this.el.setAttribute('aria-hidden', 'true');
      this.img = document.createElement('img');
      this.img.className = 'vp-thumb-img';
      this.img.alt = '';
      this.el.appendChild(this.img);
      (this.mountTarget ?? this.container).appendChild(this.el);
    }
    return this.el;
  }
}

export const thumbnailPreviewStyles = `
  .vp-thumb-preview {
    position: absolute;
    bottom: calc(100% + 44px);
    left: 0;
    transform: translateX(-50%);
    pointer-events: none;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    border: 2px solid rgba(255,255,255,0.15);
    background: #000;
    display: none;
    z-index: 5;
  }
`;
