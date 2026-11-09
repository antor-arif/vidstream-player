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
  ErrorRecoveryConfig,
  PipConfig,
  MiniPlayerConfig,
  PlaylistItem,
  PlaylistOptions,
  PluginsConfig,
  LowLatencyConfig,
  P2PConfig,
  P2PStats,
  LiveConfig,
  TokenRefreshEvent,
  LiveState,
  LiveWatchStats,
  LiveStateChangeEvent,
  LiveEdgeChangeEvent,
  AutoplayBlockedEvent,
  LatencyEvent,
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
  /** Read once on mount */
  analytics?: AnalyticsConfig;
  /** Read once on mount */
  lmsProgress?: LMSProgressConfig;
  security?: SecurityConfig;
  /** Read once on mount */
  sdkAuth?: SDKAuthConfig;
  subtitles?: SubtitleTrack[];
  chapters?: Chapter[];
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  keyboardShortcuts?: boolean;
  /** Read once on mount */
  startTime?: number;
  playbackRate?: number;
  debug?: boolean;

  // New feature props
  gestures?: GesturesConfig;
  errorRecovery?: ErrorRecoveryConfig;
  pip?: PipConfig;
  miniPlayer?: MiniPlayerConfig;
  playlist?: PlaylistItem[];
  playlistOptions?: PlaylistOptions;
  thumbnailVtt?: string;
  chaptersVtt?: string;
  /** Read once on mount */
  plugins?: PluginsConfig;
  /** Low-latency live HLS. Changing it rebuilds the HLS engine. */
  lowLatency?: boolean | LowLatencyConfig;
  /** P2P HLS delivery. Changing it rebuilds the HLS engine. */
  p2p?: P2PConfig;
  /** Live options (`latencyMode`, …). Changing it rebuilds the HLS engine. */
  live?: LiveConfig;
  /** Extra hls.js config. Changing it rebuilds the HLS engine. */
  hlsConfig?: Record<string, any>;
  /** OS media controls (lock screen / notification). Default: true */
  mediaSession?: boolean;
  /** Called with each hls.js instance before it loads (e.g. to attach a P2P engine) */
  onHlsCreated?: (hls: any, Hls: any) => void;

  className?: string;
  style?: React.CSSProperties;

  // DOM event handlers (from CustomEvent dispatch)
  onReady?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onSeek?: (from: number, to: number) => void;
  onVolumeChange?: (volume: number, muted: boolean) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onPipChange?: (pip: boolean) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  onError?: (event: Event) => void;
  onBuffering?: (buffering: boolean) => void;
  /** Fires with the latest PlayerState on every player event */
  onStateChange?: (state: PlayerState) => void;
  onChapterChange?: (event: CustomEvent) => void;
  onPlaylistChange?: (event: CustomEvent) => void;
  /** About once per second during live HLS playback */
  onLatency?: (latency: LatencyEvent) => void;
  /** About every 2 seconds while P2P is active */
  onP2PStats?: (stats: P2PStats) => void;
  /** A fresh signed URL / token was applied */
  onTokenRefreshed?: (event: TokenRefreshEvent) => void;
  /** Getting a fresh signed URL / token failed */
  onTokenRefreshFailed?: (event: TokenRefreshEvent) => void;
  /** Live lifecycle: waiting / playing / reconnecting / ended / offline */
  onLiveStateChange?: (event: LiveStateChangeEvent) => void;
  /** Playback moved away from / back to the live edge */
  onLiveEdgeChange?: (event: LiveEdgeChangeEvent) => void;
  /** The live stream ended */
  onStreamEnded?: () => void;
  /** The browser blocked autoplay (live streams fall back to muted playback) */
  onAutoplayBlocked?: (event: AutoplayBlockedEvent) => void;
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
  // Live
  seekToLive(): void;
  getLiveLatency(): LatencyEvent | null;
  getP2PStats(): P2PStats | null;
  /** Active hls.js instance, or null */
  getHls(): any;
  /** Active dash.js MediaPlayer, or null */
  getDash(): any;
  /** Alias of seekToLive() */
  goToLive(): void;
  /** Show the "ended" state (e.g. after a stream.ended push from your backend) */
  markStreamEnded(): void;
  getLiveState(): LiveState;
  /** Watch statistics of the live session (null for VOD) */
  getLiveStats(): LiveWatchStats | null;
  /** Show/hide the statistics overlay; returns whether it is visible */
  toggleStats(force?: boolean): boolean;
  // Element access
  getElement(): VideoPlayerElement | null;
}

// Alias for consumers who prefer this name
export type VidstreamPlayerRef = VideoPlayerRef;

// ============================================================================
// CONFIG SYNC HELPERS
// ============================================================================

/** Props that can change after mount and are forwarded through updateConfig() */
const SYNCED_KEYS = [
  'mode', 'theme', 'watermark', 'antiPiracyText', 'quality', 'controls', 'security',
  'subtitles', 'chapters', 'autoplay', 'muted', 'loop', 'preload', 'keyboardShortcuts',
  'playbackRate', 'debug', 'gestures', 'errorRecovery', 'pip', 'miniPlayer',
  'playlist', 'playlistOptions', 'thumbnailVtt', 'chaptersVtt', 'lowLatency', 'p2p',
  'live', 'hlsConfig', 'mediaSession',
] as const;

type SyncedConfig = Partial<Pick<PlayerConfig, typeof SYNCED_KEYS[number]>>;

function buildConfig(props: VideoPlayerProps): PlayerConfig {
  return {
    source: props.source,
    mode: props.mode ?? 'vod',
    theme: props.theme,
    watermark: props.watermark,
    antiPiracyText: props.antiPiracyText,
    quality: props.quality,
    controls: props.controls,
    analytics: props.analytics,
    lmsProgress: props.lmsProgress,
    security: props.security,
    sdkAuth: props.sdkAuth,
    subtitles: props.subtitles,
    chapters: props.chapters,
    autoplay: props.autoplay ?? false,
    muted: props.muted ?? false,
    loop: props.loop ?? false,
    preload: props.preload ?? 'metadata',
    keyboardShortcuts: props.keyboardShortcuts ?? true,
    startTime: props.startTime,
    playbackRate: props.playbackRate,
    debug: props.debug ?? false,
    gestures: props.gestures,
    errorRecovery: props.errorRecovery,
    pip: props.pip,
    miniPlayer: props.miniPlayer,
    playlist: props.playlist,
    playlistOptions: props.playlistOptions,
    thumbnailVtt: props.thumbnailVtt,
    chaptersVtt: props.chaptersVtt,
    plugins: props.plugins,
    lowLatency: props.lowLatency,
    p2p: props.p2p,
    live: props.live,
    hlsConfig: props.hlsConfig,
    mediaSession: props.mediaSession,
  };
}

function pickSynced(config: PlayerConfig): SyncedConfig {
  const picked: Record<string, unknown> = {};
  SYNCED_KEYS.forEach(key => { picked[key] = config[key]; });
  return picked as SyncedConfig;
}

/**
 * Structural equality for config values, so inline objects (`theme={{ … }}`) don't trigger an
 * update on every render. Functions compare equal: callbacks inside config objects are read
 * when the relevant feature is (re)built, not on every prop change.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function sourceKey(source: VideoSource): string {
  return JSON.stringify([source.src, source.type ?? 'auto', source.poster, source.title, source.thumbnails, source.chapters]);
}

// ============================================================================
// COMPONENT
// ============================================================================

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  (props, ref) => {
    const { className, style } = props;

    const elementRef = useRef<VideoPlayerElement | null>(null);
    // Latest props for event handlers and effects without re-subscribing every render
    const propsRef = useRef(props);
    propsRef.current = props;
    const lastSynced = useRef<SyncedConfig | null>(null);
    const lastSourceKey = useRef<string | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // Listen first, then initialize — `player-ready` is dispatched synchronously while the
    // player is constructed, so listeners attached afterwards would miss it.
    useEffect(() => {
      const element = elementRef.current;
      if (!element) return;

      const call = (fn: (p: VideoPlayerProps, e: CustomEvent) => void) => (event: Event) => {
        const e = event as CustomEvent;
        if (e.detail?.state) propsRef.current.onStateChange?.(e.detail.state);
        fn(propsRef.current, e);
      };

      const handlers: Record<string, (event: Event) => void> = {
        'player-ready': call(p => p.onReady?.()),
        'player-play': call(p => p.onPlay?.()),
        'player-pause': call(p => p.onPause?.()),
        'player-ended': call(p => p.onEnded?.()),
        'player-timeupdate': call((p, e) => {
          const { currentTime, duration } = e.detail?.data ?? {};
          p.onTimeUpdate?.(currentTime, duration);
        }),
        'player-seek': call((p, e) => p.onSeek?.(e.detail?.data?.from, e.detail?.data?.to)),
        'player-volumechange': call((p, e) => {
          const { volume, muted: isMuted } = e.detail?.data ?? {};
          p.onVolumeChange?.(volume, isMuted);
        }),
        'player-fullscreen': call((p, e) => p.onFullscreenChange?.(e.detail?.data?.fullscreen)),
        'player-pip': call((p, e) => p.onPipChange?.(e.detail?.data?.pip)),
        'player-quality-change': call((p, e) => p.onQualityChange?.(e.detail?.data)),
        'player-error': call((p, e) => p.onError?.(e)),
        'player-buffering': call((p, e) => p.onBuffering?.(e.detail?.data?.buffering)),
        'player-chapter-change': call((p, e) => p.onChapterChange?.(e)),
        'player-playlist-change': call((p, e) => p.onPlaylistChange?.(e)),
        'player-latency': call((p, e) => p.onLatency?.(e.detail?.data)),
        'player-p2p-stats': call((p, e) => p.onP2PStats?.(e.detail?.data)),
        'player-token-refreshed': call((p, e) => p.onTokenRefreshed?.(e.detail?.data)),
        'player-token-refresh-failed': call((p, e) => p.onTokenRefreshFailed?.(e.detail?.data)),
        'player-live-state-change': call((p, e) => p.onLiveStateChange?.(e.detail?.data)),
        'player-live-edge-change': call((p, e) => p.onLiveEdgeChange?.(e.detail?.data)),
        'player-stream-ended': call(p => p.onStreamEnded?.()),
        'player-autoplay-blocked': call((p, e) => p.onAutoplayBlocked?.(e.detail?.data)),
        'player-loaded': call(() => {}),
        'player-ratechange': call(() => {}),
      };

      Object.entries(handlers).forEach(([event, handler]) => element.addEventListener(event, handler));

      // StrictMode re-runs this effect on the same element; the element keeps its player
      if (!element.isReady()) {
        const config = buildConfig(propsRef.current);
        // Always the latest prop (read when an hls.js instance is created)
        config.onHlsCreated = (hls: any, Hls: any) => propsRef.current.onHlsCreated?.(hls, Hls);
        element.initialize(config);
        lastSynced.current = pickSynced(config);
        lastSourceKey.current = sourceKey(config.source);
      }
      setIsInitialized(true);

      return () => {
        Object.entries(handlers).forEach(([event, handler]) => element.removeEventListener(event, handler));
      };
    }, []);

    // Forward changed props after mount (structural comparison, so inline objects are fine)
    useEffect(() => {
      const element = elementRef.current;
      if (!element || !isInitialized || !lastSynced.current) return;

      const next = pickSynced(buildConfig(props));
      const changed: SyncedConfig = {};
      let hasChanges = false;
      SYNCED_KEYS.forEach(key => {
        if (!sameValue(lastSynced.current![key], next[key])) {
          (changed as Record<string, unknown>)[key] = next[key];
          hasChanges = true;
        }
      });
      lastSynced.current = next;
      if (hasChanges) element.updateConfig(changed);
    });

    // Reload when the source actually changes (not on the initial mount — initialize() loaded it)
    useEffect(() => {
      const element = elementRef.current;
      if (!element || !isInitialized) return;
      const key = sourceKey(props.source);
      if (key === lastSourceKey.current) return;
      lastSourceKey.current = key;
      element.loadSource(props.source);
    });

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
        setQuality: (q: QualityLevel | number | 'auto') => elementRef.current?.setQuality(q),
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
        // Live
        seekToLive: () => elementRef.current?.seekToLive(),
        getLiveLatency: () => elementRef.current?.getLiveLatency() ?? null,
        getP2PStats: () => elementRef.current?.getP2PStats() ?? null,
        getHls: () => elementRef.current?.getHls() ?? null,
        getDash: () => elementRef.current?.getDash() ?? null,
        goToLive: () => elementRef.current?.goToLive(),
        markStreamEnded: () => elementRef.current?.markStreamEnded(),
        getLiveState: () => elementRef.current?.getLiveState() ?? 'idle',
        getLiveStats: () => elementRef.current?.getLiveStats() ?? null,
        toggleStats: (force?: boolean) => elementRef.current?.toggleStats(force) ?? false,
        // Element
        getElement: () => elementRef.current,
      }),
      []
    );

    // The display:contents host gives React a node it owns. The player may wrap <video-player>
    // in a layout element (playlist panel); React then only ever removes this host, never the
    // re-parented element, so unmounting can't fail with "removeChild: not a child".
    return React.createElement(
      'div',
      { style: { display: 'contents' }, 'data-vidstream-host': '' },
      React.createElement('video-player', {
        ref: elementRef,
        class: className,
        style,
      })
    );
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

    const events = [
      'player-play', 'player-pause', 'player-ended', 'player-timeupdate', 'player-volumechange',
      'player-ratechange', 'player-fullscreen', 'player-pip', 'player-buffering', 'player-loaded',
      'player-quality-change', 'player-seek',
    ];
    events.forEach(ev => element.addEventListener(ev, handleStateChange));
    setState(element.getState());
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
