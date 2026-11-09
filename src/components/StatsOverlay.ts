// "Stats for nerds" panel for support: latency, buffer, bitrate/resolution, dropped frames, P2P ratio.
// Enabled with `controls.stats`; toggled with player.toggleStats() or the `i` key. Updates once a second
// while visible and costs nothing while hidden.

export interface StatsSnapshot {
  latency: number | null;
  targetLatency: number | null;
  buffer: number;
  resolution: string | null;
  bitrateKbps: number | null;
  droppedFrames: number | null;
  totalFrames: number | null;
  p2pRatio: number | null;
  peers: number | null;
  liveState: string | null;
}

export class StatsOverlay {
  private el: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly container: HTMLElement, private readonly read: () => StatsSnapshot) {}

  isVisible(): boolean {
    return !!this.el && !this.el.hidden;
  }

  show(): void {
    if (!this.el) this.build();
    this.el!.hidden = false;
    this.render();
    if (!this.timer) this.timer = setInterval(() => this.render(), 1000);
  }

  hide(): void {
    if (this.el) this.el.hidden = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  toggle(): void {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  destroy(): void {
    this.hide();
    this.el?.remove();
    this.el = null;
  }

  private build(): void {
    const el = document.createElement('div');
    el.className = 'vp-stats';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Playback statistics');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vp-stats-close';
    close.setAttribute('aria-label', 'Close statistics');
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    const body = document.createElement('dl');
    body.className = 'vp-stats-body';
    el.append(close, body);
    // Clicks on the panel must not toggle playback
    el.addEventListener('click', (e) => e.stopPropagation());
    this.container.appendChild(el);
    this.el = el;
    this.body = body;
  }

  private render(): void {
    if (!this.body) return;
    const s = this.read();
    const rows: Array<[string, string]> = [];
    if (s.liveState) rows.push(['Live state', s.liveState]);
    if (s.latency !== null) {
      rows.push(['Latency', `${s.latency.toFixed(1)} s` + (s.targetLatency !== null ? ` (target ${s.targetLatency.toFixed(1)} s)` : '')]);
    }
    rows.push(['Buffer', `${s.buffer.toFixed(1)} s`]);
    rows.push(['Resolution', s.resolution ?? '–']);
    rows.push(['Bitrate', s.bitrateKbps !== null ? `${Math.round(s.bitrateKbps)} kbps` : '–']);
    rows.push(['Dropped frames', s.droppedFrames !== null ? `${s.droppedFrames} / ${s.totalFrames ?? '?'}` : '–']);
    if (s.p2pRatio !== null) rows.push(['P2P', `${Math.round(s.p2pRatio * 100)} % · ${s.peers ?? 0} peers`]);

    const frag = document.createDocumentFragment();
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      frag.append(dt, dd);
    }
    this.body.replaceChildren(frag);
  }
}
