/**
 * vidstream-player
 * 
 * Production-ready customizable video player SDK
 * Supports OTT streaming and LMS platforms
 * 
 * @packageDocumentation
 */

// ============================================================================
// CORE EXPORTS
// ============================================================================

export { VideoPlayer, createVideoPlayer } from './components/VideoPlayer';
export { VideoPlayerElement, registerVideoPlayerElement, VidstreamPlayer } from './webcomponent';

// ============================================================================
// COMPONENT EXPORTS
// ============================================================================

export { ControlsManager, defaultControlsConfig } from './components/PlayerControls';
export { WatermarkManager, AntiPiracyTextManager, createWatermark, createAntiPiracyText, getWatermarkStyles } from './components/WatermarkOverlay';
export {
  ThemeManager,
  createThemeManager,
  getBaseStyles,
  defaultDarkTheme,
} from './components/PlayerTheme';
export { Icons, createIcon } from './components/Icons';

// ============================================================================
// NEW FEATURE EXPORTS
// ============================================================================

export { EventBus } from './services/eventBus';
export { ErrorRecoveryManager } from './services/errorRecovery';
export { ThumbnailPreview } from './components/ThumbnailPreview';
export { MiniPlayer } from './components/MiniPlayer';
export { PlaylistManager } from './components/PlaylistManager';

// ============================================================================
// SERVICE EXPORTS
// ============================================================================

export {
  AnalyticsManager,
  ConsoleAnalyticsAdapter,
  HttpAnalyticsAdapter,
  createAnalyticsAdapter,
  createExampleBackendAdapter,
} from './services/analyticsAdapter';

export {
  LMSProgressManager,
  saveProgressToStorage,
  loadProgressFromStorage,
  clearProgressFromStorage,
  getAllProgressFromStorage,
  createProgressAPICallbacks,
} from './services/lmsProgressService';

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  // Source types
  VideoSource,
  VideoSourceType,

  // Player configuration
  PlayerConfig,
  PlayerMode,
  PlayerTheme,
  ControlsConfig,

  // Watermark & Anti-Piracy
  WatermarkConfig,
  WatermarkPosition,
  AntiPiracyTextConfig,

  // Quality
  QualityConfig,

  // Analytics
  AnalyticsConfig,
  AnalyticsAdapter,
  AnalyticsEventName,
  AnalyticsEventPayload,

  // LMS Progress
  LMSProgressConfig,
  LMSProgressData,
  ProgressMilestone,

  // Security
  SecurityConfig,
  SDKAuthConfig,

  // Chapters
  Chapter,

  // Subtitles & Quality
  SubtitleTrack,
  QualityLevel,

  // Player state & API
  PlayerState,
  PlayerAPI,
  PlayerError,
  VidstreamPlayerInstance,

  // Events
  PlayerEventDetail,
  PlayerEvents,
  PlayerCustomEvent,
  PlayEvent,
  PauseEvent,
  SeekEvent,
  EndedEvent,
  TimeUpdateEvent,
  QualityChangeEvent,
  BufferingEvent,
  ChapterChangeEvent,
  PlaylistChangeEvent,

  // New features
  GesturesConfig,
  ErrorRecoveryConfig,
  VidstreamError,
  VidstreamErrorCode,
  PipConfig,
  MiniPlayerConfig,
  PlaylistItem,
  PlaylistOptions,
  VidstreamAnalyticsPlugin,
  PluginsConfig,

  // Utilities
  DeepPartial,
} from './types';

// ============================================================================
// VERSION
// ============================================================================

export const VERSION = '1.0.0';
