// Seamless playback across token expiry and network changes for IP-bound, path-signed HLS URLs.
// TypeScript port of Instructly-Media-Engine tools/player/hls-token-refresh.js (verified in Chromium:
// 0 stalls through token expiry and a 6 s offline period, with and without SwarmCloud).
//
// Signed URLs carry the token in the PATH (our edge `/t/{exp}/{nonce}/{sig}/…`, Bunny
// `/bcdn_token=…/…`) and every playlist/segment URL is relative, so all of them inherit it. When the
// token expires or the viewer's IP changes the server answers 403. This module:
//   - retries 403, status 0 / unknown (network switching) and timeouts with backoff instead of failing;
//   - on a 403 asks the app for a fresh URL (one de-duplicated request, max 4 per minute);
//   - swaps only the token prefix of every URL: future requests (xhrSetup), segment URLs hls.js has
//     already parsed (needed for P2P loaders that fetch segments themselves) and pending retries;
//   - never touches `config.source.src` (the React wrapper would reload the stream).

/** Our edge token `/t/{exp}/{nonce}/{sig}` or Bunny's directory token `/bcdn_token=…` */
export const DEFAULT_TOKEN_PREFIX = /^(\/t\/\d+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+|\/bcdn_token=[^/]*)(\/.*)$/;

export interface SplitUrl {
  origin: string;
  /** Token part of the path, e.g. `/t/1700000000/nonce/sig` */
  prefix: string;
  /** Everything after the token, including the query string */
  rest: string;
}

/**
 * Split a URL into origin, token prefix and the rest. `pattern` must match the whole pathname with
 * group 1 = token prefix and group 2 = the remaining path. Returns null when there is no token.
 */
export function splitTokenUrl(url: string, pattern: RegExp = DEFAULT_TOKEN_PREFIX): SplitUrl | null {
  try {
    const u = new URL(url);
    const m = pattern.exec(u.pathname);
    return m && m[1] && m[2] !== undefined ? { origin: u.origin, prefix: m[1], rest: m[2] + u.search } : null;
  } catch {
    return null;
  }
}

/** URL safe to log: the token prefix and query string are removed */
export function redactUrl(url: string, pattern: RegExp = DEFAULT_TOKEN_PREFIX): string {
  try {
    const u = new URL(url);
    const m = pattern.exec(u.pathname);
    return u.origin + (m ? '/…' + m[2] : u.pathname);
  } catch {
    return '[url]';
  }
}

/** SwarmCloud / P2P channel id: host + path without the token, so all viewers of one stream on one host share it */
export function tokenlessChannelId(url: string, pattern: RegExp = DEFAULT_TOKEN_PREFIX): string {
  try {
    const u = new URL(url);
    const m = pattern.exec(u.pathname);
    return u.host + (m ? m[2] : u.pathname);
  } catch {
    return url.split(/[?#]/)[0];
  }
}

export interface TokenRefreshOptions {
  /**
   * Resolve to a full fresh URL for the SAME stream on the SAME host, or to null when the credential
   * was refreshed out of band (e.g. a new auth header) and requests should simply be retried.
   */
  getFreshUrl: () => Promise<string | null>;
  /** Token prefix pattern (see DEFAULT_TOKEN_PREFIX) */
  pattern?: RegExp;
  /** Retries per request. Backoff 1+2+4+8+8+8 s ≈ 30 s rides out a network switch. Default 6 */
  maxRetries?: number;
  /** Guards against a loop when the backend keeps signing for the wrong IP. Default 4 */
  maxRefreshesPerMinute?: number;
  /** Called after every successful refresh */
  onRefreshed?: (info: { reason: string; host: string | null }) => void;
  onRefreshFailed?: (info: { reason: string; error: Error }) => void;
  /** Debug log. Messages never contain tokens */
  log?: (message: string) => void;
}

type HlsLike = any;

/**
 * Per-source token refresher. Create one per loaded source and `attach()` every hls.js instance
 * created for it (retries rebuild the instance; the refresher and its newest token survive).
 */
export class TokenRefresher {
  private readonly pattern: RegExp;
  private readonly maxRetries: number;
  private readonly maxPerMinute: number;
  private current: { origin: string; prefix: string } | null = null;
  private pending: Promise<string | null> | null = null;
  private lastRefreshAt = 0;
  private refreshTimes: number[] = [];
  private hls: HlsLike = null;
  private detachFns: Array<() => void> = [];
  private destroyed = false;

  constructor(private readonly opts: TokenRefreshOptions) {
    this.pattern = opts.pattern ?? DEFAULT_TOKEN_PREFIX;
    this.maxRetries = opts.maxRetries ?? 6;
    this.maxPerMinute = opts.maxRefreshesPerMinute ?? 4;
  }

  /** Seed the current token from the URL that is about to be loaded */
  setUrl(url: string): void {
    const p = splitTokenUrl(url, this.pattern);
    if (p && (!this.current || this.current.origin !== p.origin)) this.current = { origin: p.origin, prefix: p.prefix };
  }

  /** `url` with its token replaced by the newest one (same origin only) */
  rewrite = (url: string): string => {
    const cur = this.current;
    if (!cur) return url;
    const p = splitTokenUrl(url, this.pattern);
    return p && p.origin === cur.origin && p.prefix !== cur.prefix ? p.origin + cur.prefix + p.rest : url;
  };

  /** Host the current token is for — pass it to the backend so it signs for the same edge / zone */
  currentHost(): string | null {
    if (!this.current) return null;
    try {
      return new URL(this.current.origin).host;
    } catch {
      return null;
    }
  }

  isRefreshing(): boolean {
    return this.pending !== null;
  }

  /** Wait for an in-flight refresh (resolves either way) */
  settled(): Promise<void> {
    return this.pending ? this.pending.then(() => undefined, () => undefined) : Promise.resolve();
  }

  /** Ask for a fresh URL. De-duplicated while in flight and rate limited. */
  refresh(reason: string): Promise<string | null> {
    if (this.pending) return this.pending;
    const now = Date.now();
    this.refreshTimes = this.refreshTimes.filter(t => now - t < 60000);
    if (this.refreshTimes.length >= this.maxPerMinute) {
      const error = new Error('too many token refreshes');
      this.opts.onRefreshFailed?.({ reason, error });
      return Promise.reject(error);
    }
    this.refreshTimes.push(now);
    this.log(`token refresh (${reason})`);

    const pending = Promise.resolve()
      .then(() => this.opts.getFreshUrl())
      .then(url => {
        if (this.destroyed) return url;
        if (url) {
          const p = splitTokenUrl(url, this.pattern);
          if (!p) throw new Error('fresh URL has no recognised token');
          if (this.current && p.origin !== this.current.origin) throw new Error('fresh URL is for a different host');
          this.current = { origin: p.origin, prefix: p.prefix };
          this.rewriteParsed();
        }
        this.lastRefreshAt = Date.now();
        this.log('token refreshed');
        this.opts.onRefreshed?.({ reason, host: this.currentHost() });
        return url;
      })
      .catch((e: unknown) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (!this.destroyed) {
          this.log(`token refresh failed: ${error.message}`);
          this.opts.onRefreshFailed?.({ reason, error });
        }
        throw error;
      })
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }

  /** The newest URL for `url` (after a refresh), for full reloads */
  currentUrlFor(url: string): string {
    return this.rewrite(url);
  }

  /**
   * hls.js config fragment: xhrSetup + load policies. `userXhrSetup` (from config.hlsConfig or the
   * player's auth header) runs after the URL has been re-opened, so headers it sets are kept.
   */
  hlsConfig(Hls: HlsLike, userXhrSetup?: (xhr: XMLHttpRequest, url: string) => void | Promise<void>): Record<string, unknown> {
    const shouldRetry = (
      _retryConfig: unknown,
      retryCount: number,
      isTimeout: boolean,
      loaderResponse: { code?: number } | undefined,
      defaultDecision: boolean
    ): boolean => {
      const code = loaderResponse?.code;
      if (code === 403 || code === 401) {
        // No way to get a fresh URL: only 2 quick retries in case the rejection was transient
        if (this.maxPerMinute <= 0) return retryCount < 2;
        if (Date.now() - this.lastRefreshAt > 3000) this.refresh(String(code)).catch(() => {});
        return retryCount < this.maxRetries;
      }
      if (!code || isTimeout) return retryCount < this.maxRetries;
      return defaultDecision;
    };

    const policy = (name: string) => {
      const source = Hls?.DefaultConfig?.[name];
      if (!source?.default) return undefined;
      const base = cloneDeep(source);
      const d = base.default;
      d.errorRetry = { ...(d.errorRetry ?? { retryDelayMs: 1000, maxRetryDelayMs: 8000 }), maxNumRetry: this.maxRetries, shouldRetry };
      d.timeoutRetry = { ...(d.timeoutRetry ?? { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 }), shouldRetry };
      return base;
    };

    const config: Record<string, unknown> = {
      xhrSetup: (xhr: XMLHttpRequest, url: string) => {
        const go = () => {
          const u = this.rewrite(url);
          // Only re-open real XHRs; other loaders (P2P) ignore the URL — rewriteParsed() covers them
          if (u !== url && typeof XMLHttpRequest !== 'undefined' && xhr instanceof XMLHttpRequest) xhr.open('GET', u, true);
          return userXhrSetup?.(xhr, u);
        };
        return this.pending ? this.pending.then(go, go) : go();
      },
    };
    // keyLoadPolicy: AES-128 key URLs under the same token (vidstream-embed VOD: `/t/…/vod/<asset>/k/<n>`)
    // must refresh too, or a seek after the token expired fails on the key
    for (const name of ['manifestLoadPolicy', 'playlistLoadPolicy', 'fragLoadPolicy', 'keyLoadPolicy']) {
      const p = policy(name);
      if (p) config[name] = p;
    }
    return config;
  }

  /** Track the URL hls.js loads and fix retried fragment URLs once a refresh resolves */
  attach(hls: HlsLike, Hls: HlsLike): void {
    this.detach();
    this.hls = hls;
    const onManifestLoading = (_: unknown, data: { url?: string }) => {
      if (data?.url) this.setUrl(data.url);
    };
    // hls.js retries reuse the failed request's URL: point it at the fresh token once we have one
    const onError = (_: unknown, data: any) => {
      const pending = this.pending;
      if (data?.frag && pending) {
        pending.then(() => {
          data.frag.url = this.rewrite(data.frag.url);
          if (data.part) data.part.url = this.rewrite(data.part.url);
        }, () => {});
      }
    };
    hls.on(Hls.Events.MANIFEST_LOADING, onManifestLoading);
    hls.on(Hls.Events.ERROR, onError);
    this.detachFns.push(() => {
      try {
        hls.off(Hls.Events.MANIFEST_LOADING, onManifestLoading);
        hls.off(Hls.Events.ERROR, onError);
      } catch {
        // instance already destroyed
      }
    });
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.hls = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
  }

  /** Point every already-parsed fragment/part URL at the fresh token (P2P loaders fetch these themselves) */
  private rewriteParsed(): void {
    const hls = this.hls;
    if (!hls) return;
    const lists = [...(hls.levels ?? []), ...(hls.audioTracks ?? []), ...(hls.subtitleTracks ?? [])];
    for (const list of lists) {
      const d = list?.details;
      if (!d) continue;
      for (const f of d.fragments ?? []) if (f?.url) f.url = this.rewrite(f.url);
      for (const p of d.partList ?? []) if (p?.url) p.url = this.rewrite(p.url);
      if (d.fragmentHint?.url) d.fragmentHint.url = this.rewrite(d.fragmentHint.url);
    }
  }

  private log(message: string): void {
    this.opts.log?.(message);
  }
}

function cloneDeep<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // functions inside (none in hls.js defaults) — fall through
    }
  }
  return JSON.parse(JSON.stringify(value));
}
