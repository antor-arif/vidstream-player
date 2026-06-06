/**
 * Watermark & Anti-Piracy Text Components
 * 
 * This module provides:
 * - WatermarkManager: Static logo/image/text watermark at fixed position
 * - AntiPiracyTextManager: Randomly moving text overlay to prevent screen recording
 */

import type { WatermarkConfig, WatermarkPosition, AntiPiracyTextConfig } from '../types';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPACITY = 0.5;
const DEFAULT_IMAGE_WIDTH = '50px';
const DEFAULT_FONT_SIZE = '14px';
const ANTI_PIRACY_MIN_INTERVAL = 3000;
const ANTI_PIRACY_MAX_INTERVAL = 8000;

// ============================================================================
// POSITION UTILITIES
// ============================================================================

function getPositionStyles(position: WatermarkPosition, forControls = false): Partial<CSSStyleDeclaration> {
  const margin = '16px';
  const bottomMargin = forControls ? '70px' : '16px';

  switch (position) {
    case 'top-left':
      return { top: margin, left: margin, right: 'auto', bottom: 'auto', transform: 'none' };
    case 'top-right':
      return { top: margin, right: margin, left: 'auto', bottom: 'auto', transform: 'none' };
    case 'top-center':
      return { top: margin, left: '50%', right: 'auto', bottom: 'auto', transform: 'translateX(-50%)' };
    case 'center':
      return { top: '50%', left: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' };
    case 'center-bottom':
      return { top: 'auto', left: '50%', right: 'auto', bottom: bottomMargin, transform: 'translateX(-50%)' };
    case 'bottom-left':
      return { top: 'auto', left: margin, right: 'auto', bottom: bottomMargin, transform: 'none' };
    case 'bottom-right':
      return { top: 'auto', right: margin, left: 'auto', bottom: bottomMargin, transform: 'none' };
    case 'bottom-center':
      return { top: 'auto', left: '50%', right: 'auto', bottom: bottomMargin, transform: 'translateX(-50%)' };
    default:
      return { top: margin, right: margin, left: 'auto', bottom: 'auto', transform: 'none' };
  }
}

/**
 * Get truly random position with percentage-based coordinates
 * This creates unpredictable positions that don't follow any pattern
 */
function getRandomPixelPosition(containerWidth: number, containerHeight: number, elementWidth = 100, elementHeight = 30): { top: string; left: string } {
  // Leave margins from edges (accounting for element size and controls)
  const marginX = 20;
  const marginTop = 20;
  const marginBottom = 80; // Extra for controls
  
  const maxX = containerWidth - elementWidth - marginX * 2;
  const maxY = containerHeight - elementHeight - marginTop - marginBottom;
  
  const x = marginX + Math.random() * Math.max(0, maxX);
  const y = marginTop + Math.random() * Math.max(0, maxY);
  
  return {
    top: `${y}px`,
    left: `${x}px`,
  };
}

/**
 * Get random interval between min and max
 */
function getRandomInterval(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================================
// WATERMARK MANAGER (Static Position)
// ============================================================================

/**
 * Manages logo/image/text watermark at a fixed position
 * This is for branding purposes, NOT for anti-piracy
 */
export class WatermarkManager {
  private container: HTMLElement;
  private config: WatermarkConfig;
  private element: HTMLElement | null = null;

  constructor(container: HTMLElement, config: WatermarkConfig) {
    this.container = container;
    this.config = config;
  }

  initialize(): void {
    if (!this.config.enabled) return;
    if (!this.config.imageUrl && !this.config.text) return;
    this.createWatermarkElement();
  }

  private createWatermarkElement(): void {
    this.element = document.createElement('div');
    this.element.className = `vp-watermark ${this.config.className ?? ''}`;
    this.element.setAttribute('aria-hidden', 'true');
    
    const position = this.config.position ?? 'top-right';
    const positionStyles = getPositionStyles(position, true);
    
    Object.assign(this.element.style, {
      position: 'absolute',
      zIndex: '100',
      pointerEvents: 'none',
      userSelect: 'none',
      opacity: String(this.config.opacity ?? DEFAULT_OPACITY),
      padding: '8px',
      ...positionStyles,
    });

    if (this.config.imageUrl) {
      const img = document.createElement('img');
      img.src = this.config.imageUrl;
      img.alt = '';
      img.draggable = false;
      Object.assign(img.style, {
        width: this.config.imageWidth ?? DEFAULT_IMAGE_WIDTH,
        height: this.config.imageHeight ?? 'auto',
        objectFit: 'contain',
        display: 'block',
      });
      this.element.appendChild(img);
    } else if (this.config.text) {
      Object.assign(this.element.style, {
        fontSize: DEFAULT_FONT_SIZE,
        color: 'rgba(255, 255, 255, 0.9)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textShadow: '1px 1px 3px rgba(0, 0, 0, 0.7)',
        fontWeight: '600',
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '4px',
        padding: '6px 12px',
      });
      this.element.textContent = this.config.text;
    }
    
    this.container.appendChild(this.element);
  }

  updateConfig(config: Partial<WatermarkConfig>): void {
    const needsRecreate = (config.imageUrl !== undefined || config.text !== undefined);
    this.config = { ...this.config, ...config };

    if (config.enabled !== undefined) {
      if (config.enabled && !this.element) {
        this.initialize();
        return;
      } else if (!config.enabled && this.element) {
        this.destroy();
        return;
      }
    }

    // Recreate element if content changed
    if (needsRecreate && this.element) {
      this.element.remove();
      this.element = null;
      this.initialize();
      return;
    }

    if (this.element) {
      if (config.opacity !== undefined) {
        this.element.style.opacity = String(config.opacity);
      }
      if (config.position) {
        const positionStyles = getPositionStyles(config.position, true);
        Object.assign(this.element.style, positionStyles);
      }
    }
  }

  show(): void {
    if (this.element) this.element.style.display = 'block';
  }

  hide(): void {
    if (this.element) this.element.style.display = 'none';
  }

  destroy(): void {
    this.element?.remove();
    this.element = null;
  }
}

// ============================================================================
// ANTI-PIRACY TEXT MANAGER (Random Moving Text)
// ============================================================================

/**
 * Manages anti-piracy text that moves randomly across the player
 * Uses unpredictable timing and positions to prevent screen recording
 */
export class AntiPiracyTextManager {
  private container: HTMLElement;
  private config: AntiPiracyTextConfig;
  private element: HTMLElement | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private isActive = false;

  constructor(container: HTMLElement, config: AntiPiracyTextConfig) {
    this.container = container;
    this.config = config;
  }

  initialize(): void {
    if (!this.config.enabled || !this.config.text) return;
    this.createTextElement();
    this.isActive = true;
    this.scheduleNextMove();
  }

  private createTextElement(): void {
    this.element = document.createElement('div');
    this.element.className = `vp-anti-piracy-text ${this.config.className ?? ''}`;
    this.element.setAttribute('aria-hidden', 'true');
    
    Object.assign(this.element.style, {
      position: 'absolute',
      zIndex: '101',
      pointerEvents: 'none',
      userSelect: 'none',
      opacity: String(this.config.opacity ?? 0.3),
      fontSize: this.config.fontSize ?? '12px',
      color: this.config.color ?? 'rgba(255, 255, 255, 0.8)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textShadow: '0 0 2px rgba(0, 0, 0, 0.5)',
      whiteSpace: 'nowrap',
      fontWeight: '400',
      letterSpacing: '0.5px',
      transition: 'top 0.5s ease-out, left 0.5s ease-out, opacity 0.3s ease',
    });

    this.element.textContent = this.config.text;
    this.container.appendChild(this.element);
    
    // Initial random position
    this.moveToRandomPosition();
  }

  private moveToRandomPosition(): void {
    if (!this.element || !this.container) return;
    
    const containerRect = this.container.getBoundingClientRect();
    const elementRect = this.element.getBoundingClientRect();
    
    const position = getRandomPixelPosition(
      containerRect.width,
      containerRect.height,
      elementRect.width || 100,
      elementRect.height || 20
    );
    
    // Reset all position properties first
    this.element.style.top = position.top;
    this.element.style.left = position.left;
    this.element.style.right = 'auto';
    this.element.style.bottom = 'auto';
    this.element.style.transform = 'none';
  }

  private scheduleNextMove(): void {
    if (!this.isActive) return;
    
    const minInterval = this.config.minInterval ?? ANTI_PIRACY_MIN_INTERVAL;
    const maxInterval = this.config.maxInterval ?? ANTI_PIRACY_MAX_INTERVAL;
    const interval = getRandomInterval(minInterval, maxInterval);
    
    this.moveTimer = setTimeout(() => {
      this.moveToRandomPosition();
      this.scheduleNextMove();
    }, interval);
  }

  updateConfig(config: Partial<AntiPiracyTextConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.enabled !== undefined) {
      if (config.enabled && !this.element) {
        this.initialize();
        return;
      } else if (!config.enabled && this.element) {
        this.destroy();
        return;
      }
    }

    if (this.element) {
      if (config.text !== undefined) {
        this.element.textContent = config.text;
      }
      if (config.opacity !== undefined) {
        this.element.style.opacity = String(config.opacity);
      }
      if (config.fontSize) {
        this.element.style.fontSize = config.fontSize;
      }
      if (config.color) {
        this.element.style.color = config.color;
      }
    }
  }

  show(): void {
    if (this.element) {
      this.element.style.display = 'block';
      if (!this.isActive) {
        this.isActive = true;
        this.scheduleNextMove();
      }
    }
  }

  hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
    }
    this.stopMoving();
  }

  private stopMoving(): void {
    this.isActive = false;
    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
  }

  destroy(): void {
    this.stopMoving();
    this.element?.remove();
    this.element = null;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createWatermark(container: HTMLElement, config: WatermarkConfig): WatermarkManager {
  const manager = new WatermarkManager(container, config);
  manager.initialize();
  return manager;
}

export function createAntiPiracyText(container: HTMLElement, config: AntiPiracyTextConfig): AntiPiracyTextManager {
  const manager = new AntiPiracyTextManager(container, config);
  manager.initialize();
  return manager;
}

// ============================================================================
// CSS STYLES
// ============================================================================

export function getWatermarkStyles(): string {
  return `
    .vp-watermark {
      position: absolute;
      z-index: 100;
      pointer-events: none;
      user-select: none;
    }
    
    .vp-watermark img {
      display: block;
      max-width: 60px;
      height: auto;
    }
    
    .vp-anti-piracy-text {
      position: absolute;
      z-index: 101;
      pointer-events: none;
      user-select: none;
    }

    /* Responsive watermark for mobile */
    @media (max-width: 480px) {
      .vp-watermark {
        transform: scale(0.8);
        transform-origin: top right;
      }
      
      .vp-watermark img {
        max-width: 40px;
      }
      
      .vp-anti-piracy-text {
        font-size: 10px !important;
      }
    }
  `;
}
