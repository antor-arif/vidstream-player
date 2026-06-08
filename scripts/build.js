const fs = require('fs');
const path = require('path');
const { build } = require('vite');
const { execSync } = require('child_process');

async function runBuild() {
  const distDir = path.resolve(__dirname, '../dist');

  console.log('1. Cleaning dist directory...');
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  console.log('2. Building ESM packages...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: {
          'player': path.resolve(__dirname, '../src/index.ts'),
          'player.webcomponent': path.resolve(__dirname, '../src/webcomponent.ts'),
          'react-wrapper': path.resolve(__dirname, '../src/react/index.ts'),
        },
        formats: ['es'],
        fileName: (format, entryName) => {
          if (entryName === 'player') return 'player.esm.js';
          return `${entryName}.js`;
        },
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'hls.js', 'dashjs'],
        output: {
          exports: 'named',
        },
      },
      minify: 'esbuild',
      sourcemap: false,
      cssCodeSplit: false,
    },
  });

  // Prepend "use client" directive to the React wrapper bundle for Next.js App Router compatibility
  const reactWrapperPath = path.resolve(distDir, 'react-wrapper.js');
  if (fs.existsSync(reactWrapperPath)) {
    const content = fs.readFileSync(reactWrapperPath, 'utf8');
    fs.writeFileSync(reactWrapperPath, `"use client";\n\n${content}`);
    console.log('Successfully prepended "use client" directive to react-wrapper.js');
  }

  console.log('3. Building UMD package...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: path.resolve(__dirname, '../src/index.ts'),
        formats: ['umd'],
        name: 'VidstreamPlayer',
        fileName: () => 'player.umd.js',
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'hls.js', 'dashjs'],
        output: {
          globals: {
            'react': 'React',
            'react-dom': 'ReactDOM',
            'hls.js': 'Hls',
            'dashjs': 'dashjs',
          },
          exports: 'named',
        },
      },
      minify: 'esbuild',
      sourcemap: false,
      cssCodeSplit: false,
    },
  });

  console.log('4. Extracting CSS stylesheet...');
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
  }

  console.log('5. Generating TypeScript types...');
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
