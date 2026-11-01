import { defineConfig } from 'vite';
import { resolve } from 'path';
import pkg from './package.json';

// Dev server for the root index.html demo page (the library build lives in scripts/build.js)
export default defineConfig({
  root: '.',
  define: {
    __VIDSTREAM_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    lib: {
      entry: resolve(__dirname, 'src/webcomponent.ts'),
      formats: ['es', 'umd'],
      name: 'VidstreamPlayer',
      fileName: (format) => {
        if (format === 'umd') return 'vidstream-player.umd.js';
        return 'vidstream-player.esm.js';
      },
    },
    rollupOptions: {
      external: [],
      output: {
        exports: 'named',
        assetFileNames: 'vidstream-player.[ext]',
      },
    },
    sourcemap: true,
    minify: 'esbuild',
    cssCodeSplit: false,
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    include: ['hls.js'],
  },
});
