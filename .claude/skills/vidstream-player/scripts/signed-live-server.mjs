#!/usr/bin/env node
// Local stand-in for the Instructly Media Engine edge: LIVE HLS behind IP-bound, path-signed URLs.
//
// Same URL contract as the real edge (SYSTEM_RULES R7):
//   http://localhost:PORT/t/{exp}/{nonce}/{sig}/{app}/{stream}/{file}
//   sig = base64url(HMAC-SHA256(secret, "v2|{exp}|{nonce}|{app}|{stream}|{ipKey}"))
// Checked on every request (master, variants, segments, parts). 403 when expired, signature wrong or
// the "viewer IP" changed. Playlist/segment URLs are relative, so they inherit the token.
//
// Formats (as on the edge):
//   ts:master.m3u8  HLS (MPEG-TS), 3 s segments, 8 per playlist. app "abr": 720p + 360p, app "live": 720p
//   master.m3u8     LL-HLS (fMP4), 0.5 s parts, 2 s segments, PART-HOLD-BACK 1.5 s
//   TS loops forever; LL-HLS media lasts 10 minutes after the last /admin/state?s=live (then the edge freezes)
//
// Fake backend + controls (no token needed):
//   GET /api/sign?app=abr&stream=demo&ttl=25&kind=hls|llhls   -> { url }  (signed for the current viewer IP)
//   GET /admin/ip?ip=10.0.0.2      simulate a network switch (old URLs now 403; new ones signed for it)
//   GET /admin/state?s=waiting|live|ended   lifecycle: waiting = 404s; ended = playlist frozen, 404 after 10 s
//   GET /stats                      request / 403 counters, live edge
//
// Media is generated once with ffmpeg (on PATH, or Docker image linuxserver/ffmpeg) into <tmp>/vidstream-signed-live.
// Usage: node signed-live-server.mjs [port=8098]

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2] ?? 8098);
const SECRET = 'local-test-secret-0123456789abcdef0123456789abcdef';
const dir = path.join(os.tmpdir(), 'vidstream-signed-live');
const DURATION = 600; // seconds of media
const SEG = 3;
const WINDOW = 8;

// ---------------------------------------------------------------------------
// 1. Media (one-time)
// ---------------------------------------------------------------------------
function ffmpeg(args, cwd) {
  try {
    execFileSync('ffmpeg', args, { stdio: 'inherit', cwd });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    execFileSync('docker', ['run', '--rm', '-v', `${cwd}:/out`, '-w', '/out', 'linuxserver/ffmpeg', ...args], { stdio: 'inherit' });
  }
}

const clock = "drawtext=text='%{pts\\:hms}':x=20:y=20:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.6";
const renditions = [
  { name: '720p', w: 1280, h: 720, bitrate: 1200000 },
  { name: '360p', w: 640, h: 360, bitrate: 400000 },
];
for (const r of renditions) {
  const out = path.join(dir, `ts_${r.name}`);
  if (fs.existsSync(path.join(out, 'index.m3u8'))) continue;
  fs.mkdirSync(out, { recursive: true });
  console.log(`Generating ${r.name} TS segments (one-time)…`);
  ffmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${r.w}x${r.h}:rate=30`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(DURATION), '-vf', clock,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-g', '90', '-keyint_min', '90', '-sc_threshold', '0', '-b:v', String(r.bitrate),
    '-c:a', 'aac', '-b:a', '64k',
    '-f', 'hls', '-hls_time', String(SEG), '-hls_list_size', '0', '-hls_segment_filename', 'seg%05d.ts', 'index.m3u8',
  ], out);
}
const llDir = path.join(dir, 'll');
if (!fs.existsSync(path.join(llDir, 'parts.m3u8'))) {
  fs.mkdirSync(llDir, { recursive: true });
  console.log('Generating LL-HLS parts (one-time)…');
  ffmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(DURATION), '-vf', clock,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-b:v', '600k',
    '-c:a', 'aac', '-b:a', '64k',
    '-f', 'hls', '-hls_time', '0.5', '-hls_list_size', '0', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', 'part%05d.m4s', 'parts.m3u8',
  ], llDir);
}

function readList(file) {
  const items = [];
  let d = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#EXTINF:')) d = parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) items.push({ file: path.join(path.dirname(file), line.trim()), duration: d });
  }
  return items;
}
const tsSegs = Object.fromEntries(renditions.map(r => [r.name, readList(path.join(dir, `ts_${r.name}`, 'index.m3u8'))]));
const parts = readList(path.join(llDir, 'parts.m3u8'));
const PPS = 4; // parts per LL segment
const partTarget = Math.ceil(Math.max(...parts.map(p => p.duration)) * 1000) / 1000;

// ---------------------------------------------------------------------------
// 2. Lifecycle + live edge
// ---------------------------------------------------------------------------
let state = 'live';
let startedAt = Date.now() - WINDOW * SEG * 1000; // pretend we started a window ago
let endedAt = 0;
let viewerIpOverride = null;
const stats = { requests: 0, forbidden: 0, notFound: 0, playlists: 0, segments: 0, parts: 0, signs: 0 };

function elapsed() {
  const now = state === 'ended' ? endedAt : Date.now();
  return Math.max(0, (now - startedAt) / 1000);
}
// TS media loops forever (EXT-X-DISCONTINUITY at each wrap), so long runs never hit a frozen edge
const TS_COUNT = Math.min(...renditions.map(r => tsSegs[r.name].length));
const availableSegments = () => Math.floor(elapsed() / SEG);
const availableParts = () => Math.min(Math.floor(elapsed() / 0.5), parts.length);

// ---------------------------------------------------------------------------
// 3. Tokens (identical algorithm to Instructly-Media-Engine tools/sign-url.js)
// ---------------------------------------------------------------------------
function ipKey(ip) {
  ip = String(ip || '').trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (ip === '::1') return '6:0000:0000:0000:0000';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return '4:' + ip;
  return '6:' + ip;
}
const clientIp = req => viewerIpOverride ?? req.socket.remoteAddress;
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

function sign(app, stream, ip, ttl, file) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const nonce = crypto.randomBytes(16).toString('base64url');
  const sig = hmac(`v2|${exp}|${nonce}|${app}|${stream}|${ipKey(ip)}`);
  return `http://localhost:${port}/t/${exp}/${nonce}/${sig}/${app}/${stream}/${file}`;
}

function verify(m, req) {
  const [, exp, nonce, sig, app, stream] = m;
  if (Number(exp) < Date.now() / 1000) return 'expired';
  const expected = hmac(`v2|${exp}|${nonce}|${app}|${stream}|${ipKey(clientIp(req))}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return 'bad signature / ip';
  return null;
}

// ---------------------------------------------------------------------------
// 4. Playlists
// ---------------------------------------------------------------------------
function tsMaster(app) {
  const list = app === 'live' ? [renditions[0]] : renditions;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const r of list) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bitrate + 64000},RESOLUTION=${r.w}x${r.h},CODECS="avc1.4d401f,mp4a.40.2"`, `ts_${r.name}.m3u8`); // no "x:" prefix: a relative "ts:x" parses as an absolute URL with scheme ts:
  }
  return lines.join('\n') + '\n';
}

function tsMedia(name) {
  const segs = tsSegs[name];
  const available = availableSegments();
  const first = Math.max(0, available - WINDOW);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEG}`, `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(first / TS_COUNT)}`];
  for (let i = first; i < available; i++) {
    if (i > first && i % TS_COUNT === 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${segs[i % TS_COUNT].duration.toFixed(3)},`, `ts_${name}_${i}.ts`);
  }
  return lines.join('\n') + '\n';
}

function llMaster() {
  return ['#EXTM3U', '#EXT-X-VERSION:9',
    '#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"', 'llhls.m3u8'].join('\n') + '\n';
}

function llMedia() {
  const available = availableParts();
  const complete = Math.floor(available / PPS);
  const first = Math.max(0, complete - 6);
  const segDur = k => parts.slice(k * PPS, k * PPS + PPS).reduce((t, p) => t + p.duration, 0);
  const out = ['#EXTM3U', '#EXT-X-VERSION:9', '#EXT-X-TARGETDURATION:2',
    `#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=${(partTarget * 3).toFixed(3)}`,
    `#EXT-X-PART-INF:PART-TARGET=${partTarget}`, `#EXT-X-MEDIA-SEQUENCE:${first}`, '#EXT-X-MAP:URI="ll_init.mp4"'];
  const partLine = i => `#EXT-X-PART:DURATION=${parts[i].duration.toFixed(5)},URI="ll_p${i}.m4s",INDEPENDENT=YES`;
  for (let k = first; k < complete; k++) {
    if (k >= complete - 3) for (let j = 0; j < PPS; j++) out.push(partLine(k * PPS + j));
    out.push(`#EXTINF:${segDur(k).toFixed(5)},`, `ll_s${k}.m4s`);
  }
  for (let i = complete * PPS; i < available; i++) out.push(partLine(i));
  if (state === 'live' && available < parts.length) out.push(`#EXT-X-PRELOAD-HINT:TYPE=PART,URI="ll_p${available}.m4s"`);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 5. HTTP
// ---------------------------------------------------------------------------
const waitUntil = async (cond, ms) => {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await new Promise(r => setTimeout(r, 25));
  return cond();
};

http.createServer((req, res) => {
  handle(req, res).catch(error => {
    if (!res.headersSent) res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
    res.end(String(error));
  });
}).listen(port, () => {
  console.log(`Signed live edge on http://localhost:${port}`);
  console.log(`  sign: http://localhost:${port}/api/sign?app=abr&stream=demo&ttl=25&kind=hls`);
});

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (status, body, type = 'text/plain') => {
    res.writeHead(status, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send(204, '');
  const json = obj => send(200, JSON.stringify(obj), 'application/json');

  if (url.pathname === '/api/sign') {
    stats.signs++;
    const app = url.searchParams.get('app') ?? 'abr';
    const stream = url.searchParams.get('stream') ?? 'demo';
    const ttl = Number(url.searchParams.get('ttl') ?? 3600);
    const kind = url.searchParams.get('kind') ?? 'hls';
    return json({ url: sign(app, stream, clientIp(req), ttl, kind === 'llhls' ? 'master.m3u8' : 'ts:master.m3u8') });
  }
  if (url.pathname === '/admin/ip') {
    viewerIpOverride = url.searchParams.get('ip') || null;
    return json({ viewerIp: viewerIpOverride });
  }
  if (url.pathname === '/admin/state') {
    const s = url.searchParams.get('s');
    if (s === 'waiting') state = 'waiting';
    if (s === 'live') { state = 'live'; startedAt = Date.now() - (url.searchParams.has('fresh') ? 0 : WINDOW * SEG * 1000); }
    if (s === 'ended') { state = 'ended'; endedAt = Date.now(); }
    return json({ state });
  }
  if (url.pathname === '/stats') return json({ ...stats, state, liveSegment: availableSegments(), livePart: availableParts() });
  if (url.pathname === '/admin/reset-stats') { for (const k of Object.keys(stats)) stats[k] = 0; return json(stats); }

  stats.requests++;
  const m = url.pathname.match(/^\/t\/(\d+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(.+)$/);
  if (!m) { stats.notFound++; return send(404, 'not found'); }
  const reason = verify(m, req);
  if (reason) { stats.forbidden++; return send(403, reason); }
  const [, , , , app, , file] = m;

  // Stream lifecycle: not started yet = 404; ended = frozen playlist, then 404 after 10 s
  if (state === 'waiting' || (state === 'ended' && Date.now() - endedAt > 10000)) { stats.notFound++; return send(404, 'stream not live'); }

  if (file === 'ts:master.m3u8') { stats.playlists++; return send(200, tsMaster(app), 'application/vnd.apple.mpegurl'); }
  let f = file.match(/^ts_(720p|360p)\.m3u8$/);
  if (f) {
    if (app === 'live' && f[1] !== '720p') return send(404, 'no rendition');
    stats.playlists++;
    return send(200, tsMedia(f[1]), 'application/vnd.apple.mpegurl');
  }
  f = file.match(/^ts_(720p|360p)_(\d+)\.ts$/);
  if (f) {
    const i = Number(f[2]);
    if (i >= availableSegments()) { stats.notFound++; return send(404, 'not yet'); }
    stats.segments++;
    return send(200, fs.readFileSync(tsSegs[f[1]][i % TS_COUNT].file), 'video/mp2t');
  }

  if (file === 'master.m3u8') { stats.playlists++; return send(200, llMaster(), 'application/vnd.apple.mpegurl'); }
  if (file === 'llhls.m3u8') {
    stats.playlists++;
    const msn = url.searchParams.get('_HLS_msn');
    if (msn !== null && state === 'live') {
      const partIdx = Number(url.searchParams.get('_HLS_part') ?? -1);
      const needed = partIdx < 0 ? (Number(msn) + 1) * PPS : Number(msn) * PPS + partIdx + 1;
      await waitUntil(() => availableParts() >= needed, 6000);
    }
    return send(200, llMedia(), 'application/vnd.apple.mpegurl');
  }
  if (file === 'll_init.mp4') return send(200, fs.readFileSync(path.join(llDir, 'init.mp4')), 'video/mp4');
  f = file.match(/^ll_p(\d+)\.m4s$/);
  if (f) {
    const i = Number(f[1]);
    if (!(await waitUntil(() => availableParts() > i, 3000))) { stats.notFound++; return send(404, 'not yet'); }
    stats.parts++;
    return send(200, fs.readFileSync(parts[i].file), 'video/mp4');
  }
  f = file.match(/^ll_s(\d+)\.m4s$/);
  if (f) {
    const k = Number(f[1]);
    if (availableParts() < (k + 1) * PPS) { stats.notFound++; return send(404, 'not yet'); }
    stats.segments++;
    return send(200, Buffer.concat(parts.slice(k * PPS, k * PPS + PPS).map(p => fs.readFileSync(p.file))), 'video/mp4');
  }
  stats.notFound++;
  send(404, 'not found');
}
