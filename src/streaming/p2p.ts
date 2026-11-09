// Lazy loading of p2p-media-loader-hlsjs and per-source P2P traffic statistics.

import type { P2PStats } from '../types';

let p2pPromise: Promise<any | null> | null = null;

/**
 * Resolve the HlsJsP2PEngine class: ESM import of the optional peer dependency, falling back to the
 * IIFE global (`window.p2pml.hlsjs`) for <script>-tag/UMD users. Resolves null when unavailable.
 */
export function loadP2PEngine(): Promise<any | null> {
  if (!p2pPromise) {
    p2pPromise = import('p2p-media-loader-hlsjs')
      .then(mod => (mod as any).HlsJsP2PEngine ?? null)
      .catch(() => (globalThis as any).p2pml?.hlsjs?.HlsJsP2PEngine ?? null);
  }
  return p2pPromise;
}

let swarmPromise: Promise<any | null> | null = null;

/**
 * Resolve SwarmCloud's P2pEngineHls: ESM import of the optional peer `@swarmcloud/hls`, falling back
 * to the CDN global (`window.P2pEngineHls`). Resolves null when unavailable.
 */
export function loadSwarmCloudEngine(): Promise<any | null> {
  if (!swarmPromise) {
    swarmPromise = import('@swarmcloud/hls')
      .then(mod => (mod as any).default ?? (mod as any).P2pEngineHls ?? null)
      .catch(() => (globalThis as any).P2pEngineHls ?? null);
  }
  return swarmPromise;
}

/** Test hook: forget the cached module resolution */
export function resetP2PEngineCache(): void {
  p2pPromise = null;
  swarmPromise = null;
}

/** Accumulates p2p-media-loader core events into a P2PStats snapshot */
export class P2PStatsTracker {
  private httpBytes = 0;
  private p2pBytes = 0;
  private uploadedBytes = 0;
  private peers = new Set<string>();
  private engine: any = null;
  private safeMode = false;
  /** Bytes of every fragment hls.js loaded, whichever path it came by */
  private fragmentBytes = 0;
  /** Peer count reported by engines that don't emit connect/close events (SwarmCloud) */
  private reportedPeers: number | null = null;

  constructor(private readonly sessionId: string) {}

  private onChunkDownloaded = (bytes: number, source: 'http' | 'p2p') => {
    if (source === 'p2p') this.p2pBytes += bytes;
    else this.httpBytes += bytes;
  };

  private onChunkUploaded = (bytes: number) => {
    this.uploadedBytes += bytes;
  };

  private onPeerConnect = (peer: { peerId: string }) => {
    this.peers.add(peer.peerId);
  };

  private onPeerClose = (peer: { peerId: string }) => {
    this.peers.delete(peer.peerId);
  };

  /** Subscribe to an HlsJsP2PEngine's events */
  attach(engine: any): void {
    this.detach();
    this.engine = engine;
    engine.addEventListener('onChunkDownloaded', this.onChunkDownloaded);
    engine.addEventListener('onChunkUploaded', this.onChunkUploaded);
    engine.addEventListener('onPeerConnect', this.onPeerConnect);
    engine.addEventListener('onPeerClose', this.onPeerClose);
  }

  detach(): void {
    const engine = this.engine;
    this.engine = null;
    if (!engine) return;
    try {
      engine.removeEventListener('onChunkDownloaded', this.onChunkDownloaded);
      engine.removeEventListener('onChunkUploaded', this.onChunkUploaded);
      engine.removeEventListener('onPeerConnect', this.onPeerConnect);
      engine.removeEventListener('onPeerClose', this.onPeerClose);
    } catch {
      // engine already destroyed
    }
  }

  /**
   * Record a loaded fragment. hls.js loads some fragments (LL-HLS parts, segments the P2P core
   * does not manage) with its default HTTP loader, which the P2P engine never reports — so HTTP
   * traffic is derived from total fragment bytes minus bytes received from peers.
   */
  addFragmentBytes(bytes: number): void {
    if (bytes > 0) this.fragmentBytes += bytes;
  }

  /** Engines that report running totals (SwarmCloud getStats) */
  setTotals(totals: { httpBytes: number; p2pBytes: number; uploadedBytes: number }): void {
    this.httpBytes = Math.max(0, totals.httpBytes);
    this.p2pBytes = Math.max(0, totals.p2pBytes);
    this.uploadedBytes = Math.max(0, totals.uploadedBytes);
  }

  setPeerCount(count: number): void {
    this.reportedPeers = Math.max(0, count);
  }

  /** Stall guard engaged: P2P switched to fast HTTP fallback */
  setSafeMode(): void {
    this.safeMode = true;
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  snapshot(): P2PStats {
    const httpBytes = Math.max(this.httpBytes, this.fragmentBytes - this.p2pBytes);
    const total = httpBytes + this.p2pBytes;
    return {
      httpBytes,
      p2pBytes: this.p2pBytes,
      uploadedBytes: this.uploadedBytes,
      peers: this.reportedPeers ?? this.peers.size,
      p2pRatio: total > 0 ? this.p2pBytes / total : 0,
      safeMode: this.safeMode,
      sessionId: this.sessionId,
    };
  }
}
