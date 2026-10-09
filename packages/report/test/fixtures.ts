import type { AuditResult, CollectIssue, Finding, RuleSummary } from '@regmark/core';

export const STARTED = '2026-10-09T10:00:00.000Z';

export function audit(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    schema: 'regmark.audit/v0',
    tool: { name: 'regmark', version: '0.1.0' },
    store: 'https://shop.example',
    startedAt: STARTED,
    finishedAt: '2026-10-09T10:02:41.000Z',
    datum: ['checkout', 'platform', 'page'],
    surfaces: ['page', 'jsonld', 'feed', 'checkout'],
    counts: { products: 12, variants: 48 },
    rules: [],
    findings: [],
    issues: [],
    ok: true,
    ...overrides,
  };
}

const PASSED_IDS = [
  'title.match',
  'description.hidden',
  'image.present',
  'gtin.present',
  'sku.unique',
  'variant.count',
  'page.reachable',
  'opengraph.price',
  'return.policy',
];

/** Mirrors the brief's example: two error rules over budget, one warn, nine passed, two skipped, one issue. */
export function richResult(overrides: Partial<AuditResult> = {}): AuditResult {
  const rules: RuleSummary[] = [
    { id: 'price.mismatch', severity: 'error', summary: 'Price agrees with checkout', findings: 2, budget: 0, passed: false },
    {
      id: 'availability.mismatch',
      severity: 'error',
      summary: 'Availability agrees with platform',
      findings: 1,
      budget: 0,
      passed: false,
    },
    {
      id: 'shipping.undisclosed',
      severity: 'warn',
      summary: 'Shipping cost is stated somewhere',
      findings: 1,
      budget: null,
      passed: true,
    },
    ...PASSED_IDS.map(
      (id): RuleSummary => ({ id, severity: 'error', summary: 'Checked', findings: 0, budget: 0, passed: true }),
    ),
    {
      id: 'shipping.mismatch',
      severity: 'error',
      summary: 'Shipping agrees with checkout',
      findings: 0,
      budget: 0,
      passed: true,
      skipped: 'needs checkout',
    },
    {
      id: 'variant.unpurchasable',
      severity: 'error',
      summary: 'Every variant can be bought',
      findings: 0,
      budget: 0,
      passed: true,
      skipped: 'needs checkout',
    },
  ];

  const findings: Finding[] = [
    {
      rule: 'price.mismatch',
      severity: 'error',
      message: 'jsonld price differs from checkout',
      product: 'tee',
      variant: 'TEE-BLU-M',
      surface: 'jsonld',
      expected: {
        surface: 'checkout',
        value: '39.00 USD',
        raw: '39.00',
        locator: 'https://shop.example/cart#line[0]/total',
      },
      actual: {
        surface: 'jsonld',
        value: '35.00 USD',
        raw: '35.00',
        locator: 'https://shop.example/p/tee/#jsonld[0]/offers/2/price',
      },
    },
    {
      rule: 'price.mismatch',
      severity: 'error',
      message: 'feed price differs from platform',
      product: 'tote',
      variant: 'TOTE-NAT',
      surface: 'feed',
      expected: {
        surface: 'platform',
        value: '24.00 USD',
        raw: '24.00',
        locator: 'https://shop.example/api/variants/TOTE-NAT#price',
      },
      actual: {
        surface: 'feed',
        value: '22.00 USD',
        raw: '22.00',
        locator: 'https://shop.example/feeds/google.xml#item[id="TOTE-NAT"]/price',
      },
    },
    {
      rule: 'availability.mismatch',
      severity: 'error',
      message: 'feed availability differs from platform',
      product: 'beanie',
      variant: 'BEANIE-NVY',
      surface: 'feed',
      expected: {
        surface: 'platform',
        value: 'out_of_stock',
        raw: 'sold_out',
        locator: 'https://shop.example/api/variants/BEANIE-NVY#stock',
      },
      actual: {
        surface: 'feed',
        value: 'in_stock',
        raw: 'in stock',
        locator: 'https://shop.example/feeds/google.xml#item[id="BEANIE-NVY"]/availability',
      },
    },
    {
      rule: 'shipping.undisclosed',
      severity: 'warn',
      message: 'no surface states a shipping cost; checkout charges 6.20 USD',
      product: 'enamel-mug',
    },
  ];

  const issues: CollectIssue[] = [
    { surface: 'microdata', code: 'parse-error', message: 'unclosed tag at line 40' },
  ];

  return audit({ rules, findings, issues, ok: false, ...overrides });
}

/** A single error finding with the given evidence, for one-off checks. */
export function singleFinding(finding: Partial<Finding>, overrides: Partial<AuditResult> = {}): AuditResult {
  const base: Finding = {
    rule: 'price.mismatch',
    severity: 'error',
    message: 'something differs',
    product: 'mug',
    ...finding,
  };
  const rule: RuleSummary = {
    id: base.rule,
    severity: base.severity,
    summary: 'one rule',
    findings: 1,
    budget: 0,
    passed: false,
  };
  return audit({ rules: [rule], findings: [base], ok: false, ...overrides });
}
