/**
 * Player Controls Component
 *
 * Control bar, progress bar with chapter segments, dropdown menus (speed / quality /
 * subtitles / chapters), keyboard shortcuts, touch gestures and auto-hide behaviour.
 * Talks to the player only through ControlsCallbacks.
 */

import type { ControlsConfig, PlayerState, QualityLevel, SubtitleTrack, Chapter, GesturesConfig } from '../types';
import { Icons } from './Icons';
import { ThumbnailPreview } from './ThumbnailPreview';

// ============================================================================
// DEFAULT CONTROLS CONFIG
// ============================================================================

export const defaultControlsConfig: Required<ControlsConfig> = {
  playPause: true,
  seekBar: true,
  progress: true,
  currentTime: true,
  duration: true,
  volume: true,
  mute: true,
  playbackSpeed: true,
  fullscreen: true,
  pip: true,
  subtitles: true,
  quality: true,
  qualitySelector: true,
  forward: true,
  rewind: true,
  liveIndicator: true,
  settings: true,
  chapters: true,
  seekDuration: 10,
  playlist: true,
  stats: false,
};

// ============================================================================
// CONTROLS MANAGER
// ============================================================================

export interface ControlsCallbacks {
  onTogglePlay: () => void;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onFullscreenToggle: () => void;
  onPipToggle: () => void;
  onQualityChange: (quality: QualityLevel | 'auto') => void;
  onSubtitleChange: (track: SubtitleTrack | null) => void;
  onForward: () => void;
  onRewind: () => void;
  onChapterSeek?: (chapter: Chapter) => void;
  onPlaylistNext?: () => void;
  onPlaylistPrev?: () => void;
  /** Relative seek in seconds (double-tap gestures). Falls back to onForward/onRewind when absent. */
  onSeekBy?: (seconds: number) => void;
  /** LIVE badge clicked — jump to the live edge */
  onGoLive?: () => void;
  /** `i` key: toggle the statistics overlay (only when controls.stats is enabled) */
  onToggleStats?: () => void;
}

export interface ControlsOptions {
  /** Keyboard shortcuts (space/k, arrows, f, m, c). Default: true */
  keyboardShortcuts?: boolean;
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Manages video player controls
 */
export class ControlsManager {
  /** Controls hide after this long without input: longer after touch (no hover to bring them back) */
  static readonly HIDE_AFTER_MOUSE_MS = 3000;
  static readonly HIDE_AFTER_TOUCH_MS = 5000;
  /** Hidden controls stay tappable this long (0.3 s fade + grace) */
  static readonly IDLE_GRACE_MS = 700;

  private container: HTMLElement;
  private config: Required<ControlsConfig>;
  private callbacks: ControlsCallbacks;
  private controlsElement: HTMLElement | null = null;
  private progressContainer: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressFilled: HTMLElement | null = null;
  private progressBuffer: HTMLElement | null = null;
  private progressThumb: HTMLElement | null = null;
  private progressHover: HTMLElement | null = null;
  private progressTooltip: HTMLElement | null = null;
  private chapterMarkers: HTMLElement[] = [];
  private chapterSegments: HTMLElement[] = [];
  private volumeSlider: HTMLElement | null = null;
  private volumeLevel: HTMLElement | null = null;
  private timeDisplay: HTMLElement | null = null;
  private playPauseBtn: HTMLElement | null = null;
  private muteBtn: HTMLElement | null = null;
  private fullscreenBtn: HTMLElement | null = null;
  private pipBtn: HTMLElement | null = null;
  private speedBtn: HTMLElement | null = null;
  private qualityBtn: HTMLElement | null = null;
  /** Live stream: seeking gestures/keys are disabled (only "go live") */
  private isLive = false;
  private subtitlesBtn: HTMLElement | null = null;
  private chaptersBtn: HTMLElement | null = null;
  private activeDropdown: HTMLElement | null = null;
  private posterOverlay: HTMLElement | null = null;
  private bigPlayBtn: HTMLElement | null = null;
  private loadingIndicator: HTMLElement | null = null;
  private gradientTop: HTMLElement | null = null;
  private gradientBottom: HTMLElement | null = null;
  private actionIndicator: HTMLElement | null = null;
  private titleElement: HTMLElement | null = null;

  private currentState: PlayerState | null = null;
  private lastKnownDuration: number = 0;
  private isDraggingProgress = false;
  private isDraggingVolume = false;
  private progressMouseDownTime = 0;
  private hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Hidden controls keep taking taps for a moment (fade-out + grace) before pointer-events go off */
  private idleSettleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last pointer input was touch: controls stay longer (no hover to bring them back) */
  private lastInputTouch = false;
  private isControlsVisible = true;
  private isInitialPlay = true;
  private lastActionAnimationTime = 0;
  private lastTapTime = 0;
  private lastTapZone: 'left' | 'center' | 'right' | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private seekFeedbackEl: { left: HTMLElement | null; right: HTMLElement | null } = { left: null, right: null };
  private seekFeedbackTimer: { left: ReturnType<typeof setTimeout> | null; right: ReturnType<typeof setTimeout> | null } = { left: null, right: null };
  private seekFeedbackCount: { left: number; right: number } = { left: 0, right: 0 };

  // Gesture state
  private gesturesConfig: GesturesConfig = {};
  private swipeStartY = 0;
  private swipeStartX = 0;
  private swipeActive = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private isLongPressActive = false;
  private savedSpeedBeforeLongPress = 1;
  private volumeFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  // Thumbnail preview
  private thumbnailPreview: ThumbnailPreview | null = null;

  // Live
  private liveBadge: HTMLElement | null = null;

  // Playlist buttons
  private prevBtn: HTMLElement | null = null;
  private nextBtn: HTMLElement | null = null;

  // Container size observer
  private sizeObserver: ResizeObserver | null = null;

  // Every listener is registered with this signal so destroy() removes them all
  private listeners = new AbortController();
  private keyboardShortcuts = true;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private speedFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  // Data
  private qualityLevels: QualityLevel[] = [];
  private subtitleTracks: SubtitleTrack[] = [];
  private chapters: Chapter[] = [];
  private currentSpeed = 1;
  private currentQuality: QualityLevel | null = null;
  private currentSubtitle: SubtitleTrack | null = null;
  private showAutoQuality = true;

  constructor(
    container: HTMLElement,
    config: ControlsConfig,
    callbacks: ControlsCallbacks,
    gesturesConfig?: GesturesConfig,
    options: ControlsOptions = {}
  ) {
    this.container = container;
    this.config = { ...defaultControlsConfig, ...config };
    this.callbacks = callbacks;
    if (gesturesConfig) this.gesturesConfig = gesturesConfig;
    this.keyboardShortcuts = options.keyboardShortcuts !== false;
  }

  /** Shorthand for addEventListener bound to this manager's lifetime */
  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    options: AddEventListenerOptions = {}
  ): void {
    target.addEventListener(type, handler as EventListener, { ...options, signal: this.listeners.signal });
  }

  /**
   * Initialize controls
   */
  initialize(): void {
    this.createGradients();
    this.createTitleElement();
    this.createPosterOverlay();
    this.createActionIndicator();
    this.createControls();
    this.createLoadingIndicator();
    this.bindEvents();
    this.bindGlobalEvents();

    // Show controls initially
    this.showControls();

    // Container-size responsive classes
    this.sizeObserver = new ResizeObserver(([entry]) => {
      this.updateSizeClass(entry.contentRect.width);
    });
    this.sizeObserver.observe(this.container);
    this.updateSizeClass(this.container.getBoundingClientRect().width);
  }

  private updateSizeClass(width: number): void {
    this.container.classList.remove('vp-size-xs', 'vp-size-sm', 'vp-size-md', 'vp-size-lg');
    if (width < 280) this.container.classList.add('vp-size-xs');
    else if (width < 400) this.container.classList.add('vp-size-sm');
    else if (width < 560) this.container.classList.add('vp-size-md');
    else if (width < 720) this.container.classList.add('vp-size-lg');
  }

  private createTitleElement(): void {
    this.titleElement = document.createElement('div');
    this.titleElement.className = 'vp-title';
    this.container.appendChild(this.titleElement);
  }

  /**
   * Create action indicator for play/pause animation
   */
  private createActionIndicator(): void {
    this.actionIndicator = document.createElement('div');
    this.actionIndicator.className = 'vp-action-indicator';
    this.actionIndicator.innerHTML = `
      <div class="vp-action-indicator-circle">
        <div class="vp-action-indicator-icon">${Icons.play}</div>
      </div>
    `;
    this.container.appendChild(this.actionIndicator);
  }

  /**
   * Show play/pause action animation (YouTube-like)
   */
  showActionAnimation(isPlaying: boolean): void {
    if (!this.actionIndicator) return;
    
    // Debounce to prevent rapid animations
    const now = Date.now();
    if (now - this.lastActionAnimationTime < 300) return;
    this.lastActionAnimationTime = now;
    
    // Update icon
    const iconEl = this.actionIndicator.querySelector('.vp-action-indicator-icon');
    if (iconEl) {
      iconEl.innerHTML = isPlaying ? Icons.play : Icons.pause;
    }
    
    // Remove previous animation class and force reflow
    this.actionIndicator.classList.remove('animate');
    void this.actionIndicator.offsetWidth; // Force reflow
    
    // Add animation class
    this.actionIndicator.classList.add('animate');
    
    // Remove class after animation completes
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.actionTimer = setTimeout(() => {
      this.actionTimer = null;
      this.actionIndicator?.classList.remove('animate');
    }, 500);
  }

  /**
   * Show seek feedback with accumulated count — multiple rapid seeks stack up like YouTube.
   * Left shows "-Xs", right shows "+Xs". Resets the opposite side on direction change.
   */
  private showSeekFeedback(direction: 'left' | 'right', secs: number = this.config.seekDuration ?? 10): void {
    const opposite = direction === 'left' ? 'right' : 'left';

    // Reset opposite side counter
    this.seekFeedbackCount[opposite] = 0;

    // Accumulate taps on this side
    this.seekFeedbackCount[direction]++;
    const totalSecs = this.seekFeedbackCount[direction] * secs;
    const label = direction === 'right' ? `+${totalSecs} sec` : `-${totalSecs} sec`;
    const icon = direction === 'left' ? Icons.rewind10 : Icons.forward10;

    if (this.seekFeedbackEl[direction]) {
      // Update existing element — reset animation and update label
      const labelEl = this.seekFeedbackEl[direction]!.querySelector('.vp-seek-feedback-label') as HTMLElement;
      if (labelEl) labelEl.textContent = label;
      this.seekFeedbackEl[direction]!.classList.remove('active');
      void this.seekFeedbackEl[direction]!.offsetWidth; // force reflow to restart animation
      this.seekFeedbackEl[direction]!.classList.add('active');
      if (this.seekFeedbackTimer[direction]) clearTimeout(this.seekFeedbackTimer[direction]!);
    } else {
      const el = document.createElement('div');
      el.className = `vp-seek-feedback vp-seek-feedback-${direction}`;
      el.innerHTML = `
        <div class="vp-seek-feedback-inner">
          <div class="vp-seek-feedback-icon">${icon}</div>
          <span class="vp-seek-feedback-label">${label}</span>
        </div>
      `;
      this.container.appendChild(el);
      this.seekFeedbackEl[direction] = el;
      requestAnimationFrame(() => el.classList.add('active'));
    }

    this.seekFeedbackTimer[direction] = setTimeout(() => {
      this.seekFeedbackEl[direction]?.remove();
      this.seekFeedbackEl[direction] = null;
      this.seekFeedbackCount[direction] = 0;
      this.seekFeedbackTimer[direction] = null;
    }, 800);
  }

  private showSpeedFeedback(speed: number): void {
    const existing = this.container.querySelector('.vp-speed-feedback') as HTMLElement | null;
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'vp-speed-feedback';
    el.innerHTML = `<span>${Icons.speed}</span><span>${Number(speed)}x</span>`;
    this.container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('active'));
    if (this.speedFeedbackTimer) clearTimeout(this.speedFeedbackTimer);
    this.speedFeedbackTimer = setTimeout(() => {
      this.speedFeedbackTimer = null;
      el.remove();
    }, 1500);
  }

  private showVolumeFeedback(volume: number, muted = false): void {
    if (this.volumeFeedbackTimer) {
      clearTimeout(this.volumeFeedbackTimer);
      this.volumeFeedbackTimer = null;
    }

    let el = this.container.querySelector('.vp-volume-feedback') as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'vp-volume-feedback';
      this.container.appendChild(el);
    }

    const pct = muted ? 0 : Math.round(volume * 100);
    const icon = (muted || volume === 0) ? Icons.volumeMute
      : volume < 0.5 ? Icons.volumeLow
      : Icons.volumeHigh;

    el.innerHTML = `
      <span class="vp-volume-feedback-icon">${icon}</span>
      <div class="vp-volume-feedback-bar">
        <div class="vp-volume-feedback-fill" style="width:${pct}%"></div>
      </div>
      <span class="vp-volume-feedback-text">${muted ? 'Muted' : pct + '%'}</span>
    `;

    el.classList.add('active');

    this.volumeFeedbackTimer = setTimeout(() => {
      el?.classList.remove('active');
      this.volumeFeedbackTimer = null;
    }, 1500);
  }

  /**
   * Create gradient overlays for better visibility
   */
  private createGradients(): void {
    this.gradientTop = document.createElement('div');
    this.gradientTop.className = 'vp-gradient-top';
    this.container.appendChild(this.gradientTop);

    this.gradientBottom = document.createElement('div');
    this.gradientBottom.className = 'vp-gradient-bottom';
    this.container.appendChild(this.gradientBottom);
  }

  /**
   * Create poster overlay with big play button
   */
  private createPosterOverlay(): void {
    this.posterOverlay = document.createElement('div');
    this.posterOverlay.className = 'vp-poster-overlay';
    
    this.bigPlayBtn = document.createElement('button');
    (this.bigPlayBtn as HTMLButtonElement).type = 'button';
    this.bigPlayBtn.className = 'vp-big-play';
    this.bigPlayBtn.innerHTML = `
      <div class="vp-big-play-icon">
        ${Icons.play}
      </div>
    `;
    this.bigPlayBtn.setAttribute('aria-label', 'Play video');
    
    this.posterOverlay.appendChild(this.bigPlayBtn);
    this.container.appendChild(this.posterOverlay);
  }

  /**
   * Create controls UI
   */
  private createControls(): void {
    this.controlsElement = document.createElement('div');
    this.controlsElement.className = 'vp-controls';
    // Force visible on creation
    this.controlsElement.classList.add('visible');
    
    // Progress container (above control buttons). `progress` is an alias of `seekBar`.
    if (this.config.seekBar && this.config.progress) {
      this.controlsElement.appendChild(this.createProgressBar());
    }

    // Control buttons row
    const controlRow = document.createElement('div');
    controlRow.className = 'vp-control-row';

    // Left group
    const leftGroup = document.createElement('div');
    leftGroup.className = 'vp-control-group vp-control-left';

    // Playlist prev button — hidden until playlist is set
    if (this.config.playlist) {
      this.prevBtn = this.createButton('prev', 'Previous', () => this.callbacks.onPlaylistPrev?.());
      this.prevBtn.classList.add('vp-btn-prev');
      this.prevBtn.style.display = 'none';
      leftGroup.appendChild(this.prevBtn);
    }

    // Play/Pause button
    if (this.config.playPause) {
      this.playPauseBtn = this.createButton('play', 'Play', () => {
        this.callbacks.onTogglePlay();
      });
      this.playPauseBtn.classList.add('vp-btn-play');
      leftGroup.appendChild(this.playPauseBtn);
    }

    // Playlist next button — hidden until playlist is set
    if (this.config.playlist) {
      this.nextBtn = this.createButton('next', 'Next', () => this.callbacks.onPlaylistNext?.());
      this.nextBtn.classList.add('vp-btn-next');
      this.nextBtn.style.display = 'none';
      leftGroup.appendChild(this.nextBtn);
    }

    // Rewind button
    if (this.config.rewind) {
      const rewindBtn = this.createButton('rewind10', `Rewind ${this.config.seekDuration}s`, () => this.callbacks.onRewind());
      rewindBtn.classList.add('vp-btn-rewind');
      leftGroup.appendChild(rewindBtn);
    }

    // Forward button
    if (this.config.forward) {
      const forwardBtn = this.createButton('forward10', `Forward ${this.config.seekDuration}s`, () => this.callbacks.onForward());
      forwardBtn.classList.add('vp-btn-forward');
      leftGroup.appendChild(forwardBtn);
    }

    // Volume control
    if (this.config.volume || this.config.mute) {
      leftGroup.appendChild(this.createVolumeControl());
    }

    // Time display
    if (this.config.currentTime || this.config.duration) {
      this.timeDisplay = document.createElement('div');
      this.timeDisplay.className = 'vp-time';
      this.timeDisplay.innerHTML = '<span class="vp-time-current">0:00</span> / <span class="vp-time-duration">0:00</span>';
      leftGroup.appendChild(this.timeDisplay);
    }

    // Live badge (shown for live streams)
    // Visibility comes from CSS (.vp-live .vp-live-badge); an inline display would override it.
    // Clicking it jumps back to the live edge when playback has fallen behind.
    if (this.config.liveIndicator) {
      const liveBadge = document.createElement('button');
      liveBadge.type = 'button';
      liveBadge.className = 'vp-live-badge';
      liveBadge.textContent = 'LIVE';
      liveBadge.setAttribute('aria-label', 'Live');
      liveBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onGoLive?.();
      });
      this.liveBadge = liveBadge;
      leftGroup.appendChild(liveBadge);
    }

    controlRow.appendChild(leftGroup);

    // Right group
    const rightGroup = document.createElement('div');
    rightGroup.className = 'vp-control-group vp-control-right';

    // Chapters button — hidden until chapters are provided via updateChapters()
    if (this.config.chapters) {
      this.chaptersBtn = this.createDropdownButton('chapters', 'Chapters', 'chapters');
      this.chaptersBtn.style.display = 'none';
      rightGroup.appendChild(this.chaptersBtn);
    }

    // Speed button with current speed display
    if (this.config.playbackSpeed) {
      this.speedBtn = this.createDropdownButton('speed', 'Playback Speed', 'speed');
      this.speedBtn.classList.add('vp-btn-speed');
      const speedLabel = document.createElement('span');
      speedLabel.className = 'vp-speed-label';
      speedLabel.textContent = '1x';
      this.speedBtn.querySelector('.vp-btn-inner')?.appendChild(speedLabel);
      rightGroup.appendChild(this.speedBtn);
    }

    // Subtitles button — hidden until tracks are provided via updateSubtitles()
    if (this.config.subtitles) {
      this.subtitlesBtn = this.createDropdownButton('subtitles', 'Subtitles', 'subtitles');
      this.subtitlesBtn.style.display = 'none';
      rightGroup.appendChild(this.subtitlesBtn);
    }

    // Quality button — accept both `quality` and `qualitySelector`
    if (this.config.qualitySelector || this.config.quality) {
      this.qualityBtn = this.createDropdownButton('settings', 'Quality', 'quality');
      this.qualityBtn.classList.add('vp-btn-quality');
      const qualityLabel = document.createElement('span');
      qualityLabel.className = 'vp-quality-label';
      qualityLabel.textContent = 'Auto';
      this.qualityBtn.querySelector('.vp-btn-inner')?.appendChild(qualityLabel);
      rightGroup.appendChild(this.qualityBtn);
    }

    // PiP button
    if (this.config.pip && document.pictureInPictureEnabled) {
      this.pipBtn = this.createButton('pip', 'Picture-in-Picture', () => {
        this.callbacks.onPipToggle();
      });
      this.pipBtn.classList.add('vp-btn-pip');
      rightGroup.appendChild(this.pipBtn);
    }

    // Fullscreen button
    if (this.config.fullscreen) {
      this.fullscreenBtn = this.createButton('fullscreen', 'Fullscreen', () => this.callbacks.onFullscreenToggle());
      this.fullscreenBtn.classList.add('vp-btn-fullscreen');
      rightGroup.appendChild(this.fullscreenBtn);
    }

    controlRow.appendChild(rightGroup);
    this.controlsElement.appendChild(controlRow);

    this.container.appendChild(this.controlsElement);
  }

  /**
   * Create progress bar with chapter markers
   */
  private createProgressBar(): HTMLElement {
    this.progressContainer = document.createElement('div');
    this.progressContainer.className = 'vp-progress-container';

    // Tooltip for time preview
    this.progressTooltip = document.createElement('div');
    this.progressTooltip.className = 'vp-progress-tooltip';
    this.progressTooltip.textContent = '0:00';
    this.progressContainer.appendChild(this.progressTooltip);

    // Progress bar track
    this.progressBar = document.createElement('div');
    this.progressBar.className = 'vp-progress';
    this.progressBar.setAttribute('role', 'slider');
    this.progressBar.setAttribute('aria-label', 'Video progress');
    this.progressBar.setAttribute('aria-valuenow', '0');
    this.progressBar.setAttribute('aria-valuemin', '0');
    this.progressBar.setAttribute('aria-valuemax', '100');
    this.progressBar.setAttribute('aria-valuetext', '0:00 of 0:00');
    this.progressBar.tabIndex = 0;

    // Buffer progress
    this.progressBuffer = document.createElement('div');
    this.progressBuffer.className = 'vp-progress-buffer';
    this.progressBar.appendChild(this.progressBuffer);

    // Hover preview
    this.progressHover = document.createElement('div');
    this.progressHover.className = 'vp-progress-hover';
    this.progressBar.appendChild(this.progressHover);

    // Played progress
    this.progressFilled = document.createElement('div');
    this.progressFilled.className = 'vp-progress-filled';
    this.progressBar.appendChild(this.progressFilled);

    // Scrubber thumb
    this.progressThumb = document.createElement('div');
    this.progressThumb.className = 'vp-progress-thumb';
    this.progressBar.appendChild(this.progressThumb);

    this.progressContainer.appendChild(this.progressBar);

    return this.progressContainer;
  }

  /**
   * Create volume control
   */
  private createVolumeControl(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'vp-volume-container';

    // Mute button
    if (this.config.mute) {
      this.muteBtn = this.createButton('volumeHigh', 'Mute', () => this.callbacks.onMuteToggle());
      this.muteBtn.classList.add('vp-btn-volume');
      container.appendChild(this.muteBtn);
    }

    // Volume slider
    if (this.config.volume) {
      const sliderWrapper = document.createElement('div');
      sliderWrapper.className = 'vp-volume-slider-wrapper';

      this.volumeSlider = document.createElement('div');
      this.volumeSlider.className = 'vp-volume-slider';
      this.volumeSlider.setAttribute('role', 'slider');
      this.volumeSlider.setAttribute('aria-label', 'Volume');

      this.volumeLevel = document.createElement('div');
      this.volumeLevel.className = 'vp-volume-level';
      this.volumeLevel.style.width = '100%';
      this.volumeSlider.appendChild(this.volumeLevel);

      const volumeThumb = document.createElement('div');
      volumeThumb.className = 'vp-volume-thumb';
      this.volumeSlider.appendChild(volumeThumb);

      sliderWrapper.appendChild(this.volumeSlider);
      container.appendChild(sliderWrapper);
    }

    return container;
  }

  /**
   * Create control button
   */
  private createButton(icon: keyof typeof Icons, label: string, onClick: () => void): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vp-control-btn';
    button.innerHTML = `<span class="vp-btn-inner">${Icons[icon]}</span>`;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    });

    return button;
  }

  /**
   * Create button with dropdown
   */
  private createDropdownButton(icon: keyof typeof Icons, label: string, dropdownType: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'vp-dropdown-wrapper';
    wrapper.setAttribute('data-dropdown', dropdownType);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vp-control-btn vp-dropdown-btn';
    button.innerHTML = `<span class="vp-btn-inner">${Icons[icon]}</span>`;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-expanded', 'false');
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.toggleDropdown(wrapper, dropdownType);
    });

    // Create dropdown menu
    const dropdown = document.createElement('div');
    dropdown.className = 'vp-dropdown-menu';
    dropdown.setAttribute('role', 'menu');
    dropdown.setAttribute('aria-label', label);
    dropdown.addEventListener('keydown', (e) => this.handleMenuKeyDown(dropdown, e));

    wrapper.appendChild(button);
    wrapper.appendChild(dropdown);

    return wrapper;
  }

  /**
   * Toggle dropdown menu
   */
  private toggleDropdown(wrapper: HTMLElement, type: string): void {
    const dropdown = wrapper.querySelector('.vp-dropdown-menu') as HTMLElement;
    const button = wrapper.querySelector('.vp-dropdown-btn') as HTMLElement;
    
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('open');

    // Close any open dropdown
    this.closeAllDropdowns();

    if (!isOpen) {
      // Populate and open dropdown
      this.populateDropdown(dropdown, type);
      dropdown.classList.add('open');
      button?.setAttribute('aria-expanded', 'true');
      this.activeDropdown = dropdown;

      // Position dropdown to stay in viewport
      this.positionDropdown(wrapper, dropdown);

      // Move focus into the menu (active item first) for keyboard users
      const items = this.getMenuItems(dropdown);
      (items.find(i => i.classList.contains('active')) ?? items[0])?.focus({ preventScroll: true });
    }
  }

  private getMenuItems(dropdown: HTMLElement): HTMLElement[] {
    return Array.from(dropdown.querySelectorAll<HTMLElement>('.vp-dropdown-item'));
  }

  /**
   * Arrow/Home/End/Escape navigation inside an open menu. Stops propagation so the
   * player-level shortcuts (arrow keys = seek/volume) don't fire while a menu is open.
   */
  private handleMenuKeyDown(dropdown: HTMLElement, e: KeyboardEvent): void {
    const items = this.getMenuItems(dropdown);
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;

    switch (e.key) {
      case 'ArrowDown': next = current < items.length - 1 ? current + 1 : 0; break;
      case 'ArrowUp': next = current > 0 ? current - 1 : items.length - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        const button = dropdown.parentElement?.querySelector<HTMLElement>('.vp-dropdown-btn');
        this.closeAllDropdowns();
        button?.focus({ preventScroll: true });
        return;
      }
      case 'Tab':
        this.closeAllDropdowns();
        return;
      default:
        // Enter/Space activate the focused <button>; let everything else through untouched
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    items[next]?.focus({ preventScroll: true });
  }

  /**
   * Build a menu item from plain strings. Labels come from config (titles, track labels),
   * so they are set with textContent — never interpolated into innerHTML.
   */
  private createMenuItem(label: string, active: boolean, onSelect: () => void, extraClass = ''): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `vp-dropdown-item${extraClass ? ` ${extraClass}` : ''}${active ? ' active' : ''}`;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(active));

    const labelEl = document.createElement('span');
    labelEl.className = 'vp-dropdown-item-label';
    labelEl.textContent = label;
    item.appendChild(labelEl);

    if (active) {
      const check = document.createElement('span');
      check.className = 'vp-dropdown-item-check';
      check.innerHTML = Icons.check;
      item.appendChild(check);
    }

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect();
    });
    return item;
  }

  /**
   * Position dropdown to stay within player bounds
   */
  private positionDropdown(wrapper: HTMLElement, dropdown: HTMLElement): void {
    const containerRect = this.container.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    
    // Reset positioning
    dropdown.style.left = '';
    dropdown.style.right = '';
    dropdown.style.bottom = '';
    dropdown.style.maxHeight = '';

    // Calculate available space
    const spaceAbove = wrapperRect.top - containerRect.top;
    const spaceRight = containerRect.right - wrapperRect.right;
    const spaceLeft = wrapperRect.left - containerRect.left;

    // Set max height based on available space
    const maxHeight = Math.min(spaceAbove - 20, 300);
    dropdown.style.maxHeight = `${maxHeight}px`;

    // Horizontal positioning
    const dropdownWidth = dropdown.offsetWidth || 180;
    
    if (spaceRight < dropdownWidth && spaceLeft > dropdownWidth) {
      // Position to the left if not enough space on right
      dropdown.style.right = '0';
      dropdown.style.left = 'auto';
    }
  }

  /**
   * Populate dropdown content
   */
  private populateDropdown(dropdown: HTMLElement, type: string): void {
    dropdown.innerHTML = '';

    switch (type) {
      case 'speed':
        this.renderSpeedOptions(dropdown);
        break;
      case 'quality':
        this.renderQualityOptions(dropdown);
        break;
      case 'subtitles':
        this.renderSubtitleOptions(dropdown);
        break;
      case 'chapters':
        this.renderChapterOptions(dropdown);
        break;
    }
  }

  /**
   * Render speed options
   */
  private renderSpeedOptions(dropdown: HTMLElement): void {
    dropdown.appendChild(this.createMenuHeader('Playback Speed'));

    const speeds = [
      { value: 0.25, label: '0.25x' },
      { value: 0.5, label: '0.5x' },
      { value: 0.75, label: '0.75x' },
      { value: 1, label: 'Normal' },
      { value: 1.25, label: '1.25x' },
      { value: 1.5, label: '1.5x' },
      { value: 1.75, label: '1.75x' },
      { value: 2, label: '2x' },
    ];

    speeds.forEach(speed => {
      dropdown.appendChild(this.createMenuItem(speed.label, this.currentSpeed === speed.value, () => {
        this.currentSpeed = speed.value;
        this.callbacks.onPlaybackRateChange(speed.value);
        this.updateSpeedLabel(speed.value);
        this.closeAllDropdowns();
      }));
    });
  }

  /**
   * Render quality options
   */
  private renderQualityOptions(dropdown: HTMLElement): void {
    dropdown.appendChild(this.createMenuHeader('Quality'));

    // Auto option (conditionally shown based on config)
    if (this.showAutoQuality) {
      dropdown.appendChild(this.createMenuItem('Auto', !this.currentQuality, () => {
        this.currentQuality = null;
        this.callbacks.onQualityChange('auto');
        this.updateQualityLabel('Auto');
        this.closeAllDropdowns();
      }));
    }

    // Quality levels
    if (this.qualityLevels.length === 0) {
      dropdown.appendChild(this.createMenuEmpty('No quality options available'));
      return;
    }

    // Sort by height descending
    [...this.qualityLevels].sort((a, b) => b.height - a.height).forEach(quality => {
      const label = quality.height >= 720 ? `${quality.label} HD` : quality.label;
      dropdown.appendChild(this.createMenuItem(label, this.currentQuality?.height === quality.height, () => {
        this.currentQuality = quality;
        this.callbacks.onQualityChange(quality);
        this.updateQualityLabel(quality.label);
        this.closeAllDropdowns();
      }));
    });
  }

  /**
   * Render subtitle options
   */
  private renderSubtitleOptions(dropdown: HTMLElement): void {
    dropdown.appendChild(this.createMenuHeader('Subtitles'));

    dropdown.appendChild(this.createMenuItem('Off', this.currentSubtitle === null, () => {
      this.currentSubtitle = null;
      this.callbacks.onSubtitleChange(null);
      this.closeAllDropdowns();
    }));

    if (this.subtitleTracks.length === 0) {
      dropdown.appendChild(this.createMenuEmpty('No subtitles available'));
      return;
    }

    this.subtitleTracks.forEach(track => {
      const isActive = this.currentSubtitle !== null && this.currentSubtitle.src === track.src;
      dropdown.appendChild(this.createMenuItem(track.label, isActive, () => {
        this.currentSubtitle = track;
        this.callbacks.onSubtitleChange(track);
        this.closeAllDropdowns();
      }));
    });
  }

  /**
   * Render chapter options
   */
  private renderChapterOptions(dropdown: HTMLElement): void {
    dropdown.appendChild(this.createMenuHeader('Chapters'));

    if (this.chapters.length === 0) {
      dropdown.appendChild(this.createMenuEmpty('No chapters available'));
      return;
    }

    const currentTime = this.currentState?.currentTime ?? 0;
    this.chapters.forEach((chapter, index) => {
      const end = this.chapters[index + 1]?.startTime ?? chapter.endTime ?? Infinity;
      const isActive = currentTime >= chapter.startTime && currentTime < end;

      const item = document.createElement('button');
      item.type = 'button';
      item.className = `vp-dropdown-item vp-chapter-item${isActive ? ' active' : ''}`;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(isActive));

      const number = document.createElement('span');
      number.className = 'vp-chapter-number';
      number.textContent = String(index + 1);

      const info = document.createElement('span');
      info.className = 'vp-chapter-info';
      const title = document.createElement('span');
      title.className = 'vp-chapter-title';
      title.textContent = chapter.title;
      const time = document.createElement('span');
      time.className = 'vp-chapter-time';
      time.textContent = this.formatTime(chapter.startTime);
      info.append(title, time);

      item.append(number, info);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.callbacks.onChapterSeek) {
          this.callbacks.onChapterSeek(chapter);
        } else {
          this.callbacks.onSeek(chapter.startTime / (this.currentState?.duration || 1));
        }
        this.closeAllDropdowns();
      });
      dropdown.appendChild(item);
    });
  }

  private createMenuHeader(text: string): HTMLElement {
    const header = document.createElement('div');
    header.className = 'vp-dropdown-header';
    header.textContent = text;
    return header;
  }

  private createMenuEmpty(text: string): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'vp-dropdown-empty';
    empty.textContent = text;
    return empty;
  }

  /**
   * Close all dropdowns
   */
  public closeAllDropdowns(): void {
    const dropdowns = this.controlsElement?.querySelectorAll('.vp-dropdown-menu.open');
    dropdowns?.forEach(dropdown => {
      dropdown.classList.remove('open');
    });
    
    const buttons = this.controlsElement?.querySelectorAll('.vp-dropdown-btn[aria-expanded="true"]');
    buttons?.forEach(btn => {
      btn.setAttribute('aria-expanded', 'false');
    });
    
    this.activeDropdown = null;
  }

  /**
   * Check if any dropdown menu is currently open
   */
  public hasOpenDropdown(): boolean {
    return this.activeDropdown !== null || !!this.controlsElement?.querySelector('.vp-dropdown-menu.open');
  }

  /**
   * Update speed label
   */
  private updateSpeedLabel(speed: number): void {
    const label = this.speedBtn?.querySelector('.vp-speed-label');
    if (label) {
      label.textContent = speed === 1 ? '1x' : `${speed}x`;
    }
  }

  /**
   * Update quality label
   */
  private updateQualityLabel(quality: string): void {
    const label = this.qualityBtn?.querySelector('.vp-quality-label');
    if (label) {
      label.textContent = quality;
    }
  }

  /**
   * Create loading indicator
   */
  private createLoadingIndicator(): void {
    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.className = 'vp-loading';
    this.loadingIndicator.innerHTML = `
      <div class="vp-spinner">
        <svg viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">
            <animate attributeName="stroke-dasharray" dur="1.5s" repeatCount="indefinite" values="1,150;90,150;90,150"/>
            <animate attributeName="stroke-dashoffset" dur="1.5s" repeatCount="indefinite" values="0;-35;-124"/>
          </circle>
        </svg>
      </div>
    `;
    this.container.appendChild(this.loadingIndicator);
  }

  /**
   * Bind event listeners
   */
  private bindEvents(): void {
    // Big play button
    if (this.bigPlayBtn) {
      this.listen(this.bigPlayBtn, 'click', (e) => {
        e.stopPropagation();
        this.callbacks.onTogglePlay();
      });
    }

    // Progress bar events (mouse + touch scrubbing)
    if (this.progressBar) {
      const bar = this.progressBar;
      this.listen(bar, 'mousedown', (e) => this.handleProgressMouseDown(e));
      this.listen(bar, 'mousemove', (e) => this.handleProgressHover(e));
      this.listen(bar, 'mouseleave', () => this.handleProgressLeave());
      this.listen(bar, 'click', (e) => this.handleProgressClick(e));
      this.listen(bar, 'touchstart', (e) => this.handleProgressTouchStart(e), { passive: false });
      this.listen(bar, 'touchmove', (e) => this.handleProgressTouchMove(e), { passive: false });
      this.listen(bar, 'touchend', () => this.handleTouchEnd());
    }

    // Volume slider events
    if (this.volumeSlider) {
      this.listen(this.volumeSlider, 'mousedown', (e) => this.handleVolumeMouseDown(e));
      this.listen(this.volumeSlider, 'click', (e) => this.handleVolumeClick(e));
    }

    // Controls visibility
    // Input type + "user is using the controls": a tap on a control (or anywhere) restarts the hide timer
    this.listen(this.container, 'pointerdown', (e) => {
      this.lastInputTouch = (e as PointerEvent).pointerType === 'touch';
      if ((e.target as HTMLElement | null)?.closest?.('.vp-controls') && this.isControlsVisible) this.resetHideTimer();
    }, { capture: true });
    this.listen(this.container, 'mousemove', () => this.handleMouseMove());
    this.listen(this.container, 'mouseleave', () => this.startHideTimer());
    this.listen(this.container, 'mouseenter', () => {
      this.showControls();
      this.resetHideTimer();
    });

    // Mobile gestures: double-tap seek, swipe volume, long press speed
    this.listen(this.container, 'touchstart', (e) => this.handleGestureStart(e), { passive: true });
    this.listen(this.container, 'touchmove', (e) => this.handleGestureMove(e), { passive: true });
    this.listen(this.container, 'touchend', (e) => this.handleGestureEnd(e));

    // Keyboard shortcuts
    this.listen(this.container, 'keydown', (e) => this.handleKeyDown(e));

    // Desktop double-click: left/right third seeks, center toggles fullscreen
    this.listen(this.container, 'dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.vp-controls, .vp-big-play, .vp-poster-overlay, .vp-error, .vp-mini-controls')) return;
      if (this.container.classList.contains('vp-mini-active')) return;
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width / 3) {
        // Live: no seeking back inside the DVR window
        if (this.isLive) return;
        this.callbacks.onRewind();
        this.showSeekFeedback('left');
      } else if (x > (rect.width * 2) / 3) {
        if (this.isLive) {
          this.callbacks.onGoLive?.();
          return;
        }
        this.callbacks.onForward();
        this.showSeekFeedback('right');
      } else {
        this.callbacks.onFullscreenToggle();
      }
    });
  }

  private isOverlayTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el?.closest?.('.vp-controls, .vp-big-play, .vp-poster-overlay, .vp-error, .vp-mini-controls');
  }

  /** Long-press playback speed, or null when long-press is disabled (`longPressSpeed: false`). */
  private getLongPressSpeed(): number | null {
    const lps = this.gesturesConfig.longPressSpeed;
    if (lps === false) return null;
    return typeof lps === 'number' && lps > 0 ? lps : 2;
  }

  /** Seconds a double-tap seeks: gestures.doubleTapSeek → gestures.seekSeconds → controls.seekDuration */
  private getDoubleTapSeconds(): number {
    return this.gesturesConfig.doubleTapSeek ?? this.gesturesConfig.seekSeconds ?? this.config.seekDuration ?? 10;
  }

  private seekBy(seconds: number): void {
    if (this.callbacks.onSeekBy) this.callbacks.onSeekBy(seconds);
    else if (seconds < 0) this.callbacks.onRewind();
    else this.callbacks.onForward();
  }

  private handleGestureStart(e: TouchEvent): void {
    if (this.isOverlayTarget(e.target)) return;
    const touch = e.touches[0];
    this.swipeStartY = touch.clientY;
    this.swipeStartX = touch.clientX;
    this.swipeActive = false;

    // Long press — increase speed while held
    const speed = this.getLongPressSpeed();
    if (this.gesturesConfig.enabled !== false && speed !== null) {
      if (this.longPressTimer) clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.isLongPressActive = true;
        this.savedSpeedBeforeLongPress = this.currentSpeed;
        this.callbacks.onPlaybackRateChange(speed);
        this.showSpeedFeedback(speed);
      }, 500);
    }
  }

  private handleGestureMove(e: TouchEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('.vp-controls') || target.closest('.vp-poster-overlay')) return;

    // Cancel long press on move
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    if (this.gesturesConfig.enabled === false) return;

    const touch = e.touches[0];
    const dy = this.swipeStartY - touch.clientY;
    const dx = Math.abs(touch.clientX - this.swipeStartX);

    if (Math.abs(dy) < 10 && !this.swipeActive) return;
    if (dx > 30) return; // horizontal scroll — ignore

    this.swipeActive = true;
    const rect = this.container.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const isRightHalf = x > rect.width / 2;

    const delta = dy / rect.height; // positive = swipe up

    if (isRightHalf && this.gesturesConfig.swipeVolume !== false) {
      const newVol = Math.max(0, Math.min(1, (this.currentState?.volume ?? 1) + delta * 1.5));
      this.callbacks.onVolumeChange(newVol);
      this.showVolumeFeedback(newVol);
      this.swipeStartY = touch.clientY;
    }
  }

  private handleGestureEnd(e: TouchEvent): void {
    if (this.isOverlayTarget(e.target)) return;

    // Cancel long press
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    // Restore speed after long press
    if (this.isLongPressActive) {
      this.isLongPressActive = false;
      this.callbacks.onPlaybackRateChange(this.savedSpeedBeforeLongPress);
      return;
    }

    // If swipe was happening, don't treat as tap
    if (this.swipeActive) {
      this.swipeActive = false;
      return;
    }

    // Suppress the synthetic mouse click; taps are handled here
    e.preventDefault();

    const now = Date.now();
    const touch = e.changedTouches[0];
    const rect = this.container.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const zone: 'left' | 'center' | 'right' =
      x < rect.width / 3 ? 'left' :
      x > (rect.width * 2) / 3 ? 'right' : 'center';

    const isDoubleTap = now - this.lastTapTime < 300 && zone === this.lastTapZone;
    this.lastTapTime = now;
    this.lastTapZone = zone;

    if (isDoubleTap && this.gesturesConfig.doubleTapZones !== false) {
      if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; }
      const seconds = this.getDoubleTapSeconds();
      if (zone === 'left') {
        if (!this.isLive) {
          this.seekBy(-seconds);
          this.showSeekFeedback('left', seconds);
        }
      } else if (zone === 'right') {
        if (this.isLive) {
          this.callbacks.onGoLive?.();
        } else {
          this.seekBy(seconds);
          this.showSeekFeedback('right', seconds);
        }
      } else {
        this.callbacks.onFullscreenToggle();
      }
      this.showControls();
      this.resetHideTimer();
    } else {
      if (this.tapTimer) clearTimeout(this.tapTimer);
      this.tapTimer = setTimeout(() => {
        this.tapTimer = null;
        if (this.hasOpenDropdown()) {
          this.closeAllDropdowns();
          return;
        }
        if (this.isControlsVisible && !this.currentState?.paused) {
          this.hideControls();
        } else {
          this.showControls();
          this.resetHideTimer();
        }
      }, 200);
    }
  }

  /**
   * Bind global events
   */
  private bindGlobalEvents(): void {
    this.listen(document, 'mousemove', (e) => this.handleGlobalMouseMove(e));
    this.listen(document, 'mouseup', () => this.handleMouseUp());

    // Close dropdowns when clicking outside
    this.listen(document, 'click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (this.hasOpenDropdown() && !target.closest('.vp-dropdown-wrapper')) {
        this.closeAllDropdowns();
      }
    });
  }

  /**
   * Handle progress bar hover
   */
  private handleProgressHover(e: MouseEvent): void {
    if (!this.progressBar || !this.progressTooltip || !this.progressHover) return;

    const rect = this.progressBar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = this.currentState?.duration || 0;
    const time = pos * duration;

    // Update tooltip — show chapter name above the time when chapters are present
    const chapter = this.chapters.length > 0
      ? this.chapters.slice().reverse().find(c => c.startTime <= time) ?? null
      : null;
    if (chapter) {
      const chapterSpan = document.createElement('span');
      chapterSpan.className = 'vp-tooltip-chapter';
      chapterSpan.textContent = chapter.title;
      const timeSpan = document.createElement('span');
      timeSpan.className = 'vp-tooltip-time';
      timeSpan.textContent = this.formatTime(time);
      this.progressTooltip.innerHTML = '';
      this.progressTooltip.appendChild(chapterSpan);
      this.progressTooltip.appendChild(timeSpan);
    } else {
      this.progressTooltip.textContent = this.formatTime(time);
    }
    this.progressTooltip.style.left = `${pos * 100}%`;
    this.progressTooltip.classList.add('visible');

    // Update hover preview
    this.progressHover.style.width = `${pos * 100}%`;

    // Thumbnail preview — stacked above the tooltip (which grows to two lines with chapter names)
    if (this.thumbnailPreview?.hasCues()) {
      // tooltip height + its 8px bottom margin + an 8px gap
      this.thumbnailPreview.show(time, pos * 100, this.progressTooltip.offsetHeight + 16);
    }
  }

  /**
   * Handle progress bar leave
   */
  private handleProgressLeave(): void {
    this.progressTooltip?.classList.remove('visible');
    if (this.progressHover) {
      this.progressHover.style.width = '0';
    }
    this.thumbnailPreview?.hide();
  }

  /**
   * Handle progress bar click
   * Guard against double-seek: mousedown already called doProgressSeek, so skip
   * the click event that fires immediately after.
   */
  private handleProgressClick(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    if (Date.now() - this.progressMouseDownTime < 300) return;
    this.doProgressSeek(e);
  }

  private doProgressSeek(e: MouseEvent): void {
    if (!this.progressBar) return;
    const rect = this.progressBar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.callbacks.onSeek(pos);
    this.updateProgressFromPos(pos);
  }

  private updateProgressFromPos(pos: number): void {
    const percentage = pos * 100;
    const duration = this.currentState?.duration ?? 0;
    const currentTime = pos * duration;

    if (this.chapterSegments.length > 0) {
      this.chapterSegments.forEach((segment, i) => {
        const chapter = this.chapters[i];
        const segEnd = this.chapters[i + 1]?.startTime ?? duration;
        const segDur = segEnd - chapter.startTime;
        const fill = segment.children[1] as HTMLElement | null;
        if (fill && segDur > 0) {
          const pct = Math.min(1, Math.max(0, (currentTime - chapter.startTime) / segDur)) * 100;
          fill.style.width = `${pct}%`;
        }
      });
    } else if (this.progressFilled) {
      this.progressFilled.style.width = `${percentage}%`;
    }
    if (this.progressThumb) {
      this.progressThumb.style.left = `${percentage}%`;
    }
  }

  /**
   * Handle progress mouse down
   */
  private handleProgressMouseDown(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    this.progressMouseDownTime = Date.now();
    this.isDraggingProgress = true;
    this.container.classList.add('vp-dragging');
    this.doProgressSeek(e);
  }

  /**
   * Handle progress touch start
   */
  private handleProgressTouchStart(e: TouchEvent): void {
    e.preventDefault();
    this.isDraggingProgress = true;
    this.container.classList.add('vp-dragging');
    const touch = e.touches[0];
    if (!this.progressBar) return;
    const rect = this.progressBar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    this.callbacks.onSeek(pos);
    this.updateProgressFromPos(pos);
  }

  /**
   * Handle progress touch move
   */
  private handleProgressTouchMove(e: TouchEvent): void {
    if (!this.isDraggingProgress || !this.progressBar) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = this.progressBar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    this.callbacks.onSeek(pos);
    this.updateProgressFromPos(pos);
  }

  /**
   * Handle touch end
   */
  private handleTouchEnd(): void {
    this.isDraggingProgress = false;
    this.isDraggingVolume = false;
    this.container.classList.remove('vp-dragging');
  }

  /**
   * Handle volume click
   */
  private handleVolumeClick(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    if (!this.volumeSlider) return;
    const rect = this.volumeSlider.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    this.callbacks.onVolumeChange(Math.max(0, Math.min(1, pos)));
  }

  /**
   * Handle volume mouse down
   */
  private handleVolumeMouseDown(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    this.isDraggingVolume = true;
    this.handleVolumeClick(e);
  }

  /**
   * Handle global mouse move (for dragging and fullscreen controls)
   */
  private handleGlobalMouseMove(e: MouseEvent): void {
    if (this.isDraggingProgress && this.progressBar) {
      const rect = this.progressBar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.callbacks.onSeek(pos);
      this.updateProgressFromPos(pos);
    }

    if (this.isDraggingVolume && this.volumeSlider) {
      const rect = this.volumeSlider.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.callbacks.onVolumeChange(pos);
    }

    // In fullscreen mode, also handle control visibility from document-level
    if (document.fullscreenElement === this.container) {
      this.showControls();
      this.resetHideTimer();
    }
  }

  /**
   * Handle mouse up
   */
  private handleMouseUp(): void {
    this.isDraggingProgress = false;
    this.isDraggingVolume = false;
    this.container.classList.remove('vp-dragging');
  }

  /**
   * Handle mouse move on container
   */
  private handleMouseMove(): void {
    this.showControls();
    this.resetHideTimer();
  }

  /**
   * Handle keyboard shortcuts
   */
  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;

    // Never hijack typing, and leave browser/OS shortcuts (Ctrl/Cmd/Alt + key) alone
    if (target.isContentEditable || target.closest?.(EDITABLE_SELECTOR)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Open menus handle their own keys
    if (target.closest?.('.vp-dropdown-menu')) return;

    if (e.key === 'Escape') {
      this.closeAllDropdowns();
      return;
    }

    if (!this.keyboardShortcuts) return;

    // Space/Enter on a focused button activate that button natively — don't also toggle playback
    const onButton = !!target.closest?.('button, [role="button"]');
    const onProgressBar = !!this.progressBar && target === this.progressBar;

    switch (e.key) {
      case ' ':
        if (onButton) return;
        e.preventDefault();
        this.callbacks.onTogglePlay();
        break;
      case 'i':
        if (!this.callbacks.onToggleStats) return;
        e.preventDefault();
        this.callbacks.onToggleStats();
        break;
      case 'k':
        e.preventDefault();
        this.callbacks.onTogglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        // Live: no seeking back
        if (!this.isLive) this.callbacks.onRewind();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (this.isLive) this.callbacks.onGoLive?.();
        else this.callbacks.onForward();
        break;
      case 'Home':
        if (!onProgressBar || this.isLive) return;
        e.preventDefault();
        this.callbacks.onSeek(0);
        break;
      case 'End':
        if (!onProgressBar || this.isLive) return;
        e.preventDefault();
        this.callbacks.onSeek(1);
        break;
      case 'ArrowUp': {
        e.preventDefault();
        const upVol = Math.min(1, (this.currentState?.volume ?? 1) + 0.1);
        this.callbacks.onVolumeChange(upVol);
        this.showVolumeFeedback(upVol, this.currentState?.muted ?? false);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const downVol = Math.max(0, (this.currentState?.volume ?? 1) - 0.1);
        this.callbacks.onVolumeChange(downVol);
        this.showVolumeFeedback(downVol, this.currentState?.muted ?? false);
        break;
      }
      case 'f':
        e.preventDefault();
        this.callbacks.onFullscreenToggle();
        break;
      case 'm':
        e.preventDefault();
        this.callbacks.onMuteToggle();
        break;
      case 'c':
        // Toggle subtitles
        if (this.subtitleTracks.length > 0) {
          if (this.currentSubtitle) {
            this.callbacks.onSubtitleChange(null);
            this.currentSubtitle = null;
          } else {
            this.callbacks.onSubtitleChange(this.subtitleTracks[0]);
            this.currentSubtitle = this.subtitleTracks[0];
          }
        }
        break;
    }
  }

  /**
   * Show controls
   */
  showControls(): void {
    this.clearIdleSettle();
    this.controlsElement?.classList.add('visible');
    this.gradientTop?.classList.add('visible');
    this.gradientBottom?.classList.add('visible');
    if (this.titleElement?.textContent) {
      this.titleElement.classList.add('visible');
    }
    this.isControlsVisible = true;
  }

  /**
   * Hide controls
   */
  hideControls(): void {
    if (this.activeDropdown) return;
    if (this.currentState?.paused) return;
    this.controlsElement?.classList.remove('visible');
    this.gradientTop?.classList.remove('visible');
    this.gradientBottom?.classList.remove('visible');
    this.titleElement?.classList.remove('visible');
    this.container.classList.add('vp-idle');
    this.closeAllDropdowns();
    this.isControlsVisible = false;
    // Controls fade out over 0.3 s; keep them tappable through the fade and a short grace, so a tap
    // that was already on its way still presses the button (touch has no hover to revive them)
    this.clearIdleSettle();
    this.idleSettleTimer = setTimeout(() => {
      this.idleSettleTimer = null;
      if (!this.isControlsVisible) this.container.classList.add('vp-idle-settled');
    }, ControlsManager.IDLE_GRACE_MS);
  }

  private clearIdleSettle(): void {
    if (this.idleSettleTimer) clearTimeout(this.idleSettleTimer);
    this.idleSettleTimer = null;
    this.container.classList.remove('vp-idle-settled');
  }

  /** Swap a button's icon only when it changes. Replacing the SVG under the pointer between mousedown
   *  and mouseup made browsers drop the click (state updates run several times a second). */
  private setIcon(button: HTMLElement | null | undefined, icon: keyof typeof Icons): void {
    const inner = button?.querySelector('.vp-btn-inner') as HTMLElement | null;
    if (!inner || inner.dataset.icon === icon) return;
    inner.innerHTML = Icons[icon];
    inner.dataset.icon = icon;
  }

  /**
   * Reset hide timer
   */
  private resetHideTimer(): void {
    if (this.hideControlsTimer) {
      clearTimeout(this.hideControlsTimer);
    }
    // Remove idle class when user is active
    this.container.classList.remove('vp-idle');
    this.clearIdleSettle();
    const delay = this.lastInputTouch ? ControlsManager.HIDE_AFTER_TOUCH_MS : ControlsManager.HIDE_AFTER_MOUSE_MS;
    this.hideControlsTimer = setTimeout(() => this.hideControls(), delay);
  }

  /**
   * Start hide timer
   */
  private startHideTimer(): void {
    this.resetHideTimer();
  }

  /**
   * Format time in MM:SS or HH:MM:SS
   */
  private formatTime(seconds: number): string {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Update player state
   */
  updateState(state: PlayerState): void {
    const wasPlaying = this.currentState?.playing;
    const wasPaused = this.currentState?.paused;
    const wasFullscreen = this.currentState?.fullscreen;
    const wasDuration = this.lastKnownDuration;
    this.lastKnownDuration = state.duration;
    // Copy: the player mutates one state object in place, so keeping the reference would make
    // every "was*" comparison above see the new values and transitions would never be detected
    this.currentState = { ...state };

    // Render chapter markers whenever duration changes
    if (state.duration > 0 && state.duration !== wasDuration && this.chapters.length > 0) {
      this.renderChapterMarkers();
    }

    // Update play/pause button
    if (this.playPauseBtn) {
      this.setIcon(this.playPauseBtn, state.playing ? 'pause' : 'play');
      this.playPauseBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
      this.playPauseBtn.setAttribute('title', state.playing ? 'Pause' : 'Play');
    }

    // Update poster overlay
    if (this.posterOverlay) {
      if (state.playing || !this.isInitialPlay) {
        this.posterOverlay.classList.add('hidden');
      } else {
        this.posterOverlay.classList.remove('hidden');
      }
    }

    // Track first play; restore the big-button icon that `ended` switched to "replay"
    if (state.playing && this.isInitialPlay) {
      this.isInitialPlay = false;
    }
    if (state.playing && !wasPlaying) {
      const icon = this.bigPlayBtn?.querySelector('.vp-big-play-icon');
      if (icon) icon.innerHTML = Icons.play;
      this.bigPlayBtn?.setAttribute('aria-label', 'Play video');
    }

    // Handle fullscreen transitions - show controls and reset timer
    if (state.fullscreen !== wasFullscreen) {
      this.showControls();
      if (state.playing) {
        this.resetHideTimer();
      }
    }

    // Start hide timer ONLY on transition from paused → playing (not on every update)
    if (state.playing && !state.paused && (!wasPlaying || wasPaused)) {
      this.resetHideTimer();
    } else if (state.paused && !wasPaused) {
      // Cancel timer and show controls when transitioning to paused
      if (this.hideControlsTimer) {
        clearTimeout(this.hideControlsTimer);
        this.hideControlsTimer = null;
      }
      this.showControls();
    }

    // Show poster overlay when ended
    if (state.ended) {
      this.isInitialPlay = true;
      this.posterOverlay?.classList.remove('hidden');
      if (this.bigPlayBtn) {
        const icon = this.bigPlayBtn.querySelector('.vp-big-play-icon');
        if (icon) icon.innerHTML = Icons.replay;
        this.bigPlayBtn.setAttribute('aria-label', 'Replay video');
      }
    }

    // Update progress
    if (state.duration > 0) {
      const percentage = (state.currentTime / state.duration) * 100;
      if (this.chapterSegments.length > 0) {
        // Per-segment fills (YouTube-style)
        this.chapterSegments.forEach((segment, i) => {
          const chapter = this.chapters[i];
          const segEnd = this.chapters[i + 1]?.startTime ?? state.duration;
          const segDur = segEnd - chapter.startTime;
          
          const bufferEl = segment.children[0] as HTMLElement | null;
          const fillEl = segment.children[1] as HTMLElement | null;

          if (segDur > 0) {
            if (bufferEl) {
              const bufferPct = Math.min(1, Math.max(0, (state.buffered - chapter.startTime) / segDur)) * 100;
              bufferEl.style.width = `${bufferPct}%`;
            }
            if (fillEl) {
              const fillPct = Math.min(1, Math.max(0, (state.currentTime - chapter.startTime) / segDur)) * 100;
              fillEl.style.width = `${fillPct}%`;
            }
          }
        });
      } else if (this.progressFilled) {
        this.progressFilled.style.width = `${percentage}%`;
      }
      if (this.progressThumb) {
        this.progressThumb.style.left = `${percentage}%`;
      }
    } else {
      // New source loading — clear the previous video's progress
      if (this.progressFilled) this.progressFilled.style.width = '0%';
      if (this.progressThumb) this.progressThumb.style.left = '0%';
      if (this.progressBuffer) this.progressBuffer.style.width = '0%';
    }

    // Slider semantics for assistive tech
    if (this.progressBar) {
      const pct = state.duration > 0 ? Math.round((state.currentTime / state.duration) * 100) : 0;
      this.progressBar.setAttribute('aria-valuenow', String(pct));
      this.progressBar.setAttribute(
        'aria-valuetext',
        `${this.formatTime(state.currentTime)} of ${this.formatTime(state.duration)}`
      );
    }

    // Update buffer
    if (this.progressBuffer && state.duration > 0) {
      const bufferPercentage = (state.buffered / state.duration) * 100;
      this.progressBuffer.style.width = `${bufferPercentage}%`;
    }

    // Update time display
    if (this.timeDisplay) {
      const currentEl = this.timeDisplay.querySelector('.vp-time-current');
      const durationEl = this.timeDisplay.querySelector('.vp-time-duration');
      if (currentEl) currentEl.textContent = this.formatTime(state.currentTime);
      if (durationEl) durationEl.textContent = this.formatTime(state.duration);
    }

    // Update volume
    if (this.volumeLevel) {
      this.volumeLevel.style.width = `${state.volume * 100}%`;
    }

    // Update volume slider thumb
    const volumeThumb = this.volumeSlider?.querySelector('.vp-volume-thumb') as HTMLElement;
    if (volumeThumb) {
      // Offset by thumb radius so it never clips: at 0% left edge flush left, at 100% right edge flush right
      volumeThumb.style.left = `calc(${state.volume * 100}% - ${state.volume * 12 - 6}px)`;
    }

    // Update mute button
    if (this.muteBtn) {
      let icon: keyof typeof Icons = 'volumeHigh';
      if (state.muted || state.volume === 0) {
        icon = 'volumeMute';
      } else if (state.volume < 0.5) {
        icon = 'volumeLow';
      }
      this.setIcon(this.muteBtn, icon);
      this.muteBtn.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
    }

    // Update fullscreen button
    if (this.fullscreenBtn) {
      this.setIcon(this.fullscreenBtn, state.fullscreen ? 'fullscreenExit' : 'fullscreen');
      this.fullscreenBtn.setAttribute('aria-label', state.fullscreen ? 'Exit Fullscreen' : 'Fullscreen');
    }

    // Update PIP button
    if (this.pipBtn) {
      this.setIcon(this.pipBtn, state.pip ? 'pipExit' : 'pip');
    }

    // Loading indicator
    if (this.loadingIndicator) {
      this.loadingIndicator.classList.toggle('visible', state.buffering);
    }

    // Update playback rate
    if (state.playbackRate !== this.currentSpeed) {
      this.currentSpeed = state.playbackRate;
      this.updateSpeedLabel(state.playbackRate);
    }
  }

  /**
   * Show/hide playlist prev/next buttons and icon swap
   */
  updatePlaylistButtons(hasPrev: boolean, hasNext: boolean): void {
    if (this.prevBtn) {
      this.prevBtn.style.display = hasPrev ? '' : 'none';
      this.setIcon(this.prevBtn, 'prev');
      this.prevBtn.setAttribute('aria-label', 'Previous video');
      this.prevBtn.setAttribute('title', 'Previous video');
    }
    if (this.nextBtn) {
      this.nextBtn.style.display = hasNext ? '' : 'none';
      this.setIcon(this.nextBtn, 'next');
      this.nextBtn.setAttribute('aria-label', 'Next video');
      this.nextBtn.setAttribute('title', 'Next video');
    }
  }

  /**
   * Attach a ThumbnailPreview instance (called from VideoPlayer after VTT loads), or detach with null
   */
  setThumbnailPreview(preview: ThumbnailPreview | null): void {
    if (this.thumbnailPreview && this.thumbnailPreview !== preview) this.thumbnailPreview.hide();
    this.thumbnailPreview = preview;
    // Mount inside the progress container so the preview is positioned relative to the bar
    if (preview && this.progressContainer) preview.mount(this.progressContainer);
  }

  /** Reflect a quality chosen outside the menu (API call, config default). null = Auto. */
  setSelectedQuality(quality: QualityLevel | null): void {
    this.currentQuality = quality;
    this.updateQualityLabel(quality ? quality.label : 'Auto');
  }

  /** Reflect a subtitle track chosen outside the menu (API call, rebuild). */
  setSelectedSubtitle(track: SubtitleTrack | null): void {
    this.currentSubtitle = track;
  }

  /**
   * Update available quality levels
   */
  updateQualities(qualities: QualityLevel[], showAuto = true): void {
    this.qualityLevels = qualities;
    this.showAutoQuality = showAuto;
    // Nothing to choose with a single rendition (e.g. a live app with one 720p ladder)
    if (this.qualityBtn) this.qualityBtn.style.display = qualities.length < 2 ? 'none' : '';
  }

  /**
   * Update available subtitle tracks
   */
  updateSubtitles(tracks: SubtitleTrack[]): void {
    this.subtitleTracks = tracks;
    if (this.subtitlesBtn) {
      this.subtitlesBtn.style.display = tracks.length > 0 ? '' : 'none';
    }
  }

  /**
   * Update chapters
   */
  updateChapters(chapters: Chapter[]): void {
    this.chapters = chapters;
    if (this.chaptersBtn) {
      this.chaptersBtn.style.display = chapters.length > 0 ? '' : 'none';
    }
    this.renderChapterMarkers();
  }

  /**
   * Render chapter segments (YouTube-style) on progress bar
   */
  private renderChapterMarkers(): void {
    this.chapterMarkers.forEach(m => m.remove());
    this.chapterMarkers = [];
    this.chapterSegments.forEach(s => s.remove());
    this.chapterSegments = [];

    if (!this.progressBar) return;

    // Restore the single fill bar whenever there are no chapters, even before duration is known
    if (this.chapters.length === 0) {
      this.progressBar.classList.remove('vp-progress--chaptered');
      if (this.progressFilled) this.progressFilled.style.display = '';
      return;
    }

    const duration = this.currentState?.duration;
    if (!duration || !isFinite(duration)) return;

    // Hide single fill bar; segments provide per-chapter fills
    if (this.progressFilled) this.progressFilled.style.display = 'none';
    this.progressBar.classList.add('vp-progress--chaptered');

    this.chapters.forEach((chapter, i) => {
      const segEnd = this.chapters[i + 1]?.startTime ?? duration;
      const segDuration = segEnd - chapter.startTime;

      const segment = document.createElement('div');
      segment.className = 'vp-chapter-segment';
      segment.style.flexGrow = String(segDuration / duration);
      segment.dataset.chapterIndex = String(i);

      const buffer = document.createElement('div');
      buffer.className = 'vp-chapter-segment-buffer';
      segment.appendChild(buffer);

      const fill = document.createElement('div');
      fill.className = 'vp-chapter-segment-fill';
      segment.appendChild(fill);

      // Insert before thumb so thumb stays on top
      this.progressBar!.insertBefore(segment, this.progressThumb);
      this.chapterSegments.push(segment);
    });
  }

  /**
   * Set the video title displayed in the top-left overlay
   */
  setTitle(title: string | undefined): void {
    if (!this.titleElement) return;
    this.titleElement.textContent = title ?? '';
    if (title && this.isControlsVisible) {
      this.titleElement.classList.add('visible');
    } else {
      this.titleElement.classList.remove('visible');
    }
  }

  /**
   * Update the quality button label when HLS auto-mode switches to a specific level.
   * Only updates when the user has not manually selected a quality (currentQuality === null).
   */
  updateAutoQualityDisplay(quality: QualityLevel | null): void {
    if (this.currentQuality !== null) return;
    this.updateQualityLabel(quality ? `Auto • ${quality.label}` : 'Auto');
  }

  /**
   * Update live state
   */
  updateLiveState(isLive: boolean): void {
    this.isLive = isLive;
    this.container.classList.toggle('vp-live', isLive);
  }

  /** Grey the LIVE badge (and make it a "jump to live" button) when playback is behind the live edge */
  updateLiveEdge(atLiveEdge: boolean, goLiveLabel = 'Jump to live'): void {
    if (!this.liveBadge) return;
    this.liveBadge.classList.toggle('vp-live-behind', !atLiveEdge);
    this.liveBadge.setAttribute('aria-label', atLiveEdge ? 'Live' : goLiveLabel);
    this.liveBadge.setAttribute('title', atLiveEdge ? 'Live' : goLiveLabel);
  }

  /**
   * Check if controls are currently visible
   */
  areControlsVisible(): boolean {
    return this.isControlsVisible;
  }

  /**
   * Destroy controls
   */
  destroy(): void {
    // Removes every container/document listener registered through listen()
    this.listeners.abort();
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    if (this.hideControlsTimer) clearTimeout(this.hideControlsTimer);
    if (this.tapTimer) clearTimeout(this.tapTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    if (this.actionTimer) clearTimeout(this.actionTimer);
    if (this.speedFeedbackTimer) clearTimeout(this.speedFeedbackTimer);
    if (this.volumeFeedbackTimer) clearTimeout(this.volumeFeedbackTimer);
    if (this.seekFeedbackTimer.left) clearTimeout(this.seekFeedbackTimer.left);
    if (this.seekFeedbackTimer.right) clearTimeout(this.seekFeedbackTimer.right);
    this.seekFeedbackEl.left?.remove();
    this.seekFeedbackEl.right?.remove();
    this.container.querySelectorAll('.vp-speed-feedback, .vp-volume-feedback').forEach(el => el.remove());
    this.clearIdleSettle();
    this.container.classList.remove('vp-idle', 'vp-dragging', 'vp-live', 'vp-size-xs', 'vp-size-sm', 'vp-size-md', 'vp-size-lg');
    // The preview is owned by VideoPlayer — just unmount its element
    this.thumbnailPreview?.destroy();
    this.thumbnailPreview = null;

    this.controlsElement?.remove();
    this.posterOverlay?.remove();
    this.loadingIndicator?.remove();
    this.gradientTop?.remove();
    this.gradientBottom?.remove();
    this.titleElement?.remove();
    this.actionIndicator?.remove();
  }
}
