/**
 * Player Theme System
 *
 * This module provides the theming system for white-label branding.
 * Features:
 * - CSS variables for easy customization (defaults are zero-specificity, so stylesheets can override them)
 * - Dynamic theme application
 * - Optional logo overlay (theme.logoUrl)
 * - Mode-specific styling (OTT vs LMS)
 */

import type { PlayerTheme, PlayerMode } from '../types';

// ============================================================================
// DEFAULT THEMES
// ============================================================================

/**
 * Default dark theme (used for OTT mode)
 */
export const defaultDarkTheme: PlayerTheme = {
  primaryColor: '#ffffff',
  accentColor: '#3b82f6',
  textColor: '#ffffff',
  controlBg: 'rgba(0, 0, 0, 0.7)',
  progressColor: '#3b82f6',
  bufferColor: 'rgba(255, 255, 255, 0.3)',
  hoverColor: '#60a5fa',
  borderRadius: '8px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  iconSize: '24px',
  tooltipBg: 'rgba(0, 0, 0, 0.9)',
};


// ============================================================================
// CSS VARIABLE NAMES
// ============================================================================

const CSS_VAR_PREFIX = '--vp-';

const themeVariableMap: Record<keyof PlayerTheme, string> = {
  primaryColor: 'primary-color',
  accentColor: 'accent-color',
  textColor: 'text-color',
  controlBg: 'control-bg',
  progressColor: 'progress-color',
  bufferColor: 'buffer-color',
  hoverColor: 'hover-color',
  borderRadius: 'border-radius',
  logoUrl: 'logo-url',
  logoPosition: 'logo-position',
  tenantName: 'tenant-name',
  fontFamily: 'font-family',
  iconSize: 'icon-size',
  tooltipBg: 'tooltip-bg',
};

// ============================================================================
// THEME MANAGER
// ============================================================================

/**
 * Manages theme application for the video player
 */
export class ThemeManager {
  private container: HTMLElement;
  /** Only the values the consumer set — defaults live in the base stylesheet */
  private currentTheme: PlayerTheme;
  private mode: PlayerMode;
  private appliedVars = new Set<string>();
  private logoEl: HTMLImageElement | null = null;
  /** Elements outside the container that also need the theme vars (e.g. the playlist panel) */
  private extraTargets = new Set<HTMLElement>();

  constructor(container: HTMLElement, theme: PlayerTheme = {}, mode: PlayerMode = 'vod') {
    this.container = container;
    this.currentTheme = { ...theme };
    this.mode = mode;
  }

  /**
   * Initialize theme styling
   */
  initialize(): void {
    this.injectBaseStyles();
    this.applyTheme({});
    this.applyModeStyles(this.mode);
  }

  /**
   * Merge theme values and write them as inline CSS variables on the container.
   * Only explicitly provided values are written inline; unset values fall back to the base stylesheet
   * (declared with zero specificity), so consumer stylesheets can still override them.
   * Passing `undefined` for a key reverts it to the default.
   */
  applyTheme(theme: Partial<PlayerTheme>): void {
    this.currentTheme = { ...this.currentTheme, ...theme };
    const targets = [this.container, ...this.extraTargets];

    (Object.keys(themeVariableMap) as (keyof PlayerTheme)[]).forEach((key) => {
      const varName = `${CSS_VAR_PREFIX}${themeVariableMap[key]}`;
      const value = this.currentTheme[key];

      if (value === undefined || value === null || value === '') {
        if (this.appliedVars.has(varName)) {
          targets.forEach(el => el.style.removeProperty(varName));
          this.appliedVars.delete(varName);
        }
        return;
      }

      const cssValue = key === 'logoUrl'
        ? `url("${String(value).replace(/["\\]/g, '\\$&')}")`
        : String(value);
      targets.forEach(el => el.style.setProperty(varName, cssValue));
      this.appliedVars.add(varName);
    });

    // Apply data attribute for CSS selectors
    this.container.setAttribute('data-theme', 'custom');
    this.renderLogo();
  }

  /** Also write the theme variables onto `el` (an element rendered outside the container). */
  addTarget(el: HTMLElement): void {
    this.extraTargets.add(el);
    this.applyTheme({});
  }

  removeTarget(el: HTMLElement): void {
    if (!this.extraTargets.delete(el)) return;
    this.appliedVars.forEach(varName => el.style.removeProperty(varName));
  }

  /** Render (or remove) the logo described by theme.logoUrl / logoPosition / tenantName */
  private renderLogo(): void {
    const url = this.currentTheme.logoUrl;
    if (!url) {
      this.logoEl?.remove();
      this.logoEl = null;
      return;
    }

    if (!this.logoEl) {
      this.logoEl = document.createElement('img');
      this.logoEl.draggable = false;
      this.container.appendChild(this.logoEl);
    }
    this.logoEl.className = `vp-logo ${this.currentTheme.logoPosition === 'top-left' ? 'left' : 'right'}`;
    this.logoEl.alt = this.currentTheme.tenantName ?? '';
    if (this.logoEl.getAttribute('src') !== url) this.logoEl.src = url;
  }

  /**
   * Apply mode-specific styles
   */
  applyModeStyles(mode: PlayerMode): void {
    this.mode = mode;
    this.container.setAttribute('data-mode', mode);

    // Mode-specific adjustments
    if (mode === 'live') {
      this.container.style.setProperty(`${CSS_VAR_PREFIX}control-padding`, '12px 16px');
      this.container.style.setProperty(`${CSS_VAR_PREFIX}progress-height`, '0px');
    } else {
      this.container.style.setProperty(`${CSS_VAR_PREFIX}control-padding`, '12px 16px');
      this.container.style.setProperty(`${CSS_VAR_PREFIX}progress-height`, '4px');
    }
  }

  /**
   * Inject base CSS styles
   */
  private injectBaseStyles(): void {
    let styleEl = document.getElementById('video-player-styles') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'video-player-styles';
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = getBaseStyles();
  }

  /**
   * Get the effective theme (defaults merged with consumer overrides)
   */
  getTheme(): PlayerTheme {
    return { ...defaultDarkTheme, ...this.currentTheme };
  }

  /**
   * Get current mode
   */
  getMode(): PlayerMode {
    return this.mode;
  }

  /**
   * Generate CSS string for current theme
   */
  generateCSSVariables(): string {
    const vars: string[] = [];

    Object.entries(this.getTheme()).forEach(([key, value]) => {
      if (value !== undefined && key in themeVariableMap) {
        const varName = `${CSS_VAR_PREFIX}${themeVariableMap[key as keyof PlayerTheme]}`;
        vars.push(`  ${varName}: ${value};`);
      }
    });

    return `:root {\n${vars.join('\n')}\n}`;
  }

  /**
   * Destroy theme manager
   */
  destroy(): void {
    // Clean up CSS variables we wrote
    [...this.extraTargets].forEach(el => this.removeTarget(el));
    this.appliedVars.forEach((varName) => this.container.style.removeProperty(varName));
    this.appliedVars.clear();
    this.container.style.removeProperty(`${CSS_VAR_PREFIX}control-padding`);
    this.container.style.removeProperty(`${CSS_VAR_PREFIX}progress-height`);
    this.logoEl?.remove();
    this.logoEl = null;

    this.container.removeAttribute('data-theme');
    this.container.removeAttribute('data-mode');
  }
}

// ============================================================================
// BASE CSS STYLES
// ============================================================================

/**
 * Get base CSS styles for the player - Improved UI
 */
export function getBaseStyles(): string {
  return `
    /* =====================================================
       VIDEO PLAYER - IMPROVED UI STYLES
       ===================================================== */
    
    /* Theme defaults — :where() keeps specificity at zero so any consumer rule
       (e.g. .my-player { --vp-accent-color: red; }) overrides them. Values mirror defaultDarkTheme. */
    :where(.video-player-container) {
      --vp-primary-color: #ffffff;
      --vp-accent-color: #3b82f6;
      --vp-text-color: #ffffff;
      --vp-control-bg: rgba(0, 0, 0, 0.7);
      --vp-progress-color: #3b82f6;
      --vp-buffer-color: rgba(255, 255, 255, 0.3);
      --vp-hover-color: #60a5fa;
      --vp-border-radius: 8px;
      --vp-font-family: system-ui, -apple-system, sans-serif;
      --vp-icon-size: 24px;
      --vp-tooltip-bg: rgba(0, 0, 0, 0.9);

      /* Spec-required aliases */
      --vp-primary: var(--vp-primary-color);
      --vp-bg: var(--vp-control-bg);
      --vp-text: var(--vp-text-color);
      --vp-radius: var(--vp-border-radius);
      --vp-font: var(--vp-font-family);
      --vp-transition: 0.3s ease;
      --vp-overlay-bg: rgba(0, 0, 0, 0.85);
      --vp-progress-height: 4px;
      --vp-control-size: var(--vp-icon-size);

      /* Overridable layout defaults */
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      max-width: 100%;
      background: #000;
      font-family: var(--vp-font-family);
      color: var(--vp-text-color);
      border-radius: var(--vp-border-radius);
    }

    /* Base Container — structural rules the player depends on */
    .video-player-container {
      position: relative;
      overflow: hidden;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      container-type: inline-size;
    }

    .video-player-container *,
    .video-player-container *::before,
    .video-player-container *::after {
      box-sizing: border-box;
    }

    .video-player-container:fullscreen {
      border-radius: 0;
      aspect-ratio: auto;
      width: 100vw;
      height: 100vh;
    }

    /* Video Element */
    .video-player-container .video-player-video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }

    /* Gradient Overlays */
    .vp-gradient-top {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 100px;
      background: linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 10;
    }

    .vp-gradient-bottom {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 180px;
      background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 60%, transparent 100%);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 10;
    }

    .vp-gradient-top.visible,
    .vp-gradient-bottom.visible {
      opacity: 1;
    }

    /* Hide gradients when idle */
    .video-player-container.vp-playing.vp-idle .vp-gradient-top,
    .video-player-container.vp-playing.vp-idle .vp-gradient-bottom {
      opacity: 0 !important;
    }

    /* Show gradients on hover when idle */
    .video-player-container.vp-playing.vp-idle:hover .vp-gradient-top,
    .video-player-container.vp-playing.vp-idle:hover .vp-gradient-bottom {
      opacity: 1 !important;
    }

    /* Video Title Overlay */
    .vp-title {
      position: absolute;
      top: 16px;
      left: 16px;
      right: 80px;
      color: var(--vp-text-color);
      font-size: 15px;
      font-weight: 600;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 15;
    }

    .vp-title.visible {
      opacity: 1;
    }

    .video-player-container.vp-playing.vp-idle .vp-title {
      opacity: 0 !important;
    }

    /* On mouse-pointer devices only — touch leaves a sticky :hover that would keep the title visible */
    @media (pointer: fine) {
      .video-player-container.vp-playing.vp-idle:hover .vp-title {
        opacity: 1 !important;
      }
    }

    /* Play/Pause Ripple Animation (YouTube-like) */
    .vp-action-indicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 60;
      opacity: 0;
    }

    .vp-action-indicator.animate {
      animation: vp-action-ripple 0.5s ease-out forwards;
    }

    .vp-action-indicator-circle {
      width: 80px;
      height: 80px;
      background: var(--vp-accent-color);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    .vp-action-indicator-icon {
      width: 32px;
      height: 32px;
      color: white;
      fill: white;
    }

    @keyframes vp-action-ripple {
      0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.8);
      }
      30% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.1);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(1.3);
      }
    }

    /* Double-tap / double-click seek feedback */
    .vp-seek-feedback {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 33%;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 25;
      opacity: 0;
    }

    .vp-seek-feedback-left {
      left: 0;
      border-radius: 0 50% 50% 0 / 0 40% 40% 0;
      background: radial-gradient(ellipse at left center, rgba(255, 255, 255, 0.15) 0%, transparent 70%);
    }

    .vp-seek-feedback-right {
      right: 0;
      border-radius: 50% 0 0 50% / 40% 0 0 40%;
      background: radial-gradient(ellipse at right center, rgba(255, 255, 255, 0.15) 0%, transparent 70%);
    }

    .vp-seek-feedback.active {
      animation: vp-seek-fade 0.8s ease-out forwards;
    }

    .vp-seek-feedback-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: white;
    }

    .vp-seek-feedback-icon {
      width: 48px;
      height: 48px;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.9));
      animation: vp-seek-icon-pulse 0.3s ease-out;
    }

    .vp-seek-feedback-label {
      font-size: 16px;
      font-weight: 700;
      text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
      white-space: nowrap;
      letter-spacing: 0.5px;
    }

    @keyframes vp-seek-fade {
      0%   { opacity: 0; }
      12%  { opacity: 1; }
      65%  { opacity: 1; }
      100% { opacity: 0; }
    }

    @keyframes vp-seek-icon-pulse {
      0%   { transform: scale(0.8); }
      60%  { transform: scale(1.1); }
      100% { transform: scale(1); }
    }

    /* Poster Overlay with Big Play */
    .vp-poster-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.3);
      z-index: 30;
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }

    .vp-poster-overlay.hidden {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }

    .vp-big-play {
      width: 80px;
      height: 80px;
      background: var(--vp-accent-color);
      border: none;
      border-radius: 50%;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
    }

    .vp-big-play:hover {
      transform: scale(1.1);
      background: var(--vp-hover-color);
      box-shadow: 0 6px 40px rgba(0, 0, 0, 0.5);
    }

    .vp-big-play:active {
      transform: scale(1.05);
    }

    .vp-big-play-icon {
      width: 36px;
      height: 36px;
      margin-left: 4px;
    }

    .vp-big-play-icon svg {
      width: 100%;
      height: 100%;
    }

    /* Loading Spinner */
    .vp-loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 35;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease, visibility 0.2s ease;
    }

    .vp-loading.visible {
      opacity: 1;
      visibility: visible;
    }

    .vp-spinner {
      width: 56px;
      height: 56px;
      color: var(--vp-accent-color);
    }

    .vp-spinner svg {
      width: 100%;
      height: 100%;
    }

    /* Controls Container */
    .vp-controls {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 0 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 50;
    }

    .vp-controls.visible,
    .video-player-container.vp-dragging .vp-controls,
    .video-player-container.vp-paused .vp-controls {
      opacity: 1;
    }

    /* When video is playing and user is idle, force hide controls */
    .video-player-container.vp-playing.vp-idle .vp-controls {
      opacity: 0 !important;
      pointer-events: none;
    }

    /* Show controls on hover when idle (user activity) */
    .video-player-container.vp-playing.vp-idle:hover .vp-controls {
      opacity: 1 !important;
      pointer-events: auto;
    }

    /* Hide cursor when idle for clean viewing */
    .video-player-container.vp-playing.vp-idle {
      cursor: none;
    }

    .video-player-container.vp-playing.vp-idle:hover {
      cursor: default;
    }

    /* Progress Container */
    .vp-progress-container {
      position: relative;
      width: 100%;
      padding: 12px 0 8px;
      cursor: pointer;
    }

    /* Progress Tooltip */
    .vp-progress-tooltip {
      position: absolute;
      bottom: 100%;
      left: 0;
      transform: translateX(-50%);
      background: var(--vp-tooltip-bg);
      color: white;
      padding: 5px 10px;
      border-radius: 4px;
      white-space: nowrap;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease;
      pointer-events: none;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }

    .vp-tooltip-chapter {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }

    .vp-tooltip-time {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
    }

    .vp-progress-tooltip.visible {
      opacity: 1;
      visibility: visible;
    }

    /* Progress Bar */
    .vp-progress {
      position: relative;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      overflow: visible;
      transition: height 0.1s ease;
    }

    .vp-progress-container:hover .vp-progress,
    .video-player-container.vp-dragging .vp-progress {
      height: 6px;
    }

    .vp-progress-buffer {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: rgba(255, 255, 255, 0.4);
      border-radius: 2px;
      transition: width 0.1s ease;
    }

    .vp-progress-hover {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      pointer-events: none;
    }

    .vp-progress-filled {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: var(--vp-accent-color);
      border-radius: 2px;
    }

    .vp-progress-thumb {
      position: absolute;
      top: 50%;
      left: 0;
      width: 14px;
      height: 14px;
      background: var(--vp-accent-color);
      border-radius: 50%;
      transform: translate(-50%, -50%) scale(0);
      transition: transform 0.15s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }

    .vp-progress-container:hover .vp-progress-thumb,
    .video-player-container.vp-dragging .vp-progress-thumb {
      transform: translate(-50%, -50%) scale(1);
    }

    /* YouTube-style chapter segments */
    .vp-progress--chaptered {
      display: flex;
      align-items: center;
      gap: 3px;
      background: transparent !important;
      overflow: visible;
    }

    /* Hide the buffer and filled overlays — segment fills replace them */
    .vp-progress--chaptered .vp-progress-buffer,
    .vp-progress--chaptered .vp-progress-filled {
      display: none !important;
    }

    .vp-chapter-segment {
      position: relative;
      flex-shrink: 0;
      height: 4px;
      background: rgba(255, 255, 255, 0.28);
      border-radius: 2px;
      overflow: hidden;
      transition: height 0.1s ease, border-radius 0.1s ease;
    }

    .vp-progress-container:hover .vp-progress--chaptered .vp-chapter-segment,
    .video-player-container.vp-dragging .vp-progress--chaptered .vp-chapter-segment {
      height: 6px;
    }

    .vp-chapter-segment-buffer {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      background: rgba(255, 255, 255, 0.4);
      border-radius: 2px;
      transition: width 0.1s ease;
    }

    .vp-chapter-segment-fill {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      background: var(--vp-accent-color);
      border-radius: 2px;
    }

    /* Control Row */
    .vp-control-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .vp-control-group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .vp-control-left {
      flex: 1;
    }

    .vp-control-right {
      flex-shrink: 0;
    }

    /* Control Buttons */
    .vp-control-btn {
      background: transparent;
      border: none;
      color: var(--vp-primary-color);
      cursor: pointer;
      padding: 8px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      outline: none;
      position: relative;
    }

    .vp-control-btn:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .vp-control-btn:focus-visible {
      box-shadow: 0 0 0 2px var(--vp-accent-color);
    }

    .vp-btn-inner {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .vp-btn-inner svg {
      width: var(--vp-icon-size);
      height: var(--vp-icon-size);
    }

    /* Play Button - Slightly larger */
    .vp-btn-play .vp-btn-inner svg {
      width: 26px;
      height: 26px;
    }

    /* Speed & Quality Labels */
    .vp-speed-label,
    .vp-quality-label {
      font-size: 12px;
      font-weight: 600;
      min-width: 32px;
      text-align: center;
    }

    /* Time Display */
    .vp-time {
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      color: var(--vp-text-color);
      white-space: nowrap;
      padding: 0 8px;
      opacity: 0.9;
    }

    .vp-time-current {
      color: var(--vp-primary-color);
    }

    .vp-time-duration {
      opacity: 0.7;
    }

    /* Volume Container */
    .vp-volume-container {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .vp-volume-slider-wrapper {
      width: 0;
      overflow: hidden;
      transition: width 0.2s ease;
      height: 16px;
      display: flex;
      align-items: center;
    }

    .vp-volume-container:hover .vp-volume-slider-wrapper,
    .vp-volume-slider-wrapper:focus-within {
      width: 80px;
    }

    .vp-volume-slider {
      position: relative;
      width: 80px;
      height: 4px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
      cursor: pointer;
    }

    .vp-volume-level {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: var(--vp-accent-color);
      border-radius: 2px;
    }

    .vp-volume-thumb {
      position: absolute;
      top: 50%;
      width: 12px;
      height: 12px;
      background: white;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      pointer-events: none;
    }

    /* Dropdown Wrapper */
    .vp-dropdown-wrapper {
      position: relative;
    }

    .vp-dropdown-btn {
      position: relative;
    }

    /* Dropdown Menu - Improved positioning and responsiveness */
    .vp-dropdown-menu {
      position: absolute;
      bottom: calc(100% + 8px);
      right: 0;
      min-width: 180px;
      max-width: 280px;
      max-height: 280px;
      background: var(--vp-tooltip-bg);
      border-radius: 8px;
      padding: 8px 0;
      opacity: 0;
      visibility: hidden;
      transform: translateY(10px);
      transition: all 0.2s ease;
      z-index: 100;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      overflow-y: auto;
      overflow-x: hidden;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    .vp-dropdown-menu::-webkit-scrollbar {
      display: none;
    }

    .vp-dropdown-menu.open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .vp-dropdown-header {
      padding: 8px 16px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.5);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      margin-bottom: 4px;
    }

    .vp-dropdown-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 10px 16px;
      font-size: 14px;
      color: var(--vp-text-color);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.15s ease;
      text-align: left;
    }

    .vp-dropdown-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .vp-dropdown-item.active {
      color: var(--vp-accent-color);
    }

    .vp-dropdown-item-label {
      flex: 1;
    }

    .vp-dropdown-item-meta {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      margin-left: 8px;
    }

    .vp-dropdown-item-check {
      width: 16px;
      height: 16px;
      margin-left: 8px;
      color: var(--vp-accent-color);
    }

    .vp-dropdown-item-check svg {
      width: 100%;
      height: 100%;
    }

    .vp-dropdown-empty {
      padding: 12px 16px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5);
      text-align: center;
    }

    /* Chapter Items */
    .vp-chapter-item {
      padding: 12px 16px;
    }

    .vp-chapter-number {
      width: 24px;
      height: 24px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      margin-right: 12px;
      flex-shrink: 0;
    }

    .vp-chapter-item.active .vp-chapter-number {
      background: var(--vp-accent-color);
    }

    .vp-chapter-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .vp-chapter-title {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .vp-chapter-time {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      margin-top: 2px;
    }

    /* Live Badge */
    .vp-live .vp-time {
      display: none;
    }

    .vp-live .vp-progress-container {
      display: none;
    }

    .vp-live-badge {
      background: #ef4444;
      color: white;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 4px;
      text-transform: uppercase;
      display: none;
      align-items: center;
      gap: 6px;
      letter-spacing: 0.5px;
    }

    .vp-live .vp-live-badge {
      display: flex;
    }

    button.vp-live-badge {
      border: none;
      cursor: pointer;
      font-family: inherit;
      line-height: 1.2;
    }

    /* Behind the live edge: grey badge, click to jump back */
    .vp-live-badge.vp-live-behind {
      background: rgba(255, 255, 255, 0.2);
    }

    .vp-live-badge.vp-live-behind::before {
      background: rgba(255, 255, 255, 0.7);
      animation: none;
    }

    .vp-live-badge.vp-live-behind:hover {
      background: #ef4444;
    }

    .vp-live-badge::before {
      content: '';
      width: 8px;
      height: 8px;
      background: white;
      border-radius: 50%;
      animation: vp-pulse 1.5s ease-in-out infinite;
    }

    @keyframes vp-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Live lifecycle overlay: hasn't started / reconnecting / ended / offline */
    .vp-live-overlay {
      position: absolute;
      inset: 0;
      z-index: 40;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 16px;
      text-align: center;
      color: #fff;
      background: rgba(0, 0, 0, 0.72);
      pointer-events: none;
    }

    .vp-live-overlay[hidden] {
      display: none;
    }

    .vp-live-overlay-text {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.4;
      max-width: 420px;
    }

    .vp-live-overlay-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255, 255, 255, 0.25);
      border-top-color: var(--vp-accent-color, #ef4444);
      border-radius: 50%;
      animation: vp-live-spin 0.9s linear infinite;
    }

    .vp-live-overlay[data-state="ended"] .vp-live-overlay-spinner {
      display: none;
    }

    .vp-live-overlay[data-state="waiting"] .vp-live-overlay-spinner,
    .vp-live-overlay[data-state="offline"] .vp-live-overlay-spinner {
      animation-duration: 2.4s;
    }

    @keyframes vp-live-spin {
      to { transform: rotate(360deg); }
    }

    /* While an overlay is shown the buffering spinner would duplicate it */
    .vp-live-overlay-active .vp-loading {
      display: none;
    }

    /* Autoplay fell back to muted: "Tap to unmute" */
    .vp-unmute-pill {
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 45;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: none;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      font: 600 13px/1 system-ui, sans-serif;
      cursor: pointer;
    }

    .vp-unmute-pill:hover,
    .vp-unmute-pill:focus-visible {
      background: var(--vp-accent-color, #ef4444);
    }

    /* Responsive - Tablet */
    @media (max-width: 768px) {
      .video-player-container {
        --vp-icon-size: 20px;
      }

      .vp-controls {
        padding: 0 12px 10px;
      }

      .vp-control-row {
        gap: 4px;
      }

      .vp-control-btn {
        padding: 6px;
      }

      .vp-big-play {
        width: 64px;
        height: 64px;
      }

      .vp-big-play-icon {
        width: 28px;
        height: 28px;
      }

      .vp-time {
        font-size: 12px;
        padding: 0 4px;
      }

      .vp-speed-label,
      .vp-quality-label {
        display: none;
      }

      .vp-dropdown-menu {
        min-width: 160px;
        max-height: 200px;
      }
    }

    /* Responsive - Mobile */
    @media (max-width: 480px) {
      .video-player-container {
        --vp-icon-size: 18px;
        border-radius: 0;
      }

      .vp-controls {
        padding: 0 8px 8px;
        gap: 4px;
      }

      .vp-progress-container {
        padding: 8px 0 4px;
      }

      .vp-control-btn {
        padding: 4px;
      }

      .vp-btn-play .vp-btn-inner svg {
        width: 22px;
        height: 22px;
      }

      .vp-time {
        font-size: 11px;
      }

      .vp-big-play {
        width: 56px;
        height: 56px;
      }

      .vp-big-play-icon {
        width: 24px;
        height: 24px;
      }

      .vp-volume-slider-wrapper {
        display: none;
      }

      .vp-btn-rewind,
      .vp-btn-forward {
        display: none;
      }

      /* Hide some controls on mobile */
      .vp-dropdown-wrapper[data-dropdown="chapters"],
      .vp-dropdown-wrapper[data-dropdown="subtitles"] {
        display: none;
      }

      .vp-dropdown-menu {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        top: auto;
        min-width: 100%;
        max-width: 100%;
        max-height: 50vh;
        border-radius: 12px 12px 0 0;
        transform: translateY(100%);
      }

      .vp-dropdown-menu.open {
        transform: translateY(0);
      }
    }

    /* Fullscreen adjustments */
    .video-player-container:fullscreen {
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
    }

    .video-player-container:fullscreen .video-player-video {
      width: 100% !important;
      height: 100% !important;
      object-fit: contain;
    }

    .video-player-container:fullscreen .vp-controls {
      padding: 0 24px 20px;
    }

    /* Fullscreen idle state - hide controls (no :hover override - controlled by JS) */
    .video-player-container:fullscreen.vp-playing.vp-idle .vp-controls {
      opacity: 0 !important;
      pointer-events: none;
    }

    /* In fullscreen, show controls only via JS-controlled visible class */
    .video-player-container:fullscreen.vp-playing.vp-idle .vp-controls.visible {
      opacity: 1 !important;
      pointer-events: auto;
    }

    .video-player-container:fullscreen.vp-playing.vp-idle .vp-gradient-top,
    .video-player-container:fullscreen.vp-playing.vp-idle .vp-gradient-bottom {
      opacity: 0 !important;
    }

    .video-player-container:fullscreen.vp-playing.vp-idle .vp-gradient-top.visible,
    .video-player-container:fullscreen.vp-playing.vp-idle .vp-gradient-bottom.visible {
      opacity: 1 !important;
    }

    .video-player-container:fullscreen.vp-playing.vp-idle {
      cursor: none;
    }

    .video-player-container:fullscreen.vp-playing:not(.vp-idle) {
      cursor: default;
    }

    .video-player-container:fullscreen .vp-dropdown-menu {
      max-height: 400px;
    }

    .video-player-container:fullscreen .vp-big-play {
      width: 100px;
      height: 100px;
    }

    .video-player-container:fullscreen .vp-big-play-icon {
      width: 48px;
      height: 48px;
    }

    /* Mobile Fullscreen - Landscape Mode */
    @media (max-width: 768px) {
      .video-player-container:fullscreen {
        width: 100vw !important;
        height: 100vh !important;
      }
      
      .video-player-container:fullscreen .vp-controls {
        padding: 0 16px 12px;
      }
      
      .video-player-container:fullscreen .vp-volume-slider-wrapper {
        display: none;
      }
      
      .video-player-container:fullscreen .vp-big-play {
        width: 72px;
        height: 72px;
      }
      
      .video-player-container:fullscreen .vp-big-play-icon {
        width: 32px;
        height: 32px;
      }

      .video-player-container:fullscreen .vp-dropdown-menu {
        max-height: 60vh;
      }
    }

    /* Ultra-wide responsive for small phones */
    @media (max-width: 360px) {
      .video-player-container {
        --vp-icon-size: 16px;
      }

      .vp-control-btn {
        padding: 3px;
      }

      .vp-time {
        font-size: 10px;
      }

      .vp-progress-container {
        padding: 6px 0 2px;
      }
    }

    /* =====================================================
       CONTAINER-SIZE RESPONSIVE (JS ResizeObserver classes)
       These fire based on the player's actual pixel width,
       not the viewport — so embedded players work correctly.
       ===================================================== */

    /* Medium container: 400–560px */
    .video-player-container.vp-size-md .vp-volume-slider-wrapper,
    .video-player-container.vp-size-md .vp-btn-pip {
      display: none;
    }
    .video-player-container.vp-size-md .vp-speed-label,
    .video-player-container.vp-size-md .vp-quality-label {
      display: none;
    }
    .video-player-container.vp-size-md .vp-control-btn {
      padding: 6px;
    }

    /* Small container: 280–400px */
    .video-player-container.vp-size-sm .vp-volume-slider-wrapper,
    .video-player-container.vp-size-sm .vp-time,
    .video-player-container.vp-size-sm .vp-btn-rewind,
    .video-player-container.vp-size-sm .vp-btn-forward,
    .video-player-container.vp-size-sm .vp-btn-pip,
    .video-player-container.vp-size-sm .vp-dropdown-wrapper[data-dropdown="chapters"],
    .video-player-container.vp-size-sm .vp-dropdown-wrapper[data-dropdown="subtitles"] {
      display: none;
    }
    .video-player-container.vp-size-sm .vp-speed-label,
    .video-player-container.vp-size-sm .vp-quality-label {
      display: none;
    }
    .video-player-container.vp-size-sm .vp-controls {
      padding: 0 8px 8px;
    }
    .video-player-container.vp-size-sm .vp-control-btn {
      padding: 5px;
    }

    /* Extra-small container: < 280px */
    .video-player-container.vp-size-xs .vp-controls {
      padding: 0 4px 4px;
      gap: 2px;
    }
    .video-player-container.vp-size-xs .vp-volume-slider-wrapper,
    .video-player-container.vp-size-xs .vp-time,
    .video-player-container.vp-size-xs .vp-btn-rewind,
    .video-player-container.vp-size-xs .vp-btn-forward,
    .video-player-container.vp-size-xs .vp-btn-pip,
    .video-player-container.vp-size-xs .vp-live-badge,
    .video-player-container.vp-size-xs .vp-dropdown-wrapper[data-dropdown="chapters"],
    .video-player-container.vp-size-xs .vp-dropdown-wrapper[data-dropdown="subtitles"],
    .video-player-container.vp-size-xs .vp-dropdown-wrapper[data-dropdown="speed"],
    .video-player-container.vp-size-xs .vp-dropdown-wrapper[data-dropdown="quality"] {
      display: none;
    }
    .video-player-container.vp-size-xs .vp-control-btn {
      padding: 4px;
    }
    .video-player-container.vp-size-xs .vp-btn-play .vp-btn-inner svg {
      width: 20px;
      height: 20px;
    }

    /* Error Display */
    .vp-error {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      padding: 32px;
      background: rgba(0, 0, 0, 0.9);
      border-radius: 12px;
      max-width: 80%;
      z-index: 60;
    }

    .vp-error-icon {
      font-size: 48px;
      margin-bottom: 16px;
      color: #ef4444;
    }

    .vp-error-icon svg {
      width: 48px;
      height: 48px;
    }

    .vp-error-message {
      font-size: 16px;
      margin-bottom: 16px;
      line-height: 1.5;
    }

    .vp-error-retry {
      background: var(--vp-accent-color);
      color: white;
      border: none;
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    .vp-error-retry:hover {
      background: var(--vp-hover-color);
    }

    /* Long-press speed indicator */
    .vp-speed-feedback {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0,0,0,0.75);
      color: #fff;
      padding: 10px 20px;
      border-radius: 24px;
      font-size: 15px;
      font-weight: 700;
      pointer-events: none;
      z-index: 65;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .vp-speed-feedback svg { width: 20px; height: 20px; }
    .vp-speed-feedback.active { opacity: 1; }

    /* Volume feedback overlay */
    .vp-volume-feedback {
      position: absolute;
      top: 50%;
      right: 18%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      background: rgba(0,0,0,0.78);
      color: #fff;
      padding: 14px 18px;
      border-radius: 12px;
      pointer-events: none;
      z-index: 65;
      opacity: 0;
      transition: opacity 0.25s;
      min-width: 90px;
    }
    .vp-volume-feedback.active { opacity: 1; }
    .vp-volume-feedback-icon svg { width: 28px; height: 28px; }
    .vp-volume-feedback-bar {
      width: 80px;
      height: 4px;
      background: rgba(255,255,255,0.25);
      border-radius: 2px;
      overflow: hidden;
    }
    .vp-volume-feedback-fill {
      height: 100%;
      background: var(--vp-accent-color, #3b82f6);
      border-radius: 2px;
      transition: width 0.08s linear;
    }
    .vp-volume-feedback-text {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }

    /* Logo positioning */
    .vp-logo {
      position: absolute;
      top: 16px;
      z-index: 25;
      max-width: 100px;
      max-height: 36px;
      opacity: 0.7;
      transition: opacity 0.3s ease;
    }

    .vp-logo.left {
      left: 16px;
    }

    .vp-logo.right {
      right: 16px;
    }

    .video-player-container:hover .vp-logo {
      opacity: 0.9;
    }

    /* Responsive Controls */
    @container (max-width: 600px) {
      .vp-controls {
        padding: 0 8px 8px;
        gap: 4px;
      }
      .vp-control-btn {
        padding: 4px;
      }
      .vp-btn-inner svg {
        width: 20px !important;
        height: 20px !important;
      }
      .vp-btn-play .vp-btn-inner svg {
        width: 24px !important;
        height: 24px !important;
      }
      .vp-time {
        font-size: 11px;
        padding: 0 4px;
      }
      .vp-volume-slider, 
      .vp-volume-container:hover .vp-volume-slider-wrapper,
      .vp-volume-slider-wrapper:focus-within {
        width: 60px;
      }
      .vp-speed-label, .vp-quality-label {
        font-size: 11px;
        min-width: 28px;
      }
    }

    @container (max-width: 400px) {
      .vp-control-btn {
        padding: 2px;
      }
      .vp-btn-inner svg {
        width: 18px !important;
        height: 18px !important;
      }
      .vp-btn-play .vp-btn-inner svg {
        width: 22px !important;
        height: 22px !important;
      }
      .vp-time {
        display: none; /* Hide time on very small screens to save space */
      }
      .vp-volume-slider, 
      .vp-volume-container:hover .vp-volume-slider-wrapper,
      .vp-volume-slider-wrapper:focus-within {
        width: 40px;
      }
    }
  `;
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createThemeManager(
  container: HTMLElement,
  options: { theme?: Partial<PlayerTheme>; mode?: PlayerMode } = {}
): ThemeManager {
  const manager = new ThemeManager(container, options.theme ?? {}, options.mode ?? 'vod');
  manager.initialize();
  return manager;
}
