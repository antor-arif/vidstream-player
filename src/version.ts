// Injected from package.json by scripts/build.js, vite.config.ts and vitest.config.ts.
// The fallback only applies when the source is consumed without one of those (e.g. a raw Vite dev server).
declare const __VIDSTREAM_VERSION__: string | undefined;

export const VERSION: string =
  typeof __VIDSTREAM_VERSION__ !== 'undefined' ? __VIDSTREAM_VERSION__ : '2.0.0';
