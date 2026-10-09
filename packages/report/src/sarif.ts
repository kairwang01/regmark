import type { AuditResult } from '@regmark/core';
import { artifactUri, collectionFailure, findingSentence, nothingRead, primaryEvidence, sarifLevel } from './shared.ts';

const INFORMATION_URI = 'https://opensource.kairwang.cloud/regmark/';

export function renderSarif(result: AuditResult): string {
  const collection = collectionFailure(result);
  const notifications = result.issues.map((issue) => ({
    descriptor: { id: issue.code },
    level: collection ? 'error' : 'warning',
    message: { text: `${issue.surface}: ${issue.message}` },
    properties: { surface: issue.surface, ...(issue.locator ? { locator: issue.locator } : {}) },
  }));
  const rules = result.rules.map((rule) => ({
    id: rule.id,
    shortDescription: { text: rule.summary },
    // Shown by GitHub beside the alert: why this usually happens and what to change.
    ...(rule.help ? { help: { text: rule.help } } : {}),
    helpUri: `https://github.com/kairwang01/regmark/blob/main/docs/rules.md#${rule.id.replace(/\./g, '')}-${rule.severity}`,
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
        // Escape delimiters within identities so "a|b", "c" and "a", "b|c"
        // cannot collapse two unrelated alerts into one fingerprint.
        'regmark/v1': [finding.rule, finding.product, finding.variant ?? '', finding.surface ?? '']
          .map((part) => part.replace(/%/g, '%25').replace(/\|/g, '%7C'))
          .join('|'),
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
        invocations: [{
          executionSuccessful: collection === undefined,
          toolExecutionNotifications: [
            ...notifications,
            ...(nothingRead(result) ? [{ descriptor: { id: 'nothing-read' }, level: 'error', message: { text: collection! } }] : []),
          ],
        }],
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
