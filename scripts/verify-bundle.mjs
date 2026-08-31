// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {builtinModules} from 'node:module';
import vm from 'node:vm';
const meta = JSON.parse(await fs.readFile('.artifacts/plugin-metafile.json', 'utf8'));
const allowed = new Set(JSON.parse(await fs.readFile('public-files.json', 'utf8')));
const external = new Set(['obsidian', ...builtinModules, ...builtinModules.map(m => 'node:' + m)]);
const inputs = Object.keys(meta.inputs);
assert.ok(inputs.length > 0);
for (const input of inputs) {
  assert.ok(input.startsWith('src/') && allowed.has(input), `Unexpected bundle input: ${input}`);
}
assert.deepEqual(Object.keys(meta.outputs), ['main.js']);
for (const item of meta.outputs['main.js'].imports) {
  assert.ok(item.external && external.has(item.path), `Unexpected runtime import: ${item.path}`);
}
const code = await fs.readFile('main.js', 'utf8');
assert.ok(code.includes('SPDX-License-Identifier: GPL-3.0-only'));
assert.ok(code.includes('Copyright (C) 2026 peyote'));
assert.ok(code.includes('https://github.com/jepicaju862-lab/wechat2ob'));
assert.ok(!code.includes('sourceMappingURL='));
assert.ok(!/services[\\/]inbox|openclaw-weixin|silk-wasm|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(code));
new vm.Script(code, {filename: 'main.js'}); // Parse without executing Obsidian code.
console.log(`Bundle OK: ${inputs.length} client inputs; host APIs only; license/source notice retained.`);
