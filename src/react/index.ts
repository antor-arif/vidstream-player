"use client";

/**
 * React Package Exports
 */

export {
  VideoPlayer,
  usePlayerState,
  usePlayerControls,
} from './VideoPlayer';

export { default } from './VideoPlayer';

export type {
  VideoPlayerProps,
  VideoPlayerRef,
  VidstreamPlayerRef,
} from './VideoPlayer';

// Re-export types
export type {
  PlayerConfig,
  VideoSource,
  VideoSourceType,
  PlayerMode,
  PlayerTheme,
  WatermarkConfig,
  ControlsConfig,
  AnalyticsConfig,
  LMSProgressConfig,
  PlayerState,
  PlayerAPI,
  QualityLevel,
  SubtitleTrack,
  ProgressMilestone,
  LMSProgressData,
  VidstreamPlayerInstance,
  GesturesConfig,
  ErrorRecoveryConfig,
  PipConfig,
  MiniPlayerConfig,
  PlaylistItem,
  PlaylistOptions,
  PluginsConfig,
  VidstreamAnalyticsPlugin,
  ChapterChangeEvent,
  PlaylistChangeEvent,
  LowLatencyConfig,
  P2PConfig,
  P2PStats,
  LatencyEvent,
  LiveConfig,
  LiveLatencyMode,
  LiveStartLevel,
  TokenRefreshEvent,
  LiveState,
  LiveMessages,
  LiveStateChangeEvent,
  LiveEdgeChangeEvent,
  AutoplayBlockedEvent,
  P2PProvider,
  LiveWatchStats,
} from '../types';
