'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) throw new Error('Manifest must use manifest_version 3');
if (!manifest.background?.service_worker) throw new Error('Missing background service worker');

for (const file of [
  manifest.background.service_worker,
  manifest.content_scripts?.flatMap((entry) => entry.js || []),
  manifest.content_scripts?.flatMap((entry) => entry.css || []),
  manifest.declarative_net_request?.rule_resources?.map((rule) => rule.path),
]) {
  for (const relative of (Array.isArray(file) ? file : [file]).filter(Boolean)) {
    const resolved = path.join(root, relative);
    if (!fs.existsSync(resolved)) throw new Error(`Manifest file not found: ${relative}`);
  }
}

const packageVersion = require('../package.json').version;
if (manifest.version !== packageVersion) {
  throw new Error(`Manifest version ${manifest.version} does not match package version ${packageVersion}`);
}

console.log(`Validated ResponsiveSnap ${manifest.version} (Manifest V3)`);
