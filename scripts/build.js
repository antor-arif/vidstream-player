const fs = require('fs');
const path = require('path');
const { build } = require('vite');
const { execSync } = require('child_process');

const pkg = require('../package.json');

// Shared Vite options: inject the package version and never copy public/ (dev-only test files)
const common = {
  configFile: false,
  publicDir: false,
  define: {
    __VIDSTREAM_VERSION__: JSON.stringify(pkg.version),
  },
};

const entries = {
  'player': path.resolve(__dirname, '../src/index.ts'),
  'player.webcomponent': path.resolve(__dirname, '../src/webcomponent.ts'),
  'react-wrapper': path.resolve(__dirname, '../src/react/index.ts'),
};

// Optional peers — loaded by the consumer's bundler (or as globals with the UMD build), never bundled
const external = ['react', 'react-dom', 'react/jsx-runtime', 'hls.js', 'dashjs', 'p2p-media-loader-hlsjs', 'p2p-media-loader-core', '@swarmcloud/hls'];

function prependUseClient(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  if (!content.startsWith('"use client"')) {
    fs.writeFileSync(file, `"use client";\n\n${content}`);
  }
}

async function runBuild() {
  const distDir = path.resolve(__dirname, '../dist');

  console.log('1. Cleaning dist directory...');
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  console.log('2. Building ESM packages...');
  await build({
    ...common,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: entries,
        formats: ['es'],
        // .mjs so Node's native ESM loader (SSR, test runners) treats every file — including the
        // cross-entry imports Rollup generates — as a module in this non-"type: module" package
        fileName: (format, entryName) => {
          if (entryName === 'player') return 'player.esm.mjs';
          return `${entryName}.mjs`;
        },
      },
      rollupOptions: {
        external,
        output: {
          exports: 'named',
          chunkFileNames: '[name]-[hash].mjs',
        },
      },
      minify: 'esbuild',
      sourcemap: false,
      cssCodeSplit: false,
    },
  });

  // Keep the historical .js paths (module/unpkg/CDN URLs) as thin re-exports of the .mjs files
  const shims = {
    'player.esm.js': "export * from './player.esm.mjs';\n",
    'player.webcomponent.js': "export * from './player.webcomponent.mjs';\nexport { default } from './player.webcomponent.mjs';\n",
    'react-wrapper.js': "export * from './react-wrapper.mjs';\nexport { default } from './react-wrapper.mjs';\n",
  };
  for (const [file, content] of Object.entries(shims)) {
    fs.writeFileSync(path.resolve(distDir, file), content);
  }

  // Prepend "use client" directive to the React wrapper bundles for Next.js App Router compatibility
  prependUseClient(path.resolve(distDir, 'react-wrapper.js'));
  prependUseClient(path.resolve(distDir, 'react-wrapper.mjs'));
  console.log('Successfully prepended "use client" directive to react-wrapper');

  console.log('3. Building CommonJS packages...');
  await build({
    ...common,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: {
          'player.webcomponent': entries['player.webcomponent'],
          'react-wrapper': entries['react-wrapper'],
        },
        formats: ['cjs'],
        fileName: (format, entryName) => `${entryName}.cjs`,
      },
      rollupOptions: {
        external,
        output: {
          exports: 'named',
          chunkFileNames: '[name]-[hash].cjs',
        },
      },
      minify: 'esbuild',
      sourcemap: false,
      cssCodeSplit: false,
    },
  });
  prependUseClient(path.resolve(distDir, 'react-wrapper.cjs'));

  console.log('4. Building UMD package...');
  await build({
    ...common,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: entries['player'],
        formats: ['umd'],
        name: 'VidstreamPlayer',
        fileName: () => 'player.umd.js',
      },
      rollupOptions: {
        external,
        output: {
          globals: {
            'react': 'React',
            'react-dom': 'ReactDOM',
            'react/jsx-runtime': 'React',
            'hls.js': 'Hls',
            'dashjs': 'dashjs',
            'p2p-media-loader-hlsjs': 'p2pml.hlsjs',
            'p2p-media-loader-core': 'p2pml.core',
            '@swarmcloud/hls': 'P2pEngineHls',
          },
          exports: 'named',
        },
      },
      minify: 'esbuild',
      sourcemap: false,
      cssCodeSplit: false,
    },
  });

  console.log('5. Extracting CSS stylesheet...');
  try {
    const themeFilePath = path.resolve(__dirname, '../src/components/PlayerTheme.ts');
    const themeFileContent = fs.readFileSync(themeFilePath, 'utf8');
    const match = themeFileContent.match(/export function getBaseStyles\(\): string \{\s*return `([\s\S]*?)`;\s*\}/);
    if (match) {
      const css = match[1];
      fs.writeFileSync(path.resolve(distDir, 'player.css'), css.trim() + '\n');
      console.log('Successfully extracted dist/player.css');
    } else {
      throw new Error('Pattern match for getBaseStyles() not found');
    }
  } catch (error) {
    console.error('Failed to extract styles from PlayerTheme.ts:', error.message);
    process.exit(1);
  }

  console.log('6. Generating TypeScript types...');
  try {
    execSync('npx tsc --emitDeclarationOnly --noEmit false --declaration --outDir dist/types', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    });

    // Write react-wrapper type proxy — export * omits default, add it explicitly
    fs.writeFileSync(
      path.resolve(distDir, 'types/react-wrapper.d.ts'),
      "export * from './react';\nexport { default } from './react';\n"
    );

    // Write styles type declaration
    fs.writeFileSync(
      path.resolve(distDir, 'types/styles.d.ts'),
      "declare const styles: any;\nexport default styles;\n"
    );
    console.log('Type declarations successfully generated.');
  } catch (error) {
    console.error('Failed to generate type declarations:', error.message);
    process.exit(1);
  }

  console.log('Build completed successfully.');
}

runBuild().catch((err) => {
  console.error('Build script encountered an error:', err);
  process.exit(1);
});
