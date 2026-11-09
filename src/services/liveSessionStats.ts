// Watch-time statistics for live sessions. Percentages and milestones mean nothing for a live class
// (no fixed duration), so LMS and analytics get "how long did the viewer actually watch" instead.

import type { LiveState, LiveWatchStats } from '../types';

export class LiveSessionStats {
  private watchedMs = 0;
  private playingSince = 0;
  private joinedAt: number | null = null;
  private lastSeenAt: number | null = null;
  private rebufferCount = 0;
  private rebufferMs = 0;
  private bufferingSince = 0;
  /** The video is stalled (waiting since the last frame) */
  private stalled = false;
  /** The current stall was counted in rebufferCount */
  private stallCounted = false;
  /** Rebuffer time accumulated by the current stall */
  private stallMs = 0;
  /** Live state allows rebuffer time (playing / reconnecting); true when no lifecycle feeds us */
  private counting = true;
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
    this.stalled = false;
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
    if (seeking || this.joinedAt === null || this.stalled) return;
    this.stalled = true;
    this.stallCounted = false;
    this.stallMs = 0;
    if (this.counting) this.openStall(t);
  }

  /**
   * Live lifecycle state changed. Rebuffer time only accrues in `playing` / `reconnecting`; a stall
   * still open when the stream ends is the class ending, not a quality problem, so it is dropped
   * entirely (time and count).
   */
  onLiveState(state: LiveState): void {
    const t = this.now();
    this.counting = state === 'playing' || state === 'reconnecting';
    if (this.counting) {
      if (this.stalled && !this.bufferingSince) this.openStall(t);
      return;
    }
    this.closeBuffering(t);
    if (state === 'ended' && this.stalled) {
      if (this.stallCounted) this.rebufferCount--;
      this.rebufferMs -= this.stallMs;
      this.stalled = false;
      this.stallCounted = false;
      this.stallMs = 0;
    }
  }

  /** Paused, ended, source changed or player destroyed */
  onStopped(): void {
    const t = this.now();
    this.closePlaying(t);
    this.closeBuffering(t);
    this.stalled = false;
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

  private openStall(t: number): void {
    if (!this.stallCounted) {
      this.rebufferCount++;
      this.stallCounted = true;
    }
    this.bufferingSince = t;
  }

  private closeBuffering(t: number): void {
    if (this.bufferingSince) {
      const ms = t - this.bufferingSince;
      this.rebufferMs += ms;
      this.stallMs += ms;
      this.bufferingSince = 0;
    }
  }
}
