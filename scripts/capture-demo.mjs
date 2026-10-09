// Rebuild documentation media from actual CLI output. Playwright is optional;
// pass an absolute path to its index.mjs when installed outside this workspace.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.argv[2];
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
const run = promisify(execFile);
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const browser = await chromium.launch({ headless: true, executablePath: process.env.REGMARK_CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  for (const clean of [false, true]) {
    const suffix = clean ? 'clean' : 'misprint';
    const html = `samples/report-${suffix}.html`;
    const { stdout } = await run(process.execPath, ['packages/cli/src/bin.ts', 'demo', ...(clean ? ['--clean'] : []), '--no-color', '--html', html], { cwd: root });
    await writeFile(path.join(root, `samples/terminal-${suffix}.txt`), stdout);
    await page.goto(pathToFileURL(path.join(root, html)).href);
    await page.screenshot({ path: path.join(root, `docs/assets/report-${clean ? 'in' : 'out-of'}-register.png`) });
    if (!clean) {
      await page.locator('[id="rule-price.mismatch"]').screenshot({ path: path.join(root, 'docs/assets/report-findings.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(root, 'docs/assets/report-mobile.png') });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw new Error('The report overflows the mobile viewport');
      await page.setViewportSize({ width: 1440, height: 520 });
      const summary = stdout.split('\n').slice(0, 12).join('\n');
      await page.setContent(`<html lang="en"><meta charset="utf-8"><title>Regmark demo terminal output</title><style>body{margin:0;background:#101726;color:#eef2f8;padding:36px;font:18px/1.5 monospace}h1{font-size:18px;color:#68d4d0;font-weight:400}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>$ node packages/cli/src/bin.ts demo</h1><pre>${escape(summary)}</pre></html>`);
      await page.screenshot({ path: path.join(root, 'docs/assets/terminal.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }
  console.log('Refreshed samples, desktop reports, finding detail, mobile report and terminal screenshot.');
} finally {
  await browser.close();
}
