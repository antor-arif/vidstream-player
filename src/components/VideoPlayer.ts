/**
 * Video Player Core
 *
 * Orchestrates playback, controls, theming, analytics, LMS progress,
 * event bus, auto-resume, error recovery, playlist, thumbnail preview,
 * mini player, and the analytics plugin slot.
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
  ChapterChangeEvent,
  PlaylistChangeEvent,
  Chapter,
} from '../types';
import { ControlsManager, ControlsCallbacks } from './PlayerControls';
import { WatermarkManager, AntiPiracyTextManager } from './WatermarkOverlay';
import { ThemeManager, defaultDarkTheme } from './PlayerTheme';
import { AnalyticsManager } from '../services/analyticsAdapter';
import { LMSProgressManager, saveProgressToStorage } from '../services/lmsProgressService';
import { EventBus } from '../services/eventBus';
import { ErrorRecoveryManager } from '../services/errorRecovery';
import { ThumbnailPreview, thumbnailPreviewStyles } from './ThumbnailPreview';
import { MiniPlayer, miniPlayerStyles } from './MiniPlayer';
import { PlaylistManager, playlistStyles } from './PlaylistManager';

// Lazy-loaded streaming engines — not bundled into the main entry
let HlsModule: typeof import('hls.js') | null = null;
let DashModule: typeof import('dashjs') | null = null;

async function loadHls(): Promise<typeof import('hls.js')> {
  if (!HlsModule) HlsModule = await import('hls.js');
  return HlsModule;
}

async function loadDash(): Promise<typeof import('dashjs')> {
  if (!DashModule) DashModule = await import('dashjs');
  return DashModule;
}

// ============================================================================
// HELPERS
// ============================================================================

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const defaultConfig: Partial<PlayerConfig> = {
  mode: 'vod',
  autoplay: false,
  muted: false,
  loop: false,
  preload: 'metadata',
  keyboardShortcuts: true,
  debug: false,
};

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

  // State
  private state: PlayerState = this.getInitialState();
  private isInitialized = false;
  private qualityLevels: QualityLevel[] = [];
  private _sessionId: string = uuidV4();
  private currentChapterIndex = -1;
  private seekFromTime = 0;

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

    const mergedTheme = { ...defaultDarkTheme, ...this.config.theme };
    this.themeManager = new ThemeManager(this.container, mergedTheme, this.config.mode ?? 'vod');
    this.themeManager.initialize();

    this.createVideoElement();
    this.initializeControls();

    if (this.config.watermark?.enabled) {
      this.watermarkManager = new WatermarkManager(this.container, this.config.watermark);
      this.watermarkManager.initialize();
    }

    if (this.config.antiPiracyText?.enabled) {
      this.antiPiracyTextManager = new AntiPiracyTextManager(this.container, this.config.antiPiracyText);
      this.antiPiracyTextManager.initialize();
    }

    if (this.config.analytics?.enabled) {
      this.analyticsManager = new AnalyticsManager(this.config.analytics);
      this.analyticsManager.initialize(this.config.source.src);
    }

    if (this.config.lmsProgress?.enabled) {
      this.initializeLMSProgress();
    }

    // Error recovery
    this.errorRecovery = new ErrorRecoveryManager(this.config.errorRecovery);

    // Playlist
    if (this.config.playlist?.length) {
      this.initializePlaylist();
    }

    // Mini player
    if (this.config.miniPlayer?.enabled) {
      this.miniPlayer = new MiniPlayer(this.container, this.config.miniPlayer);
      this.miniPlayer.initialize(() => {});
    }

    this.loadSource(this.config.source);

    // Thumbnail VTT
    const vttUrl = this.config.thumbnailVtt ?? this.config.source.thumbnails;
    if (vttUrl) this.loadThumbnailVtt(vttUrl);

    // Chapters VTT
    if (this.config.chaptersVtt) this.loadChaptersVtt(this.config.chaptersVtt);

    this.isInitialized = true;
    this.emitEvent('player-ready', {});

    // Analytics plugin — call init after player is ready
    const analyticsPlugin = this.config.plugins?.analytics;
    if (analyticsPlugin) {
      analyticsPlugin.init(this);
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

    this.bindVideoEvents();
    this.container.appendChild(this.videoElement);
  }

  private initializeControls(): void {
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
    };

    let controlsConfig = this.config.controls ?? {};

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

    this.controlsManager = new ControlsManager(
      this.container,
      controlsConfig,
      callbacks,
      this.config.gestures
    );
    this.controlsManager.initialize();

    if (this.config.mode === 'live') this.controlsManager.updateLiveState(true);
    if (this.config.chapters?.length) this.controlsManager.updateChapters(this.normalizeChapters(this.config.chapters));
    this.controlsManager.updateSubtitles(this.config.subtitles ?? []);
    if (this.config.source.title) this.controlsManager.setTitle(this.config.source.title);
  }

  /** Normalize chapters: support both `time` and `startTime` fields */
  private normalizeChapters(chapters: Chapter[]): Chapter[] {
    return chapters.map(c => ({
      ...c,
      startTime: c.startTime ?? c.time ?? 0,
    }));
  }

  private initializeLMSProgress(): void {
    if (!this.config.lmsProgress) return;

    const lmsConfig: LMSProgressConfig = {
      ...this.config.lmsProgress,
      onProgressSave: (progress) => {
        this.config.lmsProgress?.onProgressSave?.(progress);
        saveProgressToStorage(progress);
        this.emitEvent('player-progress-saved', progress);
      },
      onMilestoneReached: (milestone, progress) => {
        this.config.lmsProgress?.onMilestoneReached?.(milestone, progress);
        this.emitEvent('player-milestone', { milestone });
        this.analyticsManager?.trackEvent('milestone_reached', this.getAnalyticsState(), { milestone });
      },
      onComplete: (progress) => {
        this.config.lmsProgress?.onComplete?.(progress);
        this.analyticsManager?.trackEvent('ended', this.getAnalyticsState());
      },
    };

    this.lmsProgressManager = new LMSProgressManager(lmsConfig);
  }

  private initializePlaylist(): void {
    const items = this.config.playlist!;
    this.playlistManager = new PlaylistManager(items, this.config.playlistOptions);

    this.playlistManager.onChange((index, item) => {
      const source: VideoSource = {
        src: item.src,
        title: item.title,
        poster: item.poster,
      };
      if (item.chapters?.length) this.controlsManager?.updateChapters(this.normalizeChapters(item.chapters));
      if (item.thumbnailVtt) this.loadThumbnailVtt(item.thumbnailVtt);
      this.loadSource(source);

      const event: PlaylistChangeEvent = { index, item, sessionId: this._sessionId };
      this.emitEvent('player-playlist-change', event);
      this.eventBus.emit('playlistChange', event);
      this.state.playlistIndex = index;
    });

    if (this.config.playlistOptions?.showPanel) {
      const panel = this.playlistManager.buildPanel();
      const wrapper = document.createElement('div');
      wrapper.className = 'vp-layout-wrapper';

      // Transfer any inline width from the player to the wrapper so the wrapper
      // takes the intended outer size, and the player can be a flex item inside it.
      const inlineWidth = this.container.style.width;
      if (inlineWidth) {
        wrapper.style.width = inlineWidth;
        this.container.style.removeProperty('width');
      }

      this.container.parentElement?.insertBefore(wrapper, this.container);
      this.container.classList.add('vp-playlist-host');
      wrapper.appendChild(this.container);
      wrapper.appendChild(panel);
    }

    // Show prev/next buttons
    this.updatePlaylistControls();
  }

  private updatePlaylistControls(): void {
    if (!this.playlistManager) return;
    this.controlsManager?.updatePlaylistButtons(
      this.playlistManager.hasPrev(),
      this.playlistManager.hasNext()
    );
  }

  // ============================================================================
  // VIDEO EVENTS
  // ============================================================================

  private bindVideoEvents(): void {
    if (!this.videoElement) return;
    const video = this.videoElement;

    video.addEventListener('loadedmetadata', () => {
      this.state.duration = video.duration;
      this.state.isLive = !isFinite(video.duration);
      this.lmsProgressManager?.initialize(video.duration);
      this.controlsManager?.updateLiveState(this.state.isLive);
      this.updateState();
      this.emitEvent('player-loaded', {});
      this.analyticsManager?.trackEvent('source_loaded', this.getAnalyticsState());

      if (this.lmsProgressManager?.shouldResume()) {
        this.seek(this.lmsProgressManager.getResumePosition());
      } else if (this.config.startTime) {
        this.seek(this.config.startTime);
      }
    });

    video.addEventListener('canplay', () => {
      this.state.canPlay = true;
      this.analyticsManager?.trackEvent('can_play', this.getAnalyticsState());
      if (this.config.autoplay) this.play().catch(() => {});
    });

    video.addEventListener('play', () => {
      this.state.playing = true;
      this.state.paused = false;
      this.state.ended = false;
      this.container.classList.add('vp-playing');
      this.container.classList.remove('vp-paused');
      this.updateState();
      this.controlsManager?.showActionAnimation(true);
      this.emitEvent('player-play', {});
      this.eventBus.emit('play', { currentTime: video.currentTime, src: video.src, sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('play', this.getAnalyticsState());
      this.analyticsManager?.startHeartbeat(() => this.getAnalyticsState());
      this.lmsProgressManager?.handleFirstPlay();

    });

    video.addEventListener('pause', () => {
      this.state.playing = false;
      this.state.paused = true;
      this.container.classList.remove('vp-playing');
      this.container.classList.add('vp-paused');
      this.container.classList.remove('vp-idle');
      this.updateState();
      this.controlsManager?.showActionAnimation(false);
      this.emitEvent('player-pause', {});
      this.eventBus.emit('pause', { currentTime: video.currentTime, src: video.src, sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('pause', this.getAnalyticsState());
      this.analyticsManager?.stopHeartbeat();
    });

    video.addEventListener('ended', () => {
      this.state.ended = true;
      this.state.playing = false;
      this.updateState();
      this.emitEvent('player-ended', {});
      this.eventBus.emit('ended', { src: video.src, sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('ended', this.getAnalyticsState());
      this.lmsProgressManager?.handleCompletion();

      // Auto-advance playlist
      const opts = this.config.playlistOptions;
      if (this.playlistManager && (opts?.autoNext !== false)) {
        const next = this.playlistManager.next();
        if (next) {
          this.updatePlaylistControls();
          this.play().catch(() => {});
        }
      }
    });

    video.addEventListener('timeupdate', () => {
      this.state.currentTime = video.currentTime;
      this.updateState();
      this.emitEvent('player-timeupdate', { currentTime: video.currentTime, duration: video.duration });
      this.eventBus.emit('timeupdate', {
        currentTime: video.currentTime,
        duration: video.duration,
        percent: video.duration > 0 ? video.currentTime / video.duration : 0,
        src: video.src,
        sessionId: this._sessionId,
      });
      this.analyticsManager?.trackEvent('time_update', this.getAnalyticsState());
      this.lmsProgressManager?.updateProgress(video.currentTime, video.duration);
      this.checkChapterChange();
    });

    video.addEventListener('volumechange', () => {
      this.state.volume = video.volume;
      this.state.muted = video.muted;
      this.updateState();
      this.emitEvent('player-volumechange', { volume: video.volume, muted: video.muted });
      this.analyticsManager?.trackEvent('volume_changed', this.getAnalyticsState());
    });

    video.addEventListener('ratechange', () => {
      this.state.playbackRate = video.playbackRate;
      this.updateState();
      this.emitEvent('player-ratechange', { rate: video.playbackRate });
      this.analyticsManager?.trackEvent('playback_rate_changed', this.getAnalyticsState());
    });

    video.addEventListener('seeking', () => {
      this.seekFromTime = video.currentTime;
      this.analyticsManager?.trackEvent('seek_start', this.getAnalyticsState());
    });

    video.addEventListener('seeked', () => {
      this.eventBus.emit('seek', {
        fromTime: this.seekFromTime,
        toTime: video.currentTime,
        src: video.src,
        sessionId: this._sessionId,
      });
      this.analyticsManager?.trackEvent('seek_end', this.getAnalyticsState());
      this.errorRecovery?.resetRetries();
    });

    video.addEventListener('waiting', () => {
      this.state.buffering = true;
      this.updateState();
      this.emitEvent('player-buffering', { buffering: true });
      this.eventBus.emit('buffering', { currentTime: video.currentTime, duration: video.duration, sessionId: this._sessionId });
      this.analyticsManager?.trackEvent('buffering', this.getAnalyticsState());
    });

    video.addEventListener('playing', () => {
      this.state.buffering = false;
      this.updateState();
      this.emitEvent('player-buffering', { buffering: false });
    });

    video.addEventListener('progress', () => {
      if (video.buffered.length > 0) {
        this.state.buffered = video.buffered.end(video.buffered.length - 1);
        this.updateState();
      }
    });

    video.addEventListener('error', () => {
      const error: PlayerError = {
        code: 'MEDIA_ERROR',
        message: video.error?.message ?? 'Unknown error',
        originalError: video.error ? new Error(video.error.message) : undefined,
      };
      this.state.error = error;
      this.emitEvent('player-error', error);
      this.eventBus.emit('error', error);
      this.analyticsManager?.trackEvent('error', this.getAnalyticsState(), { error });
      this.showErrorUI(error.message, true);
    });

    document.addEventListener('fullscreenchange', () => {
      this.state.fullscreen = document.fullscreenElement === this.container;
      this.updateState();
      this.emitEvent('player-fullscreen', { fullscreen: this.state.fullscreen });
      this.analyticsManager?.trackEvent(
        this.state.fullscreen ? 'fullscreen_enter' : 'fullscreen_exit',
        this.getAnalyticsState()
      );
    });

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
    });

    video.addEventListener('leavepictureinpicture', () => {
      this.state.pip = false;
      this.isPipOperationInFlight = false;
      this.updateState();
      this.emitEvent('player-pip', { pip: false });
      this.analyticsManager?.trackEvent('pip_exit', this.getAnalyticsState());
      if (this.state.activeSubtitle) this.setSubtitle(this.state.activeSubtitle);
    });

    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('.vp-controls') ||
        target.closest('.vp-big-play') ||
        target.closest('.vp-poster-overlay') ||
        target.closest('.vp-volume-slider') ||
        target.closest('.vp-progress-bar') ||
        target.closest('.vp-dropdown-menu')
      ) return;
      this.togglePlay();
    });
  }

  // ============================================================================
  // CHAPTER TRACKING
  // ============================================================================

  private checkChapterChange(): void {
    const chapters = this.config.chapters;
    if (!chapters?.length) return;
    const t = this.state.currentTime;
    let idx = -1;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (t >= (chapters[i].startTime ?? chapters[i].time ?? 0)) {
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

  private async loadThumbnailVtt(url: string): Promise<void> {
    if (!this.videoElement) return;
    const preview = new ThumbnailPreview(this.container);
    await preview.load(url);
    if (preview.hasCues()) {
      this.thumbnailPreview = preview;
      this.controlsManager?.setThumbnailPreview(preview);
    }
  }

  private async loadChaptersVtt(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const chapters = parseChaptersVtt(text);
      if (chapters.length) {
        this.config.chapters = chapters;
        this.controlsManager?.updateChapters(chapters);
      }
    } catch {
      // graceful fallback
    }
  }

  // ============================================================================
  // ERROR UI
  // ============================================================================

  private showErrorUI(message: string, allowRetry: boolean): void {
    const existing = this.container.querySelector('.vp-error');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'vp-error';
    el.innerHTML = `
      <div class="vp-error-icon">${errorIcon()}</div>
      <p class="vp-error-message">${message}</p>
      ${allowRetry ? `<button class="vp-error-retry" type="button">Retry</button>` : ''}
    `;
    this.container.appendChild(el);

    if (allowRetry) {
      el.querySelector('.vp-error-retry')?.addEventListener('click', () => {
        el.remove();
        this.loadSource(this.config.source);
      });
    }
  }

  // ============================================================================
  // SOURCE LOADING
  // ============================================================================

  loadSource(source: VideoSource): void {
    if (!this.videoElement) return;

    try {
      if (this.hls) { this.hls.destroy(); this.hls = null; }
    } catch (e) { console.error('[VideoPlayer] Error destroying HLS:', e); }
    
    try {
      if (this.dash) { this.dash.destroy(); this.dash = null; }
    } catch (e) { console.error('[VideoPlayer] Error destroying Dash:', e); }

    this.container.querySelector('.vp-error')?.remove();
    this.errorRecovery?.resetRetries();

    const sourceType = (!source.type || source.type === 'auto')
      ? this.detectSourceType(source.src)
      : source.type;

    if (source.poster) this.videoElement.poster = source.poster;

    if (sourceType === 'hls') {
      this.loadHLSSource(source.src);
    } else if (sourceType === 'dash') {
      this.loadDashSource(source.src);
    } else {
      this.videoElement.src = source.src;
      this.videoElement.load();
    }

    this.config.source = source;
    this.analyticsManager?.initialize(source.src);
    if (source.title !== undefined) this.controlsManager?.setTitle(source.title);

    if (this.config.subtitles) {
      // Remove old tracks first
      Array.from(this.videoElement.querySelectorAll('track')).forEach(t => t.remove());
      this.config.subtitles.forEach(track => {
        const trackEl = document.createElement('track');
        trackEl.kind = track.kind ?? 'subtitles';
        trackEl.src = track.src;
        trackEl.srclang = track.language;
        trackEl.label = track.label;
        if (track.default) trackEl.default = true;
        this.videoElement!.appendChild(trackEl);
      });
    }
  }

  private async loadHLSSource(src: string): Promise<void> {
    if (!this.videoElement) return;

    const { default: Hls } = await loadHls();

    if (Hls.isSupported()) {
      this.hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      this.hls.loadSource(src);
      this.hls.attachMedia(this.videoElement);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (_: unknown, data: any) => {
        let levels = data.levels
          .filter((l: any) => l.height && l.height > 0)
          .map((l: any, i: number) => ({
            height: l.height,
            width: l.width || 0,
            bitrate: l.bitrate || 0,
            label: `${l.height}p`,
            active: i === this.hls?.currentLevel,
          }));

        const unique = new Map<number, typeof levels[0]>();
        levels.forEach((l: typeof levels[0]) => {
          const ex = unique.get(l.height);
          if (!ex || l.bitrate > ex.bitrate) unique.set(l.height, l);
        });
        levels = Array.from(unique.values());

        const qc = this.config.quality;
        if (qc?.allowedQualities?.length) {
          levels = levels.filter((l: typeof levels[0]) =>
            qc.allowedQualities!.some((a: number) => Math.abs(l.height - a) <= 100)
          );
        }

        this.qualityLevels = levels;
        this.state.qualities = levels;
        this.controlsManager?.updateQualities(levels, qc?.showAuto !== false);

        if (qc?.defaultQuality && qc.defaultQuality !== 'auto' && this.hls) {
          const idx = data.levels.findIndex((l: any) => l.height === qc.defaultQuality);
          if (idx >= 0) this.hls.currentLevel = idx;
        }
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (_: unknown, data: any) => {
        const hlsLevel = this.hls?.levels[data.level];
        const quality = hlsLevel
          ? this.qualityLevels.find((q: QualityLevel) => q.height === hlsLevel.height) ?? null
          : null;
        if (quality) {
          const prev = this.state.quality;
          this.state.quality = quality;
          this.emitEvent('player-quality-change', quality);
          this.eventBus.emit('qualityChange', {
            fromQuality: prev?.label ?? 'auto',
            toQuality: quality.label,
            auto: this.hls?.autoLevelEnabled ?? false,
            sessionId: this._sessionId,
          });
          this.analyticsManager?.trackEvent('quality_changed', this.getAnalyticsState());
          if (this.hls?.autoLevelEnabled) this.controlsManager?.updateAutoQualityDisplay(quality);
        }
      });

      this.hls.on(Hls.Events.ERROR, (_: unknown, data: any) => {
        if (data.fatal) {
          const code = data.type === 'networkError' ? 'NETWORK_ERROR' : 'DECODE_ERROR';
          const err = this.errorRecovery?.reportError(code, data.details, true);
          const playerError: PlayerError = { code: data.type, message: data.details };
          this.state.error = playerError;
          this.emitEvent('player-error', playerError);
          this.eventBus.emit('error', err);

          if (this.errorRecovery?.canRetry() && this.videoElement) {
            this.errorRecovery.scheduleRetry(() => {
              if (data.type === 'networkError') {
                this.hls?.startLoad();
              } else {
                this.loadHLSSource(src);
              }
            });
          } else {
            this.showErrorUI(data.details, true);
          }
        } else if (data.type === 'networkError' && this.errorRecovery?.canRetry()) {
          this.errorRecovery.scheduleRetry(() => this.hls?.startLoad());
        }
      });
    } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      this.videoElement.src = src;
    } else {
      console.error('[VideoPlayer] HLS not supported');
    }
  }

  private async loadDashSource(src: string): Promise<void> {
    if (!this.videoElement) return;

    const dashjs = await loadDash();

    this.dash = dashjs.MediaPlayer().create();
    this.dash.initialize(this.videoElement, src, false);
    this.dash.updateSettings({
      streaming: {
        abr: { autoSwitchBitrate: { video: true } },
        buffer: { fastSwitchEnabled: true },
      },
    });

    this.dash.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      try {
        const bitrateList = this.dash!.getBitrateInfoListFor('video');
        if (bitrateList?.length) {
          const qualityLevels: QualityLevel[] = (bitrateList as any[])
            .filter((b: any) => b.height && b.height > 0)
            .map((b: any, i: number) => ({
              id: i,
              height: b.height ?? 0,
              label: b.height ? `${b.height}p` : `${Math.round((b.bitrate ?? 0) / 1000)}kbps`,
              bitrate: b.bitrate ?? 0,
            }));
          this.qualityLevels = qualityLevels;
          this.state.qualities = qualityLevels;
          this.controlsManager?.updateQualities(qualityLevels);
        }
      } catch {}
    });

    this.dash.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, () => {
      try {
        const idx = this.dash!.getQualityFor('video');
        const bitrateList = this.dash!.getBitrateInfoListFor('video');
        const b = bitrateList?.[idx];
        if (b) {
          const quality = this.qualityLevels.find((q: QualityLevel) => q.height === b.height) ?? null;
          if (quality) {
            this.state.quality = quality;
            this.emitEvent('player-quality-change', quality);
          }
        }
      } catch {}
    });

    this.dash.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
      const fatal = e?.error?.code >= 27;
      const err = this.errorRecovery?.reportError('NETWORK_ERROR', String(e?.error?.message ?? 'DASH error'), fatal);
      if (fatal) {
        if (this.errorRecovery?.canRetry()) {
          this.errorRecovery.scheduleRetry(() => this.loadDashSource(src));
        } else {
          this.showErrorUI(String(e?.error?.message ?? 'Stream error'), true);
        }
      }
      this.eventBus.emit('error', err);
    });
  }

  private detectSourceType(url: string): VideoSourceType {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
    if (ext === 'm3u8') return 'hls';
    if (ext === 'mpd') return 'dash';
    if (ext === 'webm') return 'webm';
    return 'mp4';
  }

  // ============================================================================
  // PLAYBACK API
  // ============================================================================

  async play(): Promise<void> {
    if (!this.videoElement) return;
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

  seek(time: number): void {
    if (this.videoElement) {
      this.videoElement.currentTime = Math.max(0, Math.min(time, this.state.duration));
    }
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
    try {
      await this.container.requestFullscreen();
      if (screen.orientation && 'lock' in screen.orientation) {
        try { await (screen.orientation as any).lock('landscape'); } catch {}
      }
    } catch {}
  }

  async exitFullscreen(): Promise<void> {
    try {
      await document.exitFullscreen();
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
    this.isPipOperationInFlight = true;
    try {
      await this.videoElement.requestPictureInPicture();
    } catch {
      this.isPipOperationInFlight = false;
    }
  }

  async exitPip(): Promise<void> {
    if (this.isPipOperationInFlight) return;
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

  setQuality(quality: QualityLevel | 'auto' | number): void {
    if (this.hls) {
      if (quality === 'auto') {
        this.hls.currentLevel = -1;
      } else {
        const h = typeof quality === 'number' ? quality : (quality as QualityLevel).height;
        const idx = this.hls.levels?.findIndex((l: any) => l.height === h) ?? -1;
        if (idx >= 0) this.hls.currentLevel = idx;
      }
    } else if (this.dash) {
      if (quality === 'auto') {
        this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
      } else {
        this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
        const h = typeof quality === 'number' ? quality : (quality as QualityLevel).height;
        const bitrateList: any[] = this.dash.getBitrateInfoListFor('video') ?? [];
        const idx = bitrateList.findIndex((b: any) => b.height === h);
        if (idx >= 0) this.dash.setQualityFor('video', idx, true);
      }
    }
  }

  setSubtitle(track: SubtitleTrack | null): void {
    if (!this.videoElement) return;
    const tracks = this.videoElement.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = track && tracks[i].language === track.language ? 'showing' : 'hidden';
    }
    this.state.activeSubtitle = track ?? undefined;
    this.analyticsManager?.trackEvent('subtitle_changed', this.getAnalyticsState());
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
    this.playlistManager.goTo(index);
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

  // ============================================================================
  // CONFIG
  // ============================================================================

  updateConfig(config: Partial<PlayerConfig>): void {
    if (config.theme) {
      this.themeManager?.applyTheme(config.theme);
    }
    if (config.mode) this.themeManager?.applyModeStyles(config.mode);

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

    this.config = { ...this.config, ...config };
  }

  setChapters(chapters: Chapter[]): void {
    this.config.chapters = chapters;
    this.controlsManager?.updateChapters(this.normalizeChapters(chapters));
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
    this.analyticsManager?.endSession(this.getAnalyticsState());
    this.analyticsManager?.destroy();
    this.lmsProgressManager?.saveProgress();
    this.lmsProgressManager?.destroy();
    this.controlsManager?.destroy();
    this.watermarkManager?.destroy();
    this.antiPiracyTextManager?.destroy();
    this.themeManager?.destroy();
    this.errorRecovery?.destroy();
    this.thumbnailPreview?.destroy();
    this.miniPlayer?.destroy();
    this.playlistManager?.destroy();
    this.eventBus.destroy();

    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.dash) { this.dash.reset(); this.dash = null; }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
      this.videoElement.remove();
      this.videoElement = null;
    }

    this.container.classList.remove('video-player-container');
    this.isInitialized = false;

    if (this.config.debug) console.log('[VideoPlayer] Destroyed');
  }
}

// ============================================================================
// VTT CHAPTERS PARSER
// ============================================================================

function parseChaptersVtt(text: string): Chapter[] {
  const chapters: Chapter[] = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  let idCounter = 0;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timingLine = lines.find(l => l.includes('-->'));
    if (!timingLine) continue;

    const [startStr, endStr] = timingLine.split('-->');
    const startTime = parseVttTime(startStr.trim());
    const endTime = parseVttTime(endStr.trim().split(' ')[0]);

    const timingIdx = lines.indexOf(timingLine);
    const title = lines.slice(timingIdx + 1).join(' ').trim();
    if (!title) continue;

    idCounter++;
    chapters.push({ id: String(idCounter), title, startTime, endTime });
  }

  return chapters;
}

function parseVttTime(str: string): number {
  const parts = str.split(':').map(parseFloat);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
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
