# QuantDeck

Professional strategy backtesting that runs **entirely in the browser**. Python
strategies (backtesting.py-style API) execute inside a Web Worker via Pyodide on
real Yahoo Finance data, with first-class Indian charges & taxes. The only
server code is a thin Next.js route that proxies Yahoo Finance.

The workspace includes a searchable gallery of ready-to-edit strategy templates,
a cancellable parameter optimizer (up to 500 grid combinations), and trailing,
break-even, and partial-exit controls in the Python strategy API. Optimizer
results are historical simulations and can overfit; they are not a promise of
returns.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

First load downloads the Pyodide runtime (+numpy/pandas, ~12 MB) from CDN once;
it stays warm for all subsequent runs.

Full setup, test and troubleshooting guide: [docs/running.md](docs/running.md).
How to write strategies: [docs/strategy-format.md](docs/strategy-format.md)
(also rendered in-app under the Docs tab).

## Tests

```bash
python3 scripts/test-engine.py        # engine unit tests (plain CPython)
npm run build && npm run start -- -p 3177
node scripts/acceptance.mjs           # browser acceptance test (needs Chrome)
```

The engine test suite covers: no-lookahead, next-open execution, intrabar SL/TP
worst-case (SL first), HTF resample lag-correctness, Zerodha charges math
against hand-computed examples, metrics fixtures, sizing/margin rules, intraday
square-off, trailing and break-even stops, partial exits, and AST param
extraction. It also runs every gallery strategy on daily index-like data with
zero volume. Browser acceptance runs each template on real NIFTY 50 daily data.

## Architecture

```
Main thread   UI (Next.js 15, Tailwind, Monaco, lightweight-charts)
              Zustand store ←→ Dexie (IndexedDB: strategies, candle cache)
                 │ typed postMessage (lib/worker-protocol.ts)
Web worker    public/workers/backtest.worker.js
              Pyodide + numpy/pandas + public/py/engine.py (loaded once)
Server        app/api/data/yahoo/route.ts — CORS proxy + normalization
```

- Candle data moves to the worker as `Float64Array` buffers, never JSON.
- `engine.py` runs identically under CPython and Pyodide; all backtest
  semantics (fills at next open, intrabar SL/TP, charges per leg, metrics)
  live there.
- Strategy `params` are AST-extracted without executing user code; the params
  panel passes overrides at run time.
- Cancellation: chunked execution (4000 bars/chunk) yields to the worker event
  loop; `setInterruptBuffer` is used when cross-origin isolation is available.

## Key files

| Path | What |
| --- | --- |
| `public/py/engine.py` | Backtest engine: BaseStrategy, indicators, broker, charges, metrics |
| `scripts/test-engine.py` | CPython engine test suite |
| `public/workers/backtest.worker.js` | Pyodide worker (kept out of the bundler on purpose) |
| `lib/worker-protocol.ts` | Typed message protocol (keep in sync with the worker) |
| `lib/store.ts` | App state: strategies, runs, data, console |
| `lib/charges-presets.ts` | Indian charge profiles (delivery/intraday/futures/options) |
| `components/charts/` | lightweight-charts: candles+markers, equity, drawdown |
