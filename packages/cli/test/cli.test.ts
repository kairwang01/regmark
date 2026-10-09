// The command line, run as a child process exactly as a user would run it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { OWNERSHIP_TOKEN, startShop } from '../../../fixtures/shop/src/index.ts';
import type { RunningShop } from '../../../fixtures/shop/src/index.ts';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const BIN = path.join(projectRoot, 'packages/cli/src/bin.ts');
const TIMEOUT_MS = 30_000;

type Result = { code: number | null; stdout: string; stderr: string };
type RunOptions = { cwd?: string; env?: Record<string, string> };

/** Runs the command line. Kills the child if it outlives the 30 second limit. */
function run(args: string[], options: RunOptions = {}): Promise<Result> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  delete env.REGMARK_OWNERSHIP_TOKEN;
  Object.assign(env, options.env);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: options.cwd ?? projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const tempDirs: string[] = [];
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'regmark-cli-'));
  tempDirs.push(dir);
  return dir;
}

let misprint: RunningShop;
let clean: RunningShop;
let counting: Server;
let hits = 0;
let helpText: string;
let misprintRun: Result;
let misprintOut: string;
let cleanRun: Result;
let cleanOut: string;
let fixtureDir: string;

const auditFlags = (origin: string) => [
  'audit',
  origin,
  '--feed',
  '/feeds/google.xml',
  '--checkout',
  '--ship-to',
  'US:94103',
  '--allow-private-network',
  '--interval',
  '0',
  '--sample',
  '50',
];

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, any>;

before(async () => {
  // No fixed clock: the command line reads the real one, and the shop's sale
  // dates are relative to its own clock, so both must be on the same time.
  [misprint, clean] = await Promise.all([startShop({ mode: 'misprint' }), startShop({ mode: 'clean' })]);
  counting = createServer((_req, res) => {
    hits += 1;
    res.end('');
  });
  await new Promise<void>((resolve) => counting.listen(0, '127.0.0.1', resolve));
  fixtureDir = await freshDir();
  await mkdir(path.join(fixtureDir, 'misprint'));
  await mkdir(path.join(fixtureDir, 'clean'));
  misprintOut = path.join(fixtureDir, 'misprint');
  cleanOut = path.join(fixtureDir, 'clean');
  const env = { REGMARK_OWNERSHIP_TOKEN: OWNERSHIP_TOKEN };
  [helpText, misprintRun, cleanRun] = await Promise.all([
    run(['--help']).then((r) => r.stdout),
    run(
      [
        ...auditFlags(misprint.origin),
        '--json',
        path.join(misprintOut, 'out.json'),
        '--sarif',
        path.join(misprintOut, 'out.sarif'),
        '--junit',
        path.join(misprintOut, 'out.xml'),
        '--html',
        path.join(misprintOut, 'out.html'),
        '--markdown',
        path.join(misprintOut, 'out.md'),
        '--quiet',
      ],
      { env },
    ),
    run([...auditFlags(clean.origin), '--json', path.join(cleanOut, 'out.json'), '--quiet'], { env }),
  ]);
});

after(async () => {
  await Promise.all([misprint?.close(), clean?.close(), counting && new Promise<void>((resolve) => counting.close(() => resolve()))]);
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

// ── Information ─────────────────────────────────────────────────────────

test('--version prints the version in packages/cli/package.json', async () => {
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'packages/cli/package.json'), 'utf8')) as { version: string };
  const res = await run(['--version']);
  assert.equal(res.code, 0);
  assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+/);
  assert.equal(res.stdout.trim(), pkg.version);
});

test('--help exits 0 and names every command', async () => {
  const res = await run(['--help']);
  assert.equal(res.code, 0);
  for (const command of ['demo', 'audit', 'explain', 'rules', 'init']) {
    assert.match(res.stdout, new RegExp(`regmark ${command}\\b`), `usage mentions ${command}`);
  }
});

test('no arguments exits 2 and prints the usage on stderr, where a mistake belongs', async () => {
  const res = await run([]);
  assert.equal(res.code, 2);
  assert.equal(res.stderr, helpText);
  assert.equal(res.stdout, '');
});

test('rules prints one line per rule, including the two named rules', async () => {
  const res = await run(['rules']);
  assert.equal(res.code, 0);
  const lines = res.stdout.split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length, 17);
  for (const line of lines) assert.match(line, /^[a-z]+(\.[a-z-]+)+\s/, `dotted id first: ${line}`);
  assert.ok(lines.some((line) => line.startsWith('price.mismatch ')));
  assert.ok(lines.some((line) => line.startsWith('content.instruction-like ')));
});

test('explain prints the id, its severity and the anchor in the rules docs', async () => {
  const res = await run(['explain', 'price.mismatch']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /price\.mismatch\s+\(error\)/);
  assert.ok(res.stdout.includes('docs/rules.md#pricemismatch-error'));
});

test('explain with an unknown rule exits 2 and lists the valid ids on stderr', async () => {
  const res = await run(['explain', 'no.such-rule']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /no rule called "no\.such-rule"/);
  assert.ok(res.stderr.includes('price.mismatch'));
  assert.ok(res.stderr.includes('content.invisible-chars'));
});

test('explain with no rule exits 2', async () => {
  const res = await run(['explain']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /which rule\?/);
});

test('init writes a config with the origin only, refuses to overwrite it, and needs a URL', async () => {
  const dir = await freshDir();
  const first = await run(['init', 'https://shop.example/some/path'], { cwd: dir });
  assert.equal(first.code, 0);
  const file = path.join(dir, 'regmark.config.json');
  const written = await readFile(file, 'utf8');
  assert.equal(JSON.parse(written).store, 'https://shop.example');

  const again = await run(['init', 'https://shop.example/other'], { cwd: dir });
  assert.equal(again.code, 2);
  assert.equal(await readFile(file, 'utf8'), written, 'file unchanged');

  const none = await run(['init'], { cwd: await freshDir() });
  assert.equal(none.code, 2);
});

// ── Failing fast ────────────────────────────────────────────────────────

/** Each of these must fail before a single request is made, so the counting server must see nothing. */
async function failsFast(args: string[], expected: RegExp): Promise<void> {
  const before = hits;
  const res = await run(args);
  assert.equal(res.code, 2, `exit code for ${args.join(' ')}`);
  assert.match(res.stderr, expected);
  assert.equal(hits, before, 'no request reached the shop');
}

const target = (): string => `http://127.0.0.1:${(counting.address() as AddressInfo).port}`;

test('an unknown command exits 2 with a message on stderr', async () => {
  await failsFast(['frobnicate'], /unknown command "frobnicate"/);
});

test('an unknown platform exits 2 and names the valid choices', async () => {
  await failsFast(['audit', target(), '--platform', 'magento'], /unknown platform "magento"; choose one of woocommerce, shopify, auto, none/);
});

test('--budget with no number exits 2', async () => {
  await failsFast(['audit', target(), '--budget', 'nonsense'], /--budget wants rule=number/);
});

test('--max-age that is not surface=duration exits 2', async () => {
  await failsFast(['audit', target(), '--feed', '/feed.xml', '--max-age', '24h'], /--max-age wants surface=duration, such as feed=24h; got "24h"/);
  await failsFast(['audit', target(), '--feed', '/feed.xml', '--max-age', 'feed='], /--max-age wants surface=duration/);
  await failsFast(['audit', target(), '--feed', '/feed.xml', '--max-age', 'feed=soon'], /maxAge\.feed must be a duration such as "90m", "24h" or "7d"; got "soon"/);
  await failsFast(['audit', target(), '--feed', '/feed.xml', '--max-age', 'page=24h'], /unknown maxAge field "page"/);
});

test('--max-age for a feed the audit does not read exits 2', async () => {
  await failsFast(['audit', target(), '--max-age', 'feed=24h'], /maxAge\.feed is set, but no feed is read/);
  await failsFast(['audit', target(), '--feed', '/feed.xml', '--max-age', 'acp=24h'], /maxAge\.acp is set, but no acp is read/);
});

test('--ship-to with a country name exits 2 (checkout requested)', async () => {
  await failsFast(['audit', target(), '--checkout', '--ship-to', 'USA'], /two-letter country code/);
});

test('--sample that is not a number exits 2', async () => {
  await failsFast(['audit', target(), '--sample', 'abc'], /--sample wants a whole number/);
});

test('--ship-to USA without --checkout is still rejected', async () => {
  await failsFast(['audit', target(), '--ship-to', 'USA'], /two-letter country code/);
});

test('--ship-to rejects extra components instead of silently discarding them', async () => {
  await failsFast(['audit', target(), '--ship-to', 'US:94103:CA'], /CC or CC:postcode/);
});

test('strict checkout audit exits 2 and records failure when ownership is not verified', async () => {
  const dir = await freshDir();
  const file = path.join(dir, 'out.json');
  const res = await run([...auditFlags(clean.origin), '--strict', '--json', file, '--quiet']);
  assert.equal(res.code, 2, res.stderr);
  assert.match(res.stderr, /strict audit incomplete/);
  const result = await readJson(file);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i: { code: string }) => i.code === 'ownership-not-verified'));
  assert.ok(result.counts.products > 0, 'otherwise readable products cannot mask the missing checkout');
});

test('strict checkout audit passes when all requested surfaces were collected', async () => {
  const res = await run([...auditFlags(clean.origin), '--strict', '--quiet'], { env: { REGMARK_OWNERSHIP_TOKEN: OWNERSHIP_TOKEN } });
  assert.equal(res.code, 0, res.stderr);
});

// ── Demo ────────────────────────────────────────────────────────────────

test('demo runs the bundled shop and writes an HTML report with no local address in it', async () => {
  const dir = await freshDir();
  const res = await run(['demo'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(res.stdout.includes('demo-shop.example'));
  assert.ok(res.stdout.includes('price.mismatch'));
  assert.ok(res.stdout.includes('16 errors, 10 warnings, 1 note. 8 rules over budget.'));
  assert.ok(!res.stdout.includes('127.0.0.1'));

  const html = await readFile(path.join(dir, 'regmark-demo.html'), 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Out of register'));
  assert.ok(!html.includes('127.0.0.1'));
  assert.ok(!html.includes('<script'));
});

test('demo --clean reports an in-register shop', async () => {
  const dir = await freshDir();
  const res = await run(['demo', '--clean'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(res.stdout.includes('0 errors, 0 warnings. Within budget.'));
  const html = await readFile(path.join(dir, 'regmark-demo.html'), 'utf8');
  assert.ok(html.includes('In register'));
});

test('demo --html writes the report to the name given', async () => {
  const dir = await freshDir();
  const res = await run(['demo', '--html', 'custom.html'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(existsSync(path.join(dir, 'custom.html')));
  assert.ok(!existsSync(path.join(dir, 'regmark-demo.html')));
});

test('demo does not crash when its stdout reader closes early', async () => {
  const dir = await freshDir();
  const child = spawn(process.execPath, [BIN, 'demo'], { cwd: dir, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', () => child.stdout.destroy());
    child.once('close', resolve);
  });
  clearTimeout(timer);
  assert.equal(code, 0);
  assert.ok(!stderr.includes('EPIPE'), stderr);
  assert.ok(!/\n\s+at /.test(stderr), stderr);
});

// ── Audit against the fixture shop ─────────────────────────────────────

// The run above passes no --platform flag, so this also checks that auto-detection recognises the shop.
test('audit of the misprinted shop exits 1 and writes every report format', async () => {
  assert.equal(misprintRun.code, 1, misprintRun.stderr);
  assert.equal(misprintRun.stdout, '');
  const json = await readJson(path.join(misprintOut, 'out.json'));
  assert.equal(json.schema, 'regmark.audit/v0');
  assert.equal(json.ok, false);
  assert.equal(json.findings.length, 22);
  assert.ok(json.surfaces.includes('platform'));
  assert.ok(json.surfaces.includes('checkout'));

  const sarif = await readJson(path.join(misprintOut, 'out.sarif'));
  assert.equal(sarif.version, '2.1.0');

  const junit = await readFile(path.join(misprintOut, 'out.xml'), 'utf8');
  assert.ok(junit.startsWith('<?xml'));

  const html = await readFile(path.join(misprintOut, 'out.html'), 'utf8');
  assert.ok(html.includes('Out of register'));

  const markdown = await readFile(path.join(misprintOut, 'out.md'), 'utf8');
  assert.ok(markdown.startsWith('## Regmark: out of register'));
});

test('audit of the clean shop exits 0 with no findings', async () => {
  assert.equal(cleanRun.code, 0, cleanRun.stderr);
  const json = await readJson(path.join(cleanOut, 'out.json'));
  assert.equal(json.ok, true);
  assert.deepEqual(json.findings, []);
});

test('--platform none leaves out the platform and checkout surfaces', async () => {
  const out = path.join(await freshDir(), 'none.json');
  const res = await run(
    ['audit', misprint.origin, '--feed', '/feeds/google.xml', '--platform', 'none', '--allow-private-network', '--interval', '0', '--sample', '50', '--json', out, '--quiet'],
    { env: { REGMARK_OWNERSHIP_TOKEN: OWNERSHIP_TOKEN } },
  );
  assert.equal(res.code, 1, res.stderr);
  const json = await readJson(out);
  assert.ok(!json.surfaces.includes('platform'));
  assert.ok(!json.surfaces.includes('checkout'));
});

test('a --budget for every over-budget rule makes the misprinted shop pass', async () => {
  const json = await readJson(path.join(misprintOut, 'out.json'));
  const over = (json.rules as Array<{ id: string; passed: boolean }>).filter((r) => r.passed === false);
  assert.ok(over.length > 0);
  const budgets = over.flatMap((r) => ['--budget', `${r.id}=99`]);
  const res = await run([...auditFlags(misprint.origin), ...budgets, '--quiet'], { env: { REGMARK_OWNERSHIP_TOKEN: OWNERSHIP_TOKEN } });
  assert.equal(res.code, 0, res.stderr);
});

test('a regmark.config.json in the working directory supplies the store and settings', async () => {
  const dir = await freshDir();
  await writeFile(
    path.join(dir, 'regmark.config.json'),
    JSON.stringify({
      store: misprint.origin,
      feed: '/feeds/google.xml',
      sample: 50,
      fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
    }),
  );
  const res = await run(['audit', '--json', 'out.json', '--quiet'], { cwd: dir });
  assert.equal(res.code, 1, res.stderr);
  assert.equal((await readJson(path.join(dir, 'out.json'))).store, misprint.origin);
});

// ── Mistakes that must not pass quietly ─────────────────────────────────

/** A config file in a fresh directory, and the audit run from there. */
async function withConfig(config: Record<string, unknown>, args: string[] = [], env: Record<string, string> = {}): Promise<Result & { dir: string }> {
  const dir = await freshDir();
  await writeFile(path.join(dir, 'regmark.config.json'), JSON.stringify(config));
  return { ...(await run(['audit', ...args], { cwd: dir, env })), dir };
}

const local = { fetch: { allowPrivateNetwork: true, minIntervalMs: 0 } };

test('a platform in the config file that does not exist exits 2', async () => {
  const res = await withConfig({ store: misprint.origin, platform: 'magento', ...local });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /unknown platform "magento"/);
});

test('a misspelt field in the config file exits 2 and is named', async () => {
  const res = await withConfig({ store: misprint.origin, feeds: '/feeds/google.xml', ...local });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /unknown config field "feeds"/);
});

test('a budget for a rule that does not exist exits 2 and says where the rules are listed', async () => {
  await failsFast(['audit', target(), '--budget', 'price.mismach=3'], /rule that does not exist: "price\.mismach"; regmark rules lists them/);
  const res = await withConfig({ store: misprint.origin, budget: { 'price.mismatch': 'three' }, ...local });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /budget for price\.mismatch must be a whole number/);
});

test('a surface in --datum that does not exist exits 2', async () => {
  await failsFast(['audit', target(), '--datum', 'checkout,backend'], /unknown surface "backend" in datum/);
});

test('an audit that reads no product exits 2 and no report calls it a pass', async () => {
  const dir = await freshDir();
  const origin = `http://127.0.0.1:${(counting.address() as AddressInfo).port}`;
  const res = await run(['audit', origin, '--allow-private-network', '--interval', '0', '--html', 'out.html', '--markdown', 'out.md', '--json', 'out.json'], { cwd: dir });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /no product could be read from 127\.0\.0\.1:\d+, so nothing was checked/);
  assert.match(res.stdout, /No product was read, so nothing was checked\./);
  assert.doesNotMatch(res.stdout, /Within budget/);
  const html = await readFile(path.join(dir, 'out.html'), 'utf8');
  assert.match(html, /Nothing read/);
  assert.doesNotMatch(html, /In register/);
  assert.match(await readFile(path.join(dir, 'out.md'), 'utf8'), /^## Regmark: nothing read/);
  assert.equal((await readJson(path.join(dir, 'out.json'))).counts.products, 0);
});

test('an empty REGMARK_OWNERSHIP_TOKEN does not blank out the token in the config file', async () => {
  const config = { store: misprint.origin, platform: 'woocommerce', sample: 3, ownershipToken: OWNERSHIP_TOKEN, checkout: { shipTo: { country: 'US' } }, ...local };
  const res = await withConfig(config, ['--json', 'out.json', '--quiet'], { REGMARK_OWNERSHIP_TOKEN: '' });
  assert.notEqual(res.code, 2, res.stderr);
  assert.ok((await readJson(path.join(res.dir, 'out.json'))).surfaces.includes('checkout'));
});

test('--ship-to replaces the destination of a checkout the config file asks for', async () => {
  const config = { store: misprint.origin, platform: 'woocommerce', sample: 3, checkout: { shipTo: { country: 'US' } }, ...local };
  const res = await withConfig(config, ['--ship-to', 'Canada', '--quiet']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /two-letter country code/);
  const bad = await withConfig({ ...config, checkout: { shipTo: { country: 'Canada' } } }, ['--quiet']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /checkout\.shipTo\.country must be a two-letter country code/);
});

test('--max-age reports a feed older than its limit once, and replaces the same surface from the config file', async () => {
  // The misprinted feed says it was generated nine days before the shop's clock.
  const config = { store: misprint.origin, feed: '/feeds/google.xml', platform: 'woocommerce', sample: 50, maxAge: { feed: '10d' }, ...local };
  const stale = (json: Record<string, any>) => (json.findings as Array<{ rule: string; product: string; surface?: string }>).filter((f) => f.rule === 'availability.stale');

  const fromFile = await withConfig(config, ['--json', 'out.json', '--quiet']);
  assert.equal(fromFile.code, 1, fromFile.stderr);
  const lenient = await readJson(path.join(fromFile.dir, 'out.json'));
  assert.deepEqual(stale(lenient), []);
  assert.equal(lenient.rules.find((r: { id: string }) => r.id === 'availability.stale').skipped, undefined, 'the rule ran');

  const fromFlag = await withConfig(config, ['--max-age', 'feed=24h', '--json', 'out.json', '--quiet']);
  assert.equal(fromFlag.code, 1, fromFlag.stderr);
  const strict = await readJson(path.join(fromFlag.dir, 'out.json'));
  assert.deepEqual(stale(strict).map((f) => [f.product.split('/').pop(), f.surface]), [['canvas-tote', 'feed']]);
});

test('a maxAge in the config file applies to a feed given on the command line', async () => {
  // The file is checked before the flags are merged into it, so it must not demand a feed the flags supply.
  const config = { store: misprint.origin, platform: 'woocommerce', sample: 50, maxAge: { feed: '24h' }, ...local };
  const res = await withConfig(config, ['--feed', '/feeds/google.xml', '--json', 'out.json', '--quiet']);
  assert.equal(res.code, 1, res.stderr);
  const json = await readJson(path.join(res.dir, 'out.json'));
  assert.ok(json.findings.some((f: { rule: string }) => f.rule === 'availability.stale'));
  // Without any feed, the merged config is still refused.
  const none = await withConfig(config, ['--quiet']);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /maxAge\.feed is set, but no feed is read/);
});

test('--acp-feed reads the agent feed as the acp surface, gzipped as published, and the config file can name it too', async () => {
  const acpFindings = (json: Record<string, any>) =>
    (json.findings as Array<{ rule: string; variant?: string; surface?: string }>).filter((f) => f.surface === 'acp').map((f) => `${f.rule} ${f.variant}`).sort();
  const expected = ['availability.mismatch BEANIE-NVY', 'price.mismatch SOCK-M'];

  const out = path.join(await freshDir(), 'acp.json');
  const flag = await run(
    ['audit', misprint.origin, '--acp-feed', '/feeds/acp.jsonl.gz', '--platform', 'woocommerce', '--allow-private-network', '--interval', '0', '--sample', '50', '--json', out, '--quiet'],
  );
  assert.equal(flag.code, 1, flag.stderr);
  const json = await readJson(out);
  assert.ok(json.surfaces.includes('acp'));
  assert.ok(!json.surfaces.includes('feed'), 'the Google feed was not asked for');
  assert.deepEqual(acpFindings(json), expected);
  assert.deepEqual(json.issues, []);

  const fromFile = await withConfig({ store: misprint.origin, acpFeed: '/feeds/acp.jsonl', platform: 'woocommerce', sample: 50, ...local }, ['--json', 'out.json', '--quiet']);
  assert.equal(fromFile.code, 1, fromFile.stderr);
  assert.deepEqual(acpFindings(await readJson(path.join(fromFile.dir, 'out.json'))), expected);
});
