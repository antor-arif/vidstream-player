// VTT sprite-sheet thumbnail preview for the progress bar

export interface VttCue {
  startTime: number;
  endTime: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseTime(str: string): number {
  const parts = str.trim().split(':').map(parseFloat);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

export function parseVttThumbnails(text: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timingLine = lines.find(l => l.includes('-->'));
    if (!timingLine) continue;

    const [startStr, endStr] = timingLine.split('-->');
    const startTime = parseTime(startStr);
    const endTime = parseTime(endStr.split(' ')[0]); // strip position hints

    const timingIdx = lines.indexOf(timingLine);
    const urlLine = lines[timingIdx + 1]?.trim();
    if (!urlLine) continue;

    const match = urlLine.match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
    if (match) {
      cues.push({
        startTime,
        endTime,
        url: urlLine.split('#')[0],
        x: parseInt(match[1]),
        y: parseInt(match[2]),
        w: parseInt(match[3]),
        h: parseInt(match[4]),
      });
    }
  }

  return cues;
}

export class ThumbnailPreview {
  private cues: VttCue[] = [];
  private el: HTMLElement | null = null;
  private img: HTMLImageElement | null = null;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async load(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const text = await res.text();
      this.cues = parseVttThumbnails(text);
    } catch {
      // graceful degradation — no thumbnails, just timestamps
    }
  }

  hasCues(): boolean {
    return this.cues.length > 0;
  }

  getCueAt(time: number): VttCue | null {
    return this.cues.find(c => time >= c.startTime && time <= c.endTime) ?? null;
  }

  /** Show the thumbnail above the tooltip at a given horizontal position (0–100%). */
  show(time: number, leftPct: number): void {
    const cue = this.getCueAt(time);
    if (!cue) {
      this.hide();
      return;
    }

    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'vp-thumb-preview';
      this.img = document.createElement('img');
      this.img.className = 'vp-thumb-img';
      this.el.appendChild(this.img);
      this.container.appendChild(this.el);
    }

    const img = this.img!;
    if (img.src !== cue.url) img.src = cue.url;
    img.style.cssText = `
      width: ${cue.w}px;
      height: ${cue.h}px;
      object-fit: none;
      object-position: -${cue.x}px -${cue.y}px;
      display: block;
    `;

    this.el.style.display = 'block';
    this.el.style.left = `${leftPct}%`;
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
  }

  destroy(): void {
    this.el?.remove();
    this.el = null;
    this.img = null;
  }
}

export const thumbnailPreviewStyles = `
  .vp-thumb-preview {
    position: absolute;
    bottom: calc(100% + 36px);
    transform: translateX(-50%);
    pointer-events: none;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    border: 2px solid rgba(255,255,255,0.15);
    display: none;
  }
`;
