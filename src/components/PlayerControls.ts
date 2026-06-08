/**
 * Player Controls Component - Fixed Version
 * 
 * This module provides the video player controls UI with fixes for:
 * - Play/pause toggle functionality
 * - Chapters support
 * - Responsive dropdowns
 * - Working quality/subtitle/settings menus
 * - Improved UI
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
}

/**
 * Manages video player controls
 */
export class ControlsManager {
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
  private isDraggingProgress = false;
  private isDraggingVolume = false;
  private progressMouseDownTime = 0;
  private hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
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

  // Playlist buttons
  private prevBtn: HTMLElement | null = null;
  private nextBtn: HTMLElement | null = null;

  // Container size observer
  private sizeObserver: ResizeObserver | null = null;

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
    gesturesConfig?: GesturesConfig
  ) {
    this.container = container;
    this.config = { ...defaultControlsConfig, ...config };
    this.callbacks = callbacks;
    if (gesturesConfig) this.gesturesConfig = gesturesConfig;
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
    setTimeout(() => {
      this.actionIndicator?.classList.remove('animate');
    }, 500);
  }

  /**
   * Show seek feedback with accumulated count — multiple rapid seeks stack up like YouTube.
   * Left shows "-Xs", right shows "+Xs". Resets the opposite side on direction change.
   */
  private showSeekFeedback(direction: 'left' | 'right'): void {
    const secs = this.config.seekDuration ?? 10;
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
    el.innerHTML = `<span>${Icons.speed}</span><span>${speed}x</span>`;
    this.container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('active'));
    setTimeout(() => el.remove(), 1500);
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
    
    // Progress container (above control buttons)
    if (this.config.seekBar) {
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
      this.prevBtn = this.createButton('rewind10', 'Previous', () => this.callbacks.onPlaylistPrev?.());
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
      this.nextBtn = this.createButton('forward10', 'Next', () => this.callbacks.onPlaylistNext?.());
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
    if (this.config.liveIndicator) {
      const liveBadge = document.createElement('div');
      liveBadge.className = 'vp-live-badge';
      liveBadge.textContent = 'LIVE';
      liveBadge.style.display = 'none'; // Hidden by default, shown when vp-live class is set
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
    }
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
    const header = document.createElement('div');
    header.className = 'vp-dropdown-header';
    header.textContent = 'Playback Speed';
    dropdown.appendChild(header);

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
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vp-dropdown-item';
      if (this.currentSpeed === speed.value) {
        item.classList.add('active');
      }
      item.innerHTML = `
        <span class="vp-dropdown-item-label">${speed.label}</span>
        ${this.currentSpeed === speed.value ? `<span class="vp-dropdown-item-check">${Icons.check}</span>` : ''}
      `;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentSpeed = speed.value;
        this.callbacks.onPlaybackRateChange(speed.value);
        this.updateSpeedLabel(speed.value);
        this.closeAllDropdowns();
      });
      dropdown.appendChild(item);
    });
  }

  /**
   * Render quality options
   */
  private renderQualityOptions(dropdown: HTMLElement): void {
    const header = document.createElement('div');
    header.className = 'vp-dropdown-header';
    header.textContent = 'Quality';
    dropdown.appendChild(header);

    // Auto option (conditionally shown based on config)
    if (this.showAutoQuality) {
      const autoItem = document.createElement('button');
      autoItem.type = 'button';
      autoItem.className = 'vp-dropdown-item';
      if (!this.currentQuality) {
        autoItem.classList.add('active');
      }
      autoItem.innerHTML = `
        <span class="vp-dropdown-item-label">Auto</span>
        ${!this.currentQuality ? `<span class="vp-dropdown-item-check">${Icons.check}</span>` : ''}
      `;
      autoItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentQuality = null;
        this.callbacks.onQualityChange('auto');
        this.updateQualityLabel('Auto');
        this.closeAllDropdowns();
      });
      dropdown.appendChild(autoItem);
    }

    // Quality levels
    if (this.qualityLevels.length === 0) {
      const noQualities = document.createElement('div');
      noQualities.className = 'vp-dropdown-empty';
      noQualities.textContent = 'No quality options available';
      dropdown.appendChild(noQualities);
    } else {
      // Sort by height descending
      const sortedQualities = [...this.qualityLevels].sort((a, b) => b.height - a.height);
      
      sortedQualities.forEach(quality => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'vp-dropdown-item';
        if (this.currentQuality?.height === quality.height) {
          item.classList.add('active');
        }
        
        const label = quality.height >= 720 
          ? `${quality.label} HD` 
          : quality.label;
        
        item.innerHTML = `
          <span class="vp-dropdown-item-label">${label}</span>
          ${this.currentQuality?.height === quality.height ? `<span class="vp-dropdown-item-check">${Icons.check}</span>` : ''}
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.currentQuality = quality;
          this.callbacks.onQualityChange(quality);
          this.updateQualityLabel(quality.label);
          this.closeAllDropdowns();
        });
        dropdown.appendChild(item);
      });
    }
  }

  /**
   * Render subtitle options
   */
  private renderSubtitleOptions(dropdown: HTMLElement): void {
    const header = document.createElement('div');
    header.className = 'vp-dropdown-header';
    header.textContent = 'Subtitles';
    dropdown.appendChild(header);

    // Off option
    const offItem = document.createElement('button');
    offItem.type = 'button';
    offItem.className = 'vp-dropdown-item';
    if (this.currentSubtitle === null) {
      offItem.classList.add('active');
    }
    offItem.innerHTML = `
      <span class="vp-dropdown-item-label">Off</span>
      ${this.currentSubtitle === null ? `<span class="vp-dropdown-item-check">${Icons.check}</span>` : ''}
    `;
    offItem.addEventListener('click', (e) => {
      e.stopPropagation();
      this.currentSubtitle = null;
      this.callbacks.onSubtitleChange(null);
      this.closeAllDropdowns();
    });
    dropdown.appendChild(offItem);

    if (this.subtitleTracks.length === 0) {
      const noSubs = document.createElement('div');
      noSubs.className = 'vp-dropdown-empty';
      noSubs.textContent = 'No subtitles available';
      dropdown.appendChild(noSubs);
    } else {
      this.subtitleTracks.forEach(track => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'vp-dropdown-item';
        const isActive = this.currentSubtitle !== null && this.currentSubtitle.src === track.src;
        if (isActive) {
          item.classList.add('active');
        }
        item.innerHTML = `
          <span class="vp-dropdown-item-label">${track.label}</span>
          ${isActive ? `<span class="vp-dropdown-item-check">${Icons.check}</span>` : ''}
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.currentSubtitle = track;
          this.callbacks.onSubtitleChange(track);
          this.closeAllDropdowns();
        });
        dropdown.appendChild(item);
      });
    }
  }

  /**
   * Render chapter options
   */
  private renderChapterOptions(dropdown: HTMLElement): void {
    const header = document.createElement('div');
    header.className = 'vp-dropdown-header';
    header.textContent = 'Chapters';
    dropdown.appendChild(header);

    if (this.chapters.length === 0) {
      const noChapters = document.createElement('div');
      noChapters.className = 'vp-dropdown-empty';
      noChapters.textContent = 'No chapters available';
      dropdown.appendChild(noChapters);
    } else {
      this.chapters.forEach((chapter, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'vp-dropdown-item vp-chapter-item';
        
        // Check if current time is in this chapter
        const currentTime = this.currentState?.currentTime ?? 0;
        const isActive = currentTime >= chapter.startTime && 
          (chapter.endTime ? currentTime < chapter.endTime : index === this.chapters.length - 1);
        
        if (isActive) {
          item.classList.add('active');
        }
        
        item.innerHTML = `
          <span class="vp-chapter-number">${index + 1}</span>
          <span class="vp-chapter-info">
            <span class="vp-chapter-title">${chapter.title}</span>
            <span class="vp-chapter-time">${this.formatTime(chapter.startTime)}</span>
          </span>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks.onChapterSeek?.(chapter);
          this.callbacks.onSeek(chapter.startTime / (this.currentState?.duration || 1));
          this.closeAllDropdowns();
        });
        dropdown.appendChild(item);
      });
    }
  }

  /**
   * Close all dropdowns
   */
  private closeAllDropdowns(): void {
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
    this.bigPlayBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onTogglePlay();
    });

    // Progress bar events
    if (this.progressBar) {
      this.progressBar.addEventListener('mousedown', this.handleProgressMouseDown.bind(this));
      this.progressBar.addEventListener('mousemove', this.handleProgressHover.bind(this));
      this.progressBar.addEventListener('mouseleave', this.handleProgressLeave.bind(this));
      this.progressBar.addEventListener('click', this.handleProgressClick.bind(this));
    }

    // Volume slider events
    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('mousedown', this.handleVolumeMouseDown.bind(this));
      this.volumeSlider.addEventListener('click', this.handleVolumeClick.bind(this));
    }

    // Touch events
    if (this.progressBar) {
      this.progressBar.addEventListener('touchstart', this.handleProgressTouchStart.bind(this), { passive: false });
      this.progressBar.addEventListener('touchmove', this.handleProgressTouchMove.bind(this), { passive: false });
      this.progressBar.addEventListener('touchend', this.handleTouchEnd.bind(this));
    }

    // Controls visibility
    this.container.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.container.addEventListener('mouseleave', this.startHideTimer.bind(this));
    this.container.addEventListener('mouseenter', () => {
      this.showControls();
      this.resetHideTimer();
    });

    // Mobile gestures: double-tap seek, swipe volume/brightness, long press speed
    this.container.addEventListener('touchstart', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.vp-controls') || target.closest('.vp-big-play') || target.closest('.vp-poster-overlay')) return;
      const touch = e.touches[0];
      this.swipeStartY = touch.clientY;
      this.swipeStartX = touch.clientX;
      this.swipeActive = false;

      // Long press — increase speed while held
      if (this.gesturesConfig.enabled !== false) {
        this.longPressTimer = setTimeout(() => {
          this.isLongPressActive = true;
          this.savedSpeedBeforeLongPress = this.currentSpeed;
          const lps = this.gesturesConfig.longPressSpeed;
          const speed = typeof lps === 'number' ? lps : 2;
          this.callbacks.onPlaybackRateChange(speed);
          this.showSpeedFeedback(speed);
        }, 500);
      }
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
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
    }, { passive: true });

    this.container.addEventListener('touchend', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.vp-controls') || target.closest('.vp-big-play') || target.closest('.vp-poster-overlay')) {
        return;
      }

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
        if (zone === 'left') {
          this.callbacks.onRewind();
          this.showSeekFeedback('left');
        } else if (zone === 'right') {
          this.callbacks.onForward();
          this.showSeekFeedback('right');
        } else {
          this.callbacks.onFullscreenToggle();
        }
        this.showControls();
        this.resetHideTimer();
      } else {
        this.tapTimer = setTimeout(() => {
          this.tapTimer = null;
          if (this.isControlsVisible && !this.currentState?.paused) {
            this.hideControls();
          } else {
            this.showControls();
            this.resetHideTimer();
          }
        }, 200);
      }
    });

    // Keyboard shortcuts
    this.container.addEventListener('keydown', this.handleKeyDown.bind(this));

    // Desktop double-click: left/right third seeks, center toggles fullscreen
    this.container.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.vp-controls')) return;
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width / 3) {
        this.callbacks.onRewind();
        this.showSeekFeedback('left');
      } else if (x > (rect.width * 2) / 3) {
        this.callbacks.onForward();
        this.showSeekFeedback('right');
      } else {
        this.callbacks.onFullscreenToggle();
      }
    });
  }

  /**
   * Bind global events
   */
  private bindGlobalEvents(): void {
    document.addEventListener('mousemove', this.handleGlobalMouseMove.bind(this));
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target as Node)) {
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

    // Thumbnail preview
    if (this.thumbnailPreview?.hasCues()) {
      this.thumbnailPreview.show(time, pos * 100);
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
    const pos = (e.clientX - rect.left) / rect.width;
    this.callbacks.onSeek(Math.max(0, Math.min(1, pos)));
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
    // Don't handle if focused on input
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        this.callbacks.onTogglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.callbacks.onRewind();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.callbacks.onForward();
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
      case 'Escape':
        this.closeAllDropdowns();
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
    this.hideControlsTimer = setTimeout(() => this.hideControls(), 3000);
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
    const wasDuration = this.currentState?.duration ?? 0;
    this.currentState = state;

    // Render chapter markers once duration becomes available for the first time
    if (state.duration > 0 && wasDuration === 0 && this.chapters.length > 0) {
      this.renderChapterMarkers();
    }

    // Update play/pause button
    if (this.playPauseBtn) {
      const inner = this.playPauseBtn.querySelector('.vp-btn-inner');
      if (inner) {
        inner.innerHTML = state.playing ? Icons.pause : Icons.play;
      }
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

    // Track first play
    if (state.playing && this.isInitialPlay) {
      this.isInitialPlay = false;
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
          const fill = segment.firstElementChild as HTMLElement | null;
          if (fill && segDur > 0) {
            const pct = Math.min(1, Math.max(0, (state.currentTime - chapter.startTime) / segDur)) * 100;
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
      const inner = this.muteBtn.querySelector('.vp-btn-inner');
      if (inner) inner.innerHTML = Icons[icon];
      this.muteBtn.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
    }

    // Update fullscreen button
    if (this.fullscreenBtn) {
      const inner = this.fullscreenBtn.querySelector('.vp-btn-inner');
      if (inner) inner.innerHTML = state.fullscreen ? Icons.fullscreenExit : Icons.fullscreen;
      this.fullscreenBtn.setAttribute('aria-label', state.fullscreen ? 'Exit Fullscreen' : 'Fullscreen');
    }

    // Update PIP button
    if (this.pipBtn) {
      const inner = this.pipBtn.querySelector('.vp-btn-inner');
      if (inner) inner.innerHTML = state.pip ? Icons.pipExit : Icons.pip;
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
      // Use chevronLeft icon for prev
      const inner = this.prevBtn.querySelector('.vp-btn-inner');
      if (inner) inner.innerHTML = Icons.chevronLeft;
      this.prevBtn.setAttribute('aria-label', 'Previous video');
      this.prevBtn.setAttribute('title', 'Previous video');
    }
    if (this.nextBtn) {
      this.nextBtn.style.display = hasNext ? '' : 'none';
      const inner = this.nextBtn.querySelector('.vp-btn-inner');
      if (inner) inner.innerHTML = Icons.chevronRight;
      this.nextBtn.setAttribute('aria-label', 'Next video');
      this.nextBtn.setAttribute('title', 'Next video');
    }
  }

  /**
   * Attach a ThumbnailPreview instance (called from VideoPlayer after VTT loads)
   */
  setThumbnailPreview(preview: ThumbnailPreview): void {
    this.thumbnailPreview = preview;
    // Mount preview element inside progress container
    if (this.progressContainer) {
      const el = preview['el'] as HTMLElement | null;
      if (el && !this.progressContainer.contains(el)) {
        this.progressContainer.appendChild(el);
      }
    }
  }

  /**
   * Update available quality levels
   */
  updateQualities(qualities: QualityLevel[], showAuto = true): void {
    this.qualityLevels = qualities;
    this.showAutoQuality = showAuto;
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

    if (!this.progressBar || !this.currentState?.duration) return;

    const duration = this.currentState.duration;

    if (this.chapters.length === 0) {
      this.progressBar.classList.remove('vp-progress--chaptered');
      if (this.progressFilled) this.progressFilled.style.display = '';
      return;
    }

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
    this.container.classList.toggle('vp-live', isLive);
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
    this.sizeObserver?.disconnect();
    if (this.hideControlsTimer) clearTimeout(this.hideControlsTimer);
    if (this.tapTimer) clearTimeout(this.tapTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    if (this.seekFeedbackTimer.left) clearTimeout(this.seekFeedbackTimer.left);
    if (this.seekFeedbackTimer.right) clearTimeout(this.seekFeedbackTimer.right);
    this.seekFeedbackEl.left?.remove();
    this.seekFeedbackEl.right?.remove();
    this.thumbnailPreview?.destroy();

    this.controlsElement?.remove();
    this.posterOverlay?.remove();
    this.loadingIndicator?.remove();
    this.gradientTop?.remove();
    this.gradientBottom?.remove();
    this.titleElement?.remove();
    this.actionIndicator?.remove();
  }
}
