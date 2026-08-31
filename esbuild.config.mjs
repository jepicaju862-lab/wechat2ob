// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import {build} from 'esbuild';
import fs from 'node:fs/promises';
const notice = await fs.readFile('NOTICE', 'utf8');
const result = await build({
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', target: 'es2022',
  format: 'cjs', external: ['obsidian'], outfile: 'main.js', sourcemap: false,
  metafile: true, logLevel: 'info', banner: {js: '/*!\n' + notice + '\n*/'},
});
await fs.mkdir('.artifacts', {recursive: true});
await fs.writeFile('.artifacts/plugin-metafile.json', JSON.stringify(result.metafile, null, 2) + '\n');
