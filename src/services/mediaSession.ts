// OS media controls (lock screen, notification, hardware keys) and the Screen Wake Lock.
// Both are feature-detected: unsupported browsers simply skip them.

export interface MediaSessionInfo {
  title?: string;
  artist?: string;
  artwork?: string;
  live: boolean;
}

export interface MediaSessionActions {
  play: () => void;
  pause: () => void;
  seekBy: (seconds: number) => void;
  seekTo: (time: number) => void;
}

const SEEK_ACTIONS = ['seekbackward', 'seekforward', 'seekto'] as const;

function session(): any {
  return typeof navigator !== 'undefined' ? (navigator as any).mediaSession : undefined;
}

/** Point the OS media controls at this player. Live: play/pause only (no seeking). */
export function applyMediaSession(info: MediaSessionInfo, actions: MediaSessionActions): void {
  const ms = session();
  if (!ms) return;
  try {
    const Metadata = (globalThis as any).MediaMetadata;
    if (typeof Metadata === 'function') {
      ms.metadata = new Metadata({
        title: info.title ?? '',
        artist: info.artist ?? (info.live ? 'LIVE' : ''),
        artwork: info.artwork ? [{ src: info.artwork }] : [],
      });
    }
  } catch {
    // MediaMetadata rejected the artwork URL — keep going without metadata
  }

  const set = (action: string, handler: ((details: any) => void) | null) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // action not supported by this browser
    }
  };
  set('play', () => actions.play());
  set('pause', () => actions.pause());
  if (info.live) {
    for (const action of SEEK_ACTIONS) set(action, null);
  } else {
    set('seekbackward', (d) => actions.seekBy(-(d?.seekOffset ?? 10)));
    set('seekforward', (d) => actions.seekBy(d?.seekOffset ?? 10));
    set('seekto', (d) => { if (typeof d?.seekTime === 'number') actions.seekTo(d.seekTime); });
  }
}

/** Remove our handlers (another player on the page may take over) */
export function clearMediaSession(): void {
  const ms = session();
  if (!ms) return;
  for (const action of ['play', 'pause', ...SEEK_ACTIONS]) {
    try {
      ms.setActionHandler(action, null);
    } catch {
      // ignore
    }
  }
  try {
    ms.metadata = null;
  } catch {
    // ignore
  }
}

export function setMediaSessionState(state: 'playing' | 'paused' | 'none'): void {
  const ms = session();
  if (!ms) return;
  try {
    ms.playbackState = state;
  } catch {
    // ignore
  }
}

/** Screen Wake Lock: keeps the screen on during live playback. Re-acquired when the tab is visible again. */
export class WakeLockController {
  private sentinel: any = null;
  private wanted = false;

  constructor(signal: AbortSignal) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (this.wanted && document.visibilityState === 'visible' && !this.sentinel) void this.acquire();
      }, { signal });
    }
  }

  async request(): Promise<void> {
    this.wanted = true;
    if (!this.sentinel) await this.acquire();
  }

  release(): void {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    try {
      s?.release?.();
    } catch {
      // already released
    }
  }

  isHeld(): boolean {
    return !!this.sentinel;
  }

  private async acquire(): Promise<void> {
    const wakeLock = typeof navigator !== 'undefined' ? (navigator as any).wakeLock : undefined;
    if (!wakeLock?.request) return;
    try {
      const sentinel = await wakeLock.request('screen');
      if (!this.wanted) {
        sentinel.release?.();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // denied (tab hidden, battery saver, permissions policy)
    }
  }
}
