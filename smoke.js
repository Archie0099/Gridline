/* ============================================================================
 * Gridline — headless-DOM smoke test  (27 assertions)
 *
 * Loads gridline.html in jsdom with a stubbed Chart.js and the real PapaParse,
 * feeds in a CSV through the paste path, then exercises the pivot, cross-tab,
 * trend overlay, split-by, number-format toggle and date filter — asserting the
 * dashboard renders with ZERO runtime errors. Complements the pure-logic suite
 * in gridline-tests.js.
 *
 * SETUP (install the dev deps if node_modules is missing):
 *   cd <folder containing these files>
 *   npm install jsdom papaparse --no-audit --no-fund --loglevel=error
 *
 * USAGE:
 *   node smoke.js [path/to/gridline.html] [path/to/sample-mandi-sales.csv]
 *   # if modules were installed elsewhere:
 *   NODE_PATH=/path/to/node_modules node smoke.js
 *
 * A benign "Window.scrollTo() not implemented" line may print to stderr — that
 * is a jsdom limitation, not a test failure.
 * ==========================================================================*/

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Papa = require('papaparse');

const HTML = process.argv[2] || path.join(__dirname, 'gridline.html');
const CSV  = process.argv[3] || path.join(__dirname, 'sample-mandi-sales.csv');

const html = fs.readFileSync(HTML, 'utf8');
const csv  = fs.readFileSync(CSV, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok  ' + n))
                            : (fail++, console.log('FAIL  ' + n + (d !== undefined ? ('  [' + d + ']') : ''))); };

// minimal Chart stub (jsdom has no canvas); records every config it receives
class StubChart {
  constructor(ctx, cfg) { this.ctx = ctx; this.config = cfg; StubChart.last = cfg; StubChart.all.push(cfg); }
  destroy() {} update() {} resize() {} toBase64Image() { return 'data:image/png;base64,'; }
}
StubChart.all = [];
StubChart.register = function () {};
StubChart.defaults = { font: {}, color: null, animation: null };

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.Papa = Papa;                                   // real parser
    window.Chart = StubChart;                             // stubbed charts
    window.HTMLCanvasElement.prototype.getContext = function () { return {}; };
    window.URL.createObjectURL = function () { return 'blob:stub'; };
    window.URL.revokeObjectURL = function () {};
    window.matchMedia = window.matchMedia || function () {
      return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
    };
    window.onerror = function (msg) { errors.push(String(msg)); };
  }
});
const { window } = dom;
const doc = window.document;
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

setTimeout(() => {
  try {
    ok('dash hidden before load', doc.getElementById('dash').classList.contains('hidden'));

    // ---- ingest via the paste path (real PapaParse on a string) ----
    doc.getElementById('pasteArea').value = csv;
    fire(doc.getElementById('pasteRead'), 'click');

    ok('no runtime errors during ingest/render', errors.length === 0, errors.join(' | '));
    ok('dash shown after load', !doc.getElementById('dash').classList.contains('hidden'));
    ok('stat cards rendered', doc.querySelectorAll('#statgrid .stat-card').length >= 4, doc.querySelectorAll('#statgrid .stat-card').length);
    ok('number format toggle present', !!doc.getElementById('numFmtSeg'));
    ok('columns table has 5 headers incl Filled', doc.querySelectorAll('#typesTable thead th').length === 5, doc.querySelectorAll('#typesTable thead th').length);
    ok('columns table has 6 column rows', doc.querySelectorAll('#typesTable tbody tr').length === 6, doc.querySelectorAll('#typesTable tbody tr').length);
    ok('main chart built as line', StubChart.all.some(c => c.type === 'line'), StubChart.all.map(c => c.type).join(','));

    // ---- pivot (default: Date rows by month, no col, sum Amount) ----
    ok('pivot rendered rows', doc.querySelectorAll('#pivotTable tbody tr').length > 0, doc.querySelectorAll('#pivotTable tbody tr').length);
    ok('pivot has grand-total row', !!doc.querySelector('#pivotTable tbody tr.grand'));
    ok('pivot corner shows Date', /Date/.test((doc.querySelector('#pivotTable thead .corner') || {}).textContent || ''));

    // cross-tab: columns = Commodity
    const pvCol = doc.getElementById('pvCol'); pvCol.value = 'Commodity'; fire(pvCol, 'change');
    ok('no errors after colDim change', errors.length === 0, errors.join(' | '));
    ok('cross-tab header has 7 cols', doc.querySelectorAll('#pivotTable thead th').length === 7, doc.querySelectorAll('#pivotTable thead th').length);

    // row dim -> categorical (Mandi): gran wrapper hides
    const pvRow = doc.getElementById('pvRow'); pvRow.value = 'Mandi'; fire(pvRow, 'change');
    ok('no errors after rowDim change', errors.length === 0, errors.join(' | '));
    ok('gran wrapper hidden for categorical rows', doc.getElementById('pvRowGranWrap').classList.contains('hidden'));
    ok('pivot now 5 Mandi rows + grand', doc.querySelectorAll('#pivotTable tbody tr').length === 6, doc.querySelectorAll('#pivotTable tbody tr').length);

    // aggregate -> average
    fire(doc.getElementById('pvAggSeg').querySelector('[data-agg="average"]'), 'click');
    ok('no errors after agg=average', errors.length === 0, errors.join(' | '));

    // pivot CSV export (URL stubbed) — must not throw
    fire(doc.getElementById('dlPivot'), 'click');
    ok('pivot export no errors', errors.length === 0, errors.join(' | '));

    // ---- trend overlay (X is date) ----
    ok('MA field visible (date X)', !doc.getElementById('maField').classList.contains('hidden'));
    fire(doc.getElementById('maSeg').querySelector('[data-ma="7"]'), 'click');
    ok('no errors after MA toggle', errors.length === 0, errors.join(' | '));
    ok('chart now has 2 datasets (series + MA)', StubChart.last.data.datasets.length === 2, StubChart.last.data.datasets.length);

    // ---- split-by series ----
    const cSplit = doc.getElementById('cSplit'); cSplit.value = 'Commodity'; fire(cSplit, 'change');
    ok('no errors after split', errors.length === 0, errors.join(' | '));
    ok('MA field hidden when split active', doc.getElementById('maField').classList.contains('hidden'));
    ok('split produced multiple datasets', StubChart.last.data.datasets.length >= 2, StubChart.last.data.datasets.length);

    // ---- number format -> Indian ----
    fire(doc.getElementById('numFmtSeg').querySelector('[data-fmt="in"]'), 'click');
    ok('no errors after number-format switch', errors.length === 0, errors.join(' | '));

    // ---- date range filter ----
    ok('date filter group visible', !doc.getElementById('dateFilterGroup').classList.contains('hidden'));
    ok('two date inputs', doc.querySelectorAll('#dateFilterBody input[type=date]').length === 2, doc.querySelectorAll('#dateFilterBody input[type=date]').length);

    console.log('\n=========================');
    console.log('PASS ' + pass + '  FAIL ' + fail);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('HARNESS EXCEPTION:', (e && e.stack) || e);
    process.exit(2);
  }
}, 50);
