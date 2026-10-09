#!/usr/bin/env node
// The command line. It turns flags into a config, runs the audit, prints the
// summary, writes any report files asked for, and sets the exit code. All the
// judgement lives in runAudit; nothing here decides what a finding is.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, styleText } from 'node:util';
import { renderHtml, renderJson, renderJUnit, renderMarkdown, renderSarif, renderTerminal } from '@regmark/report';
import { allRules } from '@regmark/rules';
import type { AuditResult, Surface } from '@regmark/core';
import { ConfigError, runAudit } from './audit.ts';
import type { AuditConfig } from './audit.ts';
import { checkConfig, configObject } from './config.ts';

// Set by the bundler. When the sources are run directly it is read from package.json.
declare const __REGMARK_VERSION__: string | undefined;

const DOCS = 'https://github.com/kairwang01/regmark/blob/main/docs';

const USAGE = `regmark: catch ecommerce product-data mismatches across pages, feeds and store APIs

Usage
  regmark demo                      audit a bundled shop with defects planted in it
  regmark demo --clean              the same shop with nothing wrong in it
  regmark audit <store-url>         audit a real shop
  regmark explain <rule>            the usual cause of a finding, and the fix
  regmark rules                     list every rule
  regmark init <store-url>          write a starter regmark.config.json

Surfaces (audit)
  --feed <url>              product feed in Google Merchant format
  --acp-feed <url>          product feed in Agentic Commerce Protocol format
  --platform <name>         woocommerce, shopify, auto or none; default auto
  --ucp                     read the shop's UCP catalogue (/.well-known/ucp)
  --mcp                     read the shop's storefront MCP server
  --checkout                run the checkout probe (WooCommerce or Shopify; needs an ownership token)
  --ship-to <CC[:postcode]> destination for the checkout probe, default US
  --cloaking                fetch pages again as a browser and as an agent, and compare (needs an ownership token)
  --page <url>              audit this product page; repeatable

Scope
  --sample <n>              how many products to audit, default 25
  --seed <n>                changes which products are sampled, default 1
  --datum <a,b,c>           which surface to believe, most trusted first
  --budget <rule=n>         allow up to n findings for a rule; repeatable
  --max-age <surface=age>   oldest a feed may be, such as feed=24h; repeatable
  --strict                  exit 2 if any surface has a collection issue

Output
  --html <file>   --json <file>   --sarif <file>   --junit <file>   --markdown <file>
  --quiet                   do not print the summary
  --no-color
  --verbose                 every step on stderr

Other
  --config <file>           JSON, or a module with a default export; ./regmark.config.json is read if present
  --interval <ms>           gap between requests to one host, default 1000
  --allow-private-network   for a shop on your own machine or network
  --version   --help

The ownership token is read from REGMARK_OWNERSHIP_TOKEN. Put the line
regmark-verify=<token> in /.well-known/regmark.txt on the shop.

Exit code: 0 within budget, 1 over budget, 2 the audit could not run or read no product.
Documentation: ${DOCS}
`;

async function version(): Promise<string> {
  if (typeof __REGMARK_VERSION__ === 'string') return __REGMARK_VERSION__;
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

async function loadConfig(file: string): Promise<Partial<AuditConfig>> {
  const abs = path.resolve(file);
  let value: unknown;
  if (abs.endsWith('.json')) value = JSON.parse(await readFile(abs, 'utf8'));
  else value = ((await import(pathToFileURL(abs).href)) as { default?: unknown }).default;
  configObject(value, file);
  // Validate before merging flags: spreading a string or normalizing checkout
  // used to hide malformed safety options from the final validator.
  checkConfig({ ...value, store: value.store ?? 'https://config.example', platform: value.platform === 'none' ? undefined : value.platform } as AuditConfig, allRules, { partial: true });
  return value as Partial<AuditConfig>;
}

function parseShipTo(text: string): { country: string; postcode?: string } {
  const [country = '', postcode, extra] = text.split(':');
  if (!/^[A-Za-z]{2}$/.test(country)) throw new ConfigError(`--ship-to wants a two-letter country code, got "${text}"`);
  if (extra !== undefined || postcode === '') throw new ConfigError('--ship-to wants CC or CC:postcode');
  return postcode ? { country: country.toUpperCase(), postcode } : { country: country.toUpperCase() };
}

function parseBudget(entries: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) {
    const m = /^([a-z][a-z0-9.-]*)=(\d+)$/.exec(entry);
    if (!m) throw new ConfigError(`--budget wants rule=number, got "${entry}"`);
    out[m[1]!] = Number(m[2]);
  }
  return out;
}

function parseMaxAge(entries: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const m = /^([a-z]+)=(.+)$/.exec(entry);
    if (!m) throw new ConfigError(`--max-age wants surface=duration, such as feed=24h; got "${entry}"`);
    out[m[1]!] = m[2]!;
  }
  return out;
}

const wholeNumber = (flag: string, text: string): number => {
  if (!/^\d+$/.test(text)) throw new ConfigError(`${flag} wants a whole number, got "${text}"`);
  return Number(text);
};

const out = (text: string) => process.stdout.write(text);
const note = (text: string) => process.stderr.write(text);
const dim = (text: string) => (process.stderr.isTTY && !process.env.NO_COLOR ? styleText('dim', text) : text);

/** The anchor GitHub gives a rule's heading in docs/rules.md. */
const ruleAnchor = (id: string, severity: string) => `${id.replace(/\./g, '')}-${severity}`;

function explain(id: string | undefined): number {
  const rule = allRules.find((r) => r.id === id);
  if (!rule) {
    note(id ? `regmark: no rule called "${id}"\n\n` : 'regmark: which rule?\n\n');
    for (const r of allRules) note(`  ${r.id}\n`);
    return 2;
  }
  out(`\n  ${rule.id}  (${rule.severity})\n\n  ${rule.summary}\n`);
  if (rule.help) out(`\n  ${wrap(rule.help, 76).join('\n  ')}\n`);
  out(`\n  Exactly when it fires: ${DOCS}/rules.md#${ruleAnchor(rule.id, rule.severity)}\n\n`);
  return 0;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function init(target: string | undefined): Promise<number> {
  if (!target) throw new ConfigError('which shop? regmark init <store-url>');
  const store = new URL(target).origin;
  checkConfig({ store: target }, allRules);
  const file = 'regmark.config.json';
  if (existsSync(file)) throw new ConfigError(`${file} already exists; edit it, or delete it and run init again`);
  const config = { store, platform: 'auto', sample: 25, budget: {} };
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  out(`
  Wrote ${file}

  Next:
    regmark audit                      read ${new URL(store).host} and report
    regmark audit --html report.html   and keep a report to share

  To let Regmark compare against real checkout totals (WooCommerce or Shopify):
    1. choose a token of 16 or more letters and digits
    2. serve the line  regmark-verify=<token>  at ${store}/.well-known/regmark.txt
    3. REGMARK_OWNERSHIP_TOKEN=<token> regmark audit --checkout

  Every option: ${DOCS}/configuration.md

`);
  return 0;
}

type Outputs = { json?: string; sarif?: string; junit?: string; html?: string; markdown?: string };

async function writeReports(result: AuditResult, files: Outputs): Promise<void> {
  const renderers: Array<[string | undefined, () => string]> = [
    [files.json, () => renderJson(result)],
    [files.sarif, () => renderSarif(result)],
    [files.junit, () => renderJUnit(result)],
    [files.html, () => renderHtml(result)],
    [files.markdown, () => renderMarkdown(result)],
  ];
  for (const [file, render] of renderers) {
    if (file) await writeFile(file, render());
  }
}

/** A run against the shop that ships inside the tool: the fastest way to see what a report looks like. */
async function demo(clean: boolean, html: string | undefined, color: boolean): Promise<number> {
  const { OWNERSHIP_TOKEN, startShop } = await import('@regmark/fixture-shop');
  const shop = await startShop({ mode: clean ? 'clean' : 'misprint' });
  const planted = shop.shop.defects.length;
  let result: AuditResult;
  try {
    result = await runAudit(
      {
        store: shop.origin,
        feed: '/feeds/google.xml',
        platform: 'woocommerce',
        checkout: { shipTo: { country: 'US', postcode: '94103' } },
        cloaking: true,
        ownershipToken: OWNERSHIP_TOKEN,
        maxAge: { feed: '24h' },
        sample: 50,
        fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
      },
      { version: await version() },
    );
  } finally {
    await shop.close();
  }
  // The shop ran on a local port; give it a name a reader can keep in mind.
  const named = JSON.parse(
    JSON.stringify(result)
      .replaceAll(shop.origin, 'https://demo-shop.example')
      .replaceAll(new URL(shop.origin).host, 'demo-shop.example'),
  ) as AuditResult;

  out(renderTerminal(named, { color }));
  const file = html ?? 'regmark-demo.html';
  await writeFile(file, renderHtml(named));
  out(
    clean
      ? `  That was the same shop with nothing wrong in it: every surface agrees with the checkout.\n`
      : `  That was a shop bundled with Regmark, with ${planted} defects planted in it. Each one is a\n  way real shops go wrong; run  regmark explain price.mismatch  to read about one.\n`,
  );
  out(`\n  The full report is in ${file}\n  Now a real one:  regmark audit https://your-shop.example\n\n`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      feed: { type: 'string' },
      'acp-feed': { type: 'string' },
      platform: { type: 'string' },
      ucp: { type: 'boolean' },
      mcp: { type: 'boolean' },
      checkout: { type: 'boolean' },
      cloaking: { type: 'boolean' },
      'max-age': { type: 'string', multiple: true },
      'ship-to': { type: 'string' },
      page: { type: 'string', multiple: true },
      sample: { type: 'string' },
      seed: { type: 'string' },
      datum: { type: 'string' },
      budget: { type: 'string', multiple: true },
      strict: { type: 'boolean' },
      json: { type: 'string' },
      sarif: { type: 'string' },
      junit: { type: 'string' },
      html: { type: 'string' },
      markdown: { type: 'string' },
      quiet: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      verbose: { type: 'boolean' },
      config: { type: 'string' },
      interval: { type: 'string' },
      'allow-private-network': { type: 'boolean' },
      clean: { type: 'boolean' },
      version: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.version) {
    out(`${await version()}\n`);
    return 0;
  }
  const [command, target] = positionals;
  if (values.help) {
    out(USAGE);
    return 0;
  }
  if (!command) {
    // Asked for nothing: that is a mistake, so the usage goes where mistakes go.
    note(USAGE);
    return 2;
  }
  // FORCE_COLOR is the usual way to ask for colour when output is not a terminal, as in a CI log.
  const color = !values['no-color'] && !process.env.NO_COLOR && (process.stdout.isTTY === true || Boolean(process.env.FORCE_COLOR));

  if (command === 'rules') {
    const width = Math.max(...allRules.map((r) => r.id.length));
    for (const r of allRules) out(`${r.id.padEnd(width)}  ${r.severity.padEnd(5)}  ${r.summary}\n`);
    return 0;
  }
  if (command === 'explain') return explain(target);
  if (command === 'init') return init(target);
  if (command === 'demo') return demo(values.clean === true, values.html, color);
  if (command !== 'audit') throw new ConfigError(`unknown command "${command}"; try regmark --help`);

  const configFile = values.config ?? (existsSync('regmark.config.json') ? 'regmark.config.json' : undefined);
  const fromFile = configFile ? await loadConfig(configFile) : {};
  const store = target ?? fromFile.store;
  if (!store) throw new ConfigError('which shop? regmark audit <store-url>');
  const platforms = ['woocommerce', 'shopify', 'auto', 'none'];
  // The file may say "none" too, which the audit itself spells as no platform at all.
  const platformChoice: string = values.platform ?? fromFile.platform ?? 'auto';
  if (!platforms.includes(platformChoice)) {
    throw new ConfigError(`unknown platform "${platformChoice}"; choose one of ${platforms.join(', ')}`);
  }
  // Checked even without --checkout: a mistyped flag should not pass silently.
  const shipTo = values['ship-to'] ? parseShipTo(values['ship-to']) : undefined;
  const checkout = values.checkout || fromFile.checkout !== undefined;

  const config: AuditConfig = {
    ...fromFile,
    store,
    platform: platformChoice === 'none' ? undefined : (platformChoice as AuditConfig['platform']),
    ...(values.feed ? { feed: values.feed } : {}),
    ...(values['acp-feed'] ? { acpFeed: values['acp-feed'] } : {}),
    ...(values.ucp ? { ucp: fromFile.ucp || true } : {}),
    ...(values.mcp ? { mcp: fromFile.mcp || true } : {}),
    ...(values.cloaking ? { cloaking: fromFile.cloaking || true } : {}),
    ...(values['max-age']?.length ? { maxAge: { ...fromFile.maxAge, ...parseMaxAge(values['max-age']) } } : {}),
    ...(checkout ? { checkout: { shipTo: shipTo ?? fromFile.checkout?.shipTo ?? { country: 'US' } } } : {}),
    ...(values.page?.length ? { pages: values.page } : {}),
    ...(values.sample ? { sample: wholeNumber('--sample', values.sample) } : {}),
    ...(values.seed ? { seed: wholeNumber('--seed', values.seed) } : {}),
    ...(values.strict ? { strict: true } : {}),
    ...(values.datum ? { datum: values.datum.split(',').map((s) => s.trim()) as Surface[] } : {}),
    ...(values.budget?.length ? { budget: { ...fromFile.budget, ...parseBudget(values.budget) } } : {}),
    // An empty variable is what a CI job passes when the secret is not set; it must not blank out the file's token.
    ownershipToken: process.env.REGMARK_OWNERSHIP_TOKEN || fromFile.ownershipToken,
    fetch: {
      ...fromFile.fetch,
      ...(values.interval ? { minIntervalMs: wholeNumber('--interval', values.interval) } : {}),
      ...(values['allow-private-network'] ? { allowPrivateNetwork: true } : {}),
    },
  };

  // An audit paces itself at a request a second, so a minute of silence is
  // normal. On a terminal, say what is happening; in a pipe, say nothing
  // unless asked.
  const progress = values.verbose || (process.stderr.isTTY === true && !values.quiet);
  const result = await runAudit(config, {
    version: await version(),
    log: progress ? (level, message) => (level === 'debug' && !values.verbose ? undefined : note(dim(`  ${message}\n`))) : undefined,
  });

  await writeReports(result, values);
  if (config.strict && result.issues.length > 0) {
    if (!values.quiet) out(renderTerminal(result, { color }));
    note(`regmark: strict audit incomplete: ${result.issues.length} collection issue(s); inspect the report before trusting this run\n`);
    return 2;
  }
  if (result.counts.products === 0) {
    // Every rule is within budget when there is nothing to check. Calling that a pass would be a lie.
    if (!values.quiet) out(renderTerminal(result, { color }));
    note(`regmark: no product could be read from ${new URL(result.store).host}, so nothing was checked\n`);
    note('  Name a product page with --page <url>, or the platform with --platform, and look at the collection issues.\n');
    return 2;
  }
  if (!values.quiet) {
    out(renderTerminal(result, { color }));
    if (result.findings.length > 0) out(`  Usual cause and fix for a rule:  regmark explain ${result.findings[0]!.rule}\n\n`);
  }
  return result.ok ? 0 : 1;
}

// `regmark audit … | head` closes the pipe early. That is not an error worth a stack trace.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`regmark: ${message}\n`);
    process.exitCode = 2;
  },
);
