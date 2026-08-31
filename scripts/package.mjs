// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const manifest = JSON.parse(await fs.readFile('manifest.json', 'utf8'));
const assets = ['main.js', 'manifest.json', 'styles.css'];
await fs.mkdir('dist/release', {recursive: true});
const hashes = {};
for (const file of assets) {
  const bytes = await fs.readFile(file);
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile('dist/release/' + file, bytes);
}
await promisify(execFile)(process.env.WECHAT2OB_BUILD_PYTHON || 'python',
  ['scripts/package.py', manifest.version], {windowsHide: true});
const zip = `WeChat2Ob-${manifest.version}.zip`;
hashes[zip] = createHash('sha256').update(await fs.readFile('dist/' + zip)).digest('hex');
await fs.writeFile('dist/SHA256SUMS.txt', Object.entries(hashes).map(([file, sha]) => `${sha}  ${file}`).join('\n') + '\n');
await fs.writeFile('dist/plugin-files.json', JSON.stringify({id: manifest.id, version: manifest.version, files: hashes}, null, 2) + '\n');
console.log(`Local package: dist/${zip}. GitHub assets: main.js, manifest.json, styles.css only.`);
