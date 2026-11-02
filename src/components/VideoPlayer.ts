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
    this.authToken = this.config.security?.authToken;
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
      this.state.isLive = !isFinite(video.duration);
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
        this.play().catch(() => {});
      }
    }, opts);

    video.addEventListener('play', () => {
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
      this.analyticsManager?.startHeartbeat(() => this.getAnalyticsState());
      this.lmsProgressManager?.handleFirstPlay();
      this.startHeartbeat();
    }, opts);

    video.addEventListener('pause', () => {
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
      this.state.ended = true;
      this.state.playing = false;
      this.updateState();
      this.stopHeartbeat();
      this.emitEvent('player-ended', {});
      this.eventBus.emit('ended', { src: this.currentSrc(), sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('ended', this.getAnalyticsState());
      this.lmsProgressManager?.handleCompletion();

      if (this.isLiveStream()) {
        this.reportError('STREAM_ENDED', 'The live stream has ended', false);
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
    }, opts);

    video.addEventListener('volumechange', () => {
      const muteChanged = this.state.muted !== video.muted;
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
      this.state.buffering = true;
      this.updateState();
      this.emitEvent('player-buffering', { buffering: true });
      this.eventBus.emit('buffering', { currentTime: video.currentTime, duration: video.duration, sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('buffering', this.getAnalyticsState());
    }, opts);

    video.addEventListener('playing', () => {
      this.state.buffering = false;
      this.updateState();
      this.emitEvent('player-buffering', { buffering: false });
      // Playback is healthy again — refill the retry budget for the next failure
      this.errorRecovery?.resetRetries();
      this.mediaErrorRecoveries = 0;
      this.authRefreshAttempted = false;
      if (this.state.error && !this.state.error.fatal) this.state.error = undefined;
    }, opts);

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
    originalError?: unknown
  ): void {
    const recovery = this.errorRecovery;
    if (retry && recovery?.canRetry()) {
      this.reportError(code, message, false, originalError);
      recovery.scheduleRetry(retry);
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

  private showErrorUI(message: string, allowRetry: boolean): void {
    this.hideErrorUI();

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
        this.restartPlayback();
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
    this.errorRecovery?.resetRetries();
    this.errorRecovery?.stopLiveReconnect();
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
    if (!this.videoElement || this.destroyed) return;
    const resumeAt = this.state.currentTime;
    const wasPlaying = this.state.playing || this.autoplayPending;

    this.loadToken++;
    this.teardownEngines();
    this.hideErrorUI();
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

  private isLiveStream(): boolean {
    return this.config.mode === 'live' || this.state.isLive;
  }

  private async loadHLSSource(src: string, token: number): Promise<void> {
    const Hls = await loadHls();
    if (this.isStale(token)) return;
    const video = this.videoElement!;

    if (Hls?.isSupported?.()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        xhrSetup: (xhr: XMLHttpRequest) => {
          const header = this.getAuthHeader();
          if (header) xhr.setRequestHeader(header.name, header.value);
        },
      });
      this.hls = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_: unknown, data: any) => {
        if (this.hls !== hls) return;
        this.setRawQualities(
          (data.levels ?? []).map((l: any, i: number) => ({
            height: l.height ?? 0,
            width: l.width ?? 0,
            bitrate: l.bitrate ?? 0,
            ref: i,
          }))
        );
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
      video.src = src;
    } else {
      this.handlePlaybackFailure(
        'SRC_NOT_SUPPORTED',
        'HLS playback requires hls.js (npm install hls.js) or a browser with native HLS support',
        null
      );
    }
  }

  private handleHlsError(hls: any, data: any): void {
    // hls.js recovers non-fatal errors itself
    if (!data?.fatal) return;

    const status = data.response?.code;
    if (data.type === 'networkError' && (status === 401 || status === 403)) {
      this.handleAuthorizationFailure(new Error(`HTTP ${status}: ${data.details}`), () => {
        if (this.hls === hls && hls.levels?.length) hls.startLoad();
        else this.restartPlayback();
      });
      return;
    }

    const message = String(data.details ?? 'HLS playback error');
    if (data.type === 'networkError') {
      this.handlePlaybackFailure('NETWORK_ERROR', message, () => {
        if (this.hls !== hls) return;
        // startLoad() resumes fragment loading; a failed manifest needs a fresh instance
        if (hls.levels?.length) hls.startLoad();
        else this.restartPlayback();
      }, data.error);
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
      duration: this.state.duration,
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
    this.heartbeatTimer = setInterval(() => this.emitEvent('player-heartbeat', {}), interval);
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

    if ('security' in config) this.authToken = this.config.security?.authToken;

    if ('errorRecovery' in config) {
      this.errorRecovery?.destroy();
      this.errorRecovery = new ErrorRecoveryManager(this.config.errorRecovery);
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
