/*
 * gridline-browser-tests.js — full INTEGRATION test (real Chromium + the live DuckDB engine).
 *
 * The two Node suites cover the rest:
 *   gridline-tests.js  → 173 pure-logic unit tests   (node gridline-tests.js gridline.html sample-mandi-sales.csv)
 *   smoke.js           → 27 headless-DOM checks       (npm i jsdom papaparse chart.js; node smoke.js gridline.html sample-mandi-sales.csv)
 *
 * THIS file additionally drives a real browser through every feature end-to-end (20 checks):
 * dashboard render, forecast + backtest readout, chart-type cycling, decomposition (4 panels),
 * clustering scatter, correlation heatmap, the three exports, pagination, the SQL engine load +
 * default query, registering a SECOND table, a cross-table JOIN, SQL-result CSV export, saving a
 * query, saved-query PERSISTENCE across a page reload, delete-persistence, dark mode, and three
 * adversarial CSVs (header-only / all-null / XSS). It asserts ZERO JS errors and that the
 * #gl-errbar error banner never appears.
 *
 * ── ONE-TIME SETUP (the libs are large WASM binaries, deliberately not bundled into the repo) ──
 *
 *   # 1) test deps + a browser
 *   npm i jsdom papaparse chart.js @duckdb/duckdb-wasm apache-arrow playwright esbuild
 *   npx playwright install chromium
 *
 *   # 2) build a self-contained DuckDB ESM bundle (mirrors the CDN "+esm" build) and stage fixtures
 *   mkdir -p gltest
 *   echo "export * from '@duckdb/duckdb-wasm';" > dd_entry.js
 *   npx esbuild dd_entry.js --bundle --format=esm --outfile=gltest/duckdb-bundle.mjs
 *   D=node_modules/@duckdb/duckdb-wasm/dist
 *   cp "$D/duckdb-browser-eh.worker.js" "$D/duckdb-eh.wasm" gltest/
 *   cp gridline.html gltest/gridline.html
 *   cp sample-mandi-sales.csv gltest/data.csv
 *   printf 'Mandi,District,State\nKhanna,Ludhiana,Punjab\nDoraha,Ludhiana,Punjab\nSamrala,Ludhiana,Punjab\nGulabbagh,Purnia,Bihar\nRajpura,Patiala,Punjab\n' > gltest/mandi_ref.csv
 *
 *   # 3) run  (GLDIR points at the staged fixtures)
 *   GLDIR=./gltest NODE_PATH="$(npm root)" node gridline-browser-tests.js
 *
 * Why a local DuckDB bundle: CI / offline environments often can't reach the jsDelivr CDN, so the test serves the
 * bundle from localhost and gridline.html honours a window.__DUCKDB_TEST_BUNDLE__ same-origin override
 * (see loadDuckDB() in the app). cdnjs (Chart.js / PapaParse) and Google Fonts are intercepted and
 * served locally / empty. The ONLY path this can't exercise is the live cross-origin CDN download.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const GLDIR = process.env.GLDIR || path.join(process.cwd(), 'gltest');
// Locate a file inside an installed package robustly (some packages' "exports" maps block deep require.resolve).
function pkgFile(pkg, rel) {
  try { return require.resolve(pkg + '/' + rel); } catch (_) {}
  try { return path.join(path.dirname(require.resolve(pkg + '/package.json')), rel); } catch (_) {}
  for (const nm of (process.env.NODE_PATH || '').split(path.delimiter).concat([path.join(process.cwd(), 'node_modules')])) {
    if (!nm) continue; const cand = path.join(nm, pkg, rel); if (fs.existsSync(cand)) return cand;
  }
  throw new Error('cannot locate ' + pkg + '/' + rel + ' — is it installed?');
}
const PAPA  = fs.readFileSync(pkgFile('papaparse', 'papaparse.min.js'));
const CHART = fs.readFileSync(pkgFile('chart.js', 'dist/chart.umd.js'));
const CSV   = fs.readFileSync(path.join(GLDIR, 'data.csv'), 'utf8');
const REF   = path.join(GLDIR, 'mandi_ref.csv');
const MIME  = { '.mjs':'text/javascript', '.js':'text/javascript', '.wasm':'application/wasm', '.html':'text/html' };
const ADV = {
  header_only: "Date,Mandi,Bags\n",
  all_null:    "Cat,Num\nA,\nB,\nC,\n",
  xss:         "Name,<img src=x onerror=\"window.__XSS__=1\">,Amt\n\"<script>window.__XSS__=2<\\/script>\",bad,500\n"
};

const server = http.createServer((q, s) => {
  let p = q.url === '/' ? '/gridline.html' : q.url.split('?')[0];
  fs.readFile(path.join(GLDIR, p), (e, b) => {
    if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    s.end(b);
  });
});

server.listen(0, async () => {
  const port = server.address().port, U = 'http://localhost:' + port + '/';
  const { chromium } = require('playwright');
  const launchOpts = { headless: true };
  if (process.env.PW_EXECUTABLE) launchOpts.executablePath = process.env.PW_EXECUTABLE; // optional: point at a pre-cached Chromium when `npx playwright install` can't run
  const b = await chromium.launch(launchOpts);
  const ctx = await b.newContext({ viewport: { width: 1240, height: 1300 }, acceptDownloads: true }); // one context → localStorage persists across reloads
  const p = await ctx.newPage();
  let errs = [], curr = '';
  p.on('pageerror', e => errs.push('[' + curr + '] ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('[' + curr + '] ' + m.text()); });
  const dls = []; p.on('download', d => dls.push(d.suggestedFilename()));
  await p.addInitScript(() => { window.__DUCKDB_TEST_BUNDLE__ = { module: '/duckdb-bundle.mjs', wasm: '/duckdb-eh.wasm', worker: '/duckdb-browser-eh.worker.js' }; });
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('papaparse')) return r.fulfill({ contentType: 'application/javascript', body: PAPA });
    if (u.includes('chart.umd') || u.includes('Chart')) return r.fulfill({ contentType: 'application/javascript', body: CHART });
    if (u.includes('fonts.goog') || u.includes('gstatic')) return r.fulfill({ contentType: 'text/css', body: '' });
    return r.continue();
  });

  let fails = 0;
  const ck = (l, c, d) => { console.log((c ? 'ok  ' : 'FAIL') + '  ' + l + (c ? '' : ('   ' + (d || '')))); if (!c) fails++; };
  const cw = id => p.$eval('#' + id, e => e.width || 0).catch(() => 0);
  const ingest = async v => { await p.$eval('#pasteArea', (el, x) => el.value = x, v); await p.$eval('#pasteRead', el => el.click()); await p.waitForTimeout(350); };
  const noLeak = async () => !(await p.evaluate(() => /(\bNaN\b|\bInfinity\b|\bundefined\b)/.test((document.getElementById('dash').innerText) || '')));
  async function dl(sel) { try { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 4000 }).catch(() => null), p.click(sel)]); return d ? d.suggestedFilename() : null; } catch (e) { return null; } }

  // ── Phase 1: dashboard + analytics ──
  curr = 'ingest'; await p.goto(U, { waitUntil: 'load' }); await ingest(CSV);
  ck('dashboard renders', (await cw('mainChart')) > 0 && await noLeak());
  curr = 'forecast'; await p.click('#fcSeg button[data-fc="12"]'); await p.waitForTimeout(400);
  ck('forecast + backtest readout shows', !(await p.$eval('#fcAccuracy', e => e.classList.contains('hidden'))) && (await p.$eval('#fcAccuracy .verdict', e => !!e).catch(() => false)));
  curr = 'chart-cycle'; for (const t of ['bar', 'area', 'line']) { await p.click('#typeSeg button[data-type="' + t + '"]'); await p.waitForTimeout(120); }
  await p.click('#fcSeg button[data-fc="0"]'); await p.waitForTimeout(150);
  ck('chart type cycling clean', (await cw('mainChart')) > 0 && await noLeak());
  ck('decompose: 4 panels render', (await cw('dcObserved')) > 0 && (await cw('dcTrend')) > 0 && (await cw('dcSeasonal')) > 0 && (await cw('dcResidual')) > 0);
  ck('cluster: scatter + chips', (await cw('clChart')) > 0 && (await p.$$eval('#clSummary .cl-chip', e => e.length)) >= 2);
  ck('statistics: correlation heatmap', (await p.$$eval('#corrBody td.cell', e => e.length)) > 0);

  // ── Phase 2: exports + pagination ──
  curr = 'exports';
  const csv1 = await dl('#dlCsv'), piv = await dl('#dlPivot'), png = await dl('#dlMainPng');
  ck('exports: filtered CSV + pivot CSV + chart PNG', /filtered\.csv$/.test(csv1 || '') && /pivot\.csv$/.test(piv || '') && (/chart\.png$/.test(png || '') || /PNG/.test(await p.$eval('#status', e => e.textContent).catch(() => ''))));
  curr = 'pager'; const ps = await p.$$eval('#pageSize option', o => o.map(x => x.value)); await p.selectOption('#pageSize', ps[0]); await p.waitForTimeout(120);
  await p.click('#pgNext'); await p.waitForTimeout(100); await p.click('#pgLast'); await p.waitForTimeout(100);
  ck('pagination works', /Page \d+ \/ \d+/.test(await p.$eval('#pager', e => e.textContent)) && (await p.$eval('#pgNext', e => e.disabled)));

  // ── Phase 3: SQL + JOIN + export + save ──
  curr = 'sql-enable'; await p.click('#sqlEnable'); await p.waitForSelector('#sqlResult table tbody tr', { timeout: 60000 });
  ck('SQL engine loads + default query', (await p.$$eval('#sqlResult table tbody tr', e => e.length)) > 0);
  curr = 'sql-join'; await p.setInputFiles('#sqlAddTable', REF); await p.waitForTimeout(900);
  ck('2nd table registered', (await p.$$eval('#sqlSchema .sql-tablegrp', e => e.length)) === 2);
  await p.fill('#sqlEditor', 'SELECT mandi_ref.State, sum(data.Bags) AS bags FROM data JOIN mandi_ref USING (Mandi) GROUP BY 1 ORDER BY bags DESC;');
  await p.click('#sqlRun'); await p.waitForTimeout(600);
  ck('cross-table JOIN runs', !(await p.$eval('#sqlError', e => e.style.display === 'block')) && (await p.$$eval('#sqlResult table tbody tr', e => e.length)) > 0 && /Punjab|Bihar/.test(await p.$eval('#sqlResult', e => e.textContent)));
  curr = 'sql-export'; const qcsv = await dl('#sqlExport'); ck('SQL result export CSV', /query\.csv$/.test(qcsv || ''));
  curr = 'sql-save'; await p.click('#sqlSave'); await p.waitForTimeout(150);
  ck('query saved to localStorage', JSON.parse(await p.evaluate(() => localStorage.getItem('gridline.savedQueries') || '[]')).length >= 1);

  // ── Phase 4: reload persistence ──
  curr = 'reload'; await p.reload({ waitUntil: 'load' }); await ingest(CSV); await p.click('#sqlEnable'); await p.waitForSelector('#sqlResult table tbody tr', { timeout: 60000 }); await p.waitForTimeout(200);
  ck('saved query persists across reload', (await p.$$eval('#sqlSaved option', e => e.length)) >= 2);
  await p.selectOption('#sqlSaved', '0'); await p.waitForTimeout(150); await p.click('#sqlDeleteSaved'); await p.waitForTimeout(200);
  await p.reload({ waitUntil: 'load' }); await ingest(CSV); await p.click('#sqlEnable'); await p.waitForSelector('#sqlResult table tbody tr', { timeout: 60000 });
  ck('delete persists across reload', (await p.$eval('#sqlSaved', e => e.style.display === 'none')) || (await p.$$eval('#sqlSaved option', e => e.length)) < 2);

  // ── Phase 5: dark mode ──
  curr = 'dark'; await p.click('#themeToggle'); await p.waitForTimeout(450);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const sum = (bg.match(/\d+/g) || [255, 255, 255]).reduce((a, x) => a + +x, 0);
  ck('dark: body dark + charts re-render', sum < 160 && (await cw('mainChart')) > 0 && (await cw('clChart')) > 0);
  await p.click('#themeToggle'); await p.waitForTimeout(300);

  // ── Phase 6: adversarial ──
  for (const name of Object.keys(ADV)) {
    curr = 'adv:' + name; const before = errs.length;
    await p.evaluate(() => { window.__XSS__ = undefined; });
    await ingest(ADV[name]);
    const xss = await p.evaluate(() => window.__XSS__);
    const inj = await p.$$eval('#dash script', e => e.length).catch(() => 0);
    ck('adversarial ' + name + ': no crash/leak/xss', errs.length === before && await noLeak() && !xss && inj === 0, 'xss=' + xss + ' inj=' + inj);
  }

  curr = 'final'; const banner = await p.$('#gl-errbar'); ck('no error banner anywhere', !banner);
  await b.close(); server.close();
  console.log('\ndownloads: ' + JSON.stringify(dls));
  console.log('total JS errors: ' + errs.length); errs.slice(0, 10).forEach(e => console.log('  ' + e));
  console.log('\nFINAL INTEGRATION: ' + (fails === 0 && errs.length === 0 ? 'PASS' : (fails + ' fails, ' + errs.length + ' errors')));
  process.exit(fails === 0 && errs.length === 0 ? 0 : 1);
});
