/**
 * Video Player Web Component
 * 
 * Custom Element wrapper for the video player.
 * Provides framework-agnostic integration via standard Web Components API.
 * 
 * Usage:
 * <video-player
 *   src="https://example.com/video.m3u8"
 *   source-type="hls"
 *   mode="vod"
 *   poster="https://example.com/poster.jpg"
 *   autoplay
 * ></video-player>
 */

import { VideoPlayer, createVideoPlayer } from './components/VideoPlayer';
import type {
  PlayerConfig,
  VideoSource,
  VideoSourceType,
  PlayerMode,
  PlayerTheme,
  WatermarkConfig,
  AntiPiracyTextConfig,
  QualityConfig,
  ControlsConfig,
  AnalyticsConfig,
  LMSProgressConfig,
  PlayerState,
  QualityLevel,
  SubtitleTrack,
  Chapter,
} from './types';

// ============================================================================
// ATTRIBUTE PARSING HELPERS
// ============================================================================

function parseBoolean(value: string | null): boolean {
  return value !== null && value !== 'false';
}

function parseNumber(value: string | null, defaultValue: number): number {
  if (value === null) return defaultValue;
  const num = parseFloat(value);
  return isNaN(num) ? defaultValue : num;
}

function parseJSON<T>(value: string | null, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

// ============================================================================
// OBSERVED ATTRIBUTES
// ============================================================================

const OBSERVED_ATTRIBUTES = [
  // Source
  'src', 'source-type', 'poster', 'title',
  // Mode & Theme
  'mode', 'accent-color', 'theme',
  // Playback
  'autoplay', 'muted', 'loop', 'preload', 'playback-rate',
  // Controls
  'controls', 'keyboard-shortcuts',
  // Watermark
  'watermark-enabled', 'watermark-text', 'watermark-image',
  'watermark-position', 'watermark-opacity',
  // Anti-Piracy Text
  'antipiracy-enabled', 'antipiracy-text', 'antipiracy-opacity', 'antipiracy-color',
  // Quality
  'quality-allowed', 'quality-default', 'quality-show-auto',
  // Analytics
  'analytics-enabled', 'analytics-tenant-id', 'analytics-user-id', 'analytics-video-id',
  // LMS
  'lms-enabled', 'lms-video-id', 'lms-user-id',
  // Debug
  'debug',
] as const;

// ============================================================================
// VIDEO PLAYER WEB COMPONENT
// ============================================================================

/**
 * Custom Element for Video Player
 */
const SSRHTMLElement = (typeof window === 'undefined'
  ? class {}
  : HTMLElement) as unknown as typeof HTMLElement;

export class VideoPlayerElement extends SSRHTMLElement {
  private player: VideoPlayer | null = null;
  private initialized = false;
  private pendingConfig: Partial<PlayerConfig> = {};
  private _config: Partial<PlayerConfig> = {};

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  constructor() {
    super();
  }

  connectedCallback(): void {
    // Initialize player when connected to DOM
    if (!this.initialized) {
      this.initializePlayer();
    }
  }

  disconnectedCallback(): void {
    this.destroy();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;

    if (this.initialized && this.player) {
      this.handleAttributeChange(name, newValue);
    } else if (name === 'src' && newValue) {
      this.initializePlayer();
    }
  }

  /**
   * Initialize player with configuration (for programmatic usage)
   */
  initialize(config: PlayerConfig): void {
    if (this.initialized && this.player) {
      this.player.updateConfig(config);
      return;
    }

    try {
      this.player = createVideoPlayer(this, config);
      this.initialized = true;

      this.dispatchEvent(new CustomEvent('ready', { 
        detail: { player: this.player },
        bubbles: true 
      }));
    } catch (error) {
      console.error('[VideoPlayerElement] Failed to initialize:', error);
    }
  }

  /**
   * Initialize the player with current attributes
   */
  private initializePlayer(): void {
    if (this.initialized) return;
    const config = this.buildConfigFromAttributes();
    
    if (!config.source.src) {
      if (parseBoolean(this.getAttribute('debug'))) {
        console.warn('[VideoPlayerElement] No source specified');
      }
      return;
    }

    try {
      this._config = { ...config, ...this.pendingConfig };
      this.player = createVideoPlayer(this, this._config as PlayerConfig);
      this.initialized = true;
      this.pendingConfig = {};
      
      // Dispatch ready event
      this.dispatchEvent(new CustomEvent('ready', { 
        detail: { player: this.player },
        bubbles: true 
      }));
    } catch (error) {
      console.error('[VideoPlayerElement] Failed to initialize:', error);
    }
  }

  /**
   * Build configuration from HTML attributes
   */
  private buildConfigFromAttributes(): PlayerConfig {
    const source: VideoSource = {
      src: this.getAttribute('src') ?? '',
      type: (this.getAttribute('source-type') as VideoSourceType) ?? 'auto',
      poster: this.getAttribute('poster') ?? undefined,
      title: this.getAttribute('title') ?? undefined,
    };

    const watermarkImage = this.getAttribute('watermark-image');
    const watermarkText = this.getAttribute('watermark-text');
    const watermarkEnabled = parseBoolean(this.getAttribute('watermark-enabled'));
    
    const watermark: WatermarkConfig | undefined = (watermarkEnabled || watermarkImage || watermarkText) ? {
      enabled: watermarkEnabled,
      imageUrl: watermarkImage ?? undefined,
      text: watermarkText ?? undefined,
      position: (this.getAttribute('watermark-position') as WatermarkConfig['position']) ?? 'top-right',
      opacity: parseNumber(this.getAttribute('watermark-opacity'), 0.5),
    } : undefined;

    // Anti-piracy text config
    const antipiracyEnabled = parseBoolean(this.getAttribute('antipiracy-enabled'));
    const antipiracyText = this.getAttribute('antipiracy-text');
    const antipiracyColor = this.getAttribute('antipiracy-color');
    const antiPiracyText = antipiracyEnabled || antipiracyText ? {
      enabled: antipiracyEnabled,
      text: antipiracyText ?? '',
      opacity: parseNumber(this.getAttribute('antipiracy-opacity'), 0.3),
      color: antipiracyColor ?? undefined,
    } : undefined;

    // Quality config
    const qualityAllowedAttr = this.getAttribute('quality-allowed');
    const allowedQualities = qualityAllowedAttr 
      ? qualityAllowedAttr.split(',').map((q: string) => parseInt(q.trim(), 10)).filter((q: number) => !isNaN(q))
      : undefined;
    const qualityDefault = this.getAttribute('quality-default');
    const showAuto = this.getAttribute('quality-show-auto');
    
    const quality = (allowedQualities || qualityDefault || showAuto !== null) ? {
      allowedQualities,
      defaultQuality: qualityDefault === 'auto' ? 'auto' as const : qualityDefault ? parseInt(qualityDefault, 10) : undefined,
      showAuto: showAuto !== null ? parseBoolean(showAuto) : true,
    } : undefined;

    const theme: PlayerTheme = parseJSON<PlayerTheme>(this.getAttribute('theme'), {});
    
    // Apply accent color to theme
    const accentColor = this.getAttribute('accent-color');
    if (accentColor) {
      theme.accentColor = accentColor;
    }

    const controls: ControlsConfig = parseJSON<ControlsConfig>(this.getAttribute('controls'), {});

    const analytics: AnalyticsConfig = {
      enabled: parseBoolean(this.getAttribute('analytics-enabled')),
      tenantId: this.getAttribute('analytics-tenant-id') ?? undefined,
      userId: this.getAttribute('analytics-user-id') ?? undefined,
      videoId: this.getAttribute('analytics-video-id') ?? undefined,
    };

    const lmsProgress: LMSProgressConfig | undefined = parseBoolean(this.getAttribute('lms-enabled'))
      ? {
          enabled: true,
          videoId: this.getAttribute('lms-video-id') ?? this.getAttribute('analytics-video-id') ?? 'unknown',
          userId: this.getAttribute('lms-user-id') ?? this.getAttribute('analytics-user-id') ?? 'anonymous',
        }
      : undefined;

    // Parse chapters from attribute
    const chaptersAttr = this.getAttribute('chapters');
    const chapters: Chapter[] = chaptersAttr ? parseJSON<Chapter[]>(chaptersAttr, []) : [];

    // Parse subtitles from attribute
    const subtitlesAttr = this.getAttribute('subtitles');
    const subtitles: SubtitleTrack[] = subtitlesAttr ? parseJSON<SubtitleTrack[]>(subtitlesAttr, []) : [];

    return {
      source,
      mode: (this.getAttribute('mode') as PlayerMode) ?? 'vod',
      autoplay: parseBoolean(this.getAttribute('autoplay')),
      muted: parseBoolean(this.getAttribute('muted')),
      loop: parseBoolean(this.getAttribute('loop')),
      preload: (this.getAttribute('preload') as 'none' | 'metadata' | 'auto') ?? 'metadata',
      theme,
      watermark,
      antiPiracyText,
      quality,
      controls,
      analytics,
      lmsProgress,
      keyboardShortcuts: parseBoolean(this.getAttribute('keyboard-shortcuts') ?? 'true'),
      debug: parseBoolean(this.getAttribute('debug')),
      chapters,
      subtitles,
    };
  }

  /**
   * Handle attribute changes
   */
  private handleAttributeChange(name: string, value: string | null): void {
    if (!this.player) return;

    switch (name) {
      case 'src':
        if (value) {
          this.player.loadSource({
            src: value,
            type: (this.getAttribute('source-type') as VideoSourceType) ?? 'auto',
          });
        }
        break;

      case 'mode':
        this.player.updateConfig({ mode: value as PlayerMode });
        break;

      case 'accent-color':
        this.player.updateConfig({ 
          theme: { accentColor: value ?? undefined }
        });
        break;

      case 'muted':
        if (parseBoolean(value) !== this.getState().muted) {
          this.toggleMute();
        }
        break;

      case 'watermark-enabled':
      case 'watermark-image':
      case 'watermark-text':
      case 'watermark-position':
      case 'watermark-opacity':
        this.player.updateConfig({
          watermark: {
            enabled: parseBoolean(this.getAttribute('watermark-enabled')),
            imageUrl: this.getAttribute('watermark-image') ?? undefined,
            text: this.getAttribute('watermark-text') ?? undefined,
            position: (this.getAttribute('watermark-position') as WatermarkConfig['position']) ?? 'top-right',
            opacity: parseNumber(this.getAttribute('watermark-opacity'), 0.5),
          },
        });
        break;

      case 'antipiracy-enabled':
      case 'antipiracy-text':
      case 'antipiracy-opacity':
      case 'antipiracy-color':
        this.player.updateConfig({
          antiPiracyText: {
            enabled: parseBoolean(this.getAttribute('antipiracy-enabled')),
            text: this.getAttribute('antipiracy-text') ?? '',
            opacity: parseNumber(this.getAttribute('antipiracy-opacity'), 0.3),
            color: this.getAttribute('antipiracy-color') ?? undefined,
          },
        });
        break;

      case 'quality-allowed':
      case 'quality-default':
      case 'quality-show-auto':
        const qualityAllowedAttr = this.getAttribute('quality-allowed');
        const allowedQualities = qualityAllowedAttr 
          ? qualityAllowedAttr.split(',').map((q: string) => parseInt(q.trim(), 10)).filter((q: number) => !isNaN(q))
          : undefined;
        const qualityDefault = this.getAttribute('quality-default');
        const showAuto = this.getAttribute('quality-show-auto');
        
        this.player.updateConfig({
          quality: {
            allowedQualities,
            defaultQuality: qualityDefault === 'auto' ? 'auto' as const : qualityDefault ? parseInt(qualityDefault, 10) : undefined,
            showAuto: showAuto !== null ? parseBoolean(showAuto) : true,
          },
        });
        break;
    }
  }

  // ============================================================================
  // PLAYER API IMPLEMENTATION
  // ============================================================================

  play(): Promise<void> {
    return this.player?.play() ?? Promise.resolve();
  }

  pause(): void {
    this.player?.pause();
  }

  togglePlay(): void {
    this.player?.togglePlay();
  }

  seek(time: number): void {
    this.player?.seek(time);
  }

  setVolume(volume: number): void {
    this.player?.setVolume(volume);
  }

  toggleMute(): void {
    this.player?.toggleMute();
  }

  setPlaybackRate(rate: number): void {
    this.player?.setPlaybackRate(rate);
  }

  toggleFullscreen(): void {
    this.player?.toggleFullscreen();
  }

  enterFullscreen(): Promise<void> {
    return this.toggleFullscreen(), Promise.resolve();
  }

  exitFullscreen(): Promise<void> {
    return this.toggleFullscreen(), Promise.resolve();
  }

  togglePip(): void {
    this.player?.togglePip();
  }

  enterPip(): Promise<void> {
    return this.togglePip(), Promise.resolve();
  }

  exitPip(): Promise<void> {
    return this.togglePip(), Promise.resolve();
  }

  getState(): PlayerState {
    return this.player?.getState() ?? {
      playing: false,
      paused: true,
      ended: false,
      buffering: false,
      canPlay: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
      volume: 1,
      muted: false,
      playbackRate: 1,
      fullscreen: false,
      pip: false,
      qualities: [],
      isLive: false,
    };
  }

  getQualityLevels(): QualityLevel[] {
    return this.getState().qualities ?? [];
  }

  setQuality(level: QualityLevel | 'auto'): void {
    this.player?.setQuality(level);
  }

  getSubtitleTracks(): SubtitleTrack[] {
    return [];
  }

  setSubtitle(track: SubtitleTrack | null): void {
    this.player?.setSubtitle(track);
  }

  loadSource(source: VideoSource): void {
    this.player?.loadSource(source);
  }

  updateConfig(config: Partial<PlayerConfig>): void {
    this._config = { ...this._config, ...config };
    if (this.player) {
      this.player.updateConfig(config);
    } else {
      this.pendingConfig = { ...this.pendingConfig, ...config };
    }
  }

  destroy(): void {
    this.player?.destroy();
    this.player = null;
    this.initialized = false;
  }

  // ============================================================================
  // NEW VIDSTREAM INSTANCE API
  // ============================================================================

  next(): void { this.player?.next(); }
  prev(): void { this.player?.prev(); }
  goTo(index: number): void { this.player?.goTo(index); }

  on(event: string, handler: Function): void { this.player?.on(event, handler); }
  off(event: string, handler: Function): void { this.player?.off(event, handler); }
  once(event: string, handler: Function): void { this.player?.once(event, handler); }

  setMuted(muted: boolean): void { this.player?.setMuted(muted); }
  setSpeed(rate: number): void { this.player?.setSpeed(rate); }
  getCurrentTime(): number { return this.player?.getCurrentTime() ?? 0; }
  getDuration(): number { return this.player?.getDuration() ?? 0; }
  getVolume(): number { return this.player?.getVolume() ?? 1; }
  isPaused(): boolean { return this.player?.isPaused() ?? true; }
  getQuality(): string | number { return this.player?.getQuality() ?? 'auto'; }

  get sessionId(): string { return this.player?.sessionId ?? ''; }

  // ============================================================================
  // CONVENIENCE PROPERTIES
  // ============================================================================

  get currentTime(): number {
    return this.getState().currentTime;
  }

  set currentTime(value: number) {
    this.seek(value);
  }

  get duration(): number {
    return this.getState().duration;
  }

  get paused(): boolean {
    return this.getState().paused;
  }

  get volume(): number {
    return this.getState().volume;
  }

  set volume(value: number) {
    this.setVolume(value);
  }

  get muted(): boolean {
    return this.getState().muted;
  }

  set muted(value: boolean) {
    if (value !== this.muted) {
      this.toggleMute();
    }
  }

  get playbackRate(): number {
    return this.getState().playbackRate;
  }

  set playbackRate(value: number) {
    this.setPlaybackRate(value);
  }

  get isFullscreen(): boolean {
    return this.getState().fullscreen;
  }

  get isPip(): boolean {
    return this.getState().pip;
  }

  // Support both camelCase, kebab-case, and lowercase variations for all platforms
  get src(): string {
    return this.getAttribute('src') ?? '';
  }

  set src(value: string) {
    this.setAttribute('src', value);
    if (!this.initialized && value) {
      this.initializePlayer();
    }
  }

  get sourceType(): string {
    return this.getAttribute('source-type') ?? 'auto';
  }

  set sourceType(value: string) {
    this.setAttribute('source-type', value);
  }

  get 'source-type'(): string {
    return this.sourceType;
  }

  set 'source-type'(value: string) {
    this.sourceType = value;
  }

  get theme(): PlayerTheme {
    return this._config.theme ?? this.pendingConfig.theme ?? {};
  }

  set theme(value: PlayerTheme) {
    this.updateConfig({ theme: value });
  }

  get watermark(): WatermarkConfig {
    return this._config.watermark ?? this.pendingConfig.watermark ?? { enabled: false };
  }

  set watermark(value: WatermarkConfig) {
    this.updateConfig({ watermark: value });
  }

  get antiPiracyText(): AntiPiracyTextConfig {
    return this._config.antiPiracyText ?? this.pendingConfig.antiPiracyText ?? { enabled: false, text: '' };
  }

  set antiPiracyText(value: AntiPiracyTextConfig) {
    this.updateConfig({ antiPiracyText: value });
  }

  get 'anti-piracy-text'(): AntiPiracyTextConfig {
    return this.antiPiracyText;
  }

  set 'anti-piracy-text'(value: AntiPiracyTextConfig) {
    this.antiPiracyText = value;
  }

  get antipiracytext(): AntiPiracyTextConfig {
    return this.antiPiracyText;
  }

  set antipiracytext(value: AntiPiracyTextConfig) {
    this.antiPiracyText = value;
  }

  get antipiracyText(): AntiPiracyTextConfig {
    return this.antiPiracyText;
  }

  set antipiracyText(value: AntiPiracyTextConfig) {
    this.antiPiracyText = value;
  }

  get controls(): ControlsConfig {
    return this._config.controls ?? this.pendingConfig.controls ?? {};
  }

  set controls(value: ControlsConfig) {
    this.updateConfig({ controls: value });
  }

  get quality(): QualityConfig {
    return this._config.quality ?? this.pendingConfig.quality ?? {};
  }

  set quality(value: QualityConfig) {
    this.updateConfig({ quality: value });
  }

  get analytics(): AnalyticsConfig {
    return this._config.analytics ?? this.pendingConfig.analytics ?? { enabled: false };
  }

  set analytics(value: AnalyticsConfig) {
    this.updateConfig({ analytics: value });
  }

  get lmsProgress(): LMSProgressConfig {
    return this._config.lmsProgress ?? this.pendingConfig.lmsProgress ?? { enabled: false, videoId: '', userId: '' };
  }

  set lmsProgress(value: LMSProgressConfig) {
    this.updateConfig({ lmsProgress: value });
  }

  get keyboardShortcuts(): boolean {
    return parseBoolean(this.getAttribute('keyboard-shortcuts') ?? 'true');
  }

  set keyboardShortcuts(value: boolean) {
    this.setAttribute('keyboard-shortcuts', String(value));
  }

  get 'keyboard-shortcuts'(): boolean {
    return this.keyboardShortcuts;
  }

  set 'keyboard-shortcuts'(value: boolean) {
    this.keyboardShortcuts = value;
  }

  get accentColor(): string {
    return this.getAttribute('accent-color') ?? '';
  }

  set accentColor(value: string) {
    this.setAttribute('accent-color', value);
  }

  get 'accent-color'(): string {
    return this.accentColor;
  }

  set 'accent-color'(value: string) {
    this.accentColor = value;
  }

  /**
   * Set video chapters
   */
  setChapters(chapters: Chapter[]): void {
    if (this.player) {
      this.player.setChapters(chapters);
    } else {
      this.pendingConfig = { ...this.pendingConfig, chapters };
    }
  }
}

// ============================================================================
// REGISTER WEB COMPONENT
// ============================================================================

/**
 * Register the custom element
 */
export function registerVideoPlayerElement(tagName = 'video-player'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, VideoPlayerElement);
  }
}

// Auto-register if in browser environment
if (typeof window !== 'undefined') {
  registerVideoPlayerElement();
}

// ============================================================================
// GLOBAL SDK INTERFACE
// ============================================================================

/**
 * Global SDK interface for utilities
 */
export const VidstreamPlayer = {
  /**
   * Get SDK version
   */
  version: '1.0.0',

  /**
   * Create player instance programmatically
   */
  create(container: HTMLElement | string, config: PlayerConfig): VideoPlayer {
    return createVideoPlayer(container, config);
  },

  /**
   * Register the web component with a custom tag name
   */
  register(tagName = 'video-player'): void {
    registerVideoPlayerElement(tagName);
  },
};

// Expose globally for script tag usage
if (typeof window !== 'undefined') {
  (window as any).VidstreamPlayer = VidstreamPlayer;
}

export default VideoPlayerElement;
