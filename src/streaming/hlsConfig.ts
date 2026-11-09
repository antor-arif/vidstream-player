// Pure builders for the hls.js and p2p-media-loader configuration.
// Kept free of DOM/engine state so every rule here is unit-testable.

import type { LiveLatencyMode, LowLatencyConfig, P2PConfig, P2PStrategy } from '../types';

export interface ResolvedLowLatency {
  targetLatency: number;
  maxLatency: number;
  maxCatchUpRate: number;
  partLoading: boolean;
}

export const LOW_LATENCY_DEFAULTS = {
  targetLatency: 4,
  /** Default sync point under p2p.strategy 'offload' (actual latency ≈ +2 s) */
  offloadTargetLatency: 3,
  /** maxLatency = targetLatency + this */
  maxLatencyHeadroom: 3,
  maxCatchUpRate: 1.1,
} as const;

/** Normalise `config.lowLatency` (boolean or object). Returns null when disabled. */
export function resolveLowLatency(
  lowLatency: boolean | LowLatencyConfig | undefined,
  strategy: P2PStrategy | undefined
): ResolvedLowLatency | null {
  if (!lowLatency) return null;
  const cfg: LowLatencyConfig = lowLatency === true ? {} : lowLatency;
  if (cfg.enabled === false) return null;

  // Measured: under the offload strategy playback settles ~1 segment (≈2 s) above the sync point,
  // because viewers wait briefly for peers. A 3 s sync point lands at ~5 s — inside the 3–5 s goal.
  const defaultTarget = strategy === 'offload' ? LOW_LATENCY_DEFAULTS.offloadTargetLatency : LOW_LATENCY_DEFAULTS.targetLatency;
  const targetLatency = positive(cfg.targetLatency) ?? defaultTarget;
  // hls.js requires liveMaxLatencyDuration > liveSyncDuration
  const maxLatency = Math.max(
    positive(cfg.maxLatency) ?? targetLatency + LOW_LATENCY_DEFAULTS.maxLatencyHeadroom,
    targetLatency + 0.5
  );
  const maxCatchUpRate = Math.min(2, Math.max(1, cfg.maxCatchUpRate ?? LOW_LATENCY_DEFAULTS.maxCatchUpRate));
  // Parts are tiny and served from the edge over HTTP; the offload strategy skips them so whole
  // segments (which peers can share) are requested instead
  const partLoading = cfg.partLoading ?? strategy !== 'offload';

  return { targetLatency, maxLatency, maxCatchUpRate, partLoading };
}

export interface HlsConfigOptions {
  lowLatency: ResolvedLowLatency | null;
  /** `live.latencyMode` — takes priority over `lowLatency` when set */
  latencyMode?: LiveLatencyMode;
  /** P2P is active for this load */
  p2p: boolean;
  strategy: P2PStrategy;
  xhrSetup: (xhr: XMLHttpRequest, url: string) => void | Promise<void>;
  /** `config.hlsConfig`, merged over everything the player sets */
  userConfig?: Record<string, unknown>;
}

/** Live HLS keeps at most this many seconds behind the playhead (hls.js default: Infinity) */
export const LIVE_BACK_BUFFER_SECONDS = 30;

/** hls.js config for one source load (before token-refresh settings, which the player applies last) */
export function buildHlsConfig(opts: HlsConfigOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {
    enableWorker: true,
    xhrSetup: opts.xhrSetup,
  };

  const ll = opts.lowLatency;
  if (opts.latencyMode === 'low') {
    // LL-HLS: never set liveSync* — it overrides PART-HOLD-BACK targeting (measured 9.5 s instead of 1.5 s)
    Object.assign(config, {
      lowLatencyMode: true,
      maxLiveSyncPlaybackRate: 1.1,
      backBufferLength: LIVE_BACK_BUFFER_SECONDS,
    });
  } else if (opts.latencyMode === 'standard') {
    Object.assign(config, {
      lowLatencyMode: false,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      backBufferLength: LIVE_BACK_BUFFER_SECONDS,
    });
  } else if (ll) {
    Object.assign(config, {
      lowLatencyMode: ll.partLoading,
      liveSyncDuration: ll.targetLatency,
      liveMaxLatencyDuration: ll.maxLatency,
      maxLiveSyncPlaybackRate: ll.maxCatchUpRate,
      // Recover from a stall by easing the target back gradually instead of a full segment
      liveSyncOnStallIncrease: 0.5,
      // Live viewers rarely seek back far; keep memory bounded on long sessions
      backBufferLength: LIVE_BACK_BUFFER_SECONDS,
    });
  } else {
    config.lowLatencyMode = true;
    // p2p-media-loader moves playback far behind live (up to ~120 s) unless the live sync point is
    // set explicitly. Under the latency strategy keep hls.js's standard 3-segment hold-back.
    if (opts.p2p && opts.strategy === 'latency') {
      config.liveSyncDurationCount = 3;
    }
  }

  const user = opts.userConfig;
  if (user) {
    for (const [key, value] of Object.entries(user)) {
      if (value === undefined) continue;
      // The player's xhrSetup (auth header, token swap) wraps the user's — see VideoPlayer.createHls
      if (key === 'xhrSetup') continue;
      config[key] = value;
    }
  }

  return config;
}

export interface P2PCoreOptions {
  p2p: P2PConfig;
  lowLatency: ResolvedLowLatency | null;
  /** Fallback swarm id (the unsigned source URL) */
  sourceUrl: string;
  /** Adds the auth header (security.authToken) to the P2P engine's own HTTP segment requests */
  httpRequestSetup?: P2PHttpRequestSetup;
}

/** p2p-media-loader core `httpRequestSetup` signature */
export type P2PHttpRequestSetup = (
  segmentUrl: string,
  segmentByteRange: unknown,
  requestAbortSignal?: AbortSignal,
  requestByteRange?: { start: number; end?: number }
) => Promise<Request | undefined | null>;

/** p2p-media-loader core config for one source load */
export function buildP2PCoreConfig(opts: P2PCoreOptions): Record<string, unknown> {
  const { p2p, lowLatency } = opts;
  const strategy = p2p.strategy ?? 'latency';

  const core: Record<string, unknown> = {
    swarmId: p2p.swarmId ?? stableSwarmId(opts.sourceUrl),
  };
  if (p2p.trackers?.length) core.announceTrackers = p2p.trackers;
  if (p2p.iceServers?.length) core.rtcConfig = { iceServers: p2p.iceServers };
  if (p2p.uploadDisabled) core.isP2PUploadDisabled = true;
  if (p2p.maxPeers !== undefined) core.p2pMaxPeers = p2p.maxPeers;
  if (opts.httpRequestSetup) core.httpRequestSetup = opts.httpRequestSetup;

  if (strategy === 'latency') {
    // Anything playable within the target window is fetched over HTTP if peers can't deliver at once
    const urgentWindow = lowLatency ? Math.max(2, lowLatency.targetLatency) : 6;
    Object.assign(core, {
      highDemandTimeWindow: urgentWindow,
      httpDownloadInitialTimeoutMs: 0,
      p2pNotReceivingBytesTimeoutMs: 1000,
      p2pErrorRetries: 1,
      httpErrorRetries: 3,
      simultaneousHttpDownloads: 2,
    });
  } else {
    Object.assign(core, {
      highDemandTimeWindow: 2,
      httpDownloadInitialTimeoutMs: 1500,
      p2pNotReceivingBytesTimeoutMs: 2000,
      p2pErrorRetries: 2,
      httpErrorRetries: 3,
      simultaneousP2PDownloads: 3,
    });
  }

  return { ...core, ...(p2p.core ?? {}) };
}

/** Swarm id from a URL without query/hash, so per-viewer tokens don't split the swarm */
export function stableSwarmId(url: string): string {
  return url.split(/[?#]/)[0];
}

/** WebRTC data channels are required for P2P */
export function isP2PSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).RTCPeerConnection === 'function';
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
