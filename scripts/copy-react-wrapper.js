const fs = require('fs');
const path = require('path');

// Ensure dist exists
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

// Write dist/react-wrapper.js
const reactWrapperJs = `export * from '../src/react';\n`;
fs.writeFileSync(path.join(distDir, 'react-wrapper.js'), reactWrapperJs);

// Write dist/types/react-wrapper.d.ts
const typesDir = path.join(distDir, 'types');
if (!fs.existsSync(typesDir)) fs.mkdirSync(typesDir, { recursive: true });
const reactWrapperDts = `export * from './react';\n`;
fs.writeFileSync(path.join(typesDir, 'react-wrapper.d.ts'), reactWrapperDts);