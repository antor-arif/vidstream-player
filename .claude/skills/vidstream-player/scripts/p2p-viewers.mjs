// N independent headless Chrome viewers on the p2p-live test page; prints latency/stall/P2P per viewer.
//
// Setup (once, in a scratch folder): PUPPETEER_SKIP_DOWNLOAD=1 npm i puppeteer-core@23, copy this file there.
// Needs verify-server.mjs and ll-hls-server.mjs (port 8099) running; uses the locally installed Chrome
// (override with CHROME_PATH).
//
// Usage: node p2p-viewers.mjs "<p2p-live page URL printed by verify-server, plus ?query>" [viewers=3] [seconds=45]
//   e.g. node p2p-viewers.mjs "http://localhost:5199/@fs/…/assets/p2p-live.html?src=http://localhost:8099/seg/index.m3u8&strategy=offload" 3 40
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const page = process.argv[2];
if (!page || !page.startsWith('http')) {
  console.error('usage: node p2p-viewers.mjs "<p2p-live.html URL with query>" [viewers] [seconds]');
  process.exit(1);
}
const viewers = Number(process.argv[3] ?? 3);
const seconds = Number(process.argv[4] ?? 45);
const query = new URL(page).search.slice(1);

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = chromeCandidates.find(p => fs.existsSync(p));
if (!chrome) {
  console.error('No Chrome/Edge found — set CHROME_PATH');
  process.exit(1);
}

const serverStats = () => fetch('http://localhost:8099/stats').then(r => r.json());
const before = await serverStats();

const browsers = await Promise.all(Array.from({ length: viewers }, () => puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--mute-audio',
  ],
})));

const pages = [];
for (const browser of browsers) {
  const p = await browser.newPage();
  p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.goto(page, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.player && document.querySelector('video'), { timeout: 20000 });
  await p.evaluate(() => {
    window.__lat = []; window.__stalls = 0;
    document.querySelector('video').addEventListener('waiting', () => window.__stalls++);
    setTimeout(() => setInterval(() => {
      const l = window.player.getLiveLatency(); if (l) window.__lat.push(l.latency);
    }, 1000), 15000); // ignore the first 15 s (startup, peer discovery)
  });
  pages.push(p);
  await new Promise(r => setTimeout(r, 1500)); // staggered joins, like a real audience
}

await new Promise(r => setTimeout(r, (15 + seconds) * 1000));

const after = await serverStats();
console.log(`\n${query}  (${viewers} viewers, ${seconds}s measured, server media remaining ${after.remainingSeconds}s)`);
for (const [i, p] of pages.entries()) {
  const r = await p.evaluate(() => {
    const lat = window.__lat;
    const s = window.player.getP2PStats();
    return {
      latAvg: lat.length ? +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(2) : null,
      latMin: lat.length ? +Math.min(...lat).toFixed(2) : null,
      latMax: lat.length ? +Math.max(...lat).toFixed(2) : null,
      stalls: window.__stalls,
      playing: window.player.getState().playing,
      peers: s?.peers, p2pPct: s ? Math.round(s.p2pRatio * 100) : null,
      p2pKB: s ? Math.round(s.p2pBytes / 1024) : null, httpKB: s ? Math.round(s.httpBytes / 1024) : null,
      upKB: s ? Math.round(s.uploadedBytes / 1024) : null, safeMode: s?.safeMode,
    };
  });
  console.log(`  viewer ${i + 1}:`, JSON.stringify(r));
}
console.log(`  server served: ${after.segments - before.segments} segments, ${after.parts - before.parts} parts`);
await Promise.all(browsers.map(b => b.close()));
