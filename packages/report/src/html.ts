// The report a person opens: one self-contained HTML file, no scripts, no
// external requests, readable in a mail attachment or a CI artifact viewer.
//
// It is laid out as a press proof. The verdict is printed in four plates: when
// the shop's surfaces disagree the plates sit out of register and the headline
// is visibly doubled; when they agree it prints clean. Each finding then shows
// the two statements side by side, tagged with the plate each came from.
//
// Every string that came from the audited shop is untrusted and is escaped on
// the way in. Locators become links only when they are plain http(s) URLs.

import { PLATE_OF } from '@regmark/core';
import type { AuditResult, Evidence, Finding, Plate, RuleSummary, Surface } from '@regmark/core';
import { collectionFailure, durationMs, nothingRead, subjectOf } from './shared.ts';

const esc = (s: unknown): string =>
  String(s)
    // Control characters have no business in a report and some are not legal in HTML.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, noun: string): string => `${n} ${n === 1 ? noun : `${noun}s`}`;

function duration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

function host(store: string): string {
  try {
    return new URL(store).host;
  } catch {
    return store;
  }
}

const PLATES: readonly Plate[] = ['C', 'M', 'Y', 'K'];
const PLATE_NAME: Readonly<Record<Plate, string>> = { C: 'Page', M: 'Feed', Y: 'Protocol', K: 'Checkout' };
const PLATE_NOTE: Readonly<Record<Plate, string>> = {
  C: 'what the product page shows and embeds',
  M: 'what the merchant feed lists',
  Y: 'what agent protocol endpoints return',
  K: 'what the shop charges: the key plate',
};

const chip = (plate: Plate): string => `<span class="chip chip-${plate.toLowerCase()}">${plate}</span>`;
const plateOf = (surface: Surface): Plate => PLATE_OF[surface] ?? 'C';

function locator(text: string): string {
  const shown = esc(clip(text, 240));
  const hash = text.indexOf('#');
  const url = hash === -1 ? text : text.slice(0, hash);
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return `<span class="loc">${shown}</span>`;
  return `<a class="loc" href="${esc(url)}" rel="noopener noreferrer nofollow">${shown}</a>`;
}

function says(e: Evidence, role: 'actual' | 'expected'): string {
  const plate = plateOf(e.surface);
  return `<div class="says says-${role}">
  <p class="who">${chip(plate)}<span>${esc(e.surface)}</span></p>
  <p class="value">${esc(clip(e.value, 200))}</p>
  ${locator(e.locator)}
</div>`;
}

function finding(f: Finding): string {
  const subject = `<p class="subject">${esc(clip(subjectOf(f), 120))}</p>`;
  if (f.expected && f.actual) {
    return `<li class="proof">${subject}<div class="pair">${says(f.actual, 'actual')}<p class="neq" aria-label="does not match">≠</p>${says(f.expected, 'expected')}</div></li>`;
  }
  const only = f.actual ?? f.expected;
  return `<li class="proof">${subject}<div class="single"><p class="message">${esc(clip(f.message, 400))}</p>${only ? locator(only.locator) : ''}</div></li>`;
}

type Status = 'fail' | 'flag' | 'pass' | 'skip';
const statusOf = (r: RuleSummary): Status => (r.skipped !== undefined ? 'skip' : !r.passed ? 'fail' : r.findings > 0 ? 'flag' : 'pass');
const STATUS_MARK: Readonly<Record<Status, string>> = { fail: '✗', flag: '!', pass: '✓', skip: '–' };
const STATUS_WORD: Readonly<Record<Status, string>> = { fail: 'over budget', flag: 'within budget', pass: 'clean', skip: 'not run' };

function ruleRow(r: RuleSummary): string {
  const status = statusOf(r);
  const count = r.skipped !== undefined ? '' : String(r.findings);
  const budget = r.skipped !== undefined ? esc(r.skipped) : r.budget === null ? 'no limit' : `limit ${r.budget}`;
  const id = r.findings > 0 ? `<a href="#rule-${esc(r.id)}">${esc(r.id)}</a>` : esc(r.id);
  return `<tr class="is-${status}">
  <td class="mark" title="${STATUS_WORD[status]}"><span aria-hidden="true">${STATUS_MARK[status]}</span><span class="vh">${STATUS_WORD[status]}</span></td>
  <td class="id">${id}</td>
  <td class="what">${esc(r.summary)}</td>
  <td class="num">${count}</td>
  <td class="budget">${budget}</td>
</tr>`;
}

const CSS = `
:root{--paper:#eaeeec;--surface:#f4f7f5;--rule:#c5cfcd;--rule-2:#9fadab;--text:#121a1e;--text-2:#364247;--muted:#546064;--ink:#21355c;
--c:#087a96;--m:#c2256e;--y:#e9b800;--y-line:#9a7400;--k:#121a1e;--on:#fff;--blend:multiply;--bad:#a8281e;--ok:#17694f;
--sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--cond:"IBM Plex Sans Condensed","Arial Narrow","Helvetica Neue",var(--sans);
--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--paper:#091420;--surface:#0e1c2b;--rule:#263a4f;--rule-2:#3d5872;--text:#dee9f0;--text-2:#b2c5d4;--muted:#8da2b4;--ink:#7ab2d6;
--c:#3fc3e3;--m:#f2679f;--y:#f0cb45;--y-line:#f0cb45;--k:#dee9f0;--on:#091420;--blend:screen;--bad:#f08a7c;--ok:#5fc9a3}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--text);font:400 16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
.sheet{max-width:62rem;margin:0 auto;padding:0 clamp(1rem,4vw,2.5rem) 4rem;overflow-wrap:anywhere}
a{color:var(--ink);text-underline-offset:.18em;text-decoration-thickness:1px}
h1,h2,h3{font-family:var(--cond);font-weight:600;line-height:1.2;margin:0}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.label{font:500 .72rem/1.4 var(--mono);color:var(--muted);margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:2rem;flex-wrap:wrap;padding:1.1rem 0;border-bottom:1px solid var(--rule-2)}
.head>*{min-width:0;max-width:100%}
.brand{display:flex;align-items:center;gap:.6rem;font:600 1.05rem/1 var(--cond)}
.brand svg{width:1.5rem;height:1.5rem;color:var(--ink)}
.brand span{font:500 .72rem/1 var(--mono);color:var(--muted);margin-left:.4rem}
.meta{display:flex;gap:2rem;flex-wrap:wrap;margin:0}
.meta>div{min-width:0;max-width:100%}
.meta dt{font:500 .68rem/1.4 var(--mono);color:var(--muted)}
.meta dd{margin:0;font-size:.9rem;overflow-wrap:anywhere}
.verdict{padding:3rem 0 2.2rem;border-bottom:2px solid var(--text)}
.press{position:relative;display:inline-block;max-width:100%;isolation:isolate;font:600 clamp(2.6rem,9vw,5.2rem)/1 var(--cond);letter-spacing:.005em}
.press span{display:block;mix-blend-mode:var(--blend)}
.press .pc,.press .pm,.press .py{position:absolute;inset:0}
.press .pc{color:var(--c)}.press .pm{color:var(--m)}.press .py{color:var(--y)}.press .pk{color:var(--k);position:relative}
.out .press .pc{transform:translate(-.085em,-.05em)}
.out .press .pm{transform:translate(.075em,-.035em)}
.out .press .py{transform:translate(-.03em,.075em)}
.verdict p{max-width:44rem;margin:1.4rem 0 0;color:var(--text-2);font-size:1.08rem}
.verdict b{color:var(--text);font-weight:600}
.plates{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-bottom:1px solid var(--rule-2)}
.plate{padding:1rem 1rem 1.1rem 0;border-right:1px solid var(--rule)}
.plate+.plate{padding-left:1rem}
.plate:last-child{border-right:0}
.plate h3{display:flex;align-items:center;gap:.5rem;font:600 .98rem/1.2 var(--sans)}
.plate .note{margin:.35rem 0 .6rem;color:var(--muted);font-size:.82rem;line-height:1.45}
.plate ul{list-style:none;margin:0;padding:0;font:500 .8rem/1.7 var(--mono)}
.plate.none ul{color:var(--muted)}
.chip{display:inline-grid;place-items:center;width:1.45em;height:1.45em;font:600 .72em/1 var(--mono);color:var(--on);background:var(--k);flex:none}
.chip-c{background:var(--c)}.chip-m{background:var(--m)}.chip-y{background:var(--y);color:#121a1e;box-shadow:inset 0 0 0 1px var(--y-line)}.chip-k{background:var(--k)}
section>h2{font-size:1.3rem;margin:2.8rem 0 .9rem;padding-top:1.1rem;border-top:1px solid var(--rule-2)}
.plates+section>h2{border-top:0;padding-top:0}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{text-align:left;vertical-align:top;padding:.5rem 1rem .5rem 0;border-bottom:1px solid var(--rule)}
th{font:500 .72rem/1.4 var(--mono);color:var(--muted);border-bottom:1.5px solid var(--text)}
td.mark{width:1.8rem;font:600 1rem/1.5 var(--mono)}
td.id{font:500 .84rem/1.7 var(--mono)}
td.what{color:var(--text-2)}
td.num,th.num{text-align:right;font-family:var(--mono);width:4.5rem}
td.budget{font:400 .78rem/1.9 var(--mono);color:var(--muted)}
.is-fail .mark,.is-fail .num{color:var(--bad)}.is-fail .num{font-weight:600}
.is-flag .mark{color:var(--y-line)}.is-pass .mark{color:var(--ok)}.is-skip{color:var(--muted)}.is-skip td.what{color:var(--muted)}
.group{margin-top:2rem}
.group>h3{display:flex;align-items:baseline;gap:.8rem;flex-wrap:wrap;font:500 .95rem/1.4 var(--mono)}
.group>h3 small{font:400 .88rem/1.4 var(--sans);color:var(--muted)}
.group>p.more{color:var(--muted);font-size:.88rem;margin:.6rem 0 0}
.group>p.help{max-width:46rem;margin:.55rem 0 0;color:var(--text-2);font-size:.92rem;line-height:1.6}
.group>p.help b{color:var(--text);font-weight:600}
ol.proofs{list-style:none;margin:.7rem 0 0;padding:0;border-top:1px solid var(--rule-2)}
.proof{display:grid;grid-template-columns:11rem minmax(0,1fr);gap:1rem;padding:.9rem 0;border-bottom:1px solid var(--rule)}
.subject{margin:0;font:600 .86rem/1.5 var(--mono);overflow-wrap:anywhere}
.pair{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:.9rem;align-items:start}
.says{padding:.1rem 0 .1rem .8rem;border-left:2px solid var(--rule-2);min-width:0}
.says-expected{border-left-color:var(--k)}
.who{display:flex;align-items:center;gap:.45rem;margin:0;font:500 .76rem/1.4 var(--mono);color:var(--muted)}
.value{margin:.25rem 0 .2rem;font:600 1.12rem/1.3 var(--cond);overflow-wrap:anywhere}
.says-actual .value{color:var(--bad)}
.neq{margin:.9rem 0 0;font:600 1.1rem/1 var(--mono);color:var(--muted)}
.loc{display:block;font:400 .72rem/1.5 var(--mono);color:var(--muted);overflow-wrap:anywhere}
.message{margin:0 0 .25rem;overflow-wrap:anywhere}
.issues li{margin:.3rem 0;overflow-wrap:anywhere}.issues code{font:500 .82rem var(--mono)}
footer{margin-top:3.5rem;padding-top:1rem;border-top:1px solid var(--rule-2);color:var(--muted);font:400 .76rem/1.7 var(--mono)}
@media (max-width:46rem){.plates{grid-template-columns:repeat(2,minmax(0,1fr))}.plate{border-bottom:1px solid var(--rule)}.plate:nth-child(2n){border-right:0}.plate:nth-child(odd){padding-left:0}
.proof{grid-template-columns:minmax(0,1fr);gap:.4rem}.pair{grid-template-columns:minmax(0,1fr)}.neq{margin:0}
table,thead,tbody{display:block}
tr{display:grid;grid-template-columns:1.2rem minmax(0,1fr) 3.25rem minmax(4.2rem,.5fr);gap:.35rem .5rem;padding:.7rem 0;border-bottom:1px solid var(--rule)}
thead tr{border-bottom:1.5px solid var(--text)}
th,td{min-width:0;padding:0;border:0}
th.what{display:none}
td.what{grid-column:2/-1;grid-row:2}
td.mark{width:auto;grid-column:1;grid-row:1}
td.id{grid-column:2;grid-row:1;white-space:normal}
td.num,th.num{width:auto;grid-column:3;grid-row:1}
td.budget{grid-column:4;grid-row:1;white-space:normal}}
@media print{body{background:#fff}.sheet{max-width:none;padding:0}.proof,.group>h3,tr{break-inside:avoid}a{color:inherit}}
`;

const MARK_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16 1v30M1 16h30" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

export type HtmlOptions = {
  /** How many findings to print per rule before summarising the rest. Default 50. */
  maxPerRule?: number;
};

export function renderHtml(result: AuditResult, options: HtmlOptions = {}): string {
  const max = Math.max(1, Math.floor(options.maxPerRule ?? 50));
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const warns = result.findings.filter((f) => f.severity === 'warn').length;
  const notes = result.findings.filter((f) => f.severity === 'info').length;
  const over = result.rules.filter((r) => !r.passed);
  const empty = nothingRead(result);
  const word = empty ? 'Nothing read' : result.ok ? 'In register' : 'Out of register';

  const counts = [plural(errors, 'error'), plural(warns, 'warning'), ...(notes ? [plural(notes, 'note')] : [])];
  const where = `${plural(result.counts.variants, 'variant')} of ${plural(result.counts.products, 'product')}`;
  const sentence = empty
    ? `<b>No product could be read from this shop</b>, so no rule had anything to compare.${result.issues.length ? ' What got in the way is listed under Collection issues.' : ''}`
    : result.ok
      ? `<b>${counts.join(', ')}</b> across ${where}. Every rule is within its budget.`
      : `<b>${counts.join(', ')}</b> across ${where}. ${over.length
        ? `Over budget: ${over.map((r) => `<a href="#rule-${esc(r.id)}">${esc(r.id)}</a>`).join(', ')}.`
        : esc(collectionFailure(result) ?? 'The audit did not pass.')}`;

  const collected = new Set(result.surfaces);
  const plates = PLATES.map((plate) => {
    const mine = (Object.keys(PLATE_OF) as Surface[]).filter((s) => PLATE_OF[s] === plate && collected.has(s));
    const list = mine.length ? mine.map((s) => `<li>${esc(s)}</li>`).join('') : '<li>not collected</li>';
    return `<div class="plate${mine.length ? '' : ' none'}"><h3>${chip(plate)}${PLATE_NAME[plate]}</h3><p class="note">${PLATE_NOTE[plate]}</p><ul>${list}</ul></div>`;
  }).join('');

  const groups = result.rules
    .filter((r) => r.findings > 0)
    .map((r) => {
      const all = result.findings.filter((f) => f.rule === r.id);
      const rest = all.length - Math.min(all.length, max);
      return `<div class="group" id="rule-${esc(r.id)}">
<h3>${esc(r.id)}<small>${esc(r.summary)}</small></h3>
${r.help ? `<p class="help"><b>Usual cause and fix.</b> ${esc(r.help)}</p>` : ''}
<ol class="proofs">${all.slice(0, max).map(finding).join('')}</ol>
${rest > 0 ? `<p class="more">and ${rest} more, in the JSON report.</p>` : ''}
</div>`;
    })
    .join('');

  const issues = result.issues.length
    ? `<section class="issues"><h2>Collection issues</h2><p class="label">Things that got in the way of reading the shop. They are not findings about its data.</p><ul>${result.issues
        .slice(0, 100)
        .map((i) => `<li><code>${esc(i.surface)} ${esc(i.code)}</code> ${esc(clip(i.message, 300))}${i.locator ? ` ${locator(i.locator)}` : ''}</li>`)
        .join('')}</ul></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>Regmark: ${esc(host(result.store))} ${word.toLowerCase()}</title>
<style>${CSS}</style>
</head>
<body>
<div class="sheet">
<header class="head">
  <p class="brand">${MARK_SVG}Regmark<span>audit report</span></p>
  <dl class="meta">
    <div><dt>shop</dt><dd>${esc(host(result.store))}</dd></div>
    <div><dt>run</dt><dd>${esc(result.startedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))}</dd></div>
    <div><dt>took</dt><dd>${duration(durationMs(result))}</dd></div>
    <div><dt>believes</dt><dd>${esc(result.datum.join(', then '))}</dd></div>
  </dl>
</header>
<section class="verdict ${result.ok ? 'in' : 'out'}">
  <h1 class="press"><span class="pc" aria-hidden="true">${word}</span><span class="pm" aria-hidden="true">${word}</span><span class="py" aria-hidden="true">${word}</span><span class="pk">${word}</span></h1>
  <p>${sentence}</p>
</section>
<section class="plates" aria-label="Surfaces collected, by plate">${plates}</section>
<section>
<h2>Rules</h2>
<table>
<thead><tr><th><span class="vh">status</span></th><th>rule</th><th class="what">what it catches</th><th class="num">findings</th><th>budget</th></tr></thead>
<tbody>${result.rules.map(ruleRow).join('')}</tbody>
</table>
</section>
${groups ? `<section><h2>Findings</h2>${groups}</section>` : ''}
${issues}
<footer>regmark ${esc(result.tool.version)} · schema ${esc(result.schema)} · the full data is in the JSON report</footer>
</div>
</body>
</html>
`;
}
