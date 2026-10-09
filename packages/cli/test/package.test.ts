// The root package.json is what `npx github:kairwang01/regmark`, the GitHub
// Action and a package on npm all start from. These tests guard the few
// things about it that break an install without breaking anything else.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
  bin: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
  workspaces?: unknown;
  dependencies?: Record<string, string>;
};

test('no script or field makes npm build the package when it is installed from git', () => {
  // npm installs every devDependency into the clone, and then packs it, when a
  // git package has any of these. See pacote's git fetcher.
  for (const name of ['build', 'prepare', 'prepack', 'preinstall', 'install', 'postinstall']) {
    assert.equal(pkg.scripts[name], undefined, `a "${name}" script would make "npx github:…" install the whole toolchain`);
  }
  assert.equal(pkg.workspaces, undefined);
});

test('the package needs nothing installed beside it', () => {
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test('the bin is the bundle, it is among the published files, and it starts with a shebang', async () => {
  assert.deepEqual(pkg.bin, { regmark: 'dist/regmark.mjs' });
  assert.ok(pkg.files.includes(pkg.bin.regmark!));
  const head = (await readFile(path.join(root, pkg.bin.regmark!), 'utf8')).slice(0, 20);
  assert.match(head, /^#!\/usr\/bin\/env node\n/);
});

test('the bundle runs by itself and reports the version in package.json', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, pkg.bin.regmark!), '--version'], { cwd: '/' });
  assert.equal(stdout.trim(), pkg.version);
});

test('the published docs are the guides the READMEs link to, not the internal notes', async () => {
  const docs = pkg.files.filter((f) => f.startsWith('docs/'));
  for (const doc of docs) await access(path.join(root, doc));
  for (const readme of ['README.md', 'README.zh-CN.md']) {
    const text = await readFile(path.join(root, readme), 'utf8');
    for (const [linked] of text.matchAll(/docs\/[a-z0-9-]+\.md/g)) assert.ok(docs.includes(linked), `${readme} links ${linked}, which is not published`);
  }
  assert.ok(!docs.some((d) => /audit-|discoverability/.test(d)), 'internal notes stay out of the package');
});
