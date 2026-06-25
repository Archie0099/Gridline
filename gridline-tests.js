/* ============================================================================
 * Gridline — pure-logic test harness  (173 assertions)
 *
 * Runs in Node against the exported helpers inside gridline.html.
 * It extracts the inline app <script>, requires it (the IIFE exports its pure
 * functions and returns early under Node), then runs the suites.
 *
 * USAGE:
 *   node gridline-tests.js [path/to/gridline.html] [path/to/sample-mandi-sales.csv]
 * Defaults assume all three files sit in the same folder.
 *
 * For DOM/UI verification, see the jsdom smoke test in smoke.js.
 * ==========================================================================*/

const fs = require('fs');
const os = require('os');
const path = require('path');

const HTML = process.argv[2] || path.join(__dirname, 'gridline.html');
const CSV  = process.argv[3] || path.join(__dirname, 'sample-mandi-sales.csv');

// --- extract the inline app script (between the LAST <script> and </script>) ---
const html = fs.readFileSync(HTML, 'utf8').split(/\r?\n/);
let s = -1, e = -1;
for (let i = 0; i < html.length; i++) {
  if (html[i].trim() === '<script>') s = i;        // last bare <script>
  if (html[i].trim() === '</script>') e = i;       // last </script>
}
if (s < 0 || e < 0 || e <= s) { console.error('Could not locate the inline app <script>.'); process.exit(2); }
const mod = html.slice(s + 1, e).join('\n');
const tmp = path.join(os.tmpdir(), 'gridline_mod_test.js');
fs.writeFileSync(tmp, mod);
const G = require(tmp);

// --- tiny assert helpers ---
let pass = 0, fail = 0;
function eq(n, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass++, console.log('  ok  ' + n))
     : (fail++, console.log('FAIL  ' + n + '  got:' + JSON.stringify(got) + ' want:' + JSON.stringify(want)));
}
function ok(n, c, d) {
  c ? (pass++, console.log('  ok  ' + n))
    : (fail++, console.log('FAIL  ' + n + (d !== undefined ? ('  [' + d + ']') : '')));
}
const D = (v, o) => { const t = G.parseDateValue(v, o); return t == null ? null : new Date(t); };
const pair = (r) => { const o = {}; r.labels.forEach((l, i) => o[l] = (r.values || r.counts)[i]); return o; };
const catKey = (col) => (r) => { const v = r[col]; return (v == null || String(v).trim() === '') ? '(blank)' : String(v); };

// --- load sample rows ---
const raw = fs.readFileSync(CSV, 'utf8').trim().split(/\r?\n/);
const H = raw[0].split(',');
const rows = raw.slice(1).map(l => { const c = l.split(','); const o = {}; H.forEach((h, i) => o[h] = c[i]); return o; });

/* ───────────────────────── toNumber ───────────────────────── */
console.log('\n== toNumber ==');
eq('plain int', G.toNumber('42'), 42);
eq('comma thousands', G.toNumber('1,234,567'), 1234567);
eq('indian comma', G.toNumber('1,23,456'), 123456);
eq('rupee', G.toNumber('₹2,500'), 2500);
eq('dollar+decimals', G.toNumber('$1,299.50'), 1299.5);
eq('percent keeps literal 12.5', G.toNumber('12.5%'), 12.5);
eq('moisture 14%', G.toNumber('14%'), 14);
eq('parens negative', G.toNumber('(450)'), -450);
eq('empty -> null', G.toNumber(''), null);
eq('text -> null', G.toNumber('hello'), null);
eq('float', G.toNumber('3.14159'), 3.14159);

/* ─────────────────── dates / order inference ───────────────── */
console.log('\n== parseDateValue (epoch ms) / inferDateOrder ==');
ok('iso ymd', D('2024-01-15', 'ymd').getFullYear() === 2024 && D('2024-01-15', 'ymd').getMonth() === 0 && D('2024-01-15', 'ymd').getDate() === 15);
ok('dmy 15/03/2024 -> Mar', D('15/03/2024', 'dmy').getMonth() === 2);
ok('mdy 03/15/2024 -> Mar', D('03/15/2024', 'mdy').getMonth() === 2);
ok("'15 Jan 2024'", D('15 Jan 2024', 'dmy').getMonth() === 0 && D('15 Jan 2024', 'dmy').getDate() === 15);
ok("'Jan 15, 2024'", D('Jan 15, 2024', 'mdy').getMonth() === 0);
ok("'Jan 2024'", D('Jan 2024', 'dmy').getFullYear() === 2024 && D('Jan 2024', 'dmy').getMonth() === 0);
ok('garbage -> null', D('not a date', 'dmy') === null);
ok('order day>12 -> dmy', G.inferDateOrder(['15/03/2024', '02/04/2024']) === 'dmy');
ok('order 1st>12 -> mdy', G.inferDateOrder(['03/15/2024', '04/02/2024']) === 'mdy');

/* ───────────────────── detectColumnType ───────────────────── */
console.log('\n== detectColumnType ==');
eq('numeric', G.detectColumnType(['1', '2', '3', '4,000', '5.5']).type, 'numeric');
eq('date iso', G.detectColumnType(['2024-01-01', '2024-02-01', '2024-03-01']).type, 'date');
eq('categorical', G.detectColumnType(['North', 'South', 'East', 'West']).type, 'categorical');
eq('mostly-num -> numeric', G.detectColumnType(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x']).type, 'numeric');
eq('empty -> categorical', G.detectColumnType(['', '', '']).type, 'categorical');
eq('dmy dates', G.detectColumnType(['15/03/2024', '16/03/2024', '17/03/2024']).type, 'date');

/* ─────────── histogram / topFrequencies / categoryAgg / timeSeries ────────── */
console.log('\n== histogram {labels,counts,n} ==');
(function () {
  const h = G.histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  ok('has counts', Array.isArray(h.counts) && h.counts.length > 0, h.counts && h.counts.length);
  ok('counts sum to 10', h.counts.reduce((a, c) => a + c, 0) === 10);
  const single = G.histogram([5, 5, 5, 5]);
  ok('single-value flagged', single.single === true && single.counts[0] === 4);
})();

console.log('\n== topFrequencies {labels,counts,total=distinct} ==');
(function () {
  const t = G.topFrequencies(['a', 'b', 'a', 'c', 'a', 'b'], 10);
  ok("'a' first count 3", t.labels[0] === 'a' && t.counts[0] === 3);
  ok('total distinct = 3', t.total === 3, t.total);
})();

console.log("\n== categoryAgg {labels,values} (agg='average') ==");
(function () {
  const r = [{ Region: 'North', Rev: '100' }, { Region: 'South', Rev: '200' }, { Region: 'North', Rev: '50' }, { Region: 'South', Rev: '300' }];
  const sum = pair(G.categoryAgg(r, 'Region', 'Rev', 'sum', 10));
  ok('sum North=150', sum['North'] === 150); ok('sum South=500', sum['South'] === 500);
  ok('avg North=75', pair(G.categoryAgg(r, 'Region', 'Rev', 'average', 10))['North'] === 75);
  ok('count North=2', pair(G.categoryAgg(r, 'Region', 'Rev', 'count', 10))['North'] === 2);
})();

console.log('\n== timeSeries {labels,values,gran} ==');
(function () {
  const r = []; const months = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06'];
  months.forEach((m, i) => { r.push({ D: m + '-05', V: String((i + 1) * 100) }); r.push({ D: m + '-20', V: String((i + 1) * 100) }); });
  const ts = G.timeSeries(r, 'D', 'V', 'sum', 'ymd');
  ok('produces values', ts.values.length > 0);
  ok('sum total = 4200', ts.values.reduce((a, v) => a + v, 0) === 4200, ts.values.reduce((a, v) => a + v, 0));
  ok('gran is a string', typeof ts.gran === 'string', ts.gran);
  ok('count total = 12', G.timeSeries(r, 'D', 'V', 'count', 'ymd').values.reduce((a, v) => a + v, 0) === 12);
})();

console.log('\n== fmt ==');
ok('fmtCompact string', typeof G.fmtCompact(1234567) === 'string', G.fmtCompact(1234567));
ok('fmtFull string', typeof G.fmtFull(1234567) === 'string', G.fmtFull(1234567));
ok('intl compact has M', /M$/.test(G.fmtCompact(314852651)), G.fmtCompact(314852651));

/* ─────────────── grouped (split-by) aggregations ─────────────── */
console.log('\n== timeSeriesGrouped (Amount by month, split Commodity) ==');
(function () {
  const tsg = G.timeSeriesGrouped(rows, 'Date', 'Amount', 'sum', 'dmy', 'Commodity', 6);
  ok('has labels', tsg.labels.length > 0);
  ok('series <= 6', tsg.series.length <= 6);
  ok('distinct = 5', tsg.distinct === 5, tsg.distinct);
  ok("no 'Other'", tsg.other === false);
  ok('series aligned to labels', tsg.series.every(se => se.values.length === tsg.labels.length));
  const ts = G.timeSeries(rows, 'Date', 'Amount', 'sum', 'dmy');
  let okSum = true;
  for (let i = 0; i < ts.labels.length; i++) { const st = tsg.series.reduce((a, se) => a + se.values[i], 0); if (Math.abs(st - ts.values[i]) > 1) okSum = false; }
  ok('stacked sums == ungrouped totals', okSum);
})();
console.log("\n== grouped 'Other' folding (maxSeries=3) ==");
(function () {
  const tsg3 = G.timeSeriesGrouped(rows, 'Date', 'Amount', 'sum', 'dmy', 'Commodity', 3);
  ok('series = 3 (2 named + Other)', tsg3.series.length === 3);
  ok("last is 'Other'", tsg3.series[2].name === 'Other');
  ok('other flag true', tsg3.other === true);
  const ts = G.timeSeries(rows, 'Date', 'Amount', 'sum', 'dmy');
  let okSum = true;
  for (let i = 0; i < ts.labels.length; i++) { const st = tsg3.series.reduce((a, se) => a + se.values[i], 0); if (Math.abs(st - ts.values[i]) > 1) okSum = false; }
  ok('Other preserves stacked total', okSum);
})();
console.log('\n== categoryAggGrouped (Mandi x Commodity) ==');
(function () {
  const cag = G.categoryAggGrouped(rows, 'Mandi', 'Amount', 'sum', 'Commodity', 12, 6);
  ok('5 mandi rows', cag.labels.length === 5);
  ok('series <= 6', cag.series.length <= 6);
  ok('aligned', cag.series.every(se => se.values.length === cag.labels.length));
  const single = G.categoryAgg(rows, 'Mandi', 'Amount', 'sum', 30).values.reduce((a, b) => a + b, 0);
  const grouped = cag.series.reduce((a, se) => a + se.values.reduce((x, y) => x + y, 0), 0);
  ok('grand totals reconcile', Math.abs(single - grouped) < 1, single + ' vs ' + grouped);
  const cnt = G.timeSeriesGrouped(rows, 'Date', 'Amount', 'count', 'dmy', 'Commodity', 6);
  ok('count grand total = 200', cnt.series.reduce((a, se) => a + se.values.reduce((x, y) => x + y, 0), 0) === 200);
})();

/* ───────────────────────── pivot ───────────────────────── */
console.log('\n== pivot: Mandi x Commodity, sum Amount ==');
(function () {
  const p = G.pivot(rows, 'Amount', 'sum', catKey('Mandi'), catKey('Commodity'), { rowSort: 'total', colSort: 'total' });
  ok('hasCol true', p.hasCol === true);
  ok('5 row keys', p.rowKeys.length === 5);
  ok('5 col keys', p.colKeys.length === 5);
  ok('matrix 5x5', p.matrix.length === 5 && p.matrix.every(r => r.length === 5));
  let cellSum = 0; p.matrix.forEach(r => r.forEach(v => cellSum += (v || 0)));
  ok('cells sum == grand', Math.abs(cellSum - p.grand) < 1, cellSum + ' vs ' + p.grand);
  let rowOk = true; p.matrix.forEach((r, i) => { if (Math.abs(r.reduce((a, b) => a + (b || 0), 0) - p.rowTotals[i]) > 1) rowOk = false; });
  ok('row totals == row cell sums', rowOk);
  let colOk = true; p.colKeys.forEach((c, j) => { let su = 0; p.matrix.forEach(r => su += (r[j] || 0)); if (Math.abs(su - p.colTotals[j]) > 1) colOk = false; });
  ok('col totals == col cell sums', colOk);
  ok('grand == sum(rowTotals)', Math.abs(p.rowTotals.reduce((a, b) => a + b, 0) - p.grand) < 1);
  ok('grand == sum(colTotals)', Math.abs(p.colTotals.reduce((a, b) => a + b, 0) - p.grand) < 1);
})();
console.log('\n== pivot: single column, count ==');
(function () {
  const p = G.pivot(rows, 'Amount', 'count', catKey('Mandi'), null, {});
  ok('hasCol false', p.hasCol === false);
  ok('1 value column', p.colKeys.length === 1);
  ok('count grand == 200', p.grand === 200, p.grand);
  ok('row counts sum to 200', p.rowTotals.reduce((a, b) => a + b, 0) === 200);
})();
console.log('\n== pivot: average correctness ==');
(function () {
  const tiny = [{ a: 'x', b: 'm', v: '10' }, { a: 'x', b: 'm', v: '20' }, { a: 'x', b: 'n', v: '60' }];
  const pa = G.pivot(tiny, 'v', 'average', catKey('a'), catKey('b'), {});
  const mi = pa.colKeys.indexOf('m'), ni = pa.colKeys.indexOf('n');
  ok('avg cell x,m = 15', Math.abs(pa.matrix[0][mi] - 15) < 1e-9);
  ok('avg cell x,n = 60', Math.abs(pa.matrix[0][ni] - 60) < 1e-9);
  ok('avg row total x = 30', Math.abs(pa.rowTotals[0] - 30) < 1e-9, pa.rowTotals[0]);
})();
console.log('\n== pivot: date rows by month (chronological) ==');
(function () {
  const monthKey = (r) => { const t = G.parseDateValue(r['Date'], 'dmy'); if (t == null) return null; const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const pm = G.pivot(rows, 'Amount', 'sum', monthKey, null, { rowSort: 'key' });
  ok('6 months', pm.rowKeys.length === 6, pm.rowKeys.length);
  ok('chronological', JSON.stringify(pm.rowKeys) === JSON.stringify(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']));
  ok('grand == amount sum', Math.abs(pm.grand - rows.reduce((s, r) => s + (+r.Amount), 0)) < 1);
})();

/* ───────────────────── movingAverage ───────────────────── */
console.log('\n== movingAverage ==');
(function () {
  const ma = G.movingAverage([10, 20, 30, 40, 50], 3);
  ok('first two null', ma[0] === null && ma[1] === null);
  ok('ma[2]=20', ma[2] === 20); ok('ma[3]=30', ma[3] === 30); ok('ma[4]=40', ma[4] === 40);
  ok('win<2 returns copy', JSON.stringify(G.movingAverage([1, 2, 3], 1)) === JSON.stringify([1, 2, 3]));
})();

/* ───────────────────── end-to-end on sample ───────────────────── */
console.log('\n== e2e: sample CSV column detection ==');
(function () {
  const types = {};
  H.forEach(h => { types[h] = G.detectColumnType(rows.map(r => r[h])).type; });
  eq('Date -> date', types['Date'], 'date');
  eq('Mandi -> categorical', types['Mandi'], 'categorical');
  eq('Amount -> numeric', types['Amount'], 'numeric');
})();

/* ───────────────────── statistics & forecasting ───────────────────── */
console.log('\n== describe / quantiles / outliers ==');
(function () {
  const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
  const d = G.describe(['1','2','3','4','5','6','7','8','9','10']);
  ok('n=10', d.n === 10);
  ok('mean=5.5', near(d.mean, 5.5));
  ok('median=5.5', near(d.median, 5.5));
  ok('std≈3.02765', near(d.std, 3.0276503540974917, 1e-6));
  ok('q1=3.25,q3=7.75 (type-7)', near(d.q1, 3.25) && near(d.q3, 7.75));
  ok('detects 1 outlier', G.describe(['1','2','3','4','5','100']).outliers === 1);
})();

console.log('\n== pearson / correlationMatrix / linreg ==');
(function () {
  const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
  ok('pearson perfect +1', near(G.pearson([1,2,3,4,5],[2,4,6,8,10]).r, 1));
  ok('pearson perfect -1', near(G.pearson([1,2,3,4,5],[10,8,6,4,2]).r, -1));
  ok('pearson null for <3 pts', G.pearson([1,2],[2,4]) === null);
  const lr = G.linreg([0,1,2,3,4],[1,3,5,7,9]);
  ok('linreg slope=2', near(lr.slope, 2)); ok('linreg intercept=1', near(lr.intercept, 1)); ok('linreg r2=1', near(lr.r2, 1));
  const cm = G.correlationMatrix(rows, ['Bags','Rate_per_Qtl','Amount']);
  ok('corr matrix 3x3', cm.matrix.length === 3 && cm.matrix[0].length === 3);
  ok('corr diagonal=1', cm.matrix[0][0] === 1 && cm.matrix[2][2] === 1);
  ok('corr symmetric', near(cm.matrix[0][1], cm.matrix[1][0]));
  ok('corr Bags~Amount positive', cm.matrix[0][2] > 0);
})();

console.log('\n== forecasting: Holt / Holt-Winters / fitForecast ==');
(function () {
  const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
  const lin = []; for (let i = 0; i < 20; i++) lin.push(10 + 2 * i);
  const hl = G.holtLinear(lin, 3, 0.5, 0.5);
  ok('Holt continues a line (≈50,52,54)', near(hl.forecast[0], 50, 3) && near(hl.forecast[2], 54, 3));

  const season = [0,5,10,5], sy = []; for (let t = 0; t < 24; t++) sy.push(20 + 0.5 * t + season[t % 4]);
  const hw = G.holtWinters(sy, 4, 8, 0.4, 0.1, 0.3);
  ok('HW forecast length 8', hw && hw.forecast.length === 8);
  ok('HW trends up across cycles', hw.forecast[4] > hw.forecast[0]);

  const shortLin = []; for (let i = 0; i < 18; i++) shortLin.push(100 + 3 * i);
  const r = G.fitForecast(shortLin, 12, 6);
  ok('fitForecast -> Holt linear when short for season', /Holt linear/.test(r.method));
  ok('fitForecast bands length 6', r.lower.length === 6 && r.upper.length === 6);
  ok('fitForecast band contains forecast', r.lower[0] <= r.forecast[0] && r.upper[0] >= r.forecast[0]);
  ok('fitForecast clean line MAPE < 5%', r.mape != null && r.mape < 5);

  const noisy = []; for (let i = 0; i < 18; i++) noisy.push(100 + 3 * i + (i % 2 ? 7 : -7));
  const rn = G.fitForecast(noisy, 12, 4);
  ok('noisy series -> band has positive width', rn.upper[0] > rn.forecast[0] && rn.lower[0] < rn.forecast[0]);

  const seas = []; const s = [0,2,5,9,12,14,13,10,7,4,2,1]; for (let t = 0; t < 36; t++) seas.push(50 + 0.3 * t + s[t % 12]);
  ok('fitForecast -> Holt-Winters with 3 seasons', /Holt-Winters/.test(G.fitForecast(seas, 12, 12).method));
})();

console.log('\n== anomaly detection ==');
(function () {
  const y = []; for (let i = 0; i < 30; i++) y.push(100 + Math.sin(i)); y[20] = 300;
  const fl = G.rollingAnomalies(y, 8, 3);
  ok('flags the spike at i=20', fl.some(f => f.i === 20));
  ok('does not over-flag (<5)', fl.length < 5);
})();

console.log('\n== forecast backtest ==');
(function () {
  // clean upward trend: a real forecast should beat carrying the last value forward
  const trend = []; for (let i = 0; i < 30; i++) trend.push(100 + 4 * i);
  const bt = G.backtest(trend, 1, 4, 6);
  ok('backtest returns a result on a 30-pt series', bt && typeof bt === 'object');
  ok('reports horizon = 4', bt.horizon === 4);
  ok('uses multiple folds (1..6)', bt.folds >= 1 && bt.folds <= 6);
  ok('scores some points', bt.points > 0);
  ok('error metrics finite, naive baseline > 0', isFinite(bt.rmse) && isFinite(bt.naiveRmse) && bt.naiveRmse > 0);
  ok('mape is a finite percent', bt.mape != null && isFinite(bt.mape) && bt.mape >= 0);
  ok('beats naive on a clean trend (skill > 0)', bt.skill != null && bt.skill > 0, 'skill=' + (bt && bt.skill != null ? bt.skill.toFixed(3) : 'n/a'));

  // seasonal series: still produces sane, finite metrics
  const ssn = []; const s = [0,2,5,9,12,14,13,10,7,4,2,1]; for (let t = 0; t < 48; t++) ssn.push(80 + 0.4 * t + s[t % 12]);
  const bs = G.backtest(ssn, 12, 12, 4);
  ok('seasonal backtest returns finite metrics', bs && isFinite(bs.rmse) && isFinite(bs.naiveRmse) && bs.skill != null);

  // too little history -> null (needs minTrain + horizon)
  ok('short series -> null', G.backtest([10, 12, 11, 13, 14], 1, 3) === null);
  // missing/zero horizon -> null
  ok('no horizon -> null', G.backtest(trend, 1, 0) === null);
})();

console.log('\n== seasonal decomposition ==');
(function () {
  const y = []; for (let t = 0; t < 48; t++) y.push(100 + 1.5 * t + 10 * Math.sin(2 * Math.PI * (t % 12) / 12));
  const dc = G.decompose(y, 12);
  ok('decompose returns components', dc && dc.trend && dc.seasonal && dc.residual);
  ok('period + length carried', dc.period === 12 && dc.n === 48);
  let ssum = 0; for (let p = 0; p < 12; p++) ssum += dc.seasonal[p];
  ok('seasonal indices centered (sum ~ 0)', Math.abs(ssum) < 1e-6, 'sum=' + ssum.toFixed(4));
  let okRec = true; for (let i = 0; i < 48; i++) { if (dc.trend[i] != null) { const r = dc.trend[i] + dc.seasonal[i] + dc.residual[i]; if (Math.abs(r - y[i]) > 1e-6) okRec = false; } }
  ok('trend + seasonal + resid reconstructs original', okRec);
  ok('trend tracks the true level at midpoint', Math.abs(dc.trend[24] - (100 + 1.5 * 24)) < 3, 'trend=' + dc.trend[24].toFixed(1));
  ok('detects strong seasonality (Fs > 0.6)', dc.seasonalStrength > 0.6, 'Fs=' + dc.seasonalStrength.toFixed(2));
  const yt = []; for (let t = 0; t < 48; t++) yt.push(50 + 2 * t);
  ok('pure trend -> low seasonal strength (<0.3)', G.decompose(yt, 12).seasonalStrength < 0.3);
  ok('too short (<2 periods) -> null', G.decompose(y.slice(0, 20), 12) === null);
})();

console.log('\n== k-means clustering ==');
(function () {
  const pts = []; const trueC = [[0, 0], [20, 20], [0, 20]];
  let r = 999; const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  trueC.forEach(cc => { for (let i = 0; i < 15; i++) pts.push([cc[0] + (rnd() - 0.5) * 2, cc[1] + (rnd() - 0.5) * 2]); });
  const km = G.kmeans(pts, 3, 50, 42);
  ok('returns assign/centers/sizes', km && km.assign.length === 45 && km.centers.length === 3 && km.sizes.length === 3);
  ok('all 45 points assigned, no empty cluster', km.sizes.reduce((a, b) => a + b, 0) === 45 && km.sizes.every(s => s > 0));
  let pure = true; for (let b = 0; b < 3; b++) { const lab = km.assign[b * 15]; for (let i = 1; i < 15; i++) if (km.assign[b * 15 + i] !== lab) pure = false; }
  ok('each separated blob forms one cluster', pure);
  ok('deterministic with same seed', JSON.stringify(km.assign) === JSON.stringify(G.kmeans(pts, 3, 50, 42).assign));
  ok('centroids land near true blob centers', trueC.every(tc => km.centers.some(kc => Math.abs(kc[0] - tc[0]) < 3 && Math.abs(kc[1] - tc[1]) < 3)));
  ok('k capped at n', G.kmeans([[1, 1], [2, 2]], 5, 50, 1).k === 2);
})();

/* ───────── bug-hunt regression (adversarial pass) ───────── */
console.log('\n== bug-hunt regression ==');
// toNumber: parenthesised already-signed values must not double-negate
eq('parens neg stays neg', G.toNumber('(-5)'), -5);
eq('parens neg with comma', G.toNumber('(-1,234.50)'), -1234.5);
eq('parens explicit pos', G.toNumber('(+5)'), 5);
eq('plain parens still negate', G.toNumber('(450)'), -450);
eq('currency inside parens neg', G.toNumber('($-5)'), -5);
// toNumber: trailing-dot numbers are valid
eq('trailing dot int', G.toNumber('5.'), 5);
eq('trailing dot thousands', G.toNumber('1000.'), 1000);
eq('currency trailing dot', G.toNumber('$1,000.'), 1000);
eq('leading dot still ok', G.toNumber('.5'), 0.5);
ok('junk dots rejected', G.toNumber('5..5') === null && G.toNumber('.') === null);

// dates: month names matched exactly, not by prefix
ok('non-month words rejected', G.parseDateValue('Marvel 2024','dmy')===null && G.parseDateValue('Junk 2020','dmy')===null && G.parseDateValue('Maybe 2024','dmy')===null && G.parseDateValue('Marx 2019','dmy')===null);
ok('15 Marx is not a date', G.parseDateValue('15 Marx 2024','dmy')===null);
ok('real months still parse', G.parseDateValue('Mar 2024','dmy')!==null && G.parseDateValue('Sept 2024','dmy')!==null && G.parseDateValue('March 2024','dmy')!==null && G.parseDateValue('15 January 2024','dmy')!==null);
eq('garbage-word column stays categorical', G.detectColumnType(['Marvel 2023','Marble 2023','Marvel 2024','Marble 2024']).type, 'categorical');
// dates: 4-digit ISO year < 100 kept literally; 2-digit still pivots
ok('4-digit ISO year kept literally', new Date(G.parseDateValue('0023-06-15','ymd')).getFullYear() === 23);
ok('2-digit sep year still pivots', new Date(G.parseDateValue('15/03/24','dmy')).getFullYear() === 2024);
// inferDateOrder ignores tokens the parser would reject
eq('infer ignores 3-digit-first stray', G.inferDateOrder(['999/03/2024','03/15/2024']), 'mdy');

// type detection: leading-zero codes -> categorical; single-value symmetric
eq('leading-zero codes -> categorical', G.detectColumnType(['07001','08002','00501','10001']).type, 'categorical');
eq('phone codes -> categorical', G.detectColumnType(['09876543210','08123456789']).type, 'categorical');
eq('genuine zero stays numeric', G.detectColumnType(['0','1','2','0.5']).type, 'numeric');
eq('single date -> date', G.detectColumnType(['2024-01-15']).type, 'date');
eq('single number -> numeric', G.detectColumnType(['42']).type, 'numeric');

// prototype-pollution: Object.prototype member names as keys must not vanish
(function () {
  const a = G.categoryAgg([{R:'hasOwnProperty',V:'100'},{R:'North',V:'200'},{R:'toString',V:'50'}],'R','V','sum',30);
  ok('proto-name categories preserved', a.total===3 && a.labels.indexOf('toString')>=0 && a.labels.indexOf('hasOwnProperty')>=0);
  const pv = G.pivot([{R:'__proto__',V:'100'},{R:'North',V:'200'},{R:'__proto__',V:'50'}],'V','sum',catKey('R'),null,{});
  eq('pivot __proto__ rows reconcile with grand', pv.rowTotals.reduce((x,y)=>x+y,0), pv.grand);
  const tf = G.topFrequencies(['toString','toString','x'],10);
  ok('topFrequencies proto-name counted', tf.counts[tf.labels.indexOf('toString')]===2);
})();

// rank consistency: same top-N category set whether or not split is active
(function () {
  const r = [{C:'A',S:'X',V:'-1000'},{C:'B',S:'X',V:'500'},{C:'D',S:'X',V:'5'}];
  const ug = G.categoryAgg(r,'C','V','sum',2).labels.slice().sort();
  const gp = G.categoryAggGrouped(r,'C','V','sum','S',2,6).labels.slice().sort();
  eq('split toggle keeps same categories', ug, gp);
})();

// stepDate (exported): month steps from a month-end origin must not overflow
(function () {
  const jan31 = new Date(2026,0,31).getTime();
  eq('stepDate Jan31 +1 -> Feb', new Date(G.stepDate(jan31,'month',1)).getMonth(), 1);
  eq('stepDate Jan31 +2 -> Mar', new Date(G.stepDate(jan31,'month',2)).getMonth(), 2);
  eq('stepDate Jan31 +3 -> Apr', new Date(G.stepDate(jan31,'month',3)).getMonth(), 3);
  eq('stepDate Aug31 +1 -> Sep', new Date(G.stepDate(new Date(2025,7,31).getTime(),'month',1)).getMonth(), 8);
  eq('seasonPeriod month', G.seasonPeriod('month'), 12);
})();

// rolling anomalies: a spike after a perfectly flat window is flagged (finite z), no false positive on flat data
(function () {
  const flat = []; for (let i=0;i<12;i++) flat.push(50); flat.push(5000);
  const an = G.rollingAnomalies(flat,6,3);
  ok('spike after flat window flagged', an.length===1 && an[0].i===12 && isFinite(an[0].z));
  const truly = []; for (let j=0;j<13;j++) truly.push(50);
  ok('truly flat data has no false positive', G.rollingAnomalies(truly,6,3).length===0);
})();

// k-means: degenerate low-cardinality data converges with no empty clusters
(function () {
  const bins = []; for (let i=0;i<30;i++) bins.push([i%2?1:0, i%2?100:0]);
  const km = G.kmeans(bins,3,60,1337);
  ok('low-cardinality kmeans: no empty cluster + converges', km.sizes.every(s=>s>0) && km.iters<60);
  const same = []; for (let j=0;j<50;j++) same.push([10,20]);
  const km2 = G.kmeans(same,6,60,1337);
  ok('all-identical kmeans: no empty cluster', km2.sizes.every(s=>s>0) && km2.iters<60);
})();

// formatters: sub-1 precision and negative-zero
ok('fmtFull keeps sub-1 precision', G.fmtFull(0.004) !== '0');
ok('fmtCompact no negative zero', G.fmtCompact(-0) === '0' && G.fmtCompact(-0.00000001) === '0');
ok('fmtFull no negative zero', G.fmtFull(-0) === '0');

console.log('\n=========================');
console.log('PASS ' + pass + '   FAIL ' + fail);
process.exit(fail > 0 ? 1 : 0);
