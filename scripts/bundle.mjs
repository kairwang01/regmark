// Bundle the command line into one file, dist/regmark.mjs.
//
// Development needs no build: Node runs the TypeScript sources directly. The
// bundle exists for everyone else. Node refuses to strip types from files
// under node_modules, so a package cannot ship .ts sources; and a GitHub
// Action or `npx github:kairwang01/regmark` should start without an install
// step. One self-contained file with every dependency inside covers all of
// those. It is committed, and rebuilt when a release is cut.
//
//   node scripts/bundle.mjs           write dist/regmark.mjs
//   node scripts/bundle.mjs --check   exit 1 if the committed file is out of date
//
// The package script that runs this is called "bundle" and must not be renamed
// "build": npm treats a git package with a build, prepare or install script as
// one it has to build, and installs every devDependency into the clone before
// packing it. That turns a two-second `npx github:…` into a failed install.

import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const OUT = 'dist/regmark.mjs';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const result = await build({
  entryPoints: ['packages/cli/src/bin.ts'],
  outfile: OUT,
  write: false,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  define: { __REGMARK_VERSION__: JSON.stringify(pkg.version) },
  // Some dependencies still call require() for Node built-ins.
  banner: { js: "import { createRequire as __regmarkRequire } from 'node:module';\nconst require = __regmarkRequire(import.meta.url);" },
  logLevel: 'warning',
});

const fresh = result.outputFiles[0].contents;
const label = `${OUT}  ${(fresh.length / 1024).toFixed(0)} kB  v${pkg.version}`;

if (process.argv.includes('--check')) {
  const committed = await readFile(OUT).catch(() => Buffer.alloc(0));
  if (Buffer.compare(committed, fresh) !== 0) {
    console.error(`${OUT} is out of date; run  pnpm bundle  and commit the result`);
    process.exit(1);
  }
  console.log(`${label}  up to date`);
} else {
  await writeFile(OUT, fresh);
  console.log(label);
}
