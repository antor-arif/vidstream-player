import type { ErrorRecoveryConfig, VidstreamError, VidstreamErrorCode } from '../types';

export class ErrorRecoveryManager {
  private config: Required<ErrorRecoveryConfig>;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private liveReconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ErrorRecoveryConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 2000,
      onError: config.onError ?? (() => {}),
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  canRetry(): boolean {
    return this.config.enabled && this.retryCount < this.config.maxRetries;
  }

  /** Schedule `retryFn` after an exponential backoff (retryDelay × 2^attempt). Replaces any pending retry. */
  scheduleRetry(retryFn: () => void): void {
    if (!this.canRetry()) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = this.config.retryDelay * Math.pow(2, this.retryCount);
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      retryFn();
    }, delay);
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
