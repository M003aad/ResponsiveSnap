'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const archive = path.join(dist, 'responsivesnap.zip');
const zipSource = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'rules.json',
  'LICENSE',
  'README.md',
  'icons',
];

fs.rmSync(dist, { force: true, recursive: true });
fs.mkdirSync(dist, { recursive: true });

if (process.platform === 'win32') {
  execFileSync('tar', ['-a', '-c', '-f', archive, ...zipSource], { cwd: root, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-q', '-r', archive, ...zipSource], { cwd: root, stdio: 'inherit' });
}

console.log(`Built ${path.relative(root, archive)}`);
