/**
 * Video Player Core
 *
 * Orchestrates playback, controls, theming, analytics, LMS progress,
 * event bus, error recovery, playlist, thumbnail preview, mini player,
 * playback security hooks and the analytics plugin slot.
 */

import type {
  PlayerConfig,
  PlayerState,
  PlayerAPI,
  VideoSource,
  VideoSourceType,
  QualityLevel,
  SubtitleTrack,
  PlayerEventDetail,
  PlayerError,
  LMSProgressConfig,
  VidstreamPlayerInstance,
  VidstreamErrorCode,
  ChapterChangeEvent,
  PlaylistChangeEvent,
  PlaylistItem,
  Chapter,
} from '../types';
import { ControlsManager, ControlsCallbacks } from './PlayerControls';
import { WatermarkManager, AntiPiracyTextManager } from './WatermarkOverlay';
import { ThemeManager } from './PlayerTheme';
import { AnalyticsManager } from '../services/analyticsAdapter';
import { LMSProgressManager, saveProgressToStorage } from '../services/lmsProgressService';
import { EventBus } from '../services/eventBus';
import { ErrorRecoveryManager } from '../services/errorRecovery';
import { ThumbnailPreview, thumbnailPreviewStyles } from './ThumbnailPreview';
import { MiniPlayer, miniPlayerStyles } from './MiniPlayer';
import { PlaylistManager, playlistStyles } from './PlaylistManager';
import { parseChaptersVtt } from '../utils/vtt';
import { isDomainAllowed } from '../utils/security';
import { buildHlsConfig, buildP2PCoreConfig, isP2PSupported, resolveLowLatency, LIVE_BACK_BUFFER_SECONDS } from '../streaming/hlsConfig';
import { loadP2PEngine, loadSwarmCloudEngine, P2PStatsTracker } from '../streaming/p2p';
import { TokenRefresher, redactUrl, tokenlessChannelId } from '../streaming/tokenRefresh';
import { LiveLifecycle, DEFAULT_LIVE_MESSAGES } from '../streaming/liveLifecycle';
import { LiveSessionStats } from '../services/liveSessionStats';
import { applyMediaSession, clearMediaSession, setMediaSessionState, WakeLockController } from '../services/mediaSession';
import { StatsOverlay, type StatsSnapshot } from './StatsOverlay';
import type {
  LatencyEvent, P2PStats, TokenRefreshEvent, LiveState, LiveWatchStats, LiveStateChangeEvent, LiveEdgeChangeEvent, AutoplayBlockedEvent, P2PProvider, P2PUnavailableReason, P2PUnavailableEvent,
} from '../types';

/** Continuous playback (without stalls/errors) after which the retry budget is refilled */
const HEALTHY_PLAYBACK_MS = 10000;

type P2PConfigChannelId = string | ((m3u8Url: string) => string);

/** Retry policies without token refresh (status 0 / timeouts retried, 401/403 not) */
/** Without a playback refresher a 401/403 can't fix itself: give up on the 3rd (2 quick retries) */
const AUTH_FAST_FAIL_AFTER = 3;
const NO_REFRESH = new TokenRefresher({ getFreshUrl: async () => null, maxRefreshesPerMinute: 0 });

// Lazy-loaded streaming engines — not bundled into the main entry.
// When the import fails (peer dependency not installed, or the UMD build loaded from a
// <script> tag) a global `Hls` / `dashjs` is used if present, otherwise playback falls back
// to native support where the browser has it.
let hlsPromise: Promise<any | null> | null = null;
let dashPromise: Promise<any | null> | null = null;

function loadHls(): Promise<any | null> {
  if (!hlsPromise) {
    hlsPromise = import('hls.js')
      .then(mod => (mod as any).default ?? mod)
      .catch(() => (globalThis as any).Hls ?? null);
  }
  return hlsPromise;
}

function loadDash(): Promise<any | null> {
  if (!dashPromise) {
    dashPromise = import('dashjs')
      .then(mod => {
        const ns = mod as any;
        return ns.MediaPlayer ? ns : (ns.default ?? null);
      })
      .catch(() => (globalThis as any).dashjs ?? null);
  }
  return dashPromise;
}

// ============================================================================
// HELPERS
// ============================================================================

function uuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function detectSourceType(url: string): VideoSourceType {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  if (ext === 'm3u8') return 'hls';
  if (ext === 'mpd') return 'dash';
  if (ext === 'webm') return 'webm';
  return 'mp4';
}

/** Support both `time` and `startTime` on chapters */
function normalizeChapters(chapters: Chapter[]): Chapter[] {
  return chapters.map(c => ({ ...c, startTime: c.startTime ?? c.time ?? 0 }));
}

function playlistItemToSource(item: PlaylistItem): VideoSource {
  return {
    src: item.src,
    type: item.type,
    title: item.title,
    poster: item.poster,
    chapters: item.chapters,
    thumbnails: item.thumbnailVtt,
  };
}

/** Structural equality for plain config objects (functions inside are ignored) */
function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** dash.js error codes that mean "a request failed" (manifest, segment, xlink, time sync…) */
const DASH_NETWORK_ERROR_CODES = new Set([11, 12, 16, 17, 18, 19, 25, 26, 27, 28, 29]);
/** dash.js error codes that mean the content can't be played at all */
const DASH_UNSUPPORTED_ERROR_CODES = new Set([10, 23, 31, 32, 34, 35]);
/** Timed-text parse failures — subtitles only, playback continues */
const DASH_IGNORED_ERROR_CODES = new Set([33]);

const defaultConfig: Partial<PlayerConfig> = {
  mode: 'vod',
  autoplay: false,
  muted: false,
  loop: false,
  preload: 'metadata',
  keyboardShortcuts: true,
  debug: false,
};

interface RawQuality {
  height: number;
  width: number;
  bitrate: number;
  /** Engine handle: HLS level index, dash.js v5 representation id, or dash.js v4 quality index */
  ref: number | string;
}

// ============================================================================
// VIDEO PLAYER CLASS
// ============================================================================

export class VideoPlayer implements PlayerAPI, VidstreamPlayerInstance {
  private container: HTMLElement;
  private config: PlayerConfig;
  private videoElement: HTMLVideoElement | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hls: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dash: any = null;
  private isPipOperationInFlight = false;

  // Subsystems
  private controlsManager: ControlsManager | null = null;
  private watermarkManager: WatermarkManager | null = null;
  private antiPiracyTextManager: AntiPiracyTextManager | null = null;
  private themeManager: ThemeManager | null = null;
  private analyticsManager: AnalyticsManager | null = null;
  private lmsProgressManager: LMSProgressManager | null = null;
  private eventBus: EventBus = new EventBus();
  private errorRecovery: ErrorRecoveryManager | null = null;
  private thumbnailPreview: ThumbnailPreview | null = null;
  private miniPlayer: MiniPlayer | null = null;
  private playlistManager: PlaylistManager | null = null;
  private playlistWrapper: HTMLElement | null = null;
  private playlistPanel: HTMLElement | null = null;
  private movedInlineWidth = '';

  // State
  private state: PlayerState = this.getInitialState();
  private isInitialized = false;
  private destroyed = false;
  private _sessionId: string = uuidV4();
  /** Every listener the player registers is tied to this signal and removed on destroy() */
  private listeners = new AbortController();

  // Source lifecycle — `loadToken` invalidates async work started for a previous source
  private loadToken = 0;
  private thumbnailToken = 0;
  private initialSourceSrc = '';
  private autoplayPending = false;
  private pendingStartTime: number | null = null;
  private mediaErrorRecoveries = 0;

  // Quality
  private rawQualities: RawQuality[] = [];
  private qualityLevels: QualityLevel[] = [];
  private defaultQualityApplied = false;

  // Chapters
  private initialChapters: Chapter[] = [];
  private chaptersFromVtt: Chapter[] | null = null;
  private currentChapters: Chapter[] = [];
  private currentChapterIndex = -1;

  // Misc
  private seekFromTime = 0;
  private authToken: string | undefined;
  private authRefreshAttempted = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;

  // Live latency + P2P
  private lastLatency: LatencyEvent | null = null;
  private lastLatencyEmit = 0;
  private atLiveEdge = true;
  private p2pStats: P2PStatsTracker | null = null;
  private p2pTimer: ReturnType<typeof setInterval> | null = null;
  private p2pEngine: any = null;
  private p2pStallTimes: number[] = [];
  private p2pStartedAt = 0;

  // Signed / IP-bound URLs — one refresher per loaded source, shared by every engine rebuild
  private tokenRefresher: TokenRefresher | null = null;
  /** URL currently set on the <video> for native HLS (Safari/iOS) */
  private nativeHlsSrc: string | null = null;
  private nativeRefreshInFlight = false;
  private healthyTimer: ReturnType<typeof setTimeout> | null = null;

  // Live lifecycle + UX
  private liveLifecycle: LiveLifecycle | null = null;
  private pausedAt = 0;
  private unmutePill: HTMLButtonElement | null = null;
  /** SwarmCloud P2pEngineHls instance for the current hls.js instance */
  private swarmEngine: any = null;
  /** p2pUnavailable already emitted for the current source */
  private p2pUnavailableReported = false;
  /** Re-measures latency while a live stream is paused (no timeupdate then) */
  private pausedLatencyTimer: ReturnType<typeof setInterval> | null = null;
  /** A go-live seek is in flight: latency readings are stale until it lands */
  private liveSeekPending = false;
  /** Watch-time statistics for the current source (used when it is live) */
  private liveStats = new LiveSessionStats();
  /** 401/403 answers in a row without a playback refresher (fail fast after AUTH_FAST_FAIL_AFTER) */
  private authRejections = 0;
  /** Live start held for a thin playlist (live.minSegmentsToStart): first window seen + since when */
  private startHold: { startSN: number; since: number } | null = null;
  private statsOverlay: StatsOverlay | null = null;
  private wakeLock: WakeLockController | null = null;
  private mediaSessionActive = false;

  constructor(container: HTMLElement | string, config: PlayerConfig) {
    if (typeof container === 'string') {
      const el = document.querySelector(container);
      if (!el) throw new Error(`Container not found: ${container}`);
      this.container = el as HTMLElement;
    } else {
      this.container = container;
    }

    this.config = { ...defaultConfig, ...config } as PlayerConfig;
    this.initialize();
  }

  // ============================================================================
  // INIT
  // ============================================================================

  private initialize(): void {
    this.injectExtraStyles();

    this.container.classList.add('video-player-container');
    this.container.setAttribute('tabindex', '0');

    // Only consumer-provided values are written inline; defaults come from the base stylesheet
    this.themeManager = new ThemeManager(this.container, this.config.theme ?? {}, this.config.mode ?? 'vod');
    this.themeManager.initialize();

    this.createVideoElement();
    this.buildControls();

    if (this.config.watermark?.enabled) {
      this.watermarkManager = new WatermarkManager(this.container, this.config.watermark);
      this.watermarkManager.initialize();
    }

    if (this.config.antiPiracyText?.enabled) {
      this.antiPiracyTextManager = new AntiPiracyTextManager(this.container, this.config.antiPiracyText);
      this.antiPiracyTextManager.initialize();
    }

    if (this.config.analytics?.enabled) {
      this.analyticsManager = new AnalyticsManager(this.config.analytics, this._sessionId);
      this.analyticsManager.initialize(this.config.source.src);
    }

    if (this.config.lmsProgress?.enabled) {
      this.initializeLMSProgress();
    }

    this.errorRecovery = new ErrorRecoveryManager(this.config.errorRecovery);
    this.errorRecovery.setLive(this.config.mode === 'live');
    this.authToken = this.config.security?.authToken;
    this.liveLifecycle = new LiveLifecycle(this.container, {
      restart: () => this.restartPlayback(),
      resumeLoading: () => this.resumeLiveLoading(),
      stopLoading: () => this.stopLiveLoading(),
      onStateChange: (state, previous) => {
        this.liveStats.onLiveState(state);
        const payload: LiveStateChangeEvent = { state, previous, sessionId: this._sessionId };
        this.emitEvent('player-live-state-change', payload);
        this.eventBus.emit('liveStateChange', payload);
      },
      onEnded: () => {
        this.emitEvent('player-stream-ended', {});
        // An ended class is a normal outcome, not an error: streamEnded + liveStateChange only
        this.eventBus.emit('streamEnded', { src: this.currentSrc(), sessionId: this._sessionId });
      },
    }, () => this.config.live, this.listeners.signal);
    this.wakeLock = new WakeLockController(this.listeners.signal);
    if (this.config.controls?.stats) {
      this.statsOverlay = new StatsOverlay(this.container, () => this.readStats());
      if (this.config.controls.stats === 'visible') this.statsOverlay.show();
    }
    this.initialChapters = normalizeChapters(this.config.chapters ?? []);
    this.bindContainerEvents();

    // Playlist may choose a different first source (playlistOptions.startIndex)
    const initialSource = this.config.playlist?.length ? this.initializePlaylist() : this.config.source;

    if (this.config.miniPlayer?.enabled) {
      this.miniPlayer = new MiniPlayer(this.container, this.config.miniPlayer);
      this.miniPlayer.initialize(() => {});
    }

    // startTime / LMS resume apply to the initial source only — not to later playlist items or retries
    this.initialSourceSrc = initialSource.src;
    if (this.lmsProgressManager?.shouldResume()) {
      this.pendingStartTime = this.lmsProgressManager.getResumePosition();
    } else if (this.config.startTime) {
      this.pendingStartTime = this.config.startTime;
    }

    if (this.config.chaptersVtt) this.loadChaptersVtt(this.config.chaptersVtt);

    const authError = this.checkSdkAuth();
    if (authError) {
      this.config.source = initialSource;
      this.failSdkAuth(authError);
    } else {
      this.loadSource(initialSource);
    }

    this.isInitialized = true;
    this.emitEvent('player-ready', {});
    this.analyticsManager?.trackEvent('player_loaded', this.getAnalyticsState());

    // Analytics plugin — call init after player is ready
    const analyticsPlugin = this.config.plugins?.analytics;
    if (analyticsPlugin) {
      try {
        analyticsPlugin.init(this);
      } catch (error) {
        console.error(`[VideoPlayer] analytics plugin "${analyticsPlugin.name}" failed to initialize:`, error);
      }
    }

    if (this.config.debug) console.log('[VideoPlayer] Initialized', this.config);
  }

  private injectExtraStyles(): void {
    let style = document.getElementById('vp-extra-styles') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'vp-extra-styles';
      document.head.appendChild(style);
    }
    style.textContent = thumbnailPreviewStyles + miniPlayerStyles + playlistStyles;
  }

  private createVideoElement(): void {
    this.videoElement = document.createElement('video');
    this.videoElement.className = 'video-player-video';
    this.videoElement.playsInline = true;
    this.videoElement.preload = this.config.preload ?? 'metadata';

    if (this.config.source.poster) this.videoElement.poster = this.config.source.poster;
    if (this.config.muted) this.videoElement.muted = true;
    if (this.config.loop) this.videoElement.loop = true;
    if (this.config.playbackRate) {
      // defaultPlaybackRate survives source changes; playbackRate applies now
      this.videoElement.defaultPlaybackRate = this.config.playbackRate;
      this.videoElement.playbackRate = this.config.playbackRate;
    }

    this.bindVideoEvents();
    this.container.appendChild(this.videoElement);
  }

  /** Create the ControlsManager from the current config and restore everything it displays. */
  private buildControls(): void {
    const callbacks: ControlsCallbacks = {
      onTogglePlay: () => this.togglePlay(),
      onPlay: () => this.play(),
      onPause: () => this.pause(),
      onSeek: (pos) => this.seekToPercentage(pos),
      onVolumeChange: (vol) => this.setVolume(vol),
      onMuteToggle: () => this.toggleMute(),
      onPlaybackRateChange: (rate) => this.setPlaybackRate(rate),
      onFullscreenToggle: () => this.toggleFullscreen(),
      onPipToggle: () => this.togglePip(),
      onQualityChange: (quality) => this.setQuality(quality),
      onSubtitleChange: (track) => this.setSubtitle(track),
      onForward: () => this.forward(),
      onRewind: () => this.rewind(),
      onChapterSeek: (chapter) => this.seek(chapter.startTime),
      onPlaylistNext: () => this.next(),
      onPlaylistPrev: () => this.prev(),
      onSeekBy: (seconds) => this.seek(this.state.currentTime + seconds),
      onGoLive: () => this.seekToLive(),
      onToggleStats: this.config.controls?.stats ? () => this.toggleStats() : undefined,
    };

    let controlsConfig = { ...(this.config.controls ?? {}) };

    if (this.config.mode === 'live') {
      controlsConfig = {
        ...controlsConfig,
        forward: false,
        rewind: false,
        chapters: false,
        playbackSpeed: false,
        subtitles: false,
        seekBar: false,
        progress: false,
        currentTime: false,
        duration: false,
        liveIndicator: true,
      };
    }

    // Hide PiP button if config says disabled
    if (this.config.pip?.button === false || this.config.pip?.enabled === false) {
      controlsConfig = { ...controlsConfig, pip: false };
    }

    const controls = new ControlsManager(
      this.container,
      controlsConfig,
      callbacks,
      this.config.gestures,
      { keyboardShortcuts: this.config.keyboardShortcuts !== false }
    );
    controls.initialize();
    this.controlsManager = controls;

    controls.updateLiveState(this.config.mode === 'live' || this.state.isLive);
    controls.updateChapters(this.currentChapters);
    controls.updateSubtitles(this.config.subtitles ?? []);
    controls.setSelectedSubtitle(this.state.activeSubtitle ?? null);
    controls.setTitle(this.config.source.title);
    controls.updateQualities(this.qualityLevels, this.config.quality?.showAuto !== false);
    if (this.thumbnailPreview) controls.setThumbnailPreview(this.thumbnailPreview);
    if (this.isInitialized) controls.updateState(this.state);
    this.updatePlaylistControls();
  }

  private rebuildControls(): void {
    this.controlsManager?.destroy();
    this.controlsManager = null;
    this.buildControls();
  }

  private initializeLMSProgress(): void {
    if (!this.config.lmsProgress) return;

    const lmsConfig: LMSProgressConfig = {
      ...this.config.lmsProgress,
      onProgressSave: (progress) => {
        this.config.lmsProgress?.onProgressSave?.(progress);
        saveProgressToStorage(progress);
        this.emitEvent('player-progress-saved', progress);
        this.analyticsManager?.trackEvent('progress_saved', this.getAnalyticsState(), {
          watchedPercentage: progress.watchedPercentage,
        });
      },
      onMilestoneReached: (milestone, progress) => {
        this.config.lmsProgress?.onMilestoneReached?.(milestone, progress);
        this.emitEvent('player-milestone', { milestone });
        this.analyticsManager?.trackEvent('milestone_reached', this.getAnalyticsState(), { milestone });
      },
      onComplete: (progress) => {
        this.config.lmsProgress?.onComplete?.(progress);
      },
    };

    this.lmsProgressManager = new LMSProgressManager(lmsConfig);
  }

  // ============================================================================
  // PLAYLIST
  // ============================================================================

  /**
   * Create the playlist manager (and side panel) and return the source that should play first:
   * `playlist[startIndex]` when startIndex is set, otherwise `config.source`.
   */
  private initializePlaylist(): VideoSource {
    const items = this.config.playlist!;
    const opts = this.config.playlistOptions ?? {};

    let startIndex: number;
    let source = this.config.source;
    if (opts.startIndex !== undefined) {
      startIndex = Math.max(0, Math.min(opts.startIndex, items.length - 1));
      source = playlistItemToSource(items[startIndex]);
    } else {
      const match = items.findIndex(item => item.src === this.config.source?.src);
      startIndex = match >= 0 ? match : 0;
      // config.source is that playlist item — let the item fill in what the source leaves out
      // (thumbnailVtt, chapters, title, poster)
      if (match >= 0) {
        const defined = Object.fromEntries(
          Object.entries(this.config.source).filter(([, value]) => value !== undefined)
        ) as Partial<VideoSource>;
        source = { ...playlistItemToSource(items[match]), ...defined } as VideoSource;
      }
    }

    this.playlistManager = new PlaylistManager(items, { ...opts, startIndex });
    this.state.playlistIndex = startIndex;

    this.playlistManager.onChange((index, item) => {
      this.state.playlistIndex = index;
      this.loadSource(playlistItemToSource(item));

      const event: PlaylistChangeEvent = { index, item, sessionId: this._sessionId };
      this.emitEvent('player-playlist-change', event);
      this.eventBus.emit('playlistChange', event);
      this.updatePlaylistControls();
    });

    if (opts.showPanel) this.mountPlaylistPanel();

    // Show prev/next buttons
    this.updatePlaylistControls();
    return source;
  }

  /** Render the panel beside the player by wrapping both in a flex row. */
  private mountPlaylistPanel(): void {
    const parent = this.container.parentElement;
    if (!this.playlistManager || !parent) return;

    const panel = this.playlistManager.buildPanel();
    const wrapper = document.createElement('div');
    wrapper.className = 'vp-layout-wrapper';

    // Transfer any inline width from the player to the wrapper so the wrapper
    // takes the intended outer size, and the player can be a flex item inside it.
    const inlineWidth = this.container.style.width;
    if (inlineWidth) {
      wrapper.style.width = inlineWidth;
      this.container.style.removeProperty('width');
      this.movedInlineWidth = inlineWidth;
    }

    parent.insertBefore(wrapper, this.container);
    this.container.classList.add('vp-playlist-host');
    wrapper.appendChild(this.container);
    wrapper.appendChild(panel);
    this.playlistWrapper = wrapper;
    this.playlistPanel = panel;
    // The panel lives outside the container, so give it the theme variables directly
    this.themeManager?.addTarget(panel);
  }

  /** Undo mountPlaylistPanel(): put the container back where it was. */
  private unmountPlaylistPanel(): void {
    if (this.playlistPanel) this.themeManager?.removeTarget(this.playlistPanel);
    const wrapper = this.playlistWrapper;
    if (wrapper) {
      const parent = wrapper.parentElement;
      if (parent && this.container.parentElement === wrapper) {
        parent.insertBefore(this.container, wrapper);
      }
      wrapper.remove();
    }
    if (this.movedInlineWidth) {
      this.container.style.width = this.movedInlineWidth;
      this.movedInlineWidth = '';
    }
    this.container.classList.remove('vp-playlist-host');
    this.playlistWrapper = null;
    this.playlistPanel = null;
  }

  private teardownPlaylist(): void {
    this.unmountPlaylistPanel();
    this.playlistManager?.destroy();
    this.playlistManager = null;
    this.state.playlistIndex = undefined;
    this.updatePlaylistControls();
  }

  private updatePlaylistControls(): void {
    this.controlsManager?.updatePlaylistButtons(
      this.playlistManager?.hasPrev() ?? false,
      this.playlistManager?.hasNext() ?? false
    );
  }

  // ============================================================================
  // VIDEO EVENTS
  // ============================================================================

  private bindVideoEvents(): void {
    if (!this.videoElement) return;
    const video = this.videoElement;
    const opts = { signal: this.listeners.signal };

    video.addEventListener('loadedmetadata', () => {
      this.state.duration = video.duration;
      // Native/MSE live streams report Infinity; hls.js/dash.js report a finite window duration and
      // flag live via markLive() from the playlist/manifest instead — keep whichever said "live"
      this.state.isLive = this.state.isLive || !isFinite(video.duration);
      this.lmsProgressManager?.initialize(video.duration);
      this.controlsManager?.updateLiveState(this.state.isLive || this.config.mode === 'live');
      this.updateState();
      this.emitEvent('player-loaded', {});
      this.analyticsManager?.trackEvent('source_loaded', this.getAnalyticsState());

      if (this.pendingStartTime !== null) {
        const startAt = this.pendingStartTime;
        this.pendingStartTime = null;
        if (startAt > 0) this.seek(startAt);
      }
    }, opts);

    video.addEventListener('canplay', () => {
      this.state.canPlay = true;
      this.analyticsManager?.trackEvent('can_play', this.getAnalyticsState());
      // `canplay` fires again after every seek/rebuffer — autoplay only once per loaded source
      if (this.autoplayPending) {
        this.autoplayPending = false;
        void this.attemptAutoplay();
      }
    }, opts);

    video.addEventListener('play', () => {
      // Live: after a pause, rejoin at the live edge instead of continuing from the old position
      this.stopPausedLatencyTimer();
      const pausedFor = this.pausedAt ? Date.now() - this.pausedAt : 0;
      this.pausedAt = 0;
      if (pausedFor > 1000 && this.isLiveStream() && this.config.live?.resumeAtLiveEdge !== false) {
        this.seekToLive();
      }
      this.autoplayPending = false;
      this.state.playing = true;
      this.state.paused = false;
      this.state.ended = false;
      this.container.classList.add('vp-playing');
      this.container.classList.remove('vp-paused');
      this.updateState();
      this.controlsManager?.showActionAnimation(true);
      this.emitEvent('player-play', {});
      this.eventBus.emit('play', { currentTime: video.currentTime, src: this.currentSrc(), sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('play', this.getAnalyticsState());
      this.analyticsManager?.startHeartbeat(() => this.getAnalyticsState(), () => this.liveAnalyticsData());
      this.updateMediaSession();
      setMediaSessionState('playing');
      this.lmsProgressManager?.handleFirstPlay();
      this.startHeartbeat();
    }, opts);

    video.addEventListener('pause', () => {
      this.stopHealthyTimer();
      this.liveStats.onStopped();
      this.wakeLock?.release();
      setMediaSessionState('paused');
      if (!video.ended) this.pausedAt = Date.now();
      if (this.isLiveStream()) {
        this.stopPausedLatencyTimer();
        this.pausedLatencyTimer = setInterval(() => this.trackLatency(), 1000);
      }
      this.state.playing = false;
      this.state.paused = true;
      this.container.classList.remove('vp-playing');
      this.container.classList.add('vp-paused');
      this.container.classList.remove('vp-idle');
      this.updateState();
      this.controlsManager?.showActionAnimation(false);
      this.emitEvent('player-pause', {});
      this.eventBus.emit('pause', { currentTime: video.currentTime, src: this.currentSrc(), sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('pause', this.getAnalyticsState());
      this.analyticsManager?.stopHeartbeat();
      this.stopHeartbeat();
    }, opts);

    video.addEventListener('ended', () => {
      this.liveStats.onStopped();
      this.wakeLock?.release();
      this.state.ended = true;
      this.state.playing = false;
      this.updateState();
      this.stopHeartbeat();
      this.emitEvent('player-ended', {});
      this.eventBus.emit('ended', { src: this.currentSrc(), sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('ended', this.getAnalyticsState());
      this.lmsProgressManager?.handleCompletion();

      if (this.isLiveStream()) {
        if (this.liveLifecycle?.isActive()) this.liveLifecycle.markEnded();
        else {
          this.emitEvent('player-stream-ended', {});
          this.eventBus.emit('streamEnded', { src: this.currentSrc(), sessionId: this._sessionId });
        }
      }

      // Auto-advance playlist
      if (this.playlistManager && this.config.playlistOptions?.autoNext !== false) {
        const next = this.playlistManager.next();
        if (next) {
          this.updatePlaylistControls();
          this.play().catch(() => {});
        }
      }
    }, opts);

    video.addEventListener('timeupdate', () => {
      this.state.currentTime = video.currentTime;
      this.updateState();
      this.emitEvent('player-timeupdate', { currentTime: video.currentTime, duration: video.duration });
      this.eventBus.emit('timeupdate', {
        currentTime: video.currentTime,
        duration: video.duration,
        percent: video.duration > 0 ? video.currentTime / video.duration : 0,
        src: this.currentSrc(),
        sessionId: this._sessionId,
      });
      this.analyticsManager?.trackEvent('time_update', this.getAnalyticsState());
      this.lmsProgressManager?.updateProgress(video.currentTime, video.duration);
      this.checkChapterChange();
      this.trackLatency();
    }, opts);

    video.addEventListener('volumechange', () => {
      const muteChanged = this.state.muted !== video.muted;
      if (!video.muted) this.removeUnmutePill();
      this.state.volume = video.volume;
      this.state.muted = video.muted;
      this.updateState();
      this.emitEvent('player-volumechange', { volume: video.volume, muted: video.muted });
      this.analyticsManager?.trackEvent(muteChanged ? 'mute_toggled' : 'volume_changed', this.getAnalyticsState());
    }, opts);

    video.addEventListener('ratechange', () => {
      this.state.playbackRate = video.playbackRate;
      this.updateState();
      this.emitEvent('player-ratechange', { rate: video.playbackRate });
      this.analyticsManager?.trackEvent('playback_rate_changed', this.getAnalyticsState());
    }, opts);

    video.addEventListener('seeking', () => {
      // video.currentTime already holds the target here; the last timeupdate position is the origin
      this.seekFromTime = this.state.currentTime;
      this.analyticsManager?.trackEvent('seek_start', this.getAnalyticsState());
    }, opts);

    video.addEventListener('seeked', () => {
      this.liveSeekPending = false;
      const from = this.seekFromTime;
      const to = video.currentTime;
      this.state.currentTime = to;
      this.emitEvent('player-seek', { from, to });
      this.eventBus.emit('seek', {
        fromTime: from,
        toTime: to,
        src: this.currentSrc(),
        sessionId: this._sessionId,
      });
      this.analyticsManager?.trackEvent('seek_end', this.getAnalyticsState(), { fromTime: from });
    }, opts);

    video.addEventListener('waiting', () => {
      this.stopHealthyTimer();
      this.liveStats.onWaiting(video.seeking);
      this.state.buffering = true;
      this.updateState();
      this.emitEvent('player-buffering', { buffering: true });
      this.eventBus.emit('buffering', { currentTime: video.currentTime, duration: video.duration, sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('buffering', this.getAnalyticsState());
      this.checkP2PStall();
    }, opts);

    video.addEventListener('playing', () => {
      this.state.buffering = false;
      this.updateState();
      this.emitEvent('player-buffering', { buffering: false });
      if (this.state.error && !this.state.error.fatal) this.state.error = undefined;
      // Refill the retry budget only after sustained healthy playback: a stream that plays for a second
      // and fails again must not retry forever, but a 2-hour class must survive more than 3 blips
      this.startHealthyTimer();
      this.liveStats.onPlaying();
      if (this.isLiveStream() && this.config.live?.wakeLock) void this.wakeLock?.request();
      if (this.liveLifecycle?.isActive()) {
        this.errorRecovery?.stopLiveReconnect();
        this.hideErrorUI();
        this.liveLifecycle.playing();
      }
    }, opts);

    // Native HLS (Safari/iOS): a stall may be an expired / IP-bound URL that the browser won't report
    video.addEventListener('stalled', () => this.checkNativeHlsAuth('stalled'), opts);

    video.addEventListener('progress', () => {
      if (video.buffered.length > 0) {
        this.state.buffered = video.buffered.end(video.buffered.length - 1);
        this.updateState();
      }
    }, opts);

    video.addEventListener('error', () => this.handleNativeError(), opts);

    const onFullscreenChange = () => {
      const doc = document as any;
      const fsElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      this.setFullscreenState(fsElement === this.container);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange, opts);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange, opts);
    // iPhone Safari: only the <video> itself can go fullscreen
    video.addEventListener('webkitbeginfullscreen', () => this.setFullscreenState(true), opts);
    video.addEventListener('webkitendfullscreen', () => this.setFullscreenState(false), opts);

    video.addEventListener('enterpictureinpicture', () => {
      this.state.pip = true;
      this.isPipOperationInFlight = false;
      this.updateState();
      this.emitEvent('player-pip', { pip: true });
      this.analyticsManager?.trackEvent('pip_enter', this.getAnalyticsState());
      const tracks = this.videoElement?.textTracks;
      if (tracks) {
        for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
      }
    }, opts);

    video.addEventListener('leavepictureinpicture', () => {
      this.state.pip = false;
      this.isPipOperationInFlight = false;
      this.updateState();
      this.emitEvent('player-pip', { pip: false });
      this.analyticsManager?.trackEvent('pip_exit', this.getAnalyticsState());
      if (this.state.activeSubtitle) this.setSubtitle(this.state.activeSubtitle);
    }, opts);
  }

  private bindContainerEvents(): void {
    // Click on the video surface toggles playback. The toggle waits briefly so a double-click
    // (seek / fullscreen) doesn't also pause-and-resume the video.
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(
        '.vp-controls, .vp-big-play, .vp-poster-overlay, .vp-volume-slider, .vp-progress-bar, .vp-dropdown-menu, .vp-error, .vp-mini-controls'
      )) return;
      // In the mini player a click scrolls back to the player (MiniPlayer handles it)
      if (this.container.classList.contains('vp-mini-active')) return;

      // If a dropdown menu is open, consuming the click to dismiss it — do not toggle playback
      if (this.controlsManager?.hasOpenDropdown()) {
        this.controlsManager.closeAllDropdowns();
        return;
      }

      if (this.clickTimer) {
        clearTimeout(this.clickTimer);
        this.clickTimer = null;
      }
      if (e.detail > 1) return; // second click of a double-click
      this.clickTimer = setTimeout(() => {
        this.clickTimer = null;
        this.togglePlay();
      }, 250);
    }, { signal: this.listeners.signal });
  }

  private setFullscreenState(fullscreen: boolean): void {
    if (this.state.fullscreen === fullscreen) return;
    this.state.fullscreen = fullscreen;
    this.updateState();
    this.emitEvent('player-fullscreen', { fullscreen });
    this.analyticsManager?.trackEvent(fullscreen ? 'fullscreen_enter' : 'fullscreen_exit', this.getAnalyticsState());
  }

  // ============================================================================
  // CHAPTER TRACKING
  // ============================================================================

  private setCurrentChapters(chapters: Chapter[]): void {
    this.currentChapters = chapters;
    this.currentChapterIndex = -1;
    this.controlsManager?.updateChapters(chapters);
  }

  /** Chapters for a source: its own → (initial source only) chaptersVtt → top-level `chapters`. */
  private applyChaptersForSource(source: VideoSource): void {
    if (source.chapters?.length) {
      this.setCurrentChapters(normalizeChapters(source.chapters));
    } else if (this.isInitialSource(source)) {
      this.setCurrentChapters(this.chaptersFromVtt ?? this.initialChapters);
    } else {
      this.setCurrentChapters([]);
    }
  }

  private checkChapterChange(): void {
    const chapters = this.currentChapters;
    if (!chapters.length) return;
    const t = this.state.currentTime;
    let idx = -1;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (t >= chapters[i].startTime) {
        idx = i;
        break;
      }
    }
    if (idx !== this.currentChapterIndex) {
      this.currentChapterIndex = idx;
      if (idx >= 0) {
        const event: ChapterChangeEvent = { chapter: chapters[idx], index: idx, sessionId: this._sessionId };
        this.emitEvent('player-chapter-change', event);
        this.eventBus.emit('chapterChange', event);
      }
    }
  }

  // ============================================================================
  // THUMBNAIL + CHAPTERS VTT LOADING
  // ============================================================================

  /** Seek thumbnails for a source: its own (`thumbnails` / item.thumbnailVtt) → (initial source only) config.thumbnailVtt */
  private loadThumbnailsForSource(source: VideoSource): void {
    const url = source.thumbnails ?? (this.isInitialSource(source) ? this.config.thumbnailVtt : undefined);
    const token = ++this.thumbnailToken;

    // Never keep the previous video's thumbnails
    this.thumbnailPreview?.destroy();
    this.thumbnailPreview = null;
    this.controlsManager?.setThumbnailPreview(null);
    if (!url) return;

    const preview = new ThumbnailPreview(this.container);
    preview.load(url).then(() => {
      if (this.destroyed || token !== this.thumbnailToken || !preview.hasCues()) {
        preview.destroy();
        return;
      }
      this.thumbnailPreview = preview;
      this.controlsManager?.setThumbnailPreview(preview);
    });
  }

  private async loadChaptersVtt(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const chapters = parseChaptersVtt(await res.text());
      if (this.destroyed || url !== this.config.chaptersVtt || !chapters.length) return;
      this.chaptersFromVtt = chapters;
      // Applies to the initial source unless it carries its own chapters
      if (this.isInitialSource(this.config.source) && !this.config.source.chapters?.length) {
        this.setCurrentChapters(chapters);
      }
    } catch {
      // graceful fallback
    }
  }

  // ============================================================================
  // ERRORS
  // ============================================================================

  /** Emit an error on every channel. `fatal` = playback stopped (no retry pending). */
  private reportError(code: VidstreamErrorCode, message: string, fatal: boolean, originalError?: unknown): void {
    const vidstreamError = this.errorRecovery?.reportError(code, message, fatal)
      ?? { code, message, fatal, timestamp: Date.now() };
    const playerError: PlayerError = {
      code,
      message,
      fatal,
      originalError: originalError instanceof Error ? originalError : undefined,
    };
    if (fatal) this.state.error = playerError;
    this.emitEvent('player-error', playerError);
    this.eventBus.emit('error', vidstreamError);
    this.analyticsManager?.trackEvent('error', this.getAnalyticsState(), { error: { code, message, fatal } });
  }

  /**
   * Retry with exponential backoff while the budget lasts (reported as non-fatal);
   * otherwise report a fatal error and show the error overlay.
   */
  private handlePlaybackFailure(
    code: VidstreamErrorCode,
    message: string,
    retry: (() => void) | null,
    originalError?: unknown,
    /** Expected trouble (e.g. a class ending): retry without emitting non-fatal error events */
    quiet = false
  ): void {
    const recovery = this.errorRecovery;
    const lifecycle = this.liveLifecycle;
    this.stopHealthyTimer();
    if (lifecycle?.isEnded()) return;

    const liveReconnect = !!retry && !!lifecycle?.isActive() && lifecycle.hasStarted() &&
      (code === 'NETWORK_ERROR' || code === 'AUTH_ERROR');
    if (liveReconnect) lifecycle!.networkFailure();

    if (retry && recovery?.canRetry()) {
      if (!quiet) this.reportError(code, message, false, originalError);
      recovery.scheduleRetry(retry);
      return;
    }

    // Live viewers never get stuck on an error screen for network trouble: keep reconnecting
    if (liveReconnect && recovery?.isEnabled()) {
      if (!quiet) this.reportError(code, message, false, originalError);
      recovery.startLiveReconnect(
        () => typeof navigator === 'undefined' || navigator.onLine !== false,
        () => {
          recovery.resetRetries();
          this.restartPlayback();
        }
      );
      return;
    }

    this.reportError(code, message, true, originalError);
    this.showErrorUI(message, true);

    // Live streams keep trying to reconnect in the background
    if (retry && this.isLiveStream() && recovery?.isEnabled()) {
      recovery.startLiveReconnect(
        () => typeof navigator === 'undefined' || navigator.onLine !== false,
        () => {
          recovery.resetRetries();
          this.restartPlayback();
        }
      );
    }
  }

  private handleNativeError(): void {
    const video = this.videoElement;
    // Streaming engines report their own errors with better detail
    if (!video || this.hls || this.dash) return;
    const mediaError = video.error;
    // Aborted loads and the "empty src" error raised while tearing down are not playback failures
    if (!mediaError || mediaError.code === 1 || (!video.currentSrc && !video.getAttribute('src'))) return;

    // Native HLS with a signed URL: the error may be a 403 (expired token / new IP) — refresh and rejoin
    if (this.nativeHlsSrc && this.tokenRefresher && mediaError.code !== 4) {
      void this.recoverNativeHls('error', true);
      return;
    }

    const code: VidstreamErrorCode =
      mediaError.code === 2 ? 'NETWORK_ERROR' :
      mediaError.code === 3 ? 'DECODE_ERROR' :
      'SRC_NOT_SUPPORTED';
    const message = mediaError.message || (
      code === 'NETWORK_ERROR' ? 'A network error interrupted playback' :
      code === 'DECODE_ERROR' ? 'The video could not be decoded' :
      'This video format is not supported'
    );
    this.handlePlaybackFailure(code, message, code === 'SRC_NOT_SUPPORTED' ? null : () => this.restartPlayback(), mediaError);
  }

  private startHealthyTimer(): void {
    this.stopHealthyTimer();
    this.healthyTimer = setTimeout(() => {
      this.healthyTimer = null;
      this.errorRecovery?.resetCount();
      this.mediaErrorRecoveries = 0;
      this.authRefreshAttempted = false;
    }, HEALTHY_PLAYBACK_MS);
  }

  private stopHealthyTimer(): void {
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
  }

  // ============================================================================
  // SIGNED / IP-BOUND URL REFRESH
  // ============================================================================

  /** A fresh-URL / token refresher is configured */
  private hasPlaybackRefresher(): boolean {
    const security = this.config.security;
    return !!(security?.refreshPlaybackUrl || security?.refreshPlaybackToken);
  }

  /**
   * Fresh playback URL from the app (same stream, same host), or null when only the auth header token
   * was refreshed (`refreshPlaybackToken` resolved to a bare token).
   */
  private getFreshPlaybackUrl = async (): Promise<string | null> => {
    const security = this.config.security;
    if (security?.refreshPlaybackUrl) return await security.refreshPlaybackUrl();
    if (security?.refreshPlaybackToken) {
      const value = await security.refreshPlaybackToken();
      if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim();
      this.authToken = value;
      return null;
    }
    return null;
  };

  private createTokenRefresher(): TokenRefresher {
    const debug = !!this.config.debug;
    return new TokenRefresher({
      getFreshUrl: this.getFreshPlaybackUrl,
      pattern: this.config.security?.tokenPrefixPattern,
      log: debug ? (message) => console.log(`[VideoPlayer] ${message}`) : undefined,
      onRefreshed: ({ reason, host }) => {
        const payload: TokenRefreshEvent = { reason, host, sessionId: this._sessionId };
        this.emitEvent('player-token-refreshed', payload);
        this.eventBus.emit('tokenRefreshed', payload);
        this.liveStats.onTokenRefresh();
        this.analyticsManager?.trackEvent('token_refreshed', this.getAnalyticsState(), { reason });
      },
      onRefreshFailed: ({ reason, error }) => {
        const payload: TokenRefreshEvent = { reason, error: error.message, sessionId: this._sessionId };
        this.emitEvent('player-token-refresh-failed', payload);
        this.eventBus.emit('tokenRefreshFailed', payload);
      },
    });
  }

  /** Native HLS stalled: probe the playlist; on 401/403 refresh the URL and rejoin */
  private checkNativeHlsAuth(reason: string): void {
    const src = this.nativeHlsSrc;
    if (!src || !this.tokenRefresher || this.nativeRefreshInFlight || typeof fetch !== 'function') return;
    const token = this.loadToken;
    fetch(src, { method: 'GET', cache: 'no-store' })
      .then(res => {
        if (this.isStale(token)) return;
        if (res.status === 401 || res.status === 403) void this.recoverNativeHls(reason, false);
      })
      .catch(() => { /* offline: the browser keeps retrying on its own */ });
  }

  /**
   * Native HLS (Safari/iOS without MSE): get a fresh URL and set it on the <video> again. A short
   * interruption is unavoidable here; live streams rejoin near the live edge.
   */
  private async recoverNativeHls(reason: string, fromError: boolean): Promise<void> {
    const refresher = this.tokenRefresher;
    const video = this.videoElement;
    if (!refresher || !video || !this.nativeHlsSrc || this.nativeRefreshInFlight) return;
    const token = this.loadToken;
    const wasPlaying = !video.paused || this.state.playing;
    const resumeAt = video.currentTime;
    this.nativeRefreshInFlight = true;
    try {
      await refresher.refresh(reason === 'error' ? 'native' : reason);
      if (this.isStale(token)) return;
      const fresh = refresher.rewrite(this.nativeHlsSrc);
      this.nativeHlsSrc = fresh;
      video.src = fresh;
      if (!this.isLiveStream() && resumeAt > 0) this.pendingStartTime = resumeAt;
      this.autoplayPending = wasPlaying;
      video.load();
    } catch (error) {
      if (this.isStale(token)) return;
      if (fromError) {
        this.handlePlaybackFailure('NETWORK_ERROR', 'Playback URL could not be refreshed', () => this.restartPlayback(), error);
      }
    } finally {
      this.nativeRefreshInFlight = false;
    }
  }

  /**
   * Autoplay for a freshly loaded source. Live streams fall back to muted playback when the browser
   * blocks sound ("Tap to unmute" pill); the poster with the big play button stays otherwise.
   */
  private async attemptAutoplay(): Promise<void> {
    const video = this.videoElement;
    if (!video) return;
    const token = this.loadToken;
    try {
      await video.play();
      return;
    } catch (error) {
      if (this.isStale(token) || (error as DOMException)?.name !== 'NotAllowedError') return;
    }
    const blocked = (mutedFallback: boolean) => {
      const payload: AutoplayBlockedEvent = { mutedFallback, sessionId: this._sessionId };
      this.emitEvent('player-autoplay-blocked', payload);
      this.eventBus.emit('autoplayBlocked', payload);
    };
    if (!this.isLiveStream() || video.muted) {
      blocked(false);
      return;
    }
    video.muted = true;
    try {
      await video.play();
      if (this.isStale(token)) return;
      this.showUnmutePill();
      blocked(true);
    } catch {
      if (this.isStale(token)) return;
      video.muted = false;
      blocked(false);
    }
  }

  private showUnmutePill(): void {
    this.removeUnmutePill();
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'vp-unmute-pill';
    pill.textContent = this.config.live?.messages?.tapToUnmute ?? DEFAULT_LIVE_MESSAGES.tapToUnmute;
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.videoElement) {
        this.videoElement.muted = false;
        if (this.videoElement.volume === 0) this.videoElement.volume = 1;
      }
      this.removeUnmutePill();
    });
    this.container.appendChild(pill);
    this.unmutePill = pill;
  }

  private removeUnmutePill(): void {
    this.unmutePill?.remove();
    this.unmutePill = null;
  }

  private showErrorUI(message: string, allowRetry: boolean): void {
    this.hideErrorUI();
    // One overlay at a time: the error replaces "Reconnecting…" and the live state becomes `error`
    this.liveLifecycle?.fail();

    const el = document.createElement('div');
    el.className = 'vp-error';
    el.setAttribute('role', 'alert');

    const icon = document.createElement('div');
    icon.className = 'vp-error-icon';
    icon.innerHTML = errorIcon();

    // Messages can come from the network (engine errors) — never parse them as HTML
    const text = document.createElement('p');
    text.className = 'vp-error-message';
    text.textContent = message;

    el.append(icon, text);

    if (allowRetry) {
      const retry = document.createElement('button');
      retry.className = 'vp-error-retry';
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', (e) => {
        e.stopPropagation();
        this.errorRecovery?.resetRetries();
        this.errorRecovery?.stopLiveReconnect();
        // getSignedPlaybackUrl re-signs inside startPlayback; otherwise get a fresh URL first so the
        // retry doesn't reload the same expired one
        const refresher = this.tokenRefresher;
        if (refresher && !this.config.security?.getSignedPlaybackUrl) {
          const token = this.loadToken;
          refresher.refresh('retry').catch(() => {}).finally(() => {
            if (!this.isStale(token)) this.restartPlayback();
          });
        } else {
          this.restartPlayback();
        }
      });
      el.appendChild(retry);
    }

    this.container.appendChild(el);
  }

  private hideErrorUI(): void {
    this.container.querySelector('.vp-error')?.remove();
  }

  // ============================================================================
  // SECURITY
  // ============================================================================

  private checkSdkAuth(): Error | null {
    const auth = this.config.sdkAuth;
    if (!auth) return null;
    if (typeof auth.apiKey !== 'string' || !auth.apiKey.trim()) {
      return new Error('sdkAuth.apiKey is required');
    }
    if (
      auth.allowedDomains?.length &&
      typeof location !== 'undefined' &&
      !isDomainAllowed(location.hostname, auth.allowedDomains)
    ) {
      return new Error(`This player is not licensed for "${location.hostname}"`);
    }
    return null;
  }

  private failSdkAuth(error: Error): void {
    try {
      this.config.sdkAuth?.onAuthError?.(error);
    } catch (callbackError) {
      console.error('[VideoPlayer] sdkAuth.onAuthError threw:', callbackError);
    }
    this.reportError('AUTH_ERROR', error.message, true, error);
    this.showErrorUI(error.message, false);
  }

  /** Header carrying `security.authToken` on HLS/DASH requests, if a token is set. */
  private getAuthHeader(): { name: string; value: string } | null {
    if (!this.authToken) return null;
    const custom = this.config.security?.tokenHeaderName;
    return custom
      ? { name: custom, value: this.authToken }
      : { name: 'Authorization', value: `Bearer ${this.authToken}` };
  }

  /**
   * Authorization failed (HTTP 401/403 or signing error). Refresh the token once if possible
   * and retry; otherwise notify the consumer and stop.
   */
  private async handleAuthorizationFailure(error: unknown, retry: () => void): Promise<void> {
    const security = this.config.security;
    let failure = toError(error);
    const token = this.loadToken;

    if (security?.refreshPlaybackToken && !this.authRefreshAttempted) {
      this.authRefreshAttempted = true;
      try {
        this.authToken = await security.refreshPlaybackToken();
        if (this.isStale(token)) return;
        retry();
        return;
      } catch (refreshError) {
        failure = toError(refreshError);
      }
    }
    if (this.isStale(token)) return;

    try {
      await security?.onPlaybackAuthorizationError?.(failure);
    } catch (callbackError) {
      console.error('[VideoPlayer] security.onPlaybackAuthorizationError threw:', callbackError);
    }
    if (this.isStale(token)) return;
    this.reportError('AUTH_ERROR', failure.message || 'Playback authorization failed', true, failure);
    this.showErrorUI('Playback authorization failed', true);
  }

  // ============================================================================
  // SOURCE LOADING
  // ============================================================================

  loadSource(source: VideoSource): void {
    if (!this.videoElement || this.destroyed) return;
    const video = this.videoElement;

    // Invalidate async work (engine imports, signing, retries) started for the previous source
    this.loadToken++;
    this.teardownEngines();
    this.hideErrorUI();
    this.stopHealthyTimer();
    this.authRejections = 0;
    this.startHold = null;
    this.p2pUnavailableReported = false;
    this.errorRecovery?.resetRetries();
    this.errorRecovery?.stopLiveReconnect();
    // The newest token belongs to the old source; the new one gets its own refresher
    this.tokenRefresher?.destroy();
    this.tokenRefresher = this.hasPlaybackRefresher() ? this.createTokenRefresher() : null;
    this.state.error = undefined;
    this.mediaErrorRecoveries = 0;
    this.authRefreshAttempted = false;
    this.autoplayPending = !!this.config.autoplay;
    if (source.src !== this.initialSourceSrc) this.pendingStartTime = null;

    // Timeline belongs to the new source until its metadata arrives
    this.state.duration = 0;
    this.state.currentTime = 0;
    this.state.buffered = 0;
    this.state.canPlay = false;
    this.state.ended = false;
    this.state.isLive = false;
    this.errorRecovery?.setLive(this.config.mode === 'live');
    this.liveLifecycle?.reset();
    this.liveLifecycle?.setActive(this.expectsLive());
    this.liveStats.onStopped();
    this.liveStats = new LiveSessionStats();
    this.lmsProgressManager?.setLiveStats(this.expectsLive() ? this.liveStatsProvider : null);
    this.removeUnmutePill();
    this.pausedAt = 0;
    this.updateState();

    // Reset quality state — the new source has its own renditions
    this.rawQualities = [];
    this.qualityLevels = [];
    this.defaultQualityApplied = false;
    this.state.qualities = [];
    this.state.quality = undefined;
    this.controlsManager?.updateQualities([], this.config.quality?.showAuto !== false);
    this.controlsManager?.setSelectedQuality(null);

    if (source.poster) video.poster = source.poster;
    else video.removeAttribute('poster');

    this.config.source = source;
    this.analyticsManager?.setSource(source.src);
    this.controlsManager?.setTitle(source.title);
    this.applySubtitleTracks();
    this.applyChaptersForSource(source);
    this.loadThumbnailsForSource(source);

    void this.startPlayback(source, this.loadToken);
  }

  /** Re-create the streaming engine for the current source, resuming from the current position. */
  private restartPlayback(): void {
    if (!this.videoElement || this.destroyed || this.liveLifecycle?.isEnded()) return;
    const resumeAt = this.state.currentTime;
    const wasPlaying = this.state.playing || this.autoplayPending;

    this.loadToken++;
    this.teardownEngines();
    this.hideErrorUI();
    this.liveLifecycle?.retrying();
    this.authRejections = 0;
    this.state.error = undefined;
    this.rawQualities = [];
    this.qualityLevels = [];
    if (!this.isLiveStream() && resumeAt > 0) this.pendingStartTime = resumeAt;
    this.autoplayPending = wasPlaying;

    void this.startPlayback(this.config.source, this.loadToken);
  }

  private async startPlayback(source: VideoSource, token: number): Promise<void> {
    let src = source.src;

    const getSigned = this.config.security?.getSignedPlaybackUrl;
    if (getSigned) {
      try {
        src = await getSigned(source.src);
      } catch (error) {
        if (!this.isStale(token)) this.handleAuthorizationFailure(error, () => this.restartPlayback());
        return;
      }
      if (this.isStale(token)) return;
    }

    // After a token refresh, restarts must not reload the expired URL. config.source.src is never
    // changed (the React wrapper would reload the stream when it changes)
    if (this.tokenRefresher) {
      if (getSigned) this.tokenRefresher.setUrl(src);
      src = this.tokenRefresher.rewrite(src);
    }

    // Detect from the original URL — signed URLs often hide the extension in a query string
    const sourceType = (!source.type || source.type === 'auto') ? detectSourceType(source.src) : source.type;

    if (sourceType === 'hls') {
      await this.loadHLSSource(src, token);
    } else if (sourceType === 'dash') {
      await this.loadDashSource(src, token);
    } else if (this.videoElement) {
      this.videoElement.src = src;
      this.videoElement.load();
    }
  }

  private teardownEngines(): void {
    this.stopPausedLatencyTimer();
    this.liveSeekPending = false;
    if (this.swarmEngine) {
      try {
        this.swarmEngine.destroy();
      } catch (e) { console.error('[VideoPlayer] Error destroying SwarmCloud engine:', e); }
      this.swarmEngine = null;
    }
    this.stopP2PStats();
    this.tokenRefresher?.detach();
    this.nativeHlsSrc = null;
    this.lastLatency = null;
    this.atLiveEdge = true;

    try {
      if (this.hls) this.hls.destroy();
    } catch (e) { console.error('[VideoPlayer] Error destroying HLS:', e); }
    this.hls = null;

    try {
      if (this.dash) this.dash.destroy();
    } catch (e) { console.error('[VideoPlayer] Error destroying Dash:', e); }
    this.dash = null;
  }

  private isStale(token: number): boolean {
    return this.destroyed || token !== this.loadToken || !this.videoElement;
  }

  private isInitialSource(source: VideoSource): boolean {
    return source.src === this.initialSourceSrc;
  }

  private currentSrc(): string {
    return this.config.source?.src ?? '';
  }

  /** The engine found the stream is live (hls.js playlist `live`, dash.js `isDynamic()`) */
  private markLive(live: boolean): void {
    if (this.state.isLive === live) return;
    this.state.isLive = live;
    this.errorRecovery?.setLive(live || this.config.mode === 'live');
    this.liveLifecycle?.setActive(live || this.expectsLive());
    this.lmsProgressManager?.setLiveStats(live || this.expectsLive() ? this.liveStatsProvider : null);
    this.controlsManager?.updateLiveState(live || this.config.mode === 'live');
    this.updateState();
  }

  private isLiveStream(): boolean {
    return this.config.mode === 'live' || this.state.isLive;
  }

  /** Configured as live before the engine could tell (mode 'live' or a `live` config) */
  private expectsLive(): boolean {
    return this.config.mode === 'live' || !!this.config.live;
  }

  /** Network came back: resume loading now instead of waiting for the next backoff step */
  private resumeLiveLoading(): void {
    if (this.destroyed || this.liveLifecycle?.isEnded()) return;
    this.errorRecovery?.resetRetries();
    this.errorRecovery?.stopLiveReconnect();
    this.hideErrorUI();
    const hls = this.hls;
    if (hls && hls.levels?.length) {
      try {
        hls.startLoad(-1);
        return;
      } catch {
        // fall through to a full restart
      }
    }
    this.restartPlayback();
  }

  /** The live stream ended: stop every request and retry */
  private stopLiveLoading(): void {
    this.errorRecovery?.resetRetries();
    this.errorRecovery?.stopLiveReconnect();
    this.hideErrorUI();
    try {
      this.hls?.stopLoad();
    } catch {
      // already destroyed
    }
  }

  private async loadHLSSource(src: string, token: number): Promise<void> {
    const Hls = await loadHls();
    if (this.isStale(token)) return;
    const video = this.videoElement!;

    if (Hls?.isSupported?.()) {
      const hls = await this.createHls(Hls, token);
      if (!hls) return; // superseded while the P2P engine was loading
      this.hls = hls;
      this.tokenRefresher?.setUrl(src);
      this.tokenRefresher?.attach(hls, Hls);
      if (this.usesSwarmCloud()) {
        const SwarmCloud = await loadSwarmCloudEngine();
        if (this.isStale(token) || this.hls !== hls) return;
        this.attachSwarmCloud(hls, SwarmCloud);
      }

      // Before loadSource/attachMedia, so integrations (e.g. a P2P engine) can hook in
      try {
        this.config.onHlsCreated?.(hls, Hls);
      } catch (error) {
        console.error('[VideoPlayer] onHlsCreated threw:', error);
      }
      this.emitEvent('player-hls-created', { hls });
      this.eventBus.emit('hlsCreated', { hls, Hls, sessionId: this._sessionId });
      if (this.isStale(token) || this.hls !== hls) return;

      if (this.config.debug) console.log('[VideoPlayer] HLS load', redactUrl(src, this.config.security?.tokenPrefixPattern));
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_: unknown, data: any) => {
        if (this.hls !== hls) return;
        // Runs before hls.js starts loading, so the first segment comes from this level
        this.applyLiveStartLevel(hls, data.levels ?? []);
        this.setRawQualities(
          (data.levels ?? []).map((l: any, i: number) => ({
            height: l.height ?? 0,
            width: l.width ?? 0,
            bitrate: l.bitrate ?? 0,
            ref: i,
          }))
        );
      });

      // hls.js keeps a finite duration for live streams, so take "live" from the playlist itself
      hls.on(Hls.Events.LEVEL_LOADED, (_: unknown, data: any) => {
        if (this.hls !== hls) return;
        this.authRejections = 0;
        const details = data?.details;
        if (typeof details?.live === 'boolean') {
          this.markLive(details.live);
          if (details.live) this.applyLiveBufferDefaults(hls);
          this.liveLifecycle?.playlistUpdate(details.endSN, details.live, details.targetduration);
          // A live playlist with no segments yet: the class hasn't started
          if (details.live && !details.fragments?.length) this.liveLifecycle?.streamUnavailable();
          else if (details.live) this.holdThinStart(hls, details);
        }
      });

      // All fragment traffic (HTTP or P2P) for accurate P2P stats
      hls.on(Hls.Events.FRAG_LOADED, (_: unknown, data: any) => {
        if (this.hls !== hls) return;
        this.authRejections = 0;
        // payload may already be transferred to the transmux worker (byteLength 0) — use the largest count
        this.p2pStats?.addFragmentBytes(Math.max(data?.payload?.byteLength ?? 0, data?.part?.stats?.loaded ?? 0, data?.part ? 0 : data?.frag?.stats?.loaded ?? 0));
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_: unknown, data: any) => {
        if (this.hls !== hls) return;
        const height = hls.levels?.[data.level]?.height;
        const quality = this.qualityLevels.find(q => q.height === height);
        if (quality) this.onQualityRendered(quality, hls.autoLevelEnabled ?? false);
      });

      hls.on(Hls.Events.ERROR, (_: unknown, data: any) => {
        if (this.hls !== hls) return;
        this.handleHlsError(hls, data);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS), or hls.js unavailable
      this.tokenRefresher?.setUrl(src);
      this.nativeHlsSrc = src;
      video.src = src;
    } else {
      this.handlePlaybackFailure(
        'SRC_NOT_SUPPORTED',
        'HLS playback requires hls.js (npm install hls.js) or a browser with native HLS support',
        null
      );
    }
  }

  /**
   * Build the hls.js instance for this load: low-latency tuning from `config.lowLatency`, and the
   * P2P mixin when `config.p2p.enabled`. Any P2P problem (library missing, no WebRTC, constructor
   * failure) degrades to plain HTTP hls.js — P2P must never stop playback.
   * Returns null when the load was superseded while the P2P engine was being imported.
   */
  private async createHls(Hls: any, token: number): Promise<any | null> {
    const p2pConfig = this.config.p2p;
    const strategy = p2pConfig?.strategy ?? 'latency';
    const wantsP2P = !!p2pConfig?.enabled && p2pConfig.provider !== 'swarmcloud' && isP2PSupported();
    const lowLatency = resolveLowLatency(this.config.lowLatency, wantsP2P ? strategy : undefined);

    // Auth header first, then any xhrSetup from config.hlsConfig
    const userXhrSetup = this.config.hlsConfig?.xhrSetup as ((xhr: XMLHttpRequest, url: string) => void | Promise<void>) | undefined;
    const baseXhrSetup = (xhr: XMLHttpRequest, url: string) => {
      const header = this.getAuthHeader();
      if (header) xhr.setRequestHeader(header.name, header.value);
      return userXhrSetup?.(xhr, url);
    };
    const build = (p2p: boolean): Record<string, unknown> => {
      const config = buildHlsConfig({
        lowLatency,
        latencyMode: this.config.live?.latencyMode,
        p2p,
        strategy,
        xhrSetup: baseXhrSetup,
        userConfig: this.config.hlsConfig,
      });
      // Token refresh is applied last: the URL swap wraps the xhrSetup above, plus retry policies.
      // The policies are installed for every HLS load so status 0 / timeouts (network switches) are
      // retried; without a refresher a 401/403 keeps hls.js's default decision (no retry).
      const tokenConfig = (this.tokenRefresher ?? NO_REFRESH).hlsConfig(Hls, baseXhrSetup);
      for (const name of ['manifestLoadPolicy', 'playlistLoadPolicy', 'fragLoadPolicy']) {
        // A consumer's own policy wins
        if (this.config.hlsConfig?.[name] !== undefined) delete tokenConfig[name];
      }
      if (!this.tokenRefresher) tokenConfig.xhrSetup = baseXhrSetup;
      return { ...config, ...tokenConfig };
    };

    if (wantsP2P) {
      const P2PEngine = await loadP2PEngine();
      if (this.isStale(token)) return null;

      if (P2PEngine?.injectMixin) {
        try {
          const HlsWithP2P = P2PEngine.injectMixin(Hls);
          const hls = new HlsWithP2P({
            ...build(true),
            p2p: {
              core: buildP2PCoreConfig({
                p2p: p2pConfig!,
                lowLatency,
                sourceUrl: this.config.source.src,
                httpRequestSetup: (this.config.security || this.tokenRefresher) ? this.p2pHttpRequestSetup : undefined,
              }),
            },
          });
          this.startP2PStats(hls.p2pEngine);
          return hls;
        } catch (error) {
          console.warn('[VideoPlayer] P2P unavailable, continuing over HTTP:', error);
          this.reportP2PUnavailable('p2p-media-loader', 'error', error);
        }
      } else {
        if (this.config.debug) console.warn('[VideoPlayer] p2p.enabled but p2p-media-loader-hlsjs is not installed — using HTTP only');
        this.reportP2PUnavailable('p2p-media-loader', 'not-installed');
      }
    } else if (p2pConfig?.enabled && p2pConfig.provider !== 'swarmcloud') {
      if (this.config.debug) console.warn('[VideoPlayer] p2p.enabled but WebRTC is unavailable — using HTTP only');
      this.reportP2PUnavailable('p2p-media-loader', 'unsupported');
    }

    return new Hls(build(false));
  }

  /**
   * Live HLS memory bounds for long sessions (hls.js keeps the whole back buffer by default). Applied
   * once the playlist says "live", unless set explicitly via hlsConfig or the latency settings.
   */
  private applyLiveBufferDefaults(hls: any): void {
    const config = hls?.config;
    if (!config) return;
    const user = this.config.hlsConfig ?? {};
    if (user.backBufferLength === undefined && !Number.isFinite(config.backBufferLength)) {
      config.backBufferLength = LIVE_BACK_BUFFER_SECONDS;
    }
    const hasDurationSync = (config.liveSyncDuration ?? null) !== null || (config.liveMaxLatencyDuration ?? null) !== null;
    // Count-based only: hls.js rejects mixing *Duration and *DurationCount
    if (user.liveMaxLatencyDurationCount === undefined && !hasDurationSync && !Number.isFinite(config.liveMaxLatencyDurationCount)) {
      config.liveMaxLatencyDurationCount = Math.max(10, (config.liveSyncDurationCount ?? 3) + 1);
    }
  }

  private usesSwarmCloud(): boolean {
    return !!this.config.p2p?.enabled && this.config.p2p.provider === 'swarmcloud';
  }

  /**
   * SwarmCloud replaces hls.js's fragment loader; it ignores URL rewrites made in xhrSetup, so the token
   * refresher (already attached) rewrites the parsed segment URLs for it. Failures fall back to HTTP.
   */
  private attachSwarmCloud(hls: any, P2pEngineHls: any): void {
    const p2p = this.config.p2p!;
    if (!P2pEngineHls) {
      if (this.config.debug) console.warn('[VideoPlayer] p2p.provider "swarmcloud" but @swarmcloud/hls is not installed — using HTTP only');
      this.reportP2PUnavailable('swarmcloud', 'not-installed');
      return;
    }
    try {
      if (typeof P2pEngineHls.isSupported === 'function' && !P2pEngineHls.isSupported()) {
        if (this.config.debug) console.warn('[VideoPlayer] SwarmCloud P2P not supported in this browser — using HTTP only');
        this.reportP2PUnavailable('swarmcloud', 'unsupported');
        return;
      }
      const pattern = this.config.security?.tokenPrefixPattern;
      const stats = new P2PStatsTracker(this._sessionId);
      // SwarmCloud refuses a custom channelId without a token — and throws only after it has already
      // replaced hls.js's loader, so never let it get that far
      let channelId: P2PConfigChannelId | undefined = p2p.channelId ?? ((m3u8Url: string) => tokenlessChannelId(m3u8Url, pattern));
      if (!p2p.token) {
        if (p2p.channelId) {
          console.warn('[VideoPlayer] SwarmCloud: p2p.channelId requires p2p.token — using HTTP only');
          this.reportP2PUnavailable('swarmcloud', 'config', { message: 'p2p.channelId requires p2p.token' });
          return;
        }
        console.warn('[VideoPlayer] SwarmCloud without p2p.token: using its default channel id (the full URL). ' +
          'With per-viewer signed URLs viewers will NOT share segments; set p2p.token.');
        channelId = undefined;
      }
      const engine = new P2pEngineHls({
        hlsjsInstance: hls,
        live: this.isLiveStream() || this.expectsLive(),
        token: p2p.token,
        trackerZone: p2p.trackerZone ?? 'hk',
        ...(channelId ? { channelId } : {}),
        // SwarmCloud reports totals in KB
        getStats: (totalP2PDownloaded: number, totalP2PUploaded: number, totalHTTPDownloaded: number) => {
          stats.setTotals({ httpBytes: totalHTTPDownloaded * 1024, p2pBytes: totalP2PDownloaded * 1024, uploadedBytes: totalP2PUploaded * 1024 });
        },
        getPeersInfo: (peers: string[]) => stats.setPeerCount(Array.isArray(peers) ? peers.length : 0),
        ...(p2p.swarmcloud ?? {}),
      });
      this.swarmEngine = engine;
      // A tracker refusal (bad token, domain not allowed, quota) arrives as `exception` with
      // code TRACKER_EXPT and retry false; temporary outages (5xx, network) have retry true
      engine.on?.('exception', (e: { code?: string; retry?: boolean; message?: string }) => {
        if (this.swarmEngine !== engine) return;
        if (e?.code === 'TRACKER_EXPT' && e.retry === false) this.reportP2PUnavailable('swarmcloud', 'rejected', e);
      });
      this.startP2PStats(null, stats);
    } catch (error) {
      console.warn('[VideoPlayer] SwarmCloud P2P unavailable, continuing over HTTP:', error);
      this.reportP2PUnavailable('swarmcloud', 'error', error);
    }
  }

  /** p2p-media-loader's own HTTP segment requests: add the auth header, preserve byte ranges */
  private p2pHttpRequestSetup = async (
    segmentUrl: string,
    _segmentByteRange: unknown,
    signal?: AbortSignal,
    requestByteRange?: { start: number; end?: number }
  ): Promise<Request | undefined> => {
    // Wait for an in-flight token refresh, then use the newest token
    await this.tokenRefresher?.settled();
    const url = this.tokenRefresher?.rewrite(segmentUrl) ?? segmentUrl;
    const header = this.getAuthHeader();
    if (!header && url === segmentUrl) return undefined;
    const headers: Record<string, string> = header ? { [header.name]: header.value } : {};
    if (requestByteRange) {
      headers.Range = `bytes=${requestByteRange.start}-${requestByteRange.end ?? ''}`;
    }
    return new Request(url, { headers, signal });
  };

  /** P2P is off for this source: tell the app once (DOM + EventBus). The token never leaves the player. */
  private reportP2PUnavailable(provider: P2PProvider, reason: P2PUnavailableReason, detail?: unknown): void {
    if (this.p2pUnavailableReported || this.destroyed) return;
    this.p2pUnavailableReported = true;
    const d = (detail ?? {}) as { code?: unknown; message?: unknown };
    const token = this.config.p2p?.token;
    let message = typeof d.message === 'string' && d.message ? d.message : undefined;
    if (message && token) message = message.split(token).join('***');
    const payload: P2PUnavailableEvent = {
      provider,
      reason,
      ...(typeof d.code === 'string' ? { code: d.code } : {}),
      ...(message ? { message } : {}),
      sessionId: this._sessionId,
    };
    this.emitEvent('player-p2p-unavailable', payload);
    this.eventBus.emit('p2pUnavailable', payload);
  }

  private startP2PStats(engine: any, prepared?: P2PStatsTracker): void {
    this.stopP2PStats();
    const tracker = prepared ?? new P2PStatsTracker(this._sessionId);
    if (engine) tracker.attach(engine);
    this.p2pStats = tracker;
    this.p2pEngine = engine;
    this.p2pStallTimes = [];
    this.p2pStartedAt = Date.now();
    this.p2pTimer = setInterval(() => {
      // A tracker answer of `rejected` turns SwarmCloud's P2P off silently (no exception event)
      if (this.swarmEngine?.p2pEnabled === false) {
        this.reportP2PUnavailable('swarmcloud', 'rejected', { code: 'P2P_DISABLED', message: 'The SwarmCloud tracker disabled P2P for this viewer' });
      }
      const stats = tracker.snapshot();
      this.emitEvent('player-p2p-stats', stats);
      this.eventBus.emit('p2pStats', stats);
    }, 2000);
  }

  private stopP2PStats(): void {
    if (this.p2pTimer) {
      clearInterval(this.p2pTimer);
      this.p2pTimer = null;
    }
    this.p2pStats?.detach();
    this.p2pStats = null;
    this.p2pEngine = null;
  }

  /**
   * Stall guard: waiting for peers must never break live playback. Two stalls within 20 s on a live
   * stream (after the 5 s startup) switch the P2P engine to fast HTTP fallback on the fly — peers
   * stay connected and still serve anything they already have, but urgent segments come from HTTP.
   */
  private checkP2PStall(): void {
    const engine = this.p2pEngine;
    if (!engine || !this.p2pStats || this.p2pStats.isSafeMode() || !this.isLiveStream()) return;
    const now = Date.now();
    if (now - this.p2pStartedAt < 5000) return;

    this.p2pStallTimes = this.p2pStallTimes.filter(t => now - t < 20000);
    this.p2pStallTimes.push(now);
    if (this.p2pStallTimes.length < 2) return;

    const lowLatency = resolveLowLatency(this.config.lowLatency, undefined);
    try {
      engine.applyDynamicConfig({
        core: {
          highDemandTimeWindow: Math.max(6, (lowLatency?.targetLatency ?? 4) + 2),
          httpDownloadInitialTimeoutMs: 0,
          p2pNotReceivingBytesTimeoutMs: 1000,
          p2pErrorRetries: 1,
        },
      });
      this.p2pStats.setSafeMode();
      console.warn('[VideoPlayer] Repeated stalls with P2P — switched P2P to fast HTTP fallback (safe mode)');
    } catch (error) {
      if (this.config.debug) console.warn('[VideoPlayer] Could not apply P2P safe mode:', error);
    }
  }

  /** Measure live latency (throttled to ~1/s), update the LIVE badge and emit `latency` */
  private stopPausedLatencyTimer(): void {
    if (this.pausedLatencyTimer) {
      clearInterval(this.pausedLatencyTimer);
      this.pausedLatencyTimer = null;
    }
  }

  private trackLatency(): void {
    if (!this.isLiveStream() || this.liveSeekPending) return;
    const now = Date.now();
    if (now - this.lastLatencyEmit < 1000) return;

    const snapshot = this.measureLatency();
    if (!snapshot) return;
    this.lastLatencyEmit = now;
    this.lastLatency = snapshot;
    if (!this.videoElement?.paused) this.liveStats.onLatency(snapshot.latency);

    if (snapshot.atLiveEdge !== this.atLiveEdge) {
      this.atLiveEdge = snapshot.atLiveEdge;
      this.controlsManager?.updateLiveEdge(snapshot.atLiveEdge, this.config.live?.messages?.goLive);
      const payload: LiveEdgeChangeEvent = { atLiveEdge: snapshot.atLiveEdge, latencySec: snapshot.latency, sessionId: this._sessionId };
      this.emitEvent('player-live-edge-change', payload);
      this.eventBus.emit('liveEdgeChange', payload);
    }
    this.emitEvent('player-latency', snapshot);
    this.eventBus.emit('latency', snapshot);
  }

  private measureLatency(): LatencyEvent | null {
    const video = this.videoElement;
    if (!video) return null;

    let latency: number | null = null;
    let target: number | null = null;
    if (this.hls) {
      latency = typeof this.hls.latency === 'number' ? this.hls.latency : null;
      target = typeof this.hls.targetLatency === 'number' ? this.hls.targetLatency : null;
    }
    if (latency === null && video.seekable && video.seekable.length) {
      // Native HLS (Safari): distance from the end of the seekable window
      latency = Math.max(0, video.seekable.end(video.seekable.length - 1) - video.currentTime);
    }
    if (latency === null || !Number.isFinite(latency)) return null;
    if (target === null || !Number.isFinite(target)) {
      target = resolveLowLatency(this.config.lowLatency, undefined)?.targetLatency ?? 3 * 2;
    }

    // Behind the live edge above ~1.5 × target latency (at least target + 1 s); hysteresis: live again
    // within 1.25 × target (at least target + 0.5 s) so the badge doesn't flicker
    const behindAt = Math.max(target * 1.5, target + 1);
    const liveAgainAt = Math.max(target * 1.25, target + 0.5);
    const atLiveEdge = this.atLiveEdge ? latency <= behindAt : latency <= liveAgainAt;
    return {
      latency,
      targetLatency: target,
      atLiveEdge,
      playbackRate: video.playbackRate,
      sessionId: this._sessionId,
    };
  }

  /**
   * live.startLevel (default 'lowest'): the first segment comes from the smallest rendition, then ABR
   * switches up. hls.js would otherwise guess from abrEwmaDefaultEstimate, risky for far-away viewers.
   * Skipped when the app chose a start (hlsConfig.startLevel, quality.defaultQuality).
   */
  private applyLiveStartLevel(hls: any, levels: Array<{ bitrate?: number }>): void {
    if (!this.expectsLive() || levels.length < 2) return;
    if (this.config.hlsConfig && 'startLevel' in this.config.hlsConfig) return;
    const preferred = this.config.quality?.defaultQuality;
    if (preferred !== undefined && preferred !== 'auto') return;
    const option = this.config.live?.startLevel ?? 'lowest';
    if (option === 'auto') return;
    const index = typeof option === 'number'
      ? Math.trunc(option)
      : levels.reduce((best, l, i) => ((l.bitrate || Infinity) < (levels[best].bitrate || Infinity) ? i : best), 0);
    if (index < 0 || index >= levels.length) return;
    try {
      hls.startLevel = index;
    } catch {
      // older hls.js without a startLevel setter
    }
  }

  /**
   * live.minSegmentsToStart: a viewer joining in the first seconds of a class sees a playlist with
   * 1-3 segments, so playback would start with almost no buffer. Stay `waiting` (stop loading, poll)
   * until the playlist is long enough — unless its window is already sliding (the edge keeps fewer
   * segments than asked) or we have held for longer than those segments take to appear.
   */
  private holdThinStart(hls: any, details: any): boolean {
    const lifecycle = this.liveLifecycle;
    if (!lifecycle?.isActive() || lifecycle.hasStarted()) {
      this.startHold = null;
      return false;
    }
    const live = this.config.live;
    const min = live?.minSegmentsToStart ?? (live?.latencyMode === 'standard' ? 4 : 0);
    const count = details.fragments?.length ?? 0;
    if (count >= min) {
      this.startHold = null;
      return false;
    }
    const startSN = typeof details.startSN === 'number' ? details.startSN : 0;
    const now = Date.now();
    const hold = (this.startHold ??= { startSN, since: now });
    const maxHoldMs = min * Math.max(1, details.targetduration || 3) * 1000 + 5000;
    if (startSN > hold.startSN || now - hold.since > maxHoldMs) return false;
    try {
      hls.stopLoad();
    } catch {
      // already destroyed
    }
    lifecycle.streamUnavailable();
    return true;
  }

  private handleHlsError(hls: any, data: any): void {
    const lifecycle = this.liveLifecycle;
    const status = data?.response?.code;
    lifecycle?.httpStatus(status);
    if (lifecycle?.isEnded()) return;

    // Live class not started yet: manifest/playlist 404 or an empty playlist before the first frame
    if (lifecycle?.isActive() && !lifecycle.hasStarted()) {
      const notThereYet =
        data?.details === 'levelEmptyError' ||
        (status === 404 && (data?.details === 'manifestLoadError' || data?.details === 'levelLoadError'));
      if (notThereYet) {
        // Expected while waiting for the class: liveStateChange('waiting') says it, not an error event
        lifecycle.streamUnavailable();
        return;
      }
    }

    const refresher = this.tokenRefresher;

    // No refresher: a rejected URL/token can't fix itself. hls.js retries twice (1 s, 2 s) in case the
    // 403 was transient; on the 3rd rejection stop loading and show the auth error (~3-6 s, not ~20 s)
    if (!refresher && data?.type === 'networkError' && (status === 401 || status === 403)) {
      this.authRejections++;
      if (data.fatal || this.authRejections >= AUTH_FAST_FAIL_AFTER) {
        this.authRejections = 0;
        try {
          hls.stopLoad();
        } catch {
          // already destroyed
        }
        this.handleAuthorizationFailure(new Error(`HTTP ${status}: ${data.details}`), () => {
          if (this.hls === hls && hls.levels?.length) hls.startLoad();
          else this.restartPlayback();
        });
      }
      return;
    }

    // hls.js recovers non-fatal errors itself
    if (!data?.fatal) return;

    // 404 after the class started: most likely the class is ending. Keep reconnecting quietly; the
    // lifecycle turns it into `ended` (or back to `playing`) — no error events for an expected end
    const quiet = status === 404 && data.type === 'networkError' && !!lifecycle?.isActive() && lifecycle.hasStarted();

    // Signed URLs: hls.js already retried (with in-place token swaps). Last resort: fresh URL + reload
    if (data.type === 'networkError' && refresher) {
      const authFailure = status === 401 || status === 403;
      const message = authFailure ? `HTTP ${status}: ${data.details}` : String(data.details ?? 'HLS network error');
      const code: VidstreamErrorCode = authFailure ? 'AUTH_ERROR' : 'NETWORK_ERROR';
      this.handlePlaybackFailure(code, message, () => {
        if (this.hls !== hls) return;
        const token = this.loadToken;
        refresher.refresh('fatal')
          .then(() => {
            if (this.isStale(token) || this.hls !== hls) return;
            const fresh = refresher.rewrite(this.lastHlsUrl(hls));
            // hls.js re-attaches the media itself (short visible rebuffer) and auto-starts loading
            if (hls.levels?.length) hls.loadSource(fresh);
            else this.restartPlayback();
          })
          .catch(() => {
            // Refresh failed or rate-limited (offline, backend down): keep the current token and retry
            if (this.isStale(token) || this.hls !== hls) return;
            if (hls.levels?.length) hls.startLoad();
            else this.restartPlayback();
          });
      }, data.error, quiet);
      return;
    }

    const message = String(data.details ?? 'HLS playback error');
    if (data.type === 'networkError') {
      this.handlePlaybackFailure('NETWORK_ERROR', message, () => {
        if (this.hls !== hls) return;
        // startLoad() resumes fragment loading; a failed manifest needs a fresh instance
        if (hls.levels?.length) hls.startLoad();
        else this.restartPlayback();
      }, data.error, quiet);
    } else if (data.type === 'mediaError') {
      this.handlePlaybackFailure('DECODE_ERROR', message, () => {
        if (this.hls !== hls) return;
        // Standard hls.js recovery: recoverMediaError, then swap audio codec on a repeat failure
        if (this.mediaErrorRecoveries++ > 0) hls.swapAudioCodec();
        hls.recoverMediaError();
      }, data.error);
    } else {
      this.handlePlaybackFailure('DECODE_ERROR', message, () => this.restartPlayback(), data.error);
    }
  }

  /** URL of the manifest the hls.js instance was loaded with */
  private lastHlsUrl(hls: any): string {
    return typeof hls?.url === 'string' && hls.url ? hls.url : this.config.source.src;
  }

  private async loadDashSource(src: string, token: number): Promise<void> {
    const dashjs = await loadDash();
    if (this.isStale(token)) return;

    if (!dashjs?.MediaPlayer) {
      this.handlePlaybackFailure('SRC_NOT_SUPPORTED', 'DASH playback requires dash.js (npm install dashjs)', null);
      return;
    }

    const player = dashjs.MediaPlayer().create();
    this.dash = player;
    if (this.config.security) this.installDashAuth(player);
    player.initialize(this.videoElement, src, false);
    player.updateSettings({
      streaming: {
        abr: { autoSwitchBitrate: { video: true } },
        buffer: { fastSwitchEnabled: true },
      },
    });

    const events = dashjs.MediaPlayer.events;

    player.on(events.STREAM_INITIALIZED, () => {
      if (this.dash !== player) return;
      try {
        if (typeof player.isDynamic === 'function') this.markLive(!!player.isDynamic());
      } catch {
        // live detection is best-effort
      }
      try {
        this.setRawQualities(this.getDashRepresentations(player));
      } catch (error) {
        if (this.config.debug) console.warn('[VideoPlayer] Could not read DASH qualities:', error);
      }
    });

    player.on(events.QUALITY_CHANGE_RENDERED, (e: any) => {
      if (this.dash !== player || (e?.mediaType && e.mediaType !== 'video')) return;
      try {
        // dash.js v5 sends the representation; v4 sends a quality index
        let height: number | undefined = e?.newRepresentation?.height;
        if (height === undefined && typeof e?.newQuality === 'number' && typeof player.getBitrateInfoListFor === 'function') {
          height = player.getBitrateInfoListFor('video')?.[e.newQuality]?.height;
        }
        const quality = this.qualityLevels.find(q => q.height === height);
        if (quality) this.onQualityRendered(quality, this.isDashAutoQuality(player));
      } catch {
        // quality display is best-effort
      }
    });

    player.on(events.ERROR, (e: any) => {
      if (this.dash !== player) return;
      this.handleDashError(e);
    });
  }

  /** Video representations across dash.js v5 (getRepresentationsByType) and v4 (getBitrateInfoListFor). */
  private getDashRepresentations(player: any): RawQuality[] {
    if (typeof player.getRepresentationsByType === 'function') {
      return (player.getRepresentationsByType('video') ?? []).map((r: any) => ({
        height: r.height ?? 0,
        width: r.width ?? 0,
        bitrate: r.bandwidth ?? (r.bitrateInKbit ?? 0) * 1000,
        ref: r.id,
      }));
    }
    if (typeof player.getBitrateInfoListFor === 'function') {
      return (player.getBitrateInfoListFor('video') ?? []).map((b: any, i: number) => ({
        height: b.height ?? 0,
        width: b.width ?? 0,
        bitrate: b.bitrate ?? 0,
        ref: b.qualityIndex ?? i,
      }));
    }
    return [];
  }

  private isDashAutoQuality(player: any): boolean {
    try {
      return player.getSettings?.()?.streaming?.abr?.autoSwitchBitrate?.video !== false;
    } catch {
      return true;
    }
  }

  private installDashAuth(player: any): void {
    if (typeof player.addRequestInterceptor === 'function') {
      // dash.js v5
      player.addRequestInterceptor((request: any) => {
        const header = this.getAuthHeader();
        if (header) request.headers = { ...(request.headers ?? {}), [header.name]: header.value };
        return Promise.resolve(request);
      });
    } else if (typeof player.extend === 'function') {
      // dash.js v4
      player.extend('RequestModifier', () => ({
        modifyRequestURL: (url: string) => url,
        modifyRequestHeader: (xhr: XMLHttpRequest) => {
          const header = this.getAuthHeader();
          if (header) xhr.setRequestHeader(header.name, header.value);
          return xhr;
        },
      }), true);
    }
  }

  private handleDashError(e: any): void {
    const error = e?.error ?? e;
    const code: number | undefined = typeof error?.code === 'number' ? error.code : undefined;
    if (code !== undefined && DASH_IGNORED_ERROR_CODES.has(code)) return;

    const message = String(error?.message ?? 'DASH playback error');
    const status = error?.data?.response?.status ?? error?.data?.request?.status ?? error?.data?.status;
    if (status === 401 || status === 403) {
      this.handleAuthorizationFailure(new Error(`HTTP ${status}: ${message}`), () => this.restartPlayback());
      return;
    }

    if (code !== undefined && DASH_UNSUPPORTED_ERROR_CODES.has(code)) {
      this.handlePlaybackFailure('SRC_NOT_SUPPORTED', message, null, error);
    } else if (code !== undefined && DASH_NETWORK_ERROR_CODES.has(code)) {
      this.handlePlaybackFailure('NETWORK_ERROR', message, () => this.restartPlayback(), error);
    } else {
      this.handlePlaybackFailure('DECODE_ERROR', message, () => this.restartPlayback(), error);
    }
  }

  // ============================================================================
  // QUALITY
  // ============================================================================

  /** Store the engine's renditions and publish the filtered list. */
  private setRawQualities(raw: RawQuality[]): void {
    // Keep one entry per height (highest bitrate wins)
    const byHeight = new Map<number, RawQuality>();
    raw.filter(q => q.height > 0).forEach(q => {
      const existing = byHeight.get(q.height);
      if (!existing || q.bitrate > existing.bitrate) byHeight.set(q.height, q);
    });
    this.rawQualities = Array.from(byHeight.values());
    this.refreshQualityLevels();

    const preferred = this.config.quality?.defaultQuality;
    if (!this.defaultQualityApplied && preferred !== undefined && preferred !== 'auto') {
      this.defaultQualityApplied = true;
      this.setQuality(preferred);
    }
  }

  /** Apply `quality.allowedQualities` / `showAuto` to the stored renditions. */
  private refreshQualityLevels(): void {
    const qc = this.config.quality;
    let raw = this.rawQualities;
    if (qc?.allowedQualities?.length) {
      raw = raw.filter(q => qc.allowedQualities!.some(a => Math.abs(q.height - a) <= 100));
    }
    this.qualityLevels = raw.map(q => ({
      height: q.height,
      width: q.width,
      bitrate: q.bitrate,
      label: `${q.height}p`,
      active: this.state.quality?.height === q.height,
    }));
    this.state.qualities = this.qualityLevels;
    this.controlsManager?.updateQualities(this.qualityLevels, qc?.showAuto !== false);
  }

  private onQualityRendered(quality: QualityLevel, auto: boolean): void {
    this.liveStats.onQualitySwitch();
    const prev = this.state.quality;
    if (prev?.height === quality.height) return;
    this.state.quality = quality;
    this.emitEvent('player-quality-change', quality);
    this.eventBus.emit('qualityChange', {
      fromQuality: prev?.label ?? 'auto',
      toQuality: quality.label,
      auto,
      sessionId: this._sessionId,
    });
    this.analyticsManager?.trackEvent('quality_changed', this.getAnalyticsState());
    if (auto) this.controlsManager?.updateAutoQualityDisplay(quality);
  }

  // ============================================================================
  // PLAYBACK API
  // ============================================================================

  async play(): Promise<void> {
    if (!this.videoElement) return;
    this.autoplayPending = false;
    try {
      await this.videoElement.play();
    } catch {
      // Autoplay policy — silently ignored
    }
  }

  pause(): void { this.videoElement?.pause(); }

  togglePlay(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /** Seek to `time` seconds. Before metadata has loaded the seek is remembered and applied on load. */
  seek(time: number): void {
    if (!this.videoElement || !Number.isFinite(time)) return;
    const duration = this.state.duration;
    if (!(duration > 0)) {
      this.pendingStartTime = Math.max(0, time);
      return;
    }
    this.videoElement.currentTime = Number.isFinite(duration)
      ? Math.max(0, Math.min(time, duration))
      : Math.max(0, time);
  }

  private seekToPercentage(percentage: number): void {
    this.seek(percentage * this.state.duration);
  }

  setVolume(volume: number): void {
    if (this.videoElement) this.videoElement.volume = Math.max(0, Math.min(1, volume));
  }

  setMuted(muted: boolean): void {
    if (this.videoElement) this.videoElement.muted = muted;
  }

  toggleMute(): void {
    if (this.videoElement) this.videoElement.muted = !this.videoElement.muted;
  }

  setPlaybackRate(rate: number): void {
    if (this.videoElement) this.videoElement.playbackRate = Math.max(0.25, Math.min(4, rate));
  }

  setSpeed(rate: number): void { this.setPlaybackRate(rate); }

  async enterFullscreen(): Promise<void> {
    const el = this.container as any;
    const video = this.videoElement as any;
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else if (video?.webkitEnterFullscreen) {
        // iPhone Safari: element fullscreen is unsupported, use the native video fullscreen
        video.webkitEnterFullscreen();
        return;
      } else {
        return;
      }
      if (screen.orientation && 'lock' in screen.orientation) {
        try { await (screen.orientation as any).lock('landscape'); } catch {}
      }
    } catch {
      try { video?.webkitEnterFullscreen?.(); } catch {}
    }
  }

  async exitFullscreen(): Promise<void> {
    const doc = document as any;
    const video = this.videoElement as any;
    try {
      if (doc.fullscreenElement && doc.exitFullscreen) {
        await doc.exitFullscreen();
      } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
        video.webkitExitFullscreen();
      }
      if (screen.orientation && 'unlock' in screen.orientation) {
        try { (screen.orientation as any).unlock(); } catch {}
      }
    } catch {}
  }

  toggleFullscreen(): void {
    if (this.state.fullscreen) this.exitFullscreen();
    else this.enterFullscreen();
  }

  async enterPip(): Promise<void> {
    if (!this.videoElement || this.isPipOperationInFlight) return;
    if (this.config.pip?.enabled === false) return;
    this.isPipOperationInFlight = true;
    try {
      await this.videoElement.requestPictureInPicture();
    } catch {
      this.isPipOperationInFlight = false;
    }
  }

  async exitPip(): Promise<void> {
    if (this.isPipOperationInFlight || !document.pictureInPictureElement) return;
    this.isPipOperationInFlight = true;
    try {
      await document.exitPictureInPicture();
    } catch {
      this.isPipOperationInFlight = false;
    }
  }

  togglePip(): void {
    if (this.state.pip) this.exitPip();
    else this.enterPip();
  }

  /** Switch rendition: a QualityLevel, a height in pixels (e.g. 720) or 'auto'. */
  setQuality(quality: QualityLevel | 'auto' | number): void {
    const height = quality === 'auto' ? null : typeof quality === 'number' ? quality : quality.height;
    const raw = height === null ? null : this.rawQualities.find(q => q.height === height);
    if (height !== null && !raw) return;

    if (this.hls) {
      this.hls.currentLevel = raw ? Number(raw.ref) : -1;
    } else if (this.dash) {
      const player = this.dash;
      player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: !raw } } } });
      if (raw) {
        try {
          if (typeof player.setRepresentationForTypeById === 'function') {
            player.setRepresentationForTypeById('video', String(raw.ref), true);
          } else if (typeof player.setQualityFor === 'function') {
            player.setQualityFor('video', Number(raw.ref), true);
          }
        } catch (error) {
          console.error('[VideoPlayer] Failed to switch DASH quality:', error);
        }
      }
    } else {
      return;
    }

    // Keep the menu in sync when the change didn't come from it
    const level = raw ? this.qualityLevels.find(q => q.height === raw.height) ?? null : null;
    this.controlsManager?.setSelectedQuality(level);
  }

  setSubtitle(track: SubtitleTrack | null): void {
    if (!this.videoElement) return;
    const tracks = this.videoElement.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const matches = !!track
        && tracks[i].language === track.language
        && (!track.label || !tracks[i].label || tracks[i].label === track.label);
      tracks[i].mode = matches ? 'showing' : 'hidden';
    }
    this.state.activeSubtitle = track ?? undefined;
    this.controlsManager?.setSelectedSubtitle(track);
    this.analyticsManager?.trackEvent('subtitle_changed', this.getAnalyticsState());
  }

  private applySubtitleTracks(): void {
    if (!this.videoElement) return;
    Array.from(this.videoElement.querySelectorAll('track')).forEach(t => t.remove());
    (this.config.subtitles ?? []).forEach(track => {
      const trackEl = document.createElement('track');
      trackEl.kind = track.kind ?? 'subtitles';
      trackEl.src = track.src;
      trackEl.srclang = track.language;
      trackEl.label = track.label;
      if (track.default) trackEl.default = true;
      this.videoElement!.appendChild(trackEl);
    });
    this.controlsManager?.updateSubtitles(this.config.subtitles ?? []);
  }

  private forward(): void {
    this.seek(this.state.currentTime + (this.config.controls?.seekDuration ?? 10));
  }

  private rewind(): void {
    this.seek(this.state.currentTime - (this.config.controls?.seekDuration ?? 10));
  }

  // ============================================================================
  // PLAYLIST API
  // ============================================================================

  next(): void {
    if (!this.playlistManager) return;
    const item = this.playlistManager.next();
    if (item) {
      this.updatePlaylistControls();
      this.play().catch(() => {});
    }
  }

  prev(): void {
    if (!this.playlistManager) return;
    const item = this.playlistManager.prev();
    if (item) {
      this.updatePlaylistControls();
      this.play().catch(() => {});
    }
  }

  goTo(index: number): void {
    if (!this.playlistManager) return;
    if (!this.playlistManager.goTo(index)) return;
    this.updatePlaylistControls();
    this.play().catch(() => {});
  }

  // ============================================================================
  // STATE GETTERS (VidstreamPlayerInstance)
  // ============================================================================

  getCurrentTime(): number { return this.state.currentTime; }
  getDuration(): number { return this.state.duration; }
  getVolume(): number { return this.state.volume; }
  isPaused(): boolean { return this.state.paused; }
  isFullscreen(): boolean { return this.state.fullscreen; }
  getQuality(): string | number { return this.state.quality?.label ?? 'auto'; }
  get sessionId(): string { return this._sessionId; }

  // ============================================================================
  // LIVE + P2P API
  // ============================================================================

  /** Jump to the live edge (hls.js live sync point, i.e. the target latency). No-op for VOD. */
  seekToLive(): void {
    const video = this.videoElement;
    if (!video || !this.isLiveStream()) return;

    const syncPosition = this.hls?.liveSyncPosition;
    if (typeof syncPosition === 'number' && Number.isFinite(syncPosition)) {
      if (Math.abs(video.currentTime - syncPosition) > 0.5) this.liveSeekPending = true;
      video.currentTime = syncPosition;
    } else if (video.seekable && video.seekable.length) {
      const end = video.seekable.end(video.seekable.length - 1);
      this.liveSeekPending = true;
      video.currentTime = Math.max(0, end - this.nativeLiveHoldBack());
    }
    const wasBehind = !this.atLiveEdge;
    this.atLiveEdge = true;
    this.controlsManager?.updateLiveEdge(true);
    if (wasBehind) {
      // The seek hasn't landed yet: report the latency being steered to
      const target = typeof this.hls?.targetLatency === 'number' ? this.hls.targetLatency : this.nativeLiveHoldBack();
      const payload: LiveEdgeChangeEvent = { atLiveEdge: true, latencySec: target, sessionId: this._sessionId };
      this.emitEvent('player-live-edge-change', payload);
      this.eventBus.emit('liveEdgeChange', payload);
    }
    if (video.paused) this.play().catch(() => {});
  }

  /** Alias of seekToLive() */
  goToLive(): void {
    this.seekToLive();
  }

  /**
   * The live stream has ended (e.g. your backend got a `stream.ended` webhook and pushed it). Shows the
   * "ended" overlay, stops loading and emits `streamEnded`.
   */
  markStreamEnded(): void {
    if (!this.liveLifecycle) return;
    this.liveLifecycle.setActive(true);
    this.liveLifecycle.markEnded();
  }

  /** Live lifecycle state: idle | waiting | playing | reconnecting | ended | offline */
  getLiveState(): LiveState {
    return this.liveLifecycle?.getState() ?? 'idle';
  }

  /** Watch statistics of the current live session (null for VOD) */
  getLiveStats(): LiveWatchStats | null {
    return this.isLiveStream() ? this.liveStats.snapshot() : null;
  }

  /** Show/hide the statistics overlay (requires controls.stats). Returns whether it is now visible. */
  toggleStats(force?: boolean): boolean {
    if (!this.statsOverlay) {
      if (force === false) return false;
      this.statsOverlay = new StatsOverlay(this.container, () => this.readStats());
    }
    const show = force ?? !this.statsOverlay.isVisible();
    if (show) this.statsOverlay.show();
    else this.statsOverlay.hide();
    return show;
  }

  private liveStatsProvider = (): LiveWatchStats => this.liveStats.snapshot();

  /** Extra analytics / heartbeat data for live sessions (never contains Infinity) */
  private liveAnalyticsData(): Record<string, unknown> | undefined {
    if (!this.isLiveStream()) return undefined;
    const latency = this.lastLatency?.latency;
    return {
      live: {
        ...this.liveStats.snapshot(),
        latency: typeof latency === 'number' && Number.isFinite(latency) ? Math.round(latency * 100) / 100 : null,
        liveState: this.getLiveState(),
      },
    };
  }

  private readStats(): StatsSnapshot {
    const video = this.videoElement;
    const latency = this.isLiveStream() ? this.measureLatency() : null;
    let buffer = 0;
    if (video && video.buffered.length) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime + 0.1 && video.buffered.end(i) >= video.currentTime) {
          buffer = video.buffered.end(i) - video.currentTime;
        }
      }
    }
    let bitrate: number | null = null;
    const hls = this.hls;
    if (hls && hls.levels?.length) {
      const level = hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel];
      if (level?.bitrate) bitrate = level.bitrate / 1000;
    } else if (this.state.quality?.bitrate) {
      bitrate = this.state.quality.bitrate / 1000;
    }
    const quality = typeof (video as any)?.getVideoPlaybackQuality === 'function' ? video!.getVideoPlaybackQuality() : null;
    const p2p = this.getP2PStats();
    return {
      latency: latency?.latency ?? null,
      targetLatency: latency?.targetLatency ?? null,
      buffer: Math.max(0, buffer),
      resolution: video && video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : null,
      bitrateKbps: bitrate,
      droppedFrames: quality ? quality.droppedVideoFrames : null,
      totalFrames: quality ? quality.totalVideoFrames : null,
      p2pRatio: p2p ? p2p.p2pRatio : null,
      peers: p2p ? p2p.peers : null,
      liveState: this.liveLifecycle?.isActive() ? this.getLiveState() : null,
    };
  }

  /** OS media controls for the source that is playing */
  private updateMediaSession(): void {
    if (this.config.mediaSession === false) return;
    const source = this.config.source;
    applyMediaSession(
      { title: source.title, artwork: source.poster, live: this.isLiveStream() },
      {
        play: () => { void this.play(); },
        pause: () => this.pause(),
        seekBy: (seconds) => { if (!this.isLiveStream()) this.seek(this.state.currentTime + seconds); },
        seekTo: (time) => { if (!this.isLiveStream()) this.seek(time); },
      }
    );
    this.mediaSessionActive = true;
  }

  /**
   * Native HLS (no hls.js): distance from the end of the seekable window to start at —
   * 3 × target duration for regular HLS (as hls.js), the configured target for low latency.
   */
  private nativeLiveHoldBack(): number {
    if (this.config.live?.latencyMode === 'low') return 1.5;
    const ll = resolveLowLatency(this.config.lowLatency, undefined);
    if (ll && !this.config.live?.latencyMode) return ll.targetLatency;
    return 3 * 3;
  }

  /** Latest live latency snapshot, or null when not playing a live stream */
  getLiveLatency(): LatencyEvent | null {
    if (!this.isLiveStream()) return null;
    return this.measureLatency() ?? this.lastLatency;
  }

  /** P2P traffic for the current source, or null when P2P is not active */
  getP2PStats(): P2PStats | null {
    return this.p2pStats?.snapshot() ?? null;
  }

  /** The active hls.js instance (null for MP4/DASH/native HLS or before it is created) */
  getHls(): any {
    return this.hls;
  }

  /** The active dash.js MediaPlayer, or null */
  getDash(): any {
    return this.dash;
  }

  // ============================================================================
  // EVENT BUS (VidstreamPlayerInstance)
  // ============================================================================

  on(event: string, handler: Function): void { this.eventBus.on(event, handler as any); }
  off(event: string, handler: Function): void { this.eventBus.off(event, handler as any); }
  once(event: string, handler: Function): void { this.eventBus.once(event, handler as any); }

  // ============================================================================
  // STATE
  // ============================================================================

  getState(): PlayerState { return { ...this.state }; }

  private getInitialState(): PlayerState {
    return {
      playing: false, paused: true, ended: false, buffering: false,
      canPlay: false, currentTime: 0, duration: 0, buffered: 0,
      volume: 1, muted: false, playbackRate: 1, fullscreen: false,
      pip: false, qualities: [], isLive: false,
    };
  }

  private updateState(): void { this.controlsManager?.updateState(this.state); }

  private getAnalyticsState() {
    return {
      currentTime: this.state.currentTime,
      duration: Number.isFinite(this.state.duration) ? this.state.duration : 0,
      volume: this.state.volume,
      muted: this.state.muted,
      playbackRate: this.state.playbackRate,
      quality: this.state.quality?.label,
    };
  }

  /** DOM `player-heartbeat` while playing (interval: analytics.heartbeatInterval, default 30 s) */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.config.analytics?.heartbeatInterval ?? 30000;
    this.heartbeatTimer = setInterval(() => this.emitEvent('player-heartbeat', this.liveAnalyticsData() ?? {}), interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ============================================================================
  // CONFIG
  // ============================================================================

  /**
   * Apply config changes at runtime. Supported live: theme, mode, controls, gestures,
   * keyboardShortcuts, pip, watermark, antiPiracyText, source (src/type reloads; poster/title update),
   * subtitles, chapters, chaptersVtt, thumbnailVtt, quality, muted, loop, preload, playbackRate, autoplay
   * (next load), errorRecovery, miniPlayer, playlist/playlistOptions, security.authToken.
   * analytics, lmsProgress, plugins, sdkAuth and startTime are read once at construction.
   */
  updateConfig(config: Partial<PlayerConfig>): void {
    if (this.destroyed) return;
    const prev = this.config;
    this.config = { ...prev, ...config };
    const video = this.videoElement;

    if (config.theme) {
      this.themeManager?.applyTheme(config.theme);
    }

    const modeChanged = config.mode !== undefined && config.mode !== prev.mode;
    if (modeChanged) this.themeManager?.applyModeStyles(config.mode!);

    if (config.watermark) {
      if (this.watermarkManager) {
        this.watermarkManager.updateConfig(config.watermark);
      } else if (config.watermark.enabled) {
        this.watermarkManager = new WatermarkManager(this.container, config.watermark);
        this.watermarkManager.initialize();
      }
    }

    if (config.antiPiracyText) {
      if (this.antiPiracyTextManager) {
        this.antiPiracyTextManager.updateConfig(config.antiPiracyText);
      } else if (config.antiPiracyText.enabled) {
        this.antiPiracyTextManager = new AntiPiracyTextManager(this.container, config.antiPiracyText);
        this.antiPiracyTextManager.initialize();
      }
    }

    if (video) {
      if ('muted' in config) video.muted = !!config.muted;
      if ('loop' in config) video.loop = !!config.loop;
      if (config.preload) video.preload = config.preload;
      if (config.playbackRate) {
        video.defaultPlaybackRate = config.playbackRate;
        this.setPlaybackRate(config.playbackRate);
      }
    }

    if ('security' in config) {
      this.authToken = this.config.security?.authToken;
      if (!this.hasPlaybackRefresher()) {
        this.tokenRefresher?.destroy();
        this.tokenRefresher = null;
      } else if (!this.tokenRefresher) {
        this.tokenRefresher = this.createTokenRefresher();
      }
    }

    // Engine-level settings: rebuild the HLS engine (resumes VOD position; live rejoins at the target)
    if (
      ('lowLatency' in config && !sameJson(config.lowLatency, prev.lowLatency)) ||
      ('p2p' in config && !sameJson(config.p2p, prev.p2p)) ||
      ('live' in config && !sameJson(config.live, prev.live)) ||
      ('hlsConfig' in config && !sameJson(config.hlsConfig, prev.hlsConfig))
    ) {
      if (this.hls) this.restartPlayback();
    }

    if ('errorRecovery' in config) {
      this.errorRecovery?.destroy();
      this.errorRecovery = new ErrorRecoveryManager(this.config.errorRecovery);
      this.errorRecovery.setLive(this.isLiveStream());
    }

    if ('quality' in config) {
      this.refreshQualityLevels();
      const preferred = this.config.quality?.defaultQuality;
      if (preferred !== undefined && preferred !== prev.quality?.defaultQuality) this.setQuality(preferred);
    }

    if ('subtitles' in config) this.applySubtitleTracks();

    if ('chapters' in config) {
      this.initialChapters = normalizeChapters(this.config.chapters ?? []);
      if (this.isInitialSource(this.config.source)) this.applyChaptersForSource(this.config.source);
    }

    if ('chaptersVtt' in config && config.chaptersVtt !== prev.chaptersVtt) {
      this.chaptersFromVtt = null;
      if (this.isInitialSource(this.config.source)) this.applyChaptersForSource(this.config.source);
      if (config.chaptersVtt) this.loadChaptersVtt(config.chaptersVtt);
    }

    if ('thumbnailVtt' in config && config.thumbnailVtt !== prev.thumbnailVtt && this.isInitialSource(this.config.source)) {
      this.loadThumbnailsForSource(this.config.source);
    }

    if ('miniPlayer' in config) {
      this.miniPlayer?.destroy();
      this.miniPlayer = null;
      if (this.config.miniPlayer?.enabled) {
        this.miniPlayer = new MiniPlayer(this.container, this.config.miniPlayer);
        this.miniPlayer.initialize(() => {});
      }
    }

    if ('playlist' in config || 'playlistOptions' in config) {
      this.teardownPlaylist();
      if (this.config.playlist?.length) {
        const start = this.initializePlaylist();
        if (start.src !== this.config.source.src) this.loadSource(start);
      }
    }

    if (
      modeChanged ||
      'controls' in config ||
      'gestures' in config ||
      'keyboardShortcuts' in config ||
      'pip' in config
    ) {
      this.rebuildControls();
    }

    if (config.source) {
      const next = config.source;
      if (next.src !== prev.source.src || (next.type ?? 'auto') !== (prev.source.type ?? 'auto')) {
        this.config.source = prev.source;
        this.loadSource(next);
      } else {
        if (video) {
          if (next.poster) video.poster = next.poster;
          else video.removeAttribute('poster');
        }
        this.controlsManager?.setTitle(next.title);
        if ('chapters' in next) this.applyChaptersForSource(next);
        if (next.thumbnails !== prev.source.thumbnails) this.loadThumbnailsForSource(next);
      }
    }
  }

  setChapters(chapters: Chapter[]): void {
    this.setCurrentChapters(normalizeChapters(chapters));
  }

  // ============================================================================
  // EVENTS (DOM dispatch)
  // ============================================================================

  private emitEvent<T>(type: string, data: T): void {
    const detail: PlayerEventDetail<T> = {
      type, state: this.getState(), data, timestamp: Date.now(),
    };
    this.container.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, cancelable: true }));
  }

  isReady(): boolean { return this.isInitialized; }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadToken++;

    this.analyticsManager?.endSession(this.getAnalyticsState());
    this.analyticsManager?.destroy();
    this.lmsProgressManager?.saveProgress();
    this.lmsProgressManager?.destroy();

    const plugin = this.config.plugins?.analytics;
    try {
      plugin?.destroy?.();
    } catch (error) {
      console.error(`[VideoPlayer] analytics plugin "${plugin?.name}" failed to destroy:`, error);
    }

    // Removes every video/container/document listener registered by the player
    this.listeners.abort();
    if (this.clickTimer) clearTimeout(this.clickTimer);
    this.stopHeartbeat();

    this.controlsManager?.destroy();
    this.watermarkManager?.destroy();
    this.antiPiracyTextManager?.destroy();
    this.errorRecovery?.destroy();
    this.thumbnailPreview?.destroy();
    this.miniPlayer?.destroy();
    this.teardownPlaylist();
    this.themeManager?.destroy();
    this.eventBus.destroy();
    this.hideErrorUI();

    this.teardownEngines();
    this.stopHealthyTimer();
    this.tokenRefresher?.destroy();
    this.tokenRefresher = null;
    this.liveLifecycle?.destroy();
    this.liveLifecycle = null;
    this.removeUnmutePill();
    this.liveStats.onStopped();
    this.statsOverlay?.destroy();
    this.statsOverlay = null;
    this.wakeLock?.release();
    if (this.mediaSessionActive) {
      clearMediaSession();
      this.mediaSessionActive = false;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
      this.videoElement.remove();
      this.videoElement = null;
    }

    this.container.classList.remove('video-player-container', 'vp-playing', 'vp-paused');
    this.isInitialized = false;

    if (this.config.debug) console.log('[VideoPlayer] Destroyed');
  }
}

function errorIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
}

// ============================================================================
// FACTORY
// ============================================================================

export function createVideoPlayer(container: HTMLElement | string, config: PlayerConfig): VideoPlayer {
  return new VideoPlayer(container, config);
}

export default VideoPlayer;
