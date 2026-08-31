// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFile(path.join(root, file), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));
const pkg = JSON.parse(await read('package.json'));
const lock = JSON.parse(await read('package-lock.json'));
const versions = JSON.parse(await read('versions.json'));
const files = JSON.parse(await read('public-files.json'));
const allowed = new Set(files);
assert.equal(allowed.size, files.length, 'Duplicate public paths');
const ignored = new Set(['.git', 'node_modules', '.artifacts', 'dist']);
const forbidden = /(^|\/)(services?|backend|server|installer|runtime-data|state|\.env[^/]*|data\.json|connection\.json|wechat2ob_win|wechat2ob_mac)(\/|$)|\.(zip|exe|dmg|db|sqlite\d*|pem|key|map)$/i;
const secrets = [
  /wechat2ob-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /[A-Z]:[\\/](?:Users|data)[\\/]/i,
];

for (const file of files) {
  assert.equal(typeof file, 'string');
  assert.ok(!path.isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'), `Unsafe path: ${file}`);
  assert.ok(!forbidden.test(file), `Private/backend path: ${file}`);
  const stat = await fs.lstat(path.join(root, file));
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Not a regular file: ${file}`);
  const text = await read(file);
  for (const pattern of secrets) assert.ok(!pattern.test(text), `Potential secret/private path in ${file}; inspect locally`);
}

async function walk(relative = '') {
  for (const entry of await fs.readdir(path.join(root, relative), {withFileTypes: true})) {
    const file = relative ? relative + '/' + entry.name : entry.name;
    assert.ok(!entry.isSymbolicLink(), `Symlink is not allowed: ${file}`);
    if (!relative && ignored.has(entry.name)) continue;
    if (file === 'main.js' && entry.isFile()) continue;
    assert.ok(!forbidden.test(file), `Private/backend path exists: ${file}`);
    if (entry.isDirectory()) {
      assert.ok(files.some(p => p.startsWith(file + '/')), `Unreviewed directory: ${file}`);
      await walk(file);
    } else {
      assert.ok(entry.isFile() && allowed.has(file), `Unreviewed file: ${file}`);
    }
  }
}
await walk();
assert.equal(manifest.id, 'wechat2ob');
assert.equal(manifest.author, 'peyote');
assert.equal(pkg.author, manifest.author);
assert.equal(pkg.license, 'GPL-3.0-only');
assert.equal(lock.packages[''].license, pkg.license);
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.isDesktopOnly, true);
assert.equal(Object.keys(pkg.dependencies || {}).length, 0, 'Review runtime dependencies before adding them');
assert.ok(!/services[\\/]|backend[\\/]/i.test(JSON.stringify(pkg.scripts)), 'Client scripts must be independent');
assert.equal(createHash('sha256').update(await fs.readFile(path.join(root, 'LICENSE'))).digest('hex'),
  '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903', 'Full, unmodified GPL v3 text required');
for (const file of ['README.md', 'README.en.md', 'NOTICE', 'LICENSE_SCOPE.md']) {
  assert.ok((await read(file)).includes('GPL-3.0-only'), `Missing license identifier: ${file}`);
}
if (process.env.RELEASE_TAG) {
  assert.match(process.env.RELEASE_TAG, /^v?\d+\.\d+\.\d+$/);
  assert.equal(process.env.RELEASE_TAG.replace(/^v/, ''), manifest.version, 'Tag and manifest differ');
}
if (process.argv.includes('--tracked')) {
  const tracked = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8', windowsHide: true})
    .split('\0').filter(Boolean);
  assert.deepEqual([...tracked].sort(), [...allowed].sort(), 'Tracked files must exactly match the public allowlist');
  const modes = execFileSync('git', ['ls-files', '--stage'], {cwd: root, encoding: 'utf8', windowsHide: true});
  assert.ok(!/^(120000|160000) /m.test(modes), 'No tracked symlinks or submodules');
}
console.log(`Public boundary OK: ${files.length} reviewed client files; GPL-3.0-only; version ${manifest.version}.`);
