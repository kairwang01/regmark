import type { AuditResult } from '@regmark/core';
import { artifactUri, findingSentence, primaryEvidence, sarifLevel } from './shared.ts';

const INFORMATION_URI = 'https://opensource.kairwang.cloud/regmark/';

export function renderSarif(result: AuditResult): string {
  const rules = result.rules.map((rule) => ({
    id: rule.id,
    shortDescription: { text: rule.summary },
    defaultConfiguration: { level: sarifLevel(rule.severity) },
  }));

  const results = result.findings.map((finding) => {
    const evidence = primaryEvidence(finding);
    const properties: Record<string, string> = {};
    if (evidence) properties.locator = evidence.locator;
    properties.product = finding.product;
    if (finding.variant !== undefined) properties.variant = finding.variant;
    if (finding.surface !== undefined) properties.surface = finding.surface;

    return {
      ruleId: finding.rule,
      level: sarifLevel(finding.severity),
      message: { text: findingSentence(finding) },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: evidence ? artifactUri(evidence.locator) : result.store },
          },
        },
      ],
      // Deliberately leaves out the values: a price change should not look like a new finding.
      partialFingerprints: {
        'regmark/v1': `${finding.rule}|${finding.product}|${finding.variant ?? ''}|${finding.surface ?? ''}`,
      },
      properties,
    };
  });

  const log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Regmark',
            version: result.tool.version,
            informationUri: INFORMATION_URI,
            rules,
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
