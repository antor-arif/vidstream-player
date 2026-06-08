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
        <div class="vp-playlist-item-thumb-wrapper">
          ${item.poster ? `<img src="${item.poster}" class="vp-playlist-thumb" alt="">` : `<div class="vp-playlist-thumb-placeholder">${Icons.play}</div>`}
          <div class="vp-playlist-now-playing">
            <div class="vp-equalizer-bar"></div><div class="vp-equalizer-bar"></div><div class="vp-equalizer-bar"></div>
          </div>
        </div>
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
    border-radius: var(--vp-radius, 8px);
    overflow: hidden;
    background: #000;
  }

  .vp-playlist-host {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    max-width: 100%;
  }

  .vp-playlist-panel {
    width: 320px;
    min-width: 320px;
    background: rgba(18, 18, 20, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
    border-left: 1px solid rgba(255, 255, 255, 0.05);
    align-self: stretch;
    display: flex;
    flex-direction: column;
  }

  .vp-playlist-panel::-webkit-scrollbar { width: 6px; }
  .vp-playlist-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
  .vp-playlist-panel::-webkit-scrollbar-track { background: transparent; }

  @media (max-width: 900px) {
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
      max-height: 300px;
      border-left: none;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      align-self: auto;
    }
  }

  .vp-playlist-header {
    padding: 16px 20px 12px;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: rgba(255, 255, 255, 0.8);
    background: linear-gradient(to bottom, rgba(18,18,20,0.95) 0%, rgba(18,18,20,0.8) 100%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(10px);
  }

  .vp-playlist-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    border-left: 3px solid transparent;
  }

  .vp-playlist-item::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 20px;
    right: 20px;
    height: 1px;
    background: rgba(255, 255, 255, 0.03);
  }
  .vp-playlist-item:last-child::after { display: none; }

  .vp-playlist-item:hover {
    background: rgba(255, 255, 255, 0.04);
    padding-left: 24px;
  }

  .vp-playlist-item.active {
    background: rgba(255, 255, 255, 0.06);
    border-left-color: var(--vp-accent-color, #e50914);
  }

  .vp-playlist-item-thumb-wrapper {
    position: relative;
    width: 80px;
    height: 45px;
    flex-shrink: 0;
    border-radius: 4px;
    overflow: hidden;
    background: #111;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .vp-playlist-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
  }
  
  .vp-playlist-item:hover .vp-playlist-thumb {
    transform: scale(1.05);
  }

  .vp-playlist-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.2);
    background: #111;
  }

  .vp-playlist-thumb-placeholder svg {
    width: 20px;
    height: 20px;
  }

  .vp-playlist-now-playing {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .vp-playlist-item.active .vp-playlist-now-playing {
    opacity: 1;
  }

  .vp-equalizer-bar {
    width: 3px;
    height: 12px;
    background: var(--vp-accent-color, #e50914);
    border-radius: 2px;
    animation: vp-eq 1s ease-in-out infinite alternate;
  }

  .vp-equalizer-bar:nth-child(2) { animation-delay: 0.2s; }
  .vp-equalizer-bar:nth-child(3) { animation-delay: 0.4s; }

  @keyframes vp-eq {
    0% { height: 4px; }
    100% { height: 16px; }
  }

  .vp-playlist-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .vp-playlist-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    color: rgba(255, 255, 255, 0.9);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.2s;
  }

  .vp-playlist-item.active .vp-playlist-title {
    color: var(--vp-accent-color, #e50914);
  }

  .vp-playlist-duration {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.4);
    background: rgba(0, 0, 0, 0.4);
    padding: 2px 6px;
    border-radius: 4px;
    align-self: flex-start;
  }
`;
