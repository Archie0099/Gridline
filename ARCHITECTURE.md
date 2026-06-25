# Gridline - Architecture and Development

Architecture and development notes for Gridline.

---

## 0. Overview

Gridline is a single self-contained HTML file that turns any CSV into an interactive, fully
client-side analytics dashboard. There is no build, no server, no framework, and no backend. To
use it, open it in a browser and drop in a CSV. To develop it, edit the one file and re-run the
checks in section 4.

```
gridline.html        the entire product (HTML + CSS + vanilla JS, ~3,170 lines)
```

Supporting files:
```
sample-mandi-sales.csv       demo data (200 rows; Date, Mandi, Commodity, Bags, Rate_per_Qtl, Amount)
README.md                    what it is and does
ARCHITECTURE.md              this file (architecture and development notes)
gridline-tests.js            pure-logic test harness (runs in Node)
smoke.js                     headless-DOM (jsdom) integration test (runs in Node)
gridline-browser-tests.js    full browser + live-DuckDB integration test, 20 checks (setup recipe in its header)
```

## 1. Tests

The project ships with three suites:

- Syntax check (`node --check`).
- 173 pure-logic unit tests (`gridline-tests.js`): parsing, type detection, aggregation, pivots,
  moving averages, and the analytics engine (describe/quantiles/outliers, pearson/correlation/linreg,
  Holt and Holt-Winters/fitForecast, anomalies, backtest, decomposition, k-means).
- 27 headless-DOM (jsdom) integration checks (`smoke.js`) that render the dashboard with no runtime
  errors.
- A 20-check integration browser test (`gridline-browser-tests.js`, real Chromium plus the live
  DuckDB engine): dashboard, forecast and backtest readout, chart-type cycling, decompose (four
  panels), cluster scatter, correlation heatmap, all three exports, pagination, SQL load and default
  query, a second-table register plus cross-table JOIN, SQL-result CSV export, a saved query that
  persists across reload, a delete that persists across reload, dark mode, and three adversarial CSVs
  (header-only, all-null, XSS) with no crash, leak, or injection.

Constraints the suites enforce: no backend, no network except the CDN libraries and fonts, and no
browser storage except the one scoped exception (saved SQL queries persist via `localStorage`; see
section 5).

## 2. How to run it

Open `gridline.html` in any modern browser (double-click is fine). Drop in or paste a CSV. The first
load pulls PapaParse and Chart.js from cdnjs and fonts from Google Fonts; after that the analytics
run entirely locally. No command line, no install.

## 3. How it is built (navigation map)

One IIFE in a single inline `<script>` at the end of `<body>`, organised into numbered sections
(search for `N ·`):

```
0 · guards          HAS_PAPA / HAS_CHART
1 · pure helpers    parse/detect/aggregate/format  (NO DOM, NO state; exported for tests)
2 · state + dom     the `state` object + $/el helpers
3 · Chart.js setup  defaults, background-fill export plugin, reduced-motion
4 · ingest          parse -> analyse columns -> commit state -> render
5 · controls        build/populate selects + segmented buttons
6 · filters         category/numeric/date filter bodies + applyFilters()
7 · render          renderAll -> meta, key figures, insights, statistics, charts(main/dist/top), decompose, cluster, pivot, table
8 · export          PNG / CSV writers
9 · wiring          addEventListener bindings; boot
```
The SQL workspace is its own block of functions later in the same IIFE (`loadDuckDB`, `sqlEnable`,
`sqlRegisterData`, `sqlRenderSchema`, `sqlRun`, and the multi-table/export/saved-query helpers; see
section 6).

Exported pure functions (Section 1, via a `module.exports` block guarded by `typeof module`):
`toNumber, looksLikeDateLoose, inferDateOrder, parseDateValue, detectColumnType, timeSeries,
categoryAgg, histogram, topFrequencies, fmtCompact, fmtFull, timeSeriesGrouped, categoryAggGrouped,
pivot, movingAverage`, plus the analytics engine (`describe, pearson, correlationMatrix, linreg,
holtLinear, holtWinters, fitForecast, rollingAnomalies, seasonPeriod, stepDate, backtest, decompose,
kmeans`). Every one is covered by `gridline-tests.js`.

State pipeline: `ingest()` fills `state`; every change calls `renderAll()`, which sets
`state.filtered = applyFilters()` and then the render functions read `state.filtered`. Charts live in
the `charts{}` registry by key (`main/dist/top` plus the four decompose mini-panels
`dcObserved/dcTrend/dcSeasonal/dcResidual` and the `cluster` scatter) and are destroyed and recreated
each render.

## 4. How to develop and test

Follow this loop for any change.

A. Edit `gridline.html`. Line numbers shift after any edit, so re-grep for your next anchor rather
than trusting old line numbers.

B. Extract the app script and syntax-check. The app script is between the last `<script>` and
`</script>`:
```bash
cd /path/to/gridline
S=$(grep -n "^<script>$" gridline.html | tail -1 | cut -d: -f1)
E=$(grep -n "^</script>$" gridline.html | tail -1 | cut -d: -f1)
sed -n "$((S+1)),$((E-1))p" gridline.html > /tmp/gridline_mod.js
node --check /tmp/gridline_mod.js && echo SYNTAX_OK
```

C. Run the logic tests (they extract the module above and use the sample CSV):
```bash
node gridline-tests.js
```
These exercise the exported pure functions. Add a test for any new pure function before wiring its UI.

D. For UI/DOM changes, run the headless smoke test (`smoke.js`, jsdom). Install the two dev-only deps
if `node_modules` is missing:
```bash
npm install jsdom papaparse --no-audit --no-fund --loglevel=error
node smoke.js ./gridline.html ./sample-mandi-sales.csv
```
A benign `Window.scrollTo not implemented` warning prints to stderr; it is not an error.

For reference, `smoke.js` builds a `JSDOM` from `gridline.html` with `runScripts:"dangerously"` and a
`beforeParse(window)` that injects `window.Papa` (real PapaParse), `window.Chart = StubChart` (a no-op
class with `destroy/update/resize/toBase64Image`, a static `register(){}`,
`defaults = {font:{}, color:null, animation:null}`, recording each config to `StubChart.all`),
`HTMLCanvasElement.prototype.getContext = () => ({})`, `URL.createObjectURL = () => "blob:stub"`, a
`matchMedia` stub, and `window.onerror = m => errors.push(m)`. It then sets `#pasteArea.value`, clicks
`#pasteRead`, and asserts the dashboard renders with `errors` empty, exercising pivot
(`#pvRow`/`#pvCol`/`#pvVal`/`#pvAggSeg`), trend (`#maSeg [data-ma="7"]`), split (`#cSplit`), Indian
numbers (`#numFmtSeg [data-fmt="in"]`), pivot export (`#dlPivot`), and the date filter.

E. Re-run the constraint audit (must all be zero):
```bash
grep -ic 'localstorage\|sessionstorage\|fetch(' gridline.html
```

F. Ship: copy the updated `gridline.html` to wherever you distribute it.

Node gotcha: because the `module.exports` block returns early under Node, the IIFE never defines
`state` or runs DOM code there, so pure helpers must never reference `state` or `document`. That is
why the number-format mode is a module-level `var NUMFMT` (not `state.numFmt`); it keeps
`fmtCompact`/`fmtFull` testable in Node.

## 5. Hard constraints (what not to do)

These are non-negotiable; they define the product.

- No `localStorage` / `sessionStorage` / any browser storage, with one deliberate, scoped exception:
  saved SQL queries persist via `localStorage` under key `gridline.savedQueries`, every access
  try/caught so it degrades to in-session if storage is blocked (sandboxed iframe, private mode). That
  list (just user-written SQL text) is the only thing persisted; never CSV data, theme, or table
  state. Everything else is in-memory only. The only touch-points are `sqlLoadSaved`/`sqlPersistSaved`.
- No network requests at runtime (no backend). No `fetch`, no `XMLHttpRequest`. The only external
  resources are the two cdnjs library tags plus Google Fonts, loaded once at page load (and DuckDB-WASM
  from jsDelivr, but only on demand when the SQL panel is enabled). The product must keep working with
  zero backend access.
- Keep the single-file property unless there is a clear reason not to. It preserves one-file
  portability and trivial sharing. If you go multi-file, ship the libraries locally so it is truly
  offline, and deliver as a zip so the folder structure survives.
- Do not put a chart's container behind `display:none`. Chart.js sizes to its container at creation
  time, so a hidden (zero-size) container yields a broken canvas. The in-page nav is anchor-scroll only
  for this reason. If you must hide charts, call `chart.resize()` after showing.
- Do not reference `state` or `document` from Section-1 pure helpers (see the Node gotcha in section 4).
- Preserve the design discipline: one signal colour (burnt amber) for data marks; the multi-colour
  palette appears only when a chart is split into series. Keep the monochrome-amber look, the three
  fonts, and the tick-rail motif.
- Keep empty/error copy in the product's own voice; no apologies, no "Sorry."

## 6. How key parts work

- Percent is kept literal: `toNumber("14%") === 14` (not `0.14`). Intentional for a "drop any sheet"
  tool; do not change it to a fraction.
- Dates default to day-first (Indian locale) but the parser auto-switches to month-first when a sample
  proves it (`inferDateOrder`). `parseDateValue` returns epoch ms or null, not a `Date`.
- Number-format locale is always explicit. `numLoc()` returns `"en-IN"` for Indian mode and `"en-US"`
  for International, never `undefined`. Passing `undefined` to `toLocaleString` falls back to the
  runtime locale, which on an Indian-locale machine would make the "International (1.2M)" toggle render
  lakh/crore, so always pass an explicit locale.
- Week labels: the week-start year comes from the week-start date, not the bucket's representative
  point, so weeks spanning a year boundary label correctly.
- Indian compact formatting uses `toLocaleString('en-IN', {notation:'compact'})` giving `12.3L` /
  `1.2Cr`.
- Split totals reconcile: grouped aggregations are unit-tested so stacked charts sum to the same total
  as the key-figure cards; keep that invariant if you touch
  `timeSeriesGrouped`/`categoryAggGrouped`/`pivot`.
- Responsive Chart.js canvases need `min-width:0` tracks. A CSS grid/flex column holding a responsive
  Chart.js canvas must use `minmax(0,1fr)` (not bare `1fr`) and `min-width:0`, or the canvas can
  mis-size, blank out, or fail to resize in some browsers. Give every new chart track a 0 minimum. To
  test layout for real, use a real browser (Playwright); jsdom has no canvas or layout.
- Chart.js animations are disabled on purpose; do not re-enable them. On some Firefox builds Chart.js's
  animation tick loop throws `TypeError: this._fn is not a function` (`tick -> _update -> _request`),
  which renders the chart and then blanks it on the next update. `Chart.defaults.animation` and
  `Chart.defaults.animations` are set to `false` and the `transitions` durations are zeroed.
- There is a visible global error catcher (a small script just before the app script) that shows any
  uncaught runtime error in a red bottom banner. Keep it; it turns silent failures into visible ones.
  (`smoke.js` asserts no `#gl-errbar` appears during normal use.)
- Test in Firefox, not just Chromium, for chart issues; some chart bugs do not reproduce in headless
  Chromium. If Playwright Firefox/WebKit binaries can be installed (`npx playwright install firefox
  webkit`), test there too; otherwise test in the target browser and watch the console (the error
  catcher makes this easy).
- Analytics engine lives in Section 1 (pure helpers) and is exported for tests. Functions: `describe`
  (mean/median/std/quartiles/IQR/skew/outliers), `pearson` + `correlationMatrix`, `linreg`,
  `holtLinear`, `holtWinters`, `fitForecast` (auto-selects HW-seasonal vs Holt-linear, grid-searches
  smoothing params on in-sample RMSE, returns forecast plus a roughly 95% band and MAPE), and
  `rollingAnomalies`. They are pure (no DOM, no `state`) and covered by the harness. Seasonality period
  per granularity comes from `seasonPeriod(gran)` (`{day:7, week:52, month:12, quarter:4, year:1}`);
  future bucket labels come from `stepDate(ts, gran, k)`. `timeSeries` also returns `lastTs` for
  forecast labelling.
- Forecast backtesting is a pure Section-1 function `backtest(y, m, h, maxFolds)` (exported,
  unit-tested). Rolling-origin walk-forward: re-fits via `fitForecast` on `y.slice(0,cut)`, forecasts
  `h`, scores against the held-out actuals, stepping `cut` back by `h` over up to `maxFolds` (default 6)
  non-overlapping folds; compares to a naive baseline (seasonal-naive if `seasonal = m>1 && n>=2*m`,
  else last-value). Returns `{folds, horizon, points, rmse, mae, mape, naiveRmse, naiveMae, naiveMape,
  skill}` where `skill = 1 - rmse/naiveRmse`. `minTrain` is `seasonal ? 2*m : 4`, mirroring
  `fitForecast`'s own seasonal-to-Holt-linear fallback; keep it that way, or weekly series (m=52) would
  need 110+ points before it activates. `renderMainChart` sets
  `state._bt = backtest(values, seasonPeriod(gran), h)` next to `state._fc` (both reset at the top each
  render); `renderForecastAccuracy()` (called after the chart titles) fills `#fcAccuracy` with a
  verdict/metrics/note, shows a faint "not enough history" note when `_bt` is null, and hides when no
  forecast is drawn. The verdict thresholds key off `skill` (>=0.15 reliable / >=0.02 decent / >-0.02
  marginal / else weak).
- Decomposition and clustering are pure Section-1 functions (exported, unit-tested). `decompose(y, m)`
  gives `{trend, seasonal, residual, period, n, trendStrength, seasonalStrength}` via classical
  additive decomposition (`centeredMA` does 2xm centring for even m); seasonal indices are centred to
  sum near 0; strengths are `max(0, 1 - Var(resid)/Var(component+resid))` with a `>1e-9` guard so a
  perfect or zero-variance fit reports 0, not 1 (without it, pure-trend data reads as strongly
  seasonal). `kmeans(pts, k, maxIter, seed)` standardises features, does k-means++ init via a seeded
  `mulberry32` PRNG, re-seeds empty clusters, and returns `{assign, centers (de-standardised), sizes, k,
  iters, inertia}`; always pass a fixed seed (the UI uses 1337) so clusters do not reshuffle colours on
  every filter change. UI: `renderDecompose()` buckets the chosen measure over `state.dateCol` with
  `timeSeries`, builds a cycle-length list (only periods with `2*p<=n`), and draws four stacked panels
  via the `miniLine(canvasId, key, labels, data, color, opts)` helper (chart keys
  `dcObserved/dcTrend/dcSeasonal/dcResidual`); `renderCluster()` clusters on the two selected numeric
  columns only (so the scatter's separation is faithful; do not switch to all-dims/PCA without
  rethinking the visual), chart key `cluster`, centroids drawn as `rectRot` points that flip white in
  dark via `isDarkTheme()`. Both run in `renderAll()` after `renderStatistics()`, both validate their
  selections against `state.nums` each render (so they self-heal on a new file), and both bail with a
  `.dc-note`/`.cl-note` message (no throw) when prerequisites are missing. The four decompose canvases
  and the scatter use themed chart constants, so they recolour through `refreshThemeColors()` like every
  other chart.
- Dark mode and theming. Theme is driven entirely by CSS custom properties. Light values live in
  `:root{}`; dark values in `:root[data-theme="dark"]{}`, plus a handful of dark overrides for
  hardcoded light tints (the sticky `.secnav`, the `.insight`/`.delta`/`.chip` tint backgrounds, and
  the SQL `.sql-status.ok/.warn`/`.sql-error` boxes). A tiny inline script in `<head>` (before the
  stylesheet) resolves the initial theme from `prefers-color-scheme` so there is no flash. Canvas
  layers do not read CSS, so they are handled in JS: `refreshThemeColors()` (called at the top of
  `renderAll()`) re-reads `--signal`/`--grid`/`--muted`/`--surface` into the chart constants
  `AMBER`/`GRIDC`/`AXISC`/`CHART_BG` and swaps `PALETTE` between `PALETTE_LIGHT`/`PALETTE_DARK`; the
  chart background-fill plugin paints `CHART_BG` (the surface colour); and the correlation-heatmap
  `cellColor()` branches on `isDarkTheme()` for a dark midpoint. The header `#themeToggle` calls
  `setTheme()`, which flips `data-theme`, updates the sun/moon icon, and re-renders. Theme preference is
  deliberately not persisted (it honours the no-`localStorage` rule); it follows the OS each load with a
  per-session manual override. If you add any new chart or coloured surface, drive its colours from CSS
  vars (or the chart constants) so it themes for free.
- SQL workspace: DuckDB-WASM, lazy-loaded. Section `#sec-sql`. Nothing loads until the user clicks
  `#sqlEnable`; then `loadDuckDB()` runs. It dynamic-`import()`s
  `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@<DUCKDB_VERSION>/+esm` (DUCKDB_VERSION pinned near
  the top of the SQL section, currently 1.32.0, the latest stable; npm's "latest" tag is a dev build, so
  pin explicitly), calls `getJsDelivrBundles()` + `selectBundle()`, and creates the worker via the Blob
  + `importScripts(bundle.mainWorker)` pattern (required for cross-origin / `file://`).
  `sqlRegisterData()` rebuilds the loaded rows into a CSV with `Papa.unparse` and `CREATE TABLE data AS
  SELECT * FROM read_csv_auto(...)` (SQL runs on the full dataset, not the sidebar-filtered view, which
  is intentional and stated in the UI). `arrowValue()` converts DuckDB's 128-bit DECIMAL/HUGEINT results
  (Arrow returns them as `Uint32Array` limbs, little-endian, two's-complement) and BigInts to JS
  numbers; do not remove it or `sum()` columns render as objects. On a new file ingest, `sqlReRegister()`
  refreshes the table if the engine is already loaded.
- Testing DuckDB without CDN access. Offline CI cannot reach jsDelivr, so `loadDuckDB()` honours a
  `window.__DUCKDB_TEST_BUNDLE__ = {module, wasm, worker}` override pointing at same-origin local URLs.
  The recipe: `npm i @duckdb/duckdb-wasm apache-arrow`, bundle a self-contained ESM with `esbuild`
  (`echo "export * from '@duckdb/duckdb-wasm';" | esbuild --bundle --format=esm`, which inlines
  apache-arrow, mirroring the CDN `+esm`), copy that bundle plus `dist/duckdb-browser-eh.worker.js` and
  `dist/duckdb-eh.wasm` next to a copy of gridline.html, serve over a localhost HTTP server (must send
  `application/wasm` for `.wasm`), set the override via Playwright `addInitScript`, route the cdnjs
  Chart/Papa URLs to local copies, then ingest and click `#sqlEnable` and assert `#sqlResult table`
  populates. This covers instantiation, querying, the value formatter, schema/examples, and error
  handling; the only path it does not exercise is the live cross-origin CDN fetch itself, so open the
  SQL panel once on a networked machine to confirm the live download.
- Forecast control. The forecast control (`#fcSeg`, state `state.forecast`, horizon 0/3/6/12) shows only
  for a single un-split time series (toggled in `updateMaVisibility`); when on, `renderMainChart`
  extends the axis, adds a dashed projection plus two band datasets (`_lo`/`_hi`, filtered out of
  legend/tooltip by the leading-underscore convention), suppresses the moving-average overlay, marks
  anomalies as red points, and stashes the fit in `state._fc`. The lower band is clamped to >=0 for
  non-negative series. `renderInsights` (`#insightsBody`) and `renderStatistics` (`#statsTable` numeric
  profile + `#corrBody` correlation heatmap) run in `renderAll` after the charts so `state._fc` is
  fresh. Sections `#sec-insights` and `#sec-stats` are in the nav/scrollspy. Invariant: any handler that
  changes the main chart and could affect the forecast (X, Y, aggregate, type, split, forecast, MA)
  routes through `refreshChart()` = `renderMainChart() + renderInsights()`, so the insights forecast
  line never goes stale; `renderAll` still calls them separately. `state._fc` is reset at the top of
  `renderMainChart` on every call. Forecasting renders on line, area, and bar charts; the band datasets
  carry an explicit `type:"line"` so the band is a clean area on any base type.
- SQL multi-table, export, and saved queries. `state.duck.tables` is the list of registered tables
  (`{name, n}`), `data` always first; `sqlRegisterData` rebuilds `data` while preserving extras. Extra
  tables come from `sqlAddTableFromText(fileName, csvText)` (wired to `#sqlAddTable`, read via
  `FileReader`): Papa-parse -> `sqlSanitizeName` (filename to a valid, unique SQL identifier) ->
  `registerFileText` -> `CREATE TABLE "name"`. `sqlRenderSchema` loops every table (quoted
  `DESCRIBE "name"`), renders grouped chips with a `.sql-drop` x on extras (delegated click ->
  `sqlDropTable`, never drops `data`), captures columns per table, and, when there are two or more
  tables, appends a JOIN example built from the first shared column (`USING ("col")`) or an
  `ON a.<col>=b.<col>` template. `sqlRun` stashes the full result in `state.duck.lastResult`;
  `sqlExportCsv` unparses it via Papa + `downloadBlob`. `sqlSaveQuery`/`sqlRenderSaved` keep
  `state.duck.saved` surfaced in the `#sqlSaved` dropdown; the list is persisted to `localStorage`
  (`sqlLoadSaved`/`sqlPersistSaved`, try/caught) and a `#sqlDeleteSaved` button removes the selected one
  (see the storage-rule note in section 5). All controls are themed via existing CSS vars. SQL runs on
  the full unfiltered dataset.

## 7. Project context

Gridline is designed for Indian-locale data out of the box: lakh/crore number formatting and
DD/MM/YYYY dates, with the International (`1.2M`) format and ISO/other date orders fully supported. The
bundled demo is grain-trade themed (mandi sales), which is why the sample columns and example joins use
mandi / commodity / region data. Keep the practical, "drop any sheet and it just works" bias when
extending it: sensible defaults over configuration, and every change verified against the section 4
suite.

## 8. Possible future work

A menu of where Gridline could go, grouped by area. A star marks the highest practical value. Anything
that touches the chart, render, or `state` boundary should re-run the full section 4 suite (logic +
smoke + the integration browser test) before delivery.

A. Performance and scale
- Web Worker for off-main-thread parsing and aggregation (inline `Blob` worker to stay single-file) for
  100k to 1M rows without UI jank. A real refactor (the render/`state` layer would have to talk across
  the worker boundary) and low priority for typical use, where datasets are small; worth it only if
  very large files start getting loaded.
- Virtualised table rendering for huge row counts (today it paginates, which is fine).
- Memoise or debounce expensive aggregations on rapid filter dragging.

B. Data input
- (star) Excel (`.xlsx`) import via SheetJS, with a multi-sheet picker. Likely high value (traders live
  in Excel) and low-risk: lazy-load SheetJS from a CDN the same way DuckDB is loaded (keeps the
  single-file shape), convert the chosen sheet to CSV with `XLSX.utils.sheet_to_csv(...)`, and feed it
  into the existing ingest pipeline, so type detection, charts, forecasting, and SQL need no changes.
  An MVP loads the first sheet; add a sheet-picker dropdown only when a workbook has more than one tab.
  Pass `cellDates:true` so Excel date serials parse as real dates. Wire it into both the drop zone /
  file picker and the SQL "add table" path. Core path is roughly 40 to 50 lines.
- Streaming or chunked CSV parse for big files (pairs with the worker above).
- Column type overrides: let the user force a column to date / number / text when auto-detection
  guesses wrong.
- Configurable delimiter / TSV detection; handling of merged or multi-row headers.
- "Load CSV from URL": open a hosted file by link (useful for recurring or shared data).

C. Dates and numbers
- Explicit date-format picker plus timezone handling.
- Fiscal-year support (Apr to Mar for India) for period bucketing.
- Per-column number-format overrides; currency-symbol selection.

D. Forecasting
- Empirical prediction bands from backtest residuals instead of the current 1.96 times RMSE Gaussian
  assumption (more honest intervals on skewed data).
- More models: damped-trend Holt, multiplicative Holt-Winters, a light SARIMA/Prophet-style option;
  auto-pick by backtest skill.
- Multi-series or grouped forecasting.

E. Decomposition and clustering
- STL (loess) decomposition, more robust to outliers than the classical additive method; add a
  multiplicative option.
- Let the user pick the decomposition granularity directly.
- Cluster on more than two features with a PCA projection for the scatter; automatic k (elbow or
  silhouette) with the silhouette score shown; DBSCAN for density-based clusters.

F. Statistics
- More tests: two-sample t-test, ANOVA, chi-square (categorical association).
- Distribution or normality check; an outlier table with its own CSV export.

G. SQL workspace
- Column-name autocomplete in the editor; table rename.
- Automatic query history (beyond the manual saves), which pairs naturally with the persistent
  saved-query store.
- Parquet or JSON export of results (CSV is done); DuckDB also reads Parquet, so allow Parquet/JSON
  files as joinable tables.
- A small "relationships" hint for multi-table joins.

H. Export and reporting
- (star) One-click PDF or print report of the whole dashboard, plus an "export everything" bundle.
  High practical value for sharing. Add a dedicated print stylesheet.

I. UX and accessibility
- Saved "views": persist the whole dashboard config (scoped, the same way saved queries are) and/or
  make a view shareable via a URL hash.
- Opt-in persistence of theme, last config, and recent files. Keep it scoped and clearly opt-in; do not
  silently broaden browser storage beyond the saved-query exception.
- Compact or dense display mode; column show/hide and reorder in the table.
- Fuller accessibility: complete ARIA, keyboard navigation for charts, a high-contrast theme; mobile
  and responsive polish.

J. Distribution and infra
- (star) Host the single file on GitHub Pages with a README and a short demo GIF, turning the project
  into a clickable live demo.
- Locally-bundled libraries (zip delivery) for true offline use.
- Add Firefox and WebKit to the Playwright matrix once their binaries are installable in CI (currently
  Chromium-only); a CI script; visual-regression snapshots.

If picking one thing: GitHub Pages hosting plus README (distribution), Excel import (input), or the
PDF/print report (output) have the most real-world value.

## 9. Keeping docs in sync

Keep `README.md` and this file in sync with the code, and re-run the section 4 suite before delivering
changes.
