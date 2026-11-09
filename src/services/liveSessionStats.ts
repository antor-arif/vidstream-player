// Watch-time statistics for live sessions. Percentages and milestones mean nothing for a live class
// (no fixed duration), so LMS and analytics get "how long did the viewer actually watch" instead.

import type { LiveWatchStats } from '../types';

export class LiveSessionStats {
  private watchedMs = 0;
  private playingSince = 0;
  private joinedAt: number | null = null;
  private lastSeenAt: number | null = null;
  private rebufferCount = 0;
  private rebufferMs = 0;
  private bufferingSince = 0;
  private latencySum = 0;
  private latencySamples = 0;
  private qualitySwitches = 0;
  private qualityKnown = false;
  private tokenRefreshes = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Frames are being rendered */
  onPlaying(): void {
    const t = this.now();
    if (this.joinedAt === null) this.joinedAt = t;
    this.closeBuffering(t);
    if (!this.playingSince) this.playingSince = t;
    this.lastSeenAt = t;
  }

  /**
   * Stalled waiting for data — a rebuffer once playback has started. `seeking`: the stall comes from
   * a seek (e.g. jumping to live), which is not a rebuffer.
   */
  onWaiting(seeking = false): void {
    const t = this.now();
    this.closePlaying(t);
    if (!seeking && this.joinedAt !== null && !this.bufferingSince) {
      this.rebufferCount++;
      this.bufferingSince = t;
    }
  }

  /** Paused, ended, source changed or player destroyed */
  onStopped(): void {
    const t = this.now();
    this.closePlaying(t);
    this.closeBuffering(t);
  }

  onLatency(latency: number): void {
    if (!Number.isFinite(latency) || latency < 0) return;
    this.latencySum += latency;
    this.latencySamples++;
  }

  /** A rendition started rendering. The first one is the initial selection, not a switch. */
  onQualitySwitch(): void {
    if (this.qualityKnown) this.qualitySwitches++;
    this.qualityKnown = true;
  }

  onTokenRefresh(): void {
    this.tokenRefreshes++;
  }

  snapshot(): LiveWatchStats {
    const t = this.now();
    const watched = this.watchedMs + (this.playingSince ? t - this.playingSince : 0);
    const rebuffer = this.rebufferMs + (this.bufferingSince ? t - this.bufferingSince : 0);
    if (this.playingSince) this.lastSeenAt = t;
    return {
      watchedSeconds: Math.round(watched / 100) / 10,
      joinedAt: this.joinedAt !== null ? new Date(this.joinedAt).toISOString() : null,
      lastSeenAt: this.lastSeenAt !== null ? new Date(this.lastSeenAt).toISOString() : null,
      rebufferCount: this.rebufferCount,
      rebufferSeconds: Math.round(rebuffer / 100) / 10,
      averageLatency: this.latencySamples ? Math.round((this.latencySum / this.latencySamples) * 100) / 100 : null,
      qualitySwitches: this.qualitySwitches,
      tokenRefreshes: this.tokenRefreshes,
    };
  }

  private closePlaying(t: number): void {
    if (this.playingSince) {
      this.watchedMs += t - this.playingSince;
      this.playingSince = 0;
      this.lastSeenAt = t;
    }
  }

  private closeBuffering(t: number): void {
    if (this.bufferingSince) {
      this.rebufferMs += t - this.bufferingSince;
      this.bufferingSince = 0;
    }
  }
}
