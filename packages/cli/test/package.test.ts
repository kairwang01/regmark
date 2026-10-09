// The root package.json is what `npx github:kairwang01/regmark`, the GitHub
// Action and a package on npm all start from. These tests guard the few
// things about it that break an install without breaking anything else.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
