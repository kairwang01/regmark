import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSarif } from '../src/index.ts';
import { audit, richResult, singleFinding } from './fixtures.ts';

type SarifResult = {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: { physicalLocation: { artifactLocation: { uri: string } } }[];
  partialFingerprints: Record<string, string>;
  properties: Record<string, string>;
};

function parse(result: Parameters<typeof renderSarif>[0]) {
  const log = JSON.parse(renderSarif(result));
  const run = log.runs[0];
  return { log, run, results: run.results as SarifResult[] };
}

test('SARIF parses, declares version 2.1.0 and the schema, and has one run', () => {
  const { log } = parse(richResult());
  assert.equal(log.version, '2.1.0');
  assert.equal(log.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
  assert.equal(log.runs.length, 1);
  assert.equal(log.runs[0].tool.driver.name, 'Regmark');
  assert.equal(log.runs[0].tool.driver.version, '0.1.0');
  assert.equal(log.runs[0].tool.driver.informationUri, 'https://opensource.kairwang.cloud/regmark/');
});

test('SARIF rules list every rule with mapped default levels', () => {
  const { run } = parse(richResult());
  assert.deepEqual(
    run.tool.driver.rules.map((r: { id: string }) => r.id),
    richResult().rules.map((r) => r.id),
  );
  const byId = Object.fromEntries(run.tool.driver.rules.map((r: { id: string }) => [r.id, r]));
  assert.equal(byId['price.mismatch'].defaultConfiguration.level, 'error');
  assert.equal(byId['shipping.undisclosed'].defaultConfiguration.level, 'warning');
  assert.equal(byId['price.mismatch'].shortDescription.text, 'Price agrees with checkout');
});

test('SARIF info severity maps to note', () => {
  const { results, run } = parse(
    singleFinding({ rule: 'x.note', severity: 'info', message: 'fyi' }, {
      rules: [{ id: 'x.note', severity: 'info', summary: 's', findings: 1, budget: null, passed: true }],
      ok: true,
    }),
  );
  assert.equal(results[0]!.level, 'note');
  assert.equal(run.tool.driver.rules[0].defaultConfiguration.level, 'note');
});

test('SARIF has one result per finding with the mapped level', () => {
  const { results } = parse(richResult());
  assert.equal(results.length, richResult().findings.length);
  assert.deepEqual(
    results.map((r) => [r.ruleId, r.level]),
    [
      ['price.mismatch', 'error'],
      ['price.mismatch', 'error'],
      ['availability.mismatch', 'error'],
      ['shipping.undisclosed', 'warning'],
    ],
  );
});

test('SARIF artifact uri is the locator of actual with the fragment removed', () => {
  const { results } = parse(richResult());
  assert.equal(results[0]!.locations[0]!.physicalLocation.artifactLocation.uri, 'https://shop.example/p/tee/');
  assert.equal(results[1]!.locations[0]!.physicalLocation.artifactLocation.uri, 'https://shop.example/feeds/google.xml');
  for (const r of results) {
    assert.equal(r.locations[0]!.physicalLocation.artifactLocation.uri.includes('#'), false);
  }
});

test('SARIF falls back to expected locator, then to the store, when there is no evidence', () => {
  const expectedOnly = parse(
    singleFinding({
      message: 'm',
      expected: { surface: 'checkout', value: '1', raw: '1', locator: 'https://shop.example/cart#t' },
    }),
  );
  assert.equal(
    expectedOnly.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri,
    'https://shop.example/cart',
  );

  const none = parse(singleFinding({ message: 'm' }));
  assert.equal(none.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri, 'https://shop.example');
  assert.equal('locator' in none.results[0]!.properties, false);
});

test('SARIF properties carry the full locator and the product, variant and surface when present', () => {
  const { results } = parse(richResult());
  assert.deepEqual(results[0]!.properties, {
    locator: 'https://shop.example/p/tee/#jsonld[0]/offers/2/price',
    product: 'tee',
    variant: 'TEE-BLU-M',
    surface: 'jsonld',
  });
  const warn = results[3]!;
  assert.deepEqual(warn.properties, { product: 'enamel-mug' });
});

test('SARIF fingerprints are stable across runs and ignore values', () => {
  const first = parse(richResult()).results.map((r) => r.partialFingerprints['regmark/v1']);
  const second = parse(richResult()).results.map((r) => r.partialFingerprints['regmark/v1']);
  assert.deepEqual(first, second);
  assert.equal(first[0], 'price.mismatch|tee|TEE-BLU-M|jsonld');
  assert.equal(first[3], 'shipping.undisclosed|enamel-mug||');
});

test('SARIF message text uses the comparison form when both sides exist', () => {
  const { results } = parse(richResult());
  assert.equal(results[0]!.message.text, 'TEE-BLU-M: jsonld says 35.00 USD, checkout says 39.00 USD');
});

test('SARIF message text uses the plain form otherwise', () => {
  const { results } = parse(richResult());
  assert.equal(results[3]!.message.text, 'enamel-mug: no surface states a shipping cost; checkout charges 6.20 USD');
});

test('SARIF output ends with a newline and is two-space indented', () => {
  const out = renderSarif(audit());
  assert.ok(out.endsWith('}\n'));
  assert.ok(out.includes('\n  "version": "2.1.0"'));
});
