#!/usr/bin/env node
// Local LIVE HLS test server for low-latency and P2P checks.
//
// Generates (once, with ffmpeg) ~10 minutes of 0.5 s fMP4 parts with a burned-in clock, then serves them
// as a live stream whose edge advances in real time:
//   /ll/index.m3u8   LL-HLS: EXT-X-PART (0.5 s), 2 s segments, CAN-BLOCK-RELOAD, PRELOAD-HINT
//   /seg/index.m3u8  plain short-segment HLS (2 s segments, no parts)
//
// The test media does NOT loop: after ~10 minutes the live edge stops (check /stats remainingSeconds)
// and every player stalls at the end — restart the server for a fresh window before long tests.
//
// Usage: node ll-hls-server.mjs [port=8099]
// Requires ffmpeg on PATH. Output cached in <os tmp>/vidstream-llhls.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2] ?? 8099);
const dir = path.join(os.tmpdir(), 'vidstream-llhls');
const PARTS_PER_SEGMENT = 4;
const PREROLL_PARTS = 32; // pretend the stream started 16 s ago so a window exists immediately

// ---------------------------------------------------------------------------
// 1. Media generation
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(dir, 'parts.m3u8'))) {
  fs.mkdirSync(dir, { recursive: true });
  console.log('Generating test media with ffmpeg (one-time, ~1 min)…');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '600',
    '-vf', "drawtext=text='%{pts\\:hms}':x=20:y=20:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.6",
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-b:v', '600k',
    '-c:a', 'aac', '-b:a', '64k',
    '-f', 'hls', '-hls_time', '0.5', '-hls_list_size', '0', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', 'part%05d.m4s',
    'parts.m3u8',
  ], { stdio: 'inherit', cwd: dir }); // cwd: ffmpeg writes init.mp4 relative to the working directory
}

const parts = [];
{
  const lines = fs.readFileSync(path.join(dir, 'parts.m3u8'), 'utf8').split(/\r?\n/);
  let duration = 0;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) duration = parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) parts.push({ file: path.join(dir, line.trim()), duration });
  }
}
const cumulativeEnd = [];
parts.reduce((t, p, i) => (cumulativeEnd[i] = t + p.duration), 0);
const partTarget = Math.ceil(Math.max(...parts.map(p => p.duration)) * 1000) / 1000;
const totalSegments = Math.floor(parts.length / PARTS_PER_SEGMENT);
const segmentDuration = k => parts.slice(k * 4, k * 4 + 4).reduce((t, p) => t + p.duration, 0);
const targetDuration = Math.ceil(Math.max(...Array.from({ length: Math.min(totalSegments, 50) }, (_, k) => segmentDuration(k))));
const startedAt = Date.now() - cumulativeEnd[PREROLL_PARTS - 1] * 1000;

/** Number of parts that exist "now" (live edge) */
function availableParts() {
  const elapsed = (Date.now() - startedAt) / 1000;
  let lo = 0, hi = parts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulativeEnd[mid] <= elapsed) lo = mid + 1; else hi = mid; }
  return Math.min(lo, parts.length);
}

// ---------------------------------------------------------------------------
// 2. Playlists
// ---------------------------------------------------------------------------
function playlist(withParts) {
  const available = availableParts();
  const complete = Math.floor(available / PARTS_PER_SEGMENT);
  const first = Math.max(0, complete - 6);
  const out = [
    '#EXTM3U',
    `#EXT-X-VERSION:${withParts ? 9 : 7}`,
    `#EXT-X-TARGETDURATION:${targetDuration}`,
  ];
  if (withParts) {
    out.push(`#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=${(partTarget * 3).toFixed(3)}`);
    out.push(`#EXT-X-PART-INF:PART-TARGET=${partTarget}`);
  }
  out.push(`#EXT-X-MEDIA-SEQUENCE:${first}`, '#EXT-X-MAP:URI="init.mp4"');
  out.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(startedAt + (first * 4 ? cumulativeEnd[first * 4 - 1] : 0) * 1000).toISOString()}`);

  const partLine = i => `#EXT-X-PART:DURATION=${parts[i].duration.toFixed(5)},URI="p${i}.m4s",INDEPENDENT=YES`;
  for (let k = first; k < complete; k++) {
    if (withParts && k >= complete - 3) {
      for (let j = 0; j < PARTS_PER_SEGMENT; j++) out.push(partLine(k * 4 + j));
    }
    out.push(`#EXTINF:${segmentDuration(k).toFixed(5)},`, `s${k}.m4s`);
  }
  if (withParts) {
    for (let i = complete * 4; i < available; i++) out.push(partLine(i));
    if (available < parts.length) out.push(`#EXT-X-PRELOAD-HINT:TYPE=PART,URI="p${available}.m4s"`);
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 3. HTTP
// ---------------------------------------------------------------------------
const waitUntil = async (condition, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (!condition() && Date.now() < until) await new Promise(r => setTimeout(r, 25));
  return condition();
};

const stats = { playlists: 0, parts: 0, segments: 0 };

http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
    res.end(String(error));
  }
}).listen(port, () => {
  console.log(`LL-HLS:  http://localhost:${port}/ll/index.m3u8   (parts ${partTarget}s, segments ~${targetDuration}s)`);
  console.log(`Plain:   http://localhost:${port}/seg/index.m3u8`);
  console.log(`Stats:   http://localhost:${port}/stats`);
});

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (status, body, type) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': type.includes('mpegurl') ? 'no-cache' : 'max-age=60',
    });
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send(204, '', 'text/plain');

  const match = url.pathname.match(/^\/(ll|seg)\/(.+)$/);
  if (!match) {
    if (url.pathname === '/stats') return send(200, JSON.stringify({ ...stats, livePart: availableParts(), remainingSeconds: Math.max(0, Math.round(cumulativeEnd[parts.length - 1] - (Date.now() - startedAt) / 1000)) }), 'application/json');
    return send(404, 'not found', 'text/plain');
  }
  const [, mode, name] = match;

  if (name === 'index.m3u8') {
    stats.playlists++;
    // Blocking playlist reload (LL-HLS delivery directives)
    const msn = url.searchParams.get('_HLS_msn');
    if (mode === 'll' && msn !== null) {
      const partIdx = Number(url.searchParams.get('_HLS_part') ?? -1);
      const needed = partIdx < 0 ? (Number(msn) + 1) * 4 : Number(msn) * 4 + partIdx + 1;
      await waitUntil(() => availableParts() >= needed, targetDuration * 3000);
    }
    return send(200, playlist(mode === 'll'), 'application/vnd.apple.mpegurl');
  }
  if (name === 'init.mp4') return send(200, fs.readFileSync(path.join(dir, 'init.mp4')), 'video/mp4');

  let m = name.match(/^p(\d+)\.m4s$/);
  if (m) {
    const i = Number(m[1]);
    // Preload hints may request a part slightly before it exists — hold the request until it does
    if (!(await waitUntil(() => availableParts() > i, 3000))) return send(404, 'not yet', 'text/plain');
    stats.parts++;
    return send(200, fs.readFileSync(parts[i].file), 'video/mp4');
  }
  m = name.match(/^s(\d+)\.m4s$/);
  if (m) {
    const k = Number(m[1]);
    if (availableParts() < (k + 1) * 4) return send(404, 'not yet', 'text/plain');
    stats.segments++;
    const body = Buffer.concat(parts.slice(k * 4, k * 4 + 4).map(p => fs.readFileSync(p.file)));
    return send(200, body, 'video/mp4');
  }
  send(404, 'not found', 'text/plain');
}
