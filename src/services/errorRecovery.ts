import type { ErrorRecoveryConfig, VidstreamError, VidstreamErrorCode } from '../types';

export class ErrorRecoveryManager {
  private config: Required<ErrorRecoveryConfig>;
  private retryCount = 0;
  private live = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private liveReconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ErrorRecoveryConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 2000,
      maxRetryDelay: config.maxRetryDelay ?? 30000,
      liveMaxRetries: config.liveMaxRetries ?? 10,
      onError: config.onError ?? (() => {}),
    };
  }

  /** Live streams get a larger budget (`liveMaxRetries`) */
  setLive(live: boolean): void {
    this.live = live;
  }

  private isOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  canRetry(): boolean {
    if (!this.config.enabled) return false;
    // A live viewer who is offline keeps retrying until the network comes back
    if (this.live && this.isOffline()) return true;
    return this.retryCount < (this.live ? this.config.liveMaxRetries : this.config.maxRetries);
  }

  /**
   * Schedule `retryFn` after an exponential backoff (retryDelay × 2^attempt, capped at maxRetryDelay).
   * Replaces any pending retry. Attempts made while offline (live) don't use up the budget.
   */
  scheduleRetry(retryFn: () => void): void {
    if (!this.canRetry()) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = Math.min(this.config.maxRetryDelay, this.config.retryDelay * Math.pow(2, this.retryCount));
    if (!(this.live && this.isOffline())) this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      retryFn();
    }, delay);
  }

  /** Attempts used so far */
  getRetryCount(): number {
    return this.retryCount;
  }

  /** Refill the retry budget without cancelling a pending retry (sustained healthy playback) */
  resetCount(): void {
    this.retryCount = 0;
  }

  /** Refill the retry budget and cancel any pending retry (call after playback recovers or the source changes). */
  resetRetries(): void {
    this.retryCount = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  reportError(code: VidstreamErrorCode, message: string, fatal: boolean): VidstreamError {
    const err: VidstreamError = { code, message, fatal, timestamp: Date.now() };
    try {
      this.config.onError(err);
    } catch (error) {
      console.error('[VideoPlayer] errorRecovery.onError threw:', error);
    }
    return err;
  }

  /** Poll for live stream recovery. Calls checkFn; if it returns true, calls onRecovered. */
  startLiveReconnect(checkFn: () => boolean, onRecovered: () => void): void {
    if (this.liveReconnectTimer) return;
    this.liveReconnectTimer = setInterval(() => {
      if (checkFn()) {
        this.stopLiveReconnect();
        onRecovered();
      }
    }, this.config.retryDelay * 2);
  }

  stopLiveReconnect(): void {
    if (this.liveReconnectTimer) {
      clearInterval(this.liveReconnectTimer);
      this.liveReconnectTimer = null;
    }
  }

  destroy(): void {
    this.resetRetries();
    this.stopLiveReconnect();
  }
}
