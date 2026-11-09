// Live stream lifecycle as the viewer experiences it, with an overlay for each non-playing state:
//
//   idle ──first frame──▶ playing ◀──playlist advances / playing──┐
//    │                      │                                      │
//    │ manifest 404 /       │ playlist stuck / network errors      │
//    │ empty playlist       ▼                                      │
//    └──▶ waiting      reconnecting ─────────────────────────────── ┘
//         (poll)            │ stuck ≥ endedTimeout AND 404s, ENDLIST, markStreamEnded()
//                           ▼
//                         ended (terminal for this source)
//
//   offline: browser `offline` event (any state but ended/error); `online` resumes loading at once.
//   error:   a fatal error is on screen (fail()); the overlay hides. retrying() (Retry / restart) leaves it.
//
// Kept free of hls.js: the player feeds it signals and implements LiveLifecycleHost.

import type { LiveConfig, LiveMessages, LiveState } from '../types';

export const DEFAULT_LIVE_MESSAGES: Required<LiveMessages> = {
  waiting: "Live class hasn't started yet",
  reconnecting: 'Reconnecting…',
  ended: 'Live class has ended',
  offline: 'No internet connection',
  tapToUnmute: 'Tap to unmute',
  goLive: 'Go live',
};

export interface LiveLifecycleHost {
  /** Rebuild the engine for the current source (poll a not-yet-started stream) */
  restart(): void;
  /** Network is back: resume loading right away */
  resumeLoading(): void;
  /** Stream ended: stop requesting playlists/segments */
  stopLoading(): void;
  onStateChange(state: LiveState, previous: LiveState): void;
  onEnded(): void;
}

export class LiveLifecycle {
  private state: LiveState = 'idle';
  private started = false;
  private lastEndSN = -1;
  private lastAdvanceAt = Date.now();
  private last404At = 0;
  private targetDuration = 3;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private overlay: HTMLElement | null = null;
  private overlayText: HTMLElement | null = null;
  private active = false;
  private stateBeforeOffline: LiveState = 'idle';

  constructor(
    private readonly container: HTMLElement,
    private readonly host: LiveLifecycleHost,
    private readonly getConfig: () => LiveConfig | undefined,
    signal: AbortSignal
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => this.handleOffline(), { signal });
      window.addEventListener('online', () => this.handleOnline(), { signal });
    }
  }

  getState(): LiveState {
    return this.state;
  }

  hasStarted(): boolean {
    return this.started;
  }

  isEnded(): boolean {
    return this.state === 'ended';
  }

  /** The stream is (or is expected to be) live: lifecycle tracking + overlays apply */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.startWatchdog();
    else {
      this.stopWatchdog();
      this.clearPoll();
      this.setState('idle');
    }
  }

  isActive(): boolean {
    return this.active;
  }

  /** A new source (not a restart) is loading */
  reset(): void {
    this.clearPoll();
    this.started = false;
    this.lastEndSN = -1;
    this.lastAdvanceAt = Date.now();
    this.last404At = 0;
    this.setState('idle');
  }

  /** Manifest 404 or a playlist without segments (or too few to start with) */
  streamUnavailable(): void {
    if (!this.active || this.state === 'ended' || this.state === 'error') return;
    this.last404At = Date.now();
    if (this.started) {
      this.setState('reconnecting');
      return;
    }
    if (this.state !== 'offline') this.setState('waiting');
    this.schedulePoll();
  }

  /** First frame / playback resumed */
  playing(): void {
    if (this.state === 'ended') return;
    this.started = true;
    this.lastAdvanceAt = Date.now();
    this.clearPoll();
    if (this.state !== 'offline') this.setState('playing');
  }

  /** Every playlist (re)load: `endSN` = last media sequence number, `live` = no ENDLIST */
  playlistUpdate(endSN: number | undefined, live: boolean, targetDuration?: number): void {
    if (!this.active) return;
    if (typeof targetDuration === 'number' && targetDuration > 0) this.targetDuration = targetDuration;
    if (typeof endSN === 'number' && endSN > this.lastEndSN) {
      this.lastEndSN = endSN;
      this.lastAdvanceAt = Date.now();
      if (this.state === 'reconnecting' && this.started) this.setState('playing');
    }
    if (!live && this.started) this.markEnded();
  }

  /** Any request answered with this HTTP status */
  httpStatus(code: number | undefined): void {
    if (code === 404) this.last404At = Date.now();
  }

  /** Network trouble after playback started; the player keeps retrying */
  networkFailure(): void {
    if (!this.active || !this.started || this.state === 'ended' || this.state === 'offline' || this.state === 'error') return;
    this.setState('reconnecting');
  }

  /** A fatal error is shown: hide the live overlay, stop polling, report `error` */
  fail(): void {
    if (!this.active || this.state === 'ended') return;
    this.clearPoll();
    this.setState('error');
  }

  /** Playback is being restarted after an error (Retry button, background reconnect) */
  retrying(): void {
    if (this.state !== 'error') return;
    this.lastAdvanceAt = Date.now();
    this.setState(this.started ? 'reconnecting' : 'idle');
  }

  markEnded(): void {
    if (this.state === 'ended') return;
    this.clearPoll();
    this.stopWatchdog();
    this.setState('ended');
    this.host.stopLoading();
    this.host.onEnded();
  }

  destroy(): void {
    this.clearPoll();
    this.stopWatchdog();
    this.overlay?.remove();
    this.overlay = null;
    this.container.classList.remove('vp-live-overlay-active');
  }

  /** Watchdog: playlist stuck → reconnecting; stuck ≥ endedTimeout with 404s → ended */
  tick(now = Date.now()): void {
    if (!this.active || !this.started) return;
    if (this.state !== 'playing' && this.state !== 'reconnecting') return;
    const stuck = now - this.lastAdvanceAt;
    const endedTimeout = this.getConfig()?.endedTimeout ?? 20000;
    if (stuck >= endedTimeout && this.last404At >= this.lastAdvanceAt) {
      this.markEnded();
      return;
    }
    // A live playlist normally advances every target duration; allow 3 before calling it stuck
    const stuckAfter = Math.max(8000, this.targetDuration * 3000);
    if (stuck >= stuckAfter && this.state === 'playing') this.setState('reconnecting');
  }

  private handleOffline(): void {
    if (!this.active || this.state === 'ended' || this.state === 'offline' || this.state === 'error') return;
    this.stateBeforeOffline = this.state;
    this.setState('offline');
  }

  private handleOnline(): void {
    if (this.state !== 'offline') return;
    this.setState(this.started ? 'reconnecting' : (this.stateBeforeOffline === 'waiting' ? 'waiting' : 'idle'));
    this.host.resumeLoading();
  }

  private schedulePoll(): void {
    if (this.pollTimer) return;
    const interval = Math.max(1000, this.getConfig()?.offlinePollInterval ?? 5000);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      if (this.state === 'waiting' && this.active) this.host.restart();
    }, interval);
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => this.tick(), 1000);
  }

  private stopWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private setState(next: LiveState): void {
    if (next === this.state) return;
    const previous = this.state;
    this.state = next;
    this.renderOverlay();
    this.host.onStateChange(next, previous);
  }

  private renderOverlay(): void {
    const config = this.getConfig();
    const showOverlay = config?.overlays !== false &&
      (this.state === 'waiting' || this.state === 'reconnecting' || this.state === 'ended' || this.state === 'offline');

    if (!showOverlay) {
      if (this.overlay) this.overlay.hidden = true;
      this.container.classList.remove('vp-live-overlay-active');
      return;
    }

    if (!this.overlay) {
      const overlay = document.createElement('div');
      overlay.className = 'vp-live-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      const spinner = document.createElement('div');
      spinner.className = 'vp-live-overlay-spinner';
      const text = document.createElement('p');
      text.className = 'vp-live-overlay-text';
      overlay.append(spinner, text);
      this.container.appendChild(overlay);
      this.overlay = overlay;
      this.overlayText = text;
    }
    const messages = { ...DEFAULT_LIVE_MESSAGES, ...(config?.messages ?? {}) };
    this.overlay.dataset.state = this.state;
    this.overlayText!.textContent = messages[this.state as keyof LiveMessages] ?? '';
    this.overlay.hidden = false;
    this.container.classList.add('vp-live-overlay-active');
  }
}
