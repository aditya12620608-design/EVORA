# QuantDeck Strategy Code Format

Every strategy you write in the editor must follow this format. The same
reference (condensed) is available in-app under the **Docs** tab.

Your code runs as real Python (numpy + pandas via Pyodide) inside a Web Worker
— nothing is sent to a server.

## 1. Minimal skeleton

```python
class Strategy(BaseStrategy):

    params = {
        "fast": Param(9, min=2, max=100, step=1, label="Fast EMA"),
    }

    def init(self):
        # runs ONCE before the bar loop — precompute indicators here
        self.fast = self.I(ema, self.data.close, self.p.fast)

    def next(self):
        # runs on EVERY bar — make trading decisions here
        if self.data.close[-1] > self.fast[-1]:
            self.buy()
```

Hard rules:

| Rule | Why |
| --- | --- |
| Exactly one class subclassing `BaseStrategy` | The engine finds and instantiates it. The class name itself doesn't matter (`Strategy` is conventional). If several subclasses exist, the **last one defined** is used. |
| `params` must be a **literal** dict of `Param(...)` calls | The Params panel is built by AST-parsing your code **without executing it** — computed values (`Param(2*5)`, variables, f-strings) are skipped silently. Use plain literals: `Param(9, min=2, max=100)`. |
| Don't override `__init__` | Use `init()` instead; the engine wires `self.data`, `self.p`, `self.position` before calling it. |
| `init()` for vectorized work, `next()` for per-bar logic | `next()` is a Python loop over every bar — heavy computation there will be slow. Indicators belong in `init()` via `self.I`. |

## 2. Parameters — `Param`

```python
params = {
    "fast_ema": Param(9,    min=2,   max=100,  step=1,   label="Fast EMA"),    # int slider
    "sl_pct":   Param(1.0,  min=0.1, max=10.0, step=0.1, label="Stop Loss %"), # float slider
    "use_htf":  Param(True,  label="Use HTF filter"),                          # toggle
    "htf":      Param("1h",  choices=["15m", "1h", "1d"], label="Higher TF"),  # dropdown
}
```

- The type is inferred from the default: `int`, `float`, `bool`, or string-with-`choices`.
- Read values via `self.p.<key>` (e.g. `self.p.fast_ema`).
- Tweaking a value in the Params panel passes an **override at run time** — your
  source code is never modified. The amber dot resets a param to its code default.

## 3. Data access — `self.data`

| Accessor | Meaning |
| --- | --- |
| `self.data.open / high / low / close / volume` | OHLCV series (numpy-backed) |
| `self.data.ts` | bar open time, unix seconds (UTC) |
| `self.data.session` | IST day ordinal — use to anchor `vwap` per session |
| `self.i` | current bar index |
| `len(self.data)` | bars visible so far (= `self.i + 1`) |

Indexing is **relative to the current bar**: `[-1]` is the current bar, `[-2]`
the previous, `[0]` the first bar. Slices work: `self.data.close[-20:]`.

**No lookahead is possible.** Inside `next()` the engine masks every series to
bars `[0..i]`; reading past the current bar raises `IndexError`.

## 4. Indicators — `self.I(...)`

```python
self.fast = self.I(ema, self.data.close, 9)                    # registered + plotted
self.st, self.st_dir = self.I(supertrend, self.data.high,
                              self.data.low, self.data.close)  # tuple-returning
```

`self.I(func, *args, timeframe=None, name=None, overlay=None)`:

- Computes once (vectorized), registers the series for plotting on the Chart
  tab (price-scale overlays on the candles, oscillators in a sub-pane —
  auto-detected, override with `overlay=True/False`), and returns a
  lookahead-masked series you can index like `self.data.close`.
- Functions returning tuples (`macd`, `bollinger`, `stoch`, `supertrend`,
  `donchian`) register one series per element and return a tuple.

Built-in indicator library (pure numpy/pandas):

| Function | Signature → returns |
| --- | --- |
| `ema`, `sma`, `wma` | `(series, n)` |
| `rsi` | `(series, n=14)` |
| `macd` | `(series, fast=12, slow=26, signal=9)` → `(line, signal, hist)` |
| `atr` | `(high, low, close, n=14)` |
| `supertrend` | `(high, low, close, period=10, mult=3)` → `(line, direction ±1)` |
| `vwap` | `(high, low, close, volume, session=None)` |
| `bollinger` | `(series, n=20, k=2)` → `(mid, upper, lower)` |
| `stoch` | `(high, low, close, n=14, d=3)` → `(k, d)` |
| `adx` | `(high, low, close, n=14)` |
| `donchian` | `(high, low, n=20)` → `(upper, lower, mid)` |
| `highest`, `lowest` | `(series, n)` |
| `crossover(a, b)` / `crossunder(a, b)` | `True` on the bar where `a` crosses above/below `b` (scalars allowed: `crossover(self.rsi, 30)`) |

Custom indicators work — `np` (numpy), `pd` (pandas) and `math` are in scope:

```python
self.skew = self.I(lambda c: pd.Series(c).rolling(20).skew().to_numpy(),
                   self.data.close, name="skew20", overlay=False)
```

The function receives full numpy arrays and must return an array (or tuple of
arrays) of the same length, NaN-padded at the start.

## 5. Multi-timeframe — `self.resample(tf)`

```python
def init(self):
    htf = self.resample("1h")                                  # "15m" | "30m" | "1h" | "1d"
    self.trend = self.I(ema, htf.close, 50, timeframe="1h")    # EMA on true 1h candles

def next(self):
    if self.data.close[-1] > self.trend[-1]: ...
    last_hour_close = self.resample("1h").close[-1]            # also fine per-bar
```

- The base data is resampled with pandas — never a second fetch.
- The view is **lag-correct**: at any base bar, `htf.close[-1]` is the close of
  the last **fully closed** HTF candle. A forming candle is never visible.
- Pass `timeframe="1h"` to `self.I` so the indicator is computed on true HTF
  candles and projected back to base bars (values are NaN until the first HTF
  candle closes — guard with `math.isnan` if needed).

## 6. Orders & position

```python
self.buy(size=None, sl=None, tp=None, sl_pct=None, tp_pct=None,
         trail_pct=None, trail_atr=None, trail_atr_period=14,
         break_even_at_pct=None, tag="")
self.sell(...)            # short entry, same signature
self.position.close()     # close all at the next fill point
self.position.close(fraction=0.5)  # close half of the remaining quantity
self.position.close(size=10)       # close 10 units (or all if fewer remain)
self.cancel_all()         # drop pending (unfilled) orders
```

- `sl`/`tp` are absolute prices; `sl_pct`/`tp_pct` are % from the fill price.
- `trail_pct` trails the best completed-bar extreme by a percentage; `trail_atr`
  trails it by an ATR multiple (`trail_atr_period` defaults to 14). Use one
  trailing mode per entry.
- `break_even_at_pct` moves the stop to the entry price after a favorable
  completed-bar move reaches that percentage. For example, `break_even_at_pct=1`
  activates after price moves 1% in your favor.
- Trailing and break-even changes use the previous completed bar only. They
  become active on the following bar, so an intrabar high/low cannot move a stop
  and trigger it on that same bar.
- Partial `position.close(...)` exits fill at the configured fill point and
  appear as separate trade rows. Entry charges are allocated across the closed
  quantity; the remaining position keeps its share of those charges.
- `size` overrides the position-sizing mode configured in the Params panel
  (fixed qty / fixed ₹ / % equity / F&O lots).
- `tag` is free text, shown in the Trades table.
- `self.position`: truthy when open; `.is_long`, `.is_short`, `.size` (signed),
  `.entry_price`, `.pnl` (unrealized, gross).

One position at a time (v1): `buy()` while long is rejected with a console
warning; `buy()` while **short** closes the short and reverses.

## 7. Execution semantics (what your signals actually do)

- A signal from `next()` on bar *i* fills at the **open of bar i+1** by default
  ("same bar close" is configurable in Run Config). No lookahead anywhere.
- Slippage (₹ or %/side, Run Config) is applied against you on every fill.
- **SL/TP are checked intrabar** against each bar's high/low. If both hit in
  one bar, worst case is assumed: **SL first**. Fills happen at the SL/TP level
  — or the bar's open if it gapped through the level.
- Trailing and break-even stops join the SL checks. If any stop and a target
  both hit in one bar, the stop wins. Trailing stops only ratchet from the
  previous completed bar's extreme and ATR.
- Orders needing more than `equity × margin multiplier` are rejected (warning).
- Optional intraday square-off force-closes at the configured IST time.
- Charges (if enabled) are computed per leg from the selected profile and
  itemized per trade.

## 8. Output & debugging

- `print(...)` (or `self.log(...)`) goes to the **Console** tab.
- Uncaught exceptions stop the run; the traceback appears in the Console and
  the offending line is highlighted red in the editor.
- Exit reasons in the Trades table: `signal` (including partial signal exits), `sl`, `tp`, `eod` (square-off),
  `end_of_data` (forced close on the last bar).

## 9. Common mistakes

```python
# ✗ computed param — invisible to the AST parser
params = {"n": Param(BARS * 2)}
# ✓ literal
params = {"n": Param(50)}

# ✗ heavy work per bar
def next(self):
    e = ema(self.data.close, 20)          # recomputes the whole series every bar!
# ✓ precompute once
def init(self):
    self.e = self.I(ema, self.data.close, 20)

# ✗ absolute indexing into the future
self.data.close[self.i + 1]               # raises IndexError (by design)

# ✓ guard warm-up NaNs
if not math.isnan(self.trend[-1]) and crossover(self.fast, self.slow):
    self.buy()
```

## 10. Import / export format

Exporting a strategy from the left rail produces a single `.py` file: your code
followed by a one-line JSON sidecar comment
(`# === QUANTDECK-META ... ===`) carrying the name, param overrides, run
config and data config. Importing a plain `.py` without the sidecar also works
— it just gets default config.
