#!/usr/bin/env node
// The command line. It turns flags into a config, runs the audit, prints the
// summary, writes any report files asked for, and sets the exit code. All the
// judgement lives in runAudit; nothing here decides what a finding is.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { renderHtml, renderJson, renderJUnit, renderSarif, renderTerminal } from '@regmark/report';
import { allRules } from '@regmark/rules';
import type { Surface } from '@regmark/core';
import { ConfigError, runAudit } from './audit.ts';
import type { AuditConfig } from './audit.ts';

const USAGE = `regmark: check that what a shop tells machines matches what its checkout charges

Usage
  regmark audit <store-url> [options]
  regmark rules
  regmark --version

Surfaces
  --feed <url>              product feed in Google Merchant format
  --platform <name>         read the catalogue from the storefront API: woocommerce or shopify
  --checkout                run the checkout probe (woocommerce; needs an ownership token)
  --ship-to <CC[:postcode]> destination for the checkout probe, default US
  --page <url>              audit this product page; repeatable

Scope
  --sample <n>              how many products to audit, default 25
  --seed <n>                changes which products are sampled, default 1
  --datum <a,b,c>           which surface to believe, most trusted first
  --budget <rule=n>         allow up to n findings for a rule; repeatable

Output
  --json <file>   --sarif <file>   --junit <file>   --html <file>
  --quiet                   do not print the summary
  --no-color
  --verbose                 progress on stderr

Other
  --config <file>           JSON, or a module with a default export
  --interval <ms>           gap between requests to one host, default 1000
  --allow-private-network   for a shop on your own machine or network

The ownership token is read from REGMARK_OWNERSHIP_TOKEN. Put the line
regmark-verify=<token> in /.well-known/regmark.txt on the shop.

Exit code: 0 within budget, 1 budget exceeded, 2 the audit could not run.
`;

async function version(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

async function loadConfig(file: string): Promise<Partial<AuditConfig>> {
  const abs = path.resolve(file);
  if (abs.endsWith('.json')) return JSON.parse(await readFile(abs, 'utf8')) as Partial<AuditConfig>;
  const mod = (await import(pathToFileURL(abs).href)) as { default?: Partial<AuditConfig> };
  if (!mod.default || typeof mod.default !== 'object') throw new ConfigError(`${file} has no default export`);
  return mod.default;
}

function parseShipTo(text: string): { country: string; postcode?: string } {
  const [country = '', postcode] = text.split(':');
  if (!/^[A-Za-z]{2}$/.test(country)) throw new ConfigError(`--ship-to wants a two-letter country code, got "${text}"`);
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

const wholeNumber = (flag: string, text: string): number => {
  if (!/^\d+$/.test(text)) throw new ConfigError(`${flag} wants a whole number, got "${text}"`);
  return Number(text);
};

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      feed: { type: 'string' },
      platform: { type: 'string' },
      checkout: { type: 'boolean' },
      'ship-to': { type: 'string' },
      page: { type: 'string', multiple: true },
      sample: { type: 'string' },
      seed: { type: 'string' },
      datum: { type: 'string' },
      budget: { type: 'string', multiple: true },
      json: { type: 'string' },
      sarif: { type: 'string' },
      junit: { type: 'string' },
      html: { type: 'string' },
      quiet: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      verbose: { type: 'boolean' },
      config: { type: 'string' },
      interval: { type: 'string' },
      'allow-private-network': { type: 'boolean' },
      version: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.version) {
    process.stdout.write(`${await version()}\n`);
    return 0;
  }
  const [command, target] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 2;
  }
  if (command === 'rules') {
    const width = Math.max(...allRules.map((r) => r.id.length));
    for (const r of allRules) process.stdout.write(`${r.id.padEnd(width)}  ${r.severity.padEnd(5)}  ${r.summary}\n`);
    return 0;
  }
  if (command !== 'audit') throw new ConfigError(`unknown command "${command}"; try regmark --help`);

  const fromFile = values.config ? await loadConfig(values.config) : {};
  const store = target ?? fromFile.store;
  if (!store) throw new ConfigError('which shop? regmark audit <store-url>');
  if (values.platform && values.platform !== 'woocommerce' && values.platform !== 'shopify') throw new ConfigError(`unknown platform "${values.platform}"; this release supports woocommerce and shopify`);

  const config: AuditConfig = {
    ...fromFile,
    store,
    ...(values.feed ? { feed: values.feed } : {}),
    ...(values.platform ? { platform: values.platform as 'woocommerce' | 'shopify' } : {}),
    ...(values.checkout ? { checkout: { shipTo: parseShipTo(values['ship-to'] ?? 'US') } } : {}),
    ...(values.page?.length ? { pages: values.page } : {}),
    ...(values.sample ? { sample: wholeNumber('--sample', values.sample) } : {}),
    ...(values.seed ? { seed: wholeNumber('--seed', values.seed) } : {}),
    ...(values.datum ? { datum: values.datum.split(',').map((s) => s.trim()) as Surface[] } : {}),
    ...(values.budget?.length ? { budget: { ...fromFile.budget, ...parseBudget(values.budget) } } : {}),
    ownershipToken: process.env.REGMARK_OWNERSHIP_TOKEN ?? fromFile.ownershipToken,
    fetch: {
      ...fromFile.fetch,
      ...(values.interval ? { minIntervalMs: wholeNumber('--interval', values.interval) } : {}),
      ...(values['allow-private-network'] ? { allowPrivateNetwork: true } : {}),
    },
  };

  const result = await runAudit(config, {
    version: await version(),
    log: values.verbose ? (level, message) => process.stderr.write(`[${level}] ${message}\n`) : undefined,
  });

  const files: Array<[string | undefined, () => string]> = [
    [values.json, () => renderJson(result)],
    [values.sarif, () => renderSarif(result)],
    [values.junit, () => renderJUnit(result)],
    [values.html, () => renderHtml(result)],
  ];
  for (const [file, render] of files) {
    if (file) await writeFile(file, render());
  }
  if (!values.quiet) {
    const color = !values['no-color'] && !process.env.NO_COLOR && process.stdout.isTTY === true;
    process.stdout.write(renderTerminal(result, { color }));
  }
  return result.ok ? 0 : 1;
}

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
