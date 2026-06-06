"use client";

import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useState,
} from 'react';
import type {
  PlayerConfig,
  VideoSource,
  PlayerMode,
  PlayerTheme,
  WatermarkConfig,
  AntiPiracyTextConfig,
  QualityConfig,
  ControlsConfig,
  AnalyticsConfig,
  LMSProgressConfig,
  SecurityConfig,
  SDKAuthConfig,
  Chapter,
  PlayerState,
  PlayerAPI,
  QualityLevel,
  SubtitleTrack,
  GesturesConfig,
  ResumeConfig,
  ErrorRecoveryConfig,
  PipConfig,
  MiniPlayerConfig,
  PlaylistItem,
  PlaylistOptions,
  PluginsConfig,
} from '../types';
import { VideoPlayerElement, registerVideoPlayerElement } from '../webcomponent';

if (typeof window !== 'undefined') {
  registerVideoPlayerElement();
}

// ============================================================================
// TYPES
// ============================================================================

export interface VideoPlayerProps {
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
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  keyboardShortcuts?: boolean;
  startTime?: number;
  playbackRate?: number;
  debug?: boolean;

  // New feature props
  gestures?: GesturesConfig;
  resume?: ResumeConfig;
  errorRecovery?: ErrorRecoveryConfig;
  pip?: PipConfig;
  miniPlayer?: MiniPlayerConfig;
  playlist?: PlaylistItem[];
  playlistOptions?: PlaylistOptions;
  thumbnailVtt?: string;
  chaptersVtt?: string;
  plugins?: PluginsConfig;

  className?: string;
  style?: React.CSSProperties;

  // DOM event handlers (from CustomEvent dispatch)
  onReady?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onVolumeChange?: (volume: number, muted: boolean) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onPipChange?: (pip: boolean) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  onError?: (event: Event) => void;
  onBuffering?: (buffering: boolean) => void;
  onStateChange?: (state: PlayerState) => void;
  onChapterChange?: (event: CustomEvent) => void;
  onPlaylistChange?: (event: CustomEvent) => void;
}

export interface VideoPlayerRef extends PlayerAPI {
  // Playlist
  next(): void;
  prev(): void;
  goTo(index: number): void;
  // Event bus
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
  once(event: string, handler: Function): void;
  // Getters
  getCurrentTime(): number;
  getDuration(): number;
  getVolume(): number;
  isPaused(): boolean;
  getQuality(): string | number;
  get sessionId(): string;
  // Setters
  setMuted(muted: boolean): void;
  setSpeed(rate: number): void;
  // Element access
  getElement(): VideoPlayerElement | null;
}

// Alias for consumers who prefer this name
export type VidstreamPlayerRef = VideoPlayerRef;

// ============================================================================
// COMPONENT
// ============================================================================

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  (props, ref) => {
    const {
      source,
      mode = 'vod',
      theme,
      watermark,
      antiPiracyText,
      quality,
      controls,
      analytics,
      lmsProgress,
      security,
      sdkAuth,
      subtitles,
      chapters,
      autoplay = false,
      muted = false,
      loop = false,
      preload = 'metadata',
      keyboardShortcuts = true,
      startTime,
      playbackRate,
      debug = false,
      gestures,
      resume,
      errorRecovery,
      pip,
      miniPlayer,
      playlist,
      playlistOptions,
      thumbnailVtt,
      chaptersVtt,
      plugins,
      className,
      style,
      onReady,
      onPlay,
      onPause,
      onEnded,
      onTimeUpdate,
      onVolumeChange,
      onFullscreenChange,
      onPipChange,
      onQualityChange,
      onError,
      onBuffering,
      onStateChange,
      onChapterChange,
      onPlaylistChange,
    } = props;

    const elementRef = useRef<VideoPlayerElement | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // Build config and initialize once
    useEffect(() => {
      const element = elementRef.current;
      if (!element || isInitialized) return;

      const config: PlayerConfig = {
        source,
        mode,
        theme,
        watermark,
        antiPiracyText,
        quality,
        controls,
        analytics,
        lmsProgress,
        security,
        sdkAuth,
        subtitles,
        chapters,
        autoplay,
        muted,
        loop,
        preload,
        keyboardShortcuts,
        startTime,
        playbackRate,
        debug,
        gestures,
        resume,
        errorRecovery,
        pip,
        miniPlayer,
        playlist,
        playlistOptions,
        thumbnailVtt,
        chaptersVtt,
        plugins,
      } as PlayerConfig;

      element.initialize(config);
      setIsInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync config changes
    useEffect(() => {
      const element = elementRef.current;
      if (!element || !isInitialized) return;
      element.updateConfig({ mode, theme, watermark, antiPiracyText, controls });
    }, [mode, theme, watermark, antiPiracyText, controls, isInitialized]);

    // Reload source when src changes
    useEffect(() => {
      const element = elementRef.current;
      if (!element || !isInitialized) return;
      element.loadSource(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source.src, source.type, isInitialized]);

    // DOM event listeners
    useEffect(() => {
      const element = elementRef.current;
      if (!element) return;

      const handlers: Record<string, (e: CustomEvent) => void> = {
        'player-ready': () => onReady?.(),
        'player-play': () => onPlay?.(),
        'player-pause': () => onPause?.(),
        'player-ended': () => onEnded?.(),
        'player-timeupdate': (e) => {
          const { currentTime, duration } = e.detail?.data ?? {};
          onTimeUpdate?.(currentTime, duration);
          if (e.detail?.state) onStateChange?.(e.detail.state);
        },
        'player-volumechange': (e) => {
          const { volume, muted: isMuted } = e.detail?.data ?? {};
          onVolumeChange?.(volume, isMuted);
        },
        'player-fullscreen': (e) => onFullscreenChange?.(e.detail?.data?.fullscreen),
        'player-pip': (e) => onPipChange?.(e.detail?.data?.pip),
        'player-quality-change': (e) => onQualityChange?.(e.detail?.data),
        'player-error': (e) => onError?.(e as unknown as Event),
        'player-buffering': (e) => onBuffering?.(e.detail?.data?.buffering),
        'player-chapter-change': (e) => onChapterChange?.(e),
        'player-playlist-change': (e) => onPlaylistChange?.(e),
      };

      Object.entries(handlers).forEach(([event, handler]) => {
        element.addEventListener(event, handler as EventListener);
      });

      return () => {
        Object.entries(handlers).forEach(([event, handler]) => {
          element.removeEventListener(event, handler as EventListener);
        });
      };
    }, [
      onReady, onPlay, onPause, onEnded, onTimeUpdate, onVolumeChange,
      onFullscreenChange, onPipChange, onQualityChange, onError, onBuffering,
      onStateChange, onChapterChange, onPlaylistChange,
    ]);

    // Expose imperative API
    useImperativeHandle(
      ref,
      () => ({
        // Playback
        play: () => elementRef.current?.play() ?? Promise.resolve(),
        pause: () => elementRef.current?.pause(),
        togglePlay: () => elementRef.current?.togglePlay(),
        seek: (time: number) => elementRef.current?.seek(time),
        setVolume: (volume: number) => elementRef.current?.setVolume(volume),
        toggleMute: () => elementRef.current?.toggleMute(),
        setPlaybackRate: (rate: number) => elementRef.current?.setPlaybackRate(rate),
        // Fullscreen
        enterFullscreen: () => elementRef.current?.enterFullscreen() ?? Promise.resolve(),
        exitFullscreen: () => elementRef.current?.exitFullscreen() ?? Promise.resolve(),
        toggleFullscreen: () => elementRef.current?.toggleFullscreen(),
        // PiP
        enterPip: () => elementRef.current?.enterPip() ?? Promise.resolve(),
        exitPip: () => elementRef.current?.exitPip() ?? Promise.resolve(),
        togglePip: () => elementRef.current?.togglePip(),
        // Quality / Subtitles
        setQuality: (q: QualityLevel | 'auto') => elementRef.current?.setQuality(q),
        setSubtitle: (track: SubtitleTrack | null) => elementRef.current?.setSubtitle(track),
        // State
        getState: () => elementRef.current?.getState() ?? emptyState(),
        loadSource: (src: VideoSource) => elementRef.current?.loadSource(src),
        updateConfig: (config: Partial<PlayerConfig>) => elementRef.current?.updateConfig(config),
        destroy: () => elementRef.current?.destroy(),
        // Playlist
        next: () => elementRef.current?.next(),
        prev: () => elementRef.current?.prev(),
        goTo: (index: number) => elementRef.current?.goTo(index),
        // Event bus
        on: (event: string, handler: Function) => elementRef.current?.on(event, handler),
        off: (event: string, handler: Function) => elementRef.current?.off(event, handler),
        once: (event: string, handler: Function) => elementRef.current?.once(event, handler),
        // Getters
        getCurrentTime: () => elementRef.current?.getCurrentTime() ?? 0,
        getDuration: () => elementRef.current?.getDuration() ?? 0,
        getVolume: () => elementRef.current?.getVolume() ?? 1,
        isPaused: () => elementRef.current?.isPaused() ?? true,
        getQuality: () => elementRef.current?.getQuality() ?? 'auto',
        get sessionId() { return elementRef.current?.sessionId ?? ''; },
        // Setters
        setMuted: (m: boolean) => elementRef.current?.setMuted(m),
        setSpeed: (rate: number) => elementRef.current?.setSpeed(rate),
        // Element
        getElement: () => elementRef.current,
      }),
      []
    );

    return React.createElement('video-player', {
      ref: elementRef,
      class: className,
      style,
    });
  }
);

VideoPlayer.displayName = 'VideoPlayer';

function emptyState(): PlayerState {
  return {
    playing: false, paused: true, ended: false, buffering: false,
    canPlay: false, currentTime: 0, duration: 0, buffered: 0,
    volume: 1, muted: false, playbackRate: 1, fullscreen: false,
    pip: false, qualities: [], isLive: false,
  };
}

// ============================================================================
// HOOKS
// ============================================================================

export function usePlayerState(playerRef: React.RefObject<VideoPlayerRef>) {
  const [state, setState] = useState<PlayerState>(emptyState());

  useEffect(() => {
    const element = playerRef.current?.getElement();
    if (!element) return;

    const handleStateChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.state) setState(detail.state);
    };

    const events = ['player-play', 'player-pause', 'player-timeupdate', 'player-volumechange', 'player-fullscreen', 'player-pip'];
    events.forEach(ev => element.addEventListener(ev, handleStateChange));
    return () => events.forEach(ev => element.removeEventListener(ev, handleStateChange));
  }, [playerRef]);

  return state;
}

export function usePlayerControls(playerRef: React.RefObject<VideoPlayerRef>) {
  const play = useCallback(() => playerRef.current?.play(), [playerRef]);
  const pause = useCallback(() => playerRef.current?.pause(), [playerRef]);
  const togglePlay = useCallback(() => playerRef.current?.togglePlay(), [playerRef]);
  const seek = useCallback((t: number) => playerRef.current?.seek(t), [playerRef]);
  const setVolume = useCallback((v: number) => playerRef.current?.setVolume(v), [playerRef]);
  const toggleMute = useCallback(() => playerRef.current?.toggleMute(), [playerRef]);
  const setPlaybackRate = useCallback((r: number) => playerRef.current?.setPlaybackRate(r), [playerRef]);
  const toggleFullscreen = useCallback(() => playerRef.current?.toggleFullscreen(), [playerRef]);
  const togglePip = useCallback(() => playerRef.current?.togglePip(), [playerRef]);
  const next = useCallback(() => playerRef.current?.next(), [playerRef]);
  const prev = useCallback(() => playerRef.current?.prev(), [playerRef]);
  const goTo = useCallback((i: number) => playerRef.current?.goTo(i), [playerRef]);

  return { play, pause, togglePlay, seek, setVolume, toggleMute, setPlaybackRate, toggleFullscreen, togglePip, next, prev, goTo };
}

export default VideoPlayer;
