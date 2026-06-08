/**
 * vidstream-player - Type Definitions
 */

// ============================================================================
// SOURCE TYPES
// ============================================================================

export type VideoSourceType = 'mp4' | 'hls' | 'webm' | 'dash' | 'auto';

export interface VideoSource {
  src: string;
  type?: VideoSourceType;
  title?: string;
  poster?: string;
  /** URL to WebVTT sprite sheet for seek thumbnails */
  thumbnails?: string;
}

// ============================================================================
// PLAYER MODE TYPES
// ============================================================================

export type PlayerMode = 'vod' | 'live';

// ============================================================================
// WATERMARK TYPES
// ============================================================================

export type WatermarkPosition =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'center'
  | 'center-bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center'
  | 'random';

export interface WatermarkConfig {
  enabled: boolean;
  /** Inline SVG string — rendered directly into the DOM. Takes priority over imageUrl and text. */
  svgContent?: string;
  imageUrl?: string;
  text?: string;
  opacity?: number;
  imageWidth?: string;
  imageHeight?: string;
  position?: WatermarkPosition;
  className?: string;
}

export interface AntiPiracyTextConfig {
  enabled: boolean;
  text: string;
  opacity?: number;
  fontSize?: string;
  color?: string;
  minInterval?: number;
  maxInterval?: number;
  className?: string;
}

// ============================================================================
// QUALITY TYPES
// ============================================================================

export interface QualityConfig {
  allowedQualities?: number[];
  defaultQuality?: number | 'auto';
  showAuto?: boolean;
}

export interface QualityLevel {
  height: number;
  width?: number;
  bitrate?: number;
  label: string;
  active?: boolean;
}

// ============================================================================
// THEME TYPES
// ============================================================================

export interface PlayerTheme {
  primaryColor?: string;
  accentColor?: string;
  textColor?: string;
  controlBg?: string;
  progressColor?: string;
  bufferColor?: string;
  hoverColor?: string;
  borderRadius?: string;
  logoUrl?: string;
  logoPosition?: 'top-left' | 'top-right';
  tenantName?: string;
  fontFamily?: string;
  iconSize?: string;
  tooltipBg?: string;
}

// ============================================================================
// CONTROLS CONFIGURATION
// ============================================================================

export interface ControlsConfig {
  playPause?: boolean;
  seekBar?: boolean;
  progress?: boolean;
  currentTime?: boolean;
  duration?: boolean;
  volume?: boolean;
  mute?: boolean;
  playbackSpeed?: boolean;
  fullscreen?: boolean;
  pip?: boolean;
  subtitles?: boolean;
  /** Show quality selector button. Alias: qualitySelector */
  quality?: boolean;
  qualitySelector?: boolean;
  forward?: boolean;
  rewind?: boolean;
  liveIndicator?: boolean;
  settings?: boolean;
  chapters?: boolean;
  seekDuration?: number;
  playlist?: boolean;
}

// ============================================================================
// GESTURE TYPES
// ============================================================================

export interface GesturesConfig {
  /** Default: true on touch devices, false on desktop */
  enabled?: boolean;
  /** Seconds to seek on double-tap. Default: 10. Alias: seekSeconds */
  doubleTapSeek?: number;
  seekSeconds?: number;
  /** Enable double-tap left/right zones. Default: true */
  doubleTapZones?: boolean;
  /** Enable swipe up/down on right half for volume. Default: true */
  swipeVolume?: boolean;
  /** Speed on long press. true = 2×, number = custom multiplier. Default: 2 */
  longPressSpeed?: boolean | number;
}

// ============================================================================
// ERROR RECOVERY TYPES
// ============================================================================

export type VidstreamErrorCode = 'NETWORK_ERROR' | 'DECODE_ERROR' | 'SRC_NOT_SUPPORTED' | 'STREAM_ENDED';

export interface VidstreamError {
  code: VidstreamErrorCode;
  message: string;
  fatal: boolean;
  timestamp: number;
}

export interface ErrorRecoveryConfig {
  /** Default: true */
  enabled?: boolean;
  /** Default: 3 */
  maxRetries?: number;
  /** Default: 2000ms */
  retryDelay?: number;
  onError?: (error: VidstreamError) => void;
}

// ============================================================================
// PIP + MINI PLAYER TYPES
// ============================================================================

export interface PipConfig {
  /** Default: true */
  enabled?: boolean;
  /** Show PiP button in controls. Default: true */
  button?: boolean;
}

export interface MiniPlayerConfig {
  /** Default: false — opt-in */
  enabled?: boolean;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Default: 320 */
  width?: number;
}

// ============================================================================
// PLAYLIST TYPES
// ============================================================================

export interface PlaylistItem {
  src: string;
  title?: string;
  poster?: string;
  duration?: number;
  thumbnailVtt?: string;
  chapters?: Chapter[];
}

export interface PlaylistOptions {
  /** Auto-advance to next item on end. Default: true */
  autoNext?: boolean;
  /** Loop playlist. Default: false */
  loop?: boolean;
  /** Show playlist sidebar panel. Default: false */
  showPanel?: boolean;
  /** Starting index. Default: 0 */
  startIndex?: number;
}

// ============================================================================
// ANALYTICS / PLUGIN TYPES
// ============================================================================

export interface VidstreamAnalyticsPlugin {
  name: string;
  apiKey?: string;
  init: (player: VidstreamPlayerInstance) => void;
  destroy?: () => void;
}

export interface PluginsConfig {
  analytics?: VidstreamAnalyticsPlugin;
}

// Typed event payloads for analytics integration
export interface PlayEvent {
  currentTime: number;
  src: string;
  sessionId: string;
}

export interface PauseEvent {
  currentTime: number;
  src: string;
  sessionId: string;
}

export interface SeekEvent {
  fromTime: number;
  toTime: number;
  src: string;
  sessionId: string;
}

export interface EndedEvent {
  src: string;
  sessionId: string;
}

export interface TimeUpdateEvent {
  currentTime: number;
  duration: number;
  percent: number;
  src: string;
  sessionId: string;
}

export interface QualityChangeEvent {
  fromQuality: string | number;
  toQuality: string | number;
  auto: boolean;
  sessionId: string;
}

export interface BufferingEvent {
  currentTime: number;
  duration: number;
  sessionId: string;
}

export interface ChapterChangeEvent {
  chapter: Chapter;
  index: number;
  sessionId: string;
}

export interface PlaylistChangeEvent {
  index: number;
  item: PlaylistItem;
  sessionId: string;
}

// ============================================================================
// ANALYTICS TYPES (existing, unchanged)
// ============================================================================

export type AnalyticsEventName =
  | 'player_loaded'
  | 'source_loaded'
  | 'play'
  | 'pause'
  | 'ended'
  | 'seek_start'
  | 'seek_end'
  | 'time_update'
  | 'quality_changed'
  | 'volume_changed'
  | 'mute_toggled'
  | 'fullscreen_enter'
  | 'fullscreen_exit'
  | 'pip_enter'
  | 'pip_exit'
  | 'playback_rate_changed'
  | 'subtitle_changed'
  | 'error'
  | 'buffering'
  | 'can_play'
  | 'heartbeat'
  | 'session_start'
  | 'session_end'
  | 'milestone_reached'
  | 'progress_saved';

export interface AnalyticsEventPayload {
  eventName: AnalyticsEventName;
  tenantId?: string;
  userId?: string;
  videoId?: string;
  sessionId: string;
  currentTime: number;
  duration: number;
  sourceUrl: string;
  quality?: string;
  volume: number;
  muted: boolean;
  playbackRate: number;
  timestamp: string;
  platform?: string;
  userAgent: string;
  customData?: Record<string, unknown>;
}

export interface AnalyticsAdapter {
  trackEvent(payload: AnalyticsEventPayload): void | Promise<void>;
  flush?(): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface AnalyticsConfig {
  enabled: boolean;
  tenantId?: string;
  userId?: string;
  videoId?: string;
  heartbeatInterval?: number;
  timeUpdateThrottle?: number;
  adapter?: AnalyticsAdapter;
  platform?: string;
  customData?: Record<string, unknown>;
}

// ============================================================================
// LMS PROGRESS TYPES
// ============================================================================

export type ProgressMilestone = 25 | 50 | 75 | 90 | 100;

export interface LMSProgressData {
  videoId: string;
  userId?: string;
  currentTime: number;
  duration: number;
  watchedPercentage: number;
  milestonesReached: ProgressMilestone[];
  hasStarted: boolean;
  isCompleted: boolean;
  lastUpdated: string;
}

export interface LMSProgressConfig {
  enabled: boolean;
  videoId: string;
  userId?: string;
  saveInterval?: number;
  /** Which percentage points fire milestoneReached. Defaults to [25,50,75,90,100] */
  milestones?: ProgressMilestone[] | number[];
  initialProgress?: Partial<LMSProgressData>;
  onProgressSave?: (progress: LMSProgressData) => void | Promise<void>;
  onMilestoneReached?: (milestone: ProgressMilestone | number, progress?: LMSProgressData) => void | Promise<void>;
  onFirstPlay?: (progress?: LMSProgressData) => void | Promise<void>;
  onComplete?: (progress?: LMSProgressData) => void | Promise<void>;
}

// ============================================================================
// SECURITY TYPES
// ============================================================================

export interface SecurityConfig {
  getSignedPlaybackUrl?: (originalUrl: string) => Promise<string>;
  refreshPlaybackToken?: () => Promise<string>;
  onPlaybackAuthorizationError?: (error: Error) => void | Promise<void>;
  tokenHeaderName?: string;
  authToken?: string;
}

export interface SDKAuthConfig {
  apiKey: string;
  allowedDomains?: string[];
  onAuthError?: (error: Error) => void;
}

// ============================================================================
// CHAPTER TYPES
// ============================================================================

export interface Chapter {
  id: string;
  title: string;
  startTime: number;
  /** Alias for startTime — accepted in addition to startTime */
  time?: number;
  endTime?: number;
  thumbnail?: string;
  description?: string;
}

// ============================================================================
// SUBTITLE TYPES
// ============================================================================

export interface SubtitleTrack {
  src: string;
  label: string;
  language: string;
  kind?: 'subtitles' | 'captions';
  default?: boolean;
}

// ============================================================================
// MAIN PLAYER CONFIGURATION
// ============================================================================

export interface PlayerConfig {
  source: VideoSource;
  mode?: PlayerMode;
  theme?: PlayerTheme;
  watermark?: WatermarkConfig;
  antiPiracyText?: AntiPiracyTextConfig;
  quality?: QualityConfig;
  controls?: ControlsConfig;
  analytics?: AnalyticsConfig;
  lmsProgress?: LMSProgressConfig;
  security?: SecurityConfig;
  sdkAuth?: SDKAuthConfig;
  subtitles?: SubtitleTrack[];
  chapters?: Chapter[];
  /** URL to a WebVTT chapters file (alternative to chapters array) */
  chaptersVtt?: string;
  /** URL to a WebVTT sprite sheet for seek thumbnails */
  thumbnailVtt?: string;
  /** Touch gesture config */
  gestures?: GesturesConfig;
  /** Smart error recovery config */
  errorRecovery?: ErrorRecoveryConfig;
  /** Picture-in-Picture config */
  pip?: PipConfig;
  /** Scroll-triggered mini player config */
  miniPlayer?: MiniPlayerConfig;
  /** Playlist of videos */
  playlist?: PlaylistItem[];
  playlistOptions?: PlaylistOptions;
  /** Plugin slot for @vidstream/analytics and others */
  plugins?: PluginsConfig;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  startTime?: number;
  playbackRate?: number;
  preload?: 'none' | 'metadata' | 'auto';
  keyboardShortcuts?: boolean;
  debug?: boolean;
}

// ============================================================================
// PLAYER STATE TYPES
// ============================================================================

export interface PlayerState {
  playing: boolean;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  canPlay: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  fullscreen: boolean;
  pip: boolean;
  quality?: QualityLevel;
  qualities: QualityLevel[];
  activeSubtitle?: SubtitleTrack;
  isLive: boolean;
  error?: PlayerError;
  /** Current playlist index */
  playlistIndex?: number;
}

export interface PlayerError {
  code: string;
  message: string;
  originalError?: Error;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface PlayerEventDetail<T = unknown> {
  type: string;
  state: PlayerState;
  data?: T;
  timestamp: number;
}

export interface PlayerEvents {
  'player-play': PlayerEventDetail;
  'player-pause': PlayerEventDetail;
  'player-seek': PlayerEventDetail<{ from: number; to: number }>;
  'player-ended': PlayerEventDetail;
  'player-error': PlayerEventDetail<PlayerError>;
  'player-quality-change': PlayerEventDetail<QualityLevel>;
  'player-timeupdate': PlayerEventDetail<{ currentTime: number; duration: number }>;
  'player-heartbeat': PlayerEventDetail;
  'player-volumechange': PlayerEventDetail<{ volume: number; muted: boolean }>;
  'player-fullscreen': PlayerEventDetail<{ fullscreen: boolean }>;
  'player-pip': PlayerEventDetail<{ pip: boolean }>;
  'player-ratechange': PlayerEventDetail<{ rate: number }>;
  'player-ready': PlayerEventDetail;
  'player-loaded': PlayerEventDetail;
  'player-buffering': PlayerEventDetail<{ buffering: boolean }>;
  'player-milestone': PlayerEventDetail<{ milestone: ProgressMilestone }>;
  'player-progress-saved': PlayerEventDetail<LMSProgressData>;
  'player-chapter-change': PlayerEventDetail<ChapterChangeEvent>;
  'player-playlist-change': PlayerEventDetail<PlaylistChangeEvent>;
}

// ============================================================================
// PUBLIC PLAYER API
// ============================================================================

export interface PlayerAPI {
  play(): Promise<void>;
  pause(): void;
  togglePlay(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  setPlaybackRate(rate: number): void;
  enterFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  toggleFullscreen(): void;
  enterPip(): Promise<void>;
  exitPip(): Promise<void>;
  togglePip(): void;
  setQuality(quality: QualityLevel | 'auto'): void;
  setSubtitle(track: SubtitleTrack | null): void;
  getState(): PlayerState;
  loadSource(source: VideoSource): void;
  updateConfig(config: Partial<PlayerConfig>): void;
  destroy(): void;
}

/**
 * Extended instance interface — required for analytics plugin integration.
 * VideoPlayer implements this in addition to PlayerAPI.
 */
export interface VidstreamPlayerInstance {
  // Playback
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  setVolume(level: number): void;
  setMuted(muted: boolean): void;
  setSpeed(rate: number): void;
  setQuality(level: number | 'auto'): void;

  // State getters
  getCurrentTime(): number;
  getDuration(): number;
  getVolume(): number;
  isPaused(): boolean;
  isFullscreen(): boolean;
  getQuality(): string | number;

  // Playlist
  next(): void;
  prev(): void;
  goTo(index: number): void;

  // Event bus
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
  once(event: string, handler: Function): void;

  // Identity
  readonly sessionId: string;

  // Lifecycle
  destroy(): void;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type PlayerCustomEvent<K extends keyof PlayerEvents> = CustomEvent<PlayerEvents[K]>;
