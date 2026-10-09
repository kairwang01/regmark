// Bundle the command line into one file, dist/regmark.mjs.
//
// Development needs no build: Node runs the TypeScript sources directly. The
// bundle exists for everyone else. Node refuses to strip types from files
// under node_modules, so a package cannot ship .ts sources; and a GitHub
// Action or `npx github:kairwang01/regmark` should start without an install
// step. One self-contained file with every dependency inside covers all of
// those. It is committed, and CI fails if it is out of date.

import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const result = await build({
  entryPoints: ['packages/cli/src/bin.ts'],
  outfile: 'dist/regmark.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  define: { __REGMARK_VERSION__: JSON.stringify(pkg.version) },
  // Some dependencies still call require() for Node built-ins.
  banner: { js: "import { createRequire as __regmarkRequire } from 'node:module';\nconst require = __regmarkRequire(import.meta.url);" },
  metafile: true,
  logLevel: 'warning',
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`dist/regmark.mjs  ${(bytes / 1024).toFixed(0)} kB  v${pkg.version}`);
