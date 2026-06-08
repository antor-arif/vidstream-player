import type { PlaylistItem, PlaylistOptions } from '../types';
import { Icons } from './Icons';

export class PlaylistManager {
  private items: PlaylistItem[];
  private opts: Required<PlaylistOptions>;
  private currentIndex: number;
  private panelEl: HTMLElement | null = null;
  private onChangeCallback: ((index: number, item: PlaylistItem) => void) | null = null;

  constructor(items: PlaylistItem[], options: PlaylistOptions = {}) {
    this.items = items;
    this.opts = {
      autoNext: options.autoNext ?? true,
      loop: options.loop ?? false,
      showPanel: options.showPanel ?? false,
      startIndex: options.startIndex ?? 0,
    };
    this.currentIndex = this.opts.startIndex;
  }

  get current(): PlaylistItem {
    return this.items[this.currentIndex];
  }

  get index(): number {
    return this.currentIndex;
  }

  get length(): number {
    return this.items.length;
  }

  hasNext(): boolean {
    if (this.opts.loop) return this.items.length > 1;
    return this.currentIndex < this.items.length - 1;
  }

  hasPrev(): boolean {
    if (this.opts.loop) return this.items.length > 1;
    return this.currentIndex > 0;
  }

  next(): PlaylistItem | null {
    if (!this.hasNext()) return null;
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    this.onChangeCallback?.(this.currentIndex, this.current);
    this.updatePanel();
    return this.current;
  }

  prev(): PlaylistItem | null {
    if (!this.hasPrev()) return null;
    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    this.onChangeCallback?.(this.currentIndex, this.current);
    this.updatePanel();
    return this.current;
  }

  goTo(index: number): PlaylistItem | null {
    if (index < 0 || index >= this.items.length) return null;
    this.currentIndex = index;
    this.onChangeCallback?.(this.currentIndex, this.current);
    this.updatePanel();
    return this.current;
  }

  onChange(cb: (index: number, item: PlaylistItem) => void): void {
    this.onChangeCallback = cb;
  }

  /** Build and return the playlist panel element. Caller handles DOM insertion. */
  buildPanel(): HTMLElement {
    if (this.panelEl) return this.panelEl;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'vp-playlist-panel';
    this.panelEl.style.display = this.opts.showPanel ? '' : 'none';
    this.renderPanel();
    return this.panelEl;
  }

  private renderPanel(): void {
    if (!this.panelEl) return;
    this.panelEl.innerHTML = `<div class="vp-playlist-header">Up Next</div>`;

    this.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `vp-playlist-item${i === this.currentIndex ? ' active' : ''}`;
      row.dataset.index = String(i);
      row.innerHTML = `
        ${item.poster ? `<img src="${item.poster}" class="vp-playlist-thumb" alt="">` : `<div class="vp-playlist-thumb vp-playlist-thumb-placeholder">${Icons.play}</div>`}
        <div class="vp-playlist-info">
          <span class="vp-playlist-title">${item.title ?? `Video ${i + 1}`}</span>
          ${item.duration ? `<span class="vp-playlist-duration">${formatDuration(item.duration)}</span>` : ''}
        </div>
      `;
      row.addEventListener('click', () => this.goTo(i));
      this.panelEl!.appendChild(row);
    });
  }

  private updatePanel(): void {
    if (!this.panelEl) return;
    const items = this.panelEl.querySelectorAll('.vp-playlist-item');
    items.forEach((el, i) => {
      el.classList.toggle('active', i === this.currentIndex);
    });
  }

  togglePanel(): void {
    if (!this.panelEl) return;
    this.panelEl.style.display = this.panelEl.style.display === 'none' ? '' : 'none';
  }

  destroy(): void {
    this.panelEl?.remove();
    this.panelEl = null;
    this.onChangeCallback = null;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const playlistStyles = `
  .vp-layout-wrapper {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    width: 100%;
  }

  /*
   * The direct flex child is the host element (<video-player> custom element),
   * not the inner .video-player-container.  We add .vp-playlist-host to the
   * host in VideoPlayer.ts so this rule targets the correct flex item.
   */
  .vp-playlist-host {
    flex: 1 1 0% !important;
    min-width: 0 !important;
    width: 0 !important;   /* flex-basis:0 + flex-grow:1 handles sizing */
    max-width: 100%;
  }

  .vp-playlist-panel {
    width: 280px;
    min-width: 280px;
    background: rgba(18,18,18,0.97);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.2) transparent;
    border-left: 1px solid rgba(255,255,255,0.08);
    /* Match the height of the player (determined by the host's aspect-ratio) */
    align-self: stretch;
  }

  @media (max-width: 640px) {
    .vp-layout-wrapper {
      flex-direction: column;
    }

    .vp-playlist-host {
      flex: none !important;
      width: 100% !important;
    }

    .vp-playlist-panel {
      width: 100%;
      min-width: 0;
      max-height: 240px;
      border-left: none;
      border-top: 1px solid rgba(255,255,255,0.08);
      align-self: auto;
    }
  }

  .vp-playlist-header {
    padding: 14px 16px 10px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255,255,255,0.5);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .vp-playlist-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.15s;
    border-left: 3px solid transparent;
  }

  .vp-playlist-item:hover {
    background: rgba(255,255,255,0.07);
  }

  .vp-playlist-item.active {
    border-left-color: var(--vp-accent-color, #e50914);
    background: rgba(255,255,255,0.05);
  }

  .vp-playlist-thumb {
    width: 72px;
    height: 42px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
    background: rgba(255,255,255,0.06);
  }

  .vp-playlist-thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.3);
  }

  .vp-playlist-thumb-placeholder svg {
    width: 18px;
    height: 18px;
  }

  .vp-playlist-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .vp-playlist-title {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #fff;
  }

  .vp-playlist-item.active .vp-playlist-title {
    color: var(--vp-accent-color, #e50914);
  }

  .vp-playlist-duration {
    font-size: 11px;
    color: rgba(255,255,255,0.45);
  }
`;
