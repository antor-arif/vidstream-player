#!/usr/bin/env node
// Serves the live Vidstream-player/src through Vite together with the verify harness
// (../assets/verify.html), so player changes can be checked in a real browser.
//
// It never writes into the package: no dist/ rebuild, and Vite's dependency cache goes to
// the OS temp dir instead of Vidstream-player/node_modules/.vite.
//
// Usage:  node verify-server.mjs [path-to-Vidstream-player] [port=5199]
//   The package path is optional: it is auto-detected when the skill lives inside the repo
//   (Vidstream-player/.claude/skills/…) or when run from the repo or the workspace root.
// Then open the printed URL. Stop with Ctrl+C (or stop the background task).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const isPackage = dir => fs.existsSync(path.join(dir, 'src', 'index.ts')) && fs.existsSync(path.join(dir, 'package.json'));

// Args: an optional path and/or a port number, in either order
const args = process.argv.slice(2);
const portArg = args.find(a => /^\d+$/.test(a));
const pkgArg = args.find(a => !/^\d+$/.test(a));

function detectPackage() {
  const candidates = [
    pkgArg && path.resolve(pkgArg),
    path.resolve(scriptDir, '../../../..'), // <repo>/.claude/skills/vidstream-player/scripts
    process.cwd(),
    path.join(process.cwd(), 'Vidstream-player'),
    path.resolve(scriptDir, '../../../../Vidstream-player'), // <workspace>/.claude/skills/…
  ].filter(Boolean);
  return candidates.find(isPackage);
}

const pkgDir = detectPackage();
const port = Number(portArg ?? 5199);
const harness = path.resolve(scriptDir, '../assets/verify.html');

if (!pkgDir) {
  console.error('Could not find the vidstream-player package (src/index.ts). Pass its path: node verify-server.mjs <path>');
  process.exit(1);
}
const viteEntry = path.join(pkgDir, 'node_modules', 'vite', 'dist', 'node', 'index.js');
if (!fs.existsSync(viteEntry)) {
  console.error(`Vite not installed in ${pkgDir} — run "npm install" there first.`);
  process.exit(1);
}

const { createServer } = await import(pathToFileURL(viteEntry).href);

// Serve built files under /dist/ byte-for-byte (no Vite transform, no caching) so
// assets/umd.html exercises the bundle exactly as a CDN would deliver it.
const rawDist = {
  name: 'vidstream-raw-dist',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const urlPath = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (!urlPath.startsWith('/dist/')) return next();
      const file = path.join(pkgDir, urlPath);
      if (!file.startsWith(path.join(pkgDir, 'dist')) || !fs.existsSync(file)) return next();
      const type = file.endsWith('.css') ? 'text/css' : 'text/javascript';
      res.setHeader('Content-Type', `${type}; charset=utf-8`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(file));
    });
  },
};

const server = await createServer({
  configFile: false,
  root: pkgDir,
  cacheDir: path.join(os.tmpdir(), 'vidstream-verify-vite-cache'),
  logLevel: 'warn',
  plugins: [rawDist],
  server: { port, strictPort: true, open: false, fs: { strict: false } },
  optimizeDeps: { include: ['hls.js', 'dashjs', 'p2p-media-loader-hlsjs'] },
});
await server.listen();

const fsPath = harness.replace(/\\/g, '/');
const url = `http://localhost:${port}/@fs/${fsPath.startsWith('/') ? fsPath.slice(1) : fsPath}`;
console.log(`verify harness ready: ${url}`);
console.log(`UMD/CDN check (needs npm run build): ${url.replace(/verify\.html$/, 'umd.html')}`);
console.log(`Live latency + P2P page:            ${url.replace(/verify\.html$/, 'p2p-live.html')}`);
console.log(`(package root ${pkgDir} is also served at http://localhost:${port}/ — e.g. /index.html dev demo)`);
