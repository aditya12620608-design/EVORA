# Running QuantDeck

Everything you need to start, build, and test the project locally.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 18.18+ (tested on 22) | the app itself |
| npm | comes with Node | dependencies |
| Python 3 + numpy + pandas | 3.10+ (tested on 3.12) | engine unit tests only — **not** needed to run the app |
| Google Chrome | any recent | browser acceptance test only |
| Internet access | — | Pyodide CDN (first load) + Yahoo Finance data |

The app itself needs **no Python installed** — strategies run on Pyodide
(Python compiled to WebAssembly) downloaded by the browser.

## 1. Install

```bash
cd backtester
npm install
```

## 2. Development server

```bash
npm run dev
```

Open <http://localhost:3000>. The first load shows the boot screen while the
browser downloads the Pyodide runtime + numpy/pandas (~12 MB, one time — it's
cached by the browser afterwards). When the **▶ RUN** button appears, the
Python runtime is warm.

Quick smoke test: keep the default EMA Crossover strategy, leave NIFTY 50 /
`1d` / 5Y selected, press **▶ RUN** (or `Ctrl/Cmd+Enter`). You should get a
populated Overview tab and ~30 trades.

## 3. Production build

```bash
npm run build
npm run start            # serves on :3000
npm run start -- -p 3177 # ...or any other port
```

## 4. Tests

### Engine unit tests (CPython — fast, no browser)

```bash
# needs: pip install numpy pandas  (or system packages)
python3 scripts/test-engine.py
```

Expected output ends with `72 passed, 0 failed`. Covers: no-lookahead,
execution model, intrabar SL/TP worst-case, HTF lag-correctness, Zerodha
charges math, metrics fixtures, sizing/margin, square-off, trailing and
break-even stops, partial exits and exposure accounting, AST param extraction, and every built-in
template on daily index-like bars with zero volume.

### Browser acceptance test (drives real Chrome)

```bash
npm install --no-save playwright-core    # one time
npm run build && npm run start -- -p 3177 &
node scripts/acceptance.mjs              # defaults to http://localhost:3177
```

Expected output ends with `ACCEPTANCE: PASSED`. It boots Pyodide, runs the
default strategy on real NIFTY data twice (cold + warm), and checks metrics,
trades, itemized charges, all chart tabs, the template gallery, and that the
browser console is clean. It also runs all built-in templates on NIFTY 50 daily
data. The script looks for Chrome at `/usr/bin/google-chrome` — edit
`executablePath` in `scripts/acceptance.mjs` if yours lives elsewhere.

## 5. Where your work is stored

Strategies, param overrides, run configs, charges profiles and the candle
cache all live in your **browser's IndexedDB** (database `quantdeck`) — there
is no server-side state. Consequences:

- Clearing site data wipes your strategies → use the **↓ export** button in the
  strategy list (left rail) to keep `.py` backups; re-import via **+ → Import .py**.
- A different browser/profile = a different workspace.
- Candle data is cached per `symbol|interval`; the **Data** tab has a
  **⟳ FORCE REFRESH CACHE** button if Yahoo data looks stale.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Boot screen stuck at "Loading Python runtime…" | Pyodide CDN (`cdn.jsdelivr.net`) unreachable — check network/proxy/adblock, then reload. |
| `Yahoo Finance rate limit hit` toast | Yahoo throttles bursts. Wait ~1 minute. Cached symbols keep working offline. |
| `Symbol 'X' not found` | Use Yahoo's ticker format: NSE stocks need `.NS` (`RELIANCE.NS`), indices use `^` (`^NSEI`). |
| Range clamped toast on intraday | Yahoo's history limits: `1m` ≈ 7 days, `5m`/`15m` ≈ 60 days, `1h` ≈ 730 days. Use `1d` for older history. |
| Port already in use | `npm run dev -- -p 3001` (or kill the stale `next-server` process). |
| Worker crashed toast | The app restarts the Python worker automatically; if it loops, hard-reload (Ctrl+Shift+R). |
| Strategy errors | The Console tab shows the Python traceback; the offending line is highlighted red in the editor. |

## See also

- [docs/strategy-format.md](strategy-format.md) — how to write strategy code
- In-app **Docs** tab — same reference + copyable example strategies
