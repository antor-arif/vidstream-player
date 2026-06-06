import type { MiniPlayerConfig } from '../types';
import { Icons } from './Icons';

export class MiniPlayer {
  private config: Required<MiniPlayerConfig>;
  private container: HTMLElement;
  private closeBtn: HTMLElement | null = null;
  private spacer: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  private onScrollBack: (() => void) | null = null;
  private wasEverInView = false;
  private isMini = false;

  // Saved inline styles to restore on detach
  private savedStyles: Record<string, string> = {};
  private readonly styleKeys = [
    'position', 'width', 'height', 'zIndex',
    'top', 'bottom', 'left', 'right',
    'borderRadius', 'boxShadow', 'overflow',
  ];

  constructor(container: HTMLElement, config: MiniPlayerConfig) {
    this.container = container;
    this.config = {
      enabled: config.enabled ?? false,
      position: config.position ?? 'bottom-right',
      width: config.width ?? 320,
    };
  }

  initialize(onScrollBack: () => void): void {
    this.onScrollBack = onScrollBack;
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.wasEverInView = true;
          if (this.isMini) this.detach();
        } else if (this.wasEverInView && !this.isMini) {
          this.attach();
        }
      },
      { threshold: 0.2 }
    );
    // Small delay so that initial layout is settled before observing
    setTimeout(() => this.observer?.observe(this.container), 200);
  }

  private attach(): void {
    if (this.isMini) return;
    this.isMini = true;

    const w = this.config.width;
    const h = Math.round(w * (9 / 16));

    // Save current container layout
    for (const key of this.styleKeys) {
      this.savedStyles[key] = (this.container.style as unknown as Record<string, string>)[key] ?? '';
    }

    // Insert spacer to hold the layout gap while container is fixed
    const rect = this.container.getBoundingClientRect();
    this.spacer = document.createElement('div');
    this.spacer.style.width = `${rect.width}px`;
    this.spacer.style.height = `${rect.height}px`;
    this.spacer.style.flexShrink = '0';
    this.spacer.style.pointerEvents = 'none';
    this.container.parentElement?.insertBefore(this.spacer, this.container);

    // Make the entire player container a fixed mini player
    this.container.style.position = 'fixed';
    this.container.style.zIndex = '9999';
    this.container.style.width = `${w}px`;
    this.container.style.height = `${h}px`;
    this.container.style.borderRadius = '8px';
    this.container.style.boxShadow = '0 8px 32px rgba(0,0,0,0.55)';
    this.container.style.overflow = 'hidden';
    this.container.style.top = '';
    this.container.style.bottom = '';
    this.container.style.left = '';
    this.container.style.right = '';

    const pos = this.config.position;
    if (pos === 'bottom-right' || pos === 'bottom-left') this.container.style.bottom = '20px';
    else this.container.style.top = '20px';
    if (pos === 'bottom-right' || pos === 'top-right') this.container.style.right = '20px';
    else this.container.style.left = '20px';

    this.container.classList.add('vp-mini-active');

    // Switch observer target: the container is now position:fixed so the browser
    // considers it always "intersecting" the viewport — watching it would cause an
    // infinite attach/detach loop. Watch the spacer instead: when it scrolls back
    // into view the user has returned to the player position, so we detach.
    this.observer?.unobserve(this.container);
    this.observer?.observe(this.spacer);

    // Add close + back controls overlay
    this.closeBtn = document.createElement('div');
    this.closeBtn.className = 'vp-mini-controls';
    this.closeBtn.innerHTML = `<button class="vp-mini-close" title="Close mini player" type="button">${Icons.close}</button>`;
    this.container.appendChild(this.closeBtn);

    this.closeBtn.querySelector('.vp-mini-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.detach(true);
    });

    this.container.addEventListener('click', this.handleContainerClick);
  }

  private handleContainerClick = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest('.vp-mini-close')) return;
    if (!this.isMini) return;
    this.onScrollBack?.();
    this.spacer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  private detach(permanent = false): void {
    if (!this.isMini) return;
    this.isMini = false;

    // Stop watching the spacer before removing it
    if (this.spacer) this.observer?.unobserve(this.spacer);

    // Restore container styles
    for (const key of this.styleKeys) {
      (this.container.style as unknown as Record<string, string>)[key] = this.savedStyles[key] ?? '';
    }

    this.container.classList.remove('vp-mini-active');
    this.container.removeEventListener('click', this.handleContainerClick);

    this.closeBtn?.remove();
    this.closeBtn = null;

    this.spacer?.remove();
    this.spacer = null;

    if (permanent) {
      this.observer?.disconnect();
    } else {
      // Re-observe the container after layout settles. The container is now
      // back in the document flow; a short delay prevents a spurious re-attach
      // before the browser has updated intersection state.
      setTimeout(() => {
        if (!this.isMini && this.observer) this.observer.observe(this.container);
      }, 200);
    }
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.isMini) this.detach(true);
  }
}

export const miniPlayerStyles = `
  .video-player-container.vp-mini-active {
    cursor: pointer;
  }

  .vp-mini-controls {
    position: absolute;
    top: 0;
    right: 0;
    padding: 6px;
    display: flex;
    gap: 4px;
    background: linear-gradient(to bottom, rgba(0,0,0,0.65), transparent);
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 100;
    pointer-events: auto;
  }

  .video-player-container.vp-mini-active:hover .vp-mini-controls {
    opacity: 1;
  }

  .vp-mini-close {
    width: 28px;
    height: 28px;
    border: none;
    background: rgba(0,0,0,0.65);
    color: #fff;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    line-height: 1;
  }

  .vp-mini-close svg {
    width: 16px;
    height: 16px;
    pointer-events: none;
  }
`;
