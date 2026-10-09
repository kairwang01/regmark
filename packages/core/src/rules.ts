// Running rules over a graph, and the handful of helpers every rule needs.

import { formatMoney } from './money.ts';
import type {
  Availability,
  Evidence,
  Finding,
  Money,
  Observation,
  OfferGraph,
  Rule,
  RuleContext,
  RuleSummary,
  Severity,
  Surface,
} from './types.ts';

/** Identity function that exists for the type checking and the call-site clarity. */
export function defineRule(rule: Rule): Rule {
  return rule;
}

/** The observation from the most trusted surface in `order`, or undefined when none of them spoke. */
export function pickDatum<T>(observations: readonly Observation<T>[], order: readonly Surface[]): Observation<T> | undefined {
  for (const surface of order) {
    const hit = observations.find((o) => o.surface === surface);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Whether a buyer could get the item by ordering now. Pre-order and
 * back-order count as yes. Returns null for 'unknown', which a rule must
 * treat as "no statement", not as a disagreement.
 */
export function isBuyable(a: Availability): boolean | null {
  if (a === 'unknown') return null;
  return a === 'in_stock' || a === 'preorder' || a === 'backorder';
}

export function evidence<T>(o: Observation<T>, display: string): Evidence {
  return { surface: o.surface, value: display, raw: o.raw, locator: o.locator };
}

export const moneyEvidence = (o: Observation<Money>): Evidence => evidence(o, formatMoney(o.value));

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { error: 0, warn: 1, info: 2 };

export type RunOptions = {
  datum: readonly Surface[];
  /** Rule id to the largest finding count that still passes. Overrides the default. */
  budget?: Readonly<Record<string, number>>;
  now?: Date;
};

export type RunResult = { findings: Finding[]; rules: RuleSummary[]; ok: boolean };

/**
 * Default budgets: an error rule fails the run on its first finding; warn
 * and info rules never fail it. A shop adopting the tool can set a rule's
 * budget to its current count and ratchet it down from there.
 */
function defaultBudget(severity: Severity): number | null {
  return severity === 'error' ? 0 : null;
}

export function runRules(graph: OfferGraph, rules: readonly Rule[], options: RunOptions): RunResult {
  const collected = new Set(graph.surfaces);
  const ctx: RuleContext = {
    datum: options.datum,
    collected,
    graph,
    now: options.now ?? new Date(),
    pick: (observations) => pickDatum(observations, options.datum),
  };

  const findings: Finding[] = [];
  const summaries: RuleSummary[] = [];
  for (const rule of rules) {
    const budget = options.budget?.[rule.id] ?? defaultBudget(rule.severity);
    const base = { id: rule.id, severity: rule.severity, summary: rule.summary, ...(rule.help ? { help: rule.help } : {}), budget };
    const missingAll = (rule.needsAll ?? []).filter((s) => !collected.has(s));
    const missingAny = rule.needsAny && !rule.needsAny.some((s) => collected.has(s));
    if (missingAll.length || missingAny) {
      const need = missingAll.length ? missingAll.join(', ') : `one of ${rule.needsAny!.join(', ')}`;
      summaries.push({ ...base, findings: 0, passed: true, skipped: `needs ${need}` });
      continue;
    }
    const own = graph.products.flatMap((p) => rule.check(p, ctx));
    // A rule reports under its own id and severity, whatever it filled in.
    for (const f of own) findings.push({ ...f, rule: rule.id, severity: rule.severity });
    summaries.push({ ...base, findings: own.length, passed: budget === null || own.length <= budget });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.rule.localeCompare(b.rule) ||
      a.product.localeCompare(b.product) ||
      (a.variant ?? '').localeCompare(b.variant ?? '') ||
      (a.surface ?? '').localeCompare(b.surface ?? ''),
  );
  return { findings, rules: summaries, ok: summaries.every((s) => s.passed) };
}
