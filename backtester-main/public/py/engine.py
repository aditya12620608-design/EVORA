"""
QuantDeck backtest engine.

Runs unmodified in CPython (scripts/test-engine.py) and Pyodide (Web Worker).
No lookahead anywhere: strategy code only ever sees bars [0..i] inside next(),
HTF resamples only expose fully-closed higher-timeframe candles, and signals
fill at the next bar's open by default.
"""

import ast
import json
import math
import numpy as np
import pandas as pd

IST_OFFSET = 19800  # seconds; used for session days and square-off time

BARS_PER_YEAR = {
    "1d": 252.0,
    "1h": 252.0 * 6.5,
    "15m": 252.0 * 26.0,
    "5m": 252.0 * 78.0,
    "1m": 252.0 * 390.0,
}

_TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400}
_TF_PANDAS = {"1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "1d": "1D"}


# ---------------------------------------------------------------------------
# Params
# ---------------------------------------------------------------------------

class Param:
    """Tunable strategy parameter. The UI auto-renders a control from this."""

    def __init__(self, default, min=None, max=None, step=None, label=None, choices=None):
        self.default = default
        self.min = min
        self.max = max
        self.step = step
        self.label = label
        self.choices = choices

    @property
    def type(self):
        if isinstance(self.default, bool):
            return "bool"
        if self.choices is not None:
            return "choice"
        if isinstance(self.default, int):
            return "int"
        if isinstance(self.default, float):
            return "float"
        return "str"


def extract_params(code):
    """AST-parse strategy code and return its `params` dict spec WITHOUT executing it.

    Returns a JSON string: list of {key, default, min, max, step, label, choices, type}.
    """
    tree = ast.parse(code)
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        bases = [b.id for b in node.bases if isinstance(b, ast.Name)]
        if "BaseStrategy" not in bases:
            continue
        for stmt in node.body:
            if not (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1):
                continue
            t = stmt.targets[0]
            if not (isinstance(t, ast.Name) and t.id == "params" and isinstance(stmt.value, ast.Dict)):
                continue
            for k, v in zip(stmt.value.keys, stmt.value.values):
                if not (isinstance(k, ast.Constant) and isinstance(v, ast.Call)):
                    continue
                func = v.func
                fname = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
                if fname != "Param":
                    continue
                try:
                    args = [ast.literal_eval(a) for a in v.args]
                    kwargs = {kw.arg: ast.literal_eval(kw.value) for kw in v.keywords}
                except (ValueError, SyntaxError):
                    continue
                p = Param(*args, **kwargs)
                out.append({
                    "key": k.value, "default": p.default, "min": p.min, "max": p.max,
                    "step": p.step, "label": p.label or k.value, "choices": p.choices,
                    "type": p.type,
                })
    return json.dumps(out)


# ---------------------------------------------------------------------------
# Indicator library (pure numpy/pandas, vectorized, NaN-padded to input length)
# ---------------------------------------------------------------------------

def _np(x):
    return np.asarray(x, dtype=np.float64)


def sma(x, n):
    return pd.Series(_np(x)).rolling(int(n)).mean().to_numpy()


def ema(x, n):
    return pd.Series(_np(x)).ewm(span=int(n), adjust=False).mean().to_numpy()


def wma(x, n):
    n = int(n)
    w = np.arange(1, n + 1, dtype=np.float64)
    return pd.Series(_np(x)).rolling(n).apply(lambda v: np.dot(v, w) / w.sum(), raw=True).to_numpy()


def rsi(x, n=14):
    x = _np(x)
    d = np.diff(x, prepend=x[0])
    up = pd.Series(np.where(d > 0, d, 0.0)).ewm(alpha=1.0 / n, adjust=False).mean()
    dn = pd.Series(np.where(d < 0, -d, 0.0)).ewm(alpha=1.0 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    out = (100 - 100 / (1 + rs)).to_numpy()
    out[:int(n)] = np.nan
    return out


def macd(x, fast=12, slow=26, signal=9):
    line = ema(x, fast) - ema(x, slow)
    sig = pd.Series(line).ewm(span=int(signal), adjust=False).mean().to_numpy()
    return line, sig, line - sig


def atr(high, low, close, n=14):
    h, l, c = _np(high), _np(low), _np(close)
    pc = np.concatenate(([c[0]], c[:-1]))
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).ewm(alpha=1.0 / n, adjust=False).mean().to_numpy()


def supertrend(high, low, close, period=10, mult=3.0):
    h, l, c = _np(high), _np(low), _np(close)
    a = atr(h, l, c, period)
    mid = (h + l) / 2.0
    ub, lb = mid + mult * a, mid - mult * a
    n = len(c)
    st = np.full(n, np.nan)
    direction = np.ones(n)
    fub, flb = ub.copy(), lb.copy()
    for i in range(1, n):
        fub[i] = ub[i] if (ub[i] < fub[i - 1] or c[i - 1] > fub[i - 1]) else fub[i - 1]
        flb[i] = lb[i] if (lb[i] > flb[i - 1] or c[i - 1] < flb[i - 1]) else flb[i - 1]
        if direction[i - 1] == 1:
            direction[i] = -1 if c[i] < flb[i] else 1
        else:
            direction[i] = 1 if c[i] > fub[i] else -1
        st[i] = flb[i] if direction[i] == 1 else fub[i]
    return st, direction


def vwap(high, low, close, volume, session=None):
    """Session-anchored VWAP. Pass self.data.session for daily anchoring."""
    tp = (_np(high) + _np(low) + _np(close)) / 3.0
    v = _np(volume)
    if session is None:
        g = np.zeros(len(tp))
    else:
        g = np.asarray(session)
    df = pd.DataFrame({"pv": tp * v, "v": v, "g": g})
    cum = df.groupby("g", sort=False).cumsum()
    return (cum["pv"] / cum["v"].replace(0, np.nan)).to_numpy()


def bollinger(x, n=20, k=2.0):
    s = pd.Series(_np(x))
    mid = s.rolling(int(n)).mean()
    sd = s.rolling(int(n)).std(ddof=0)
    return mid.to_numpy(), (mid + k * sd).to_numpy(), (mid - k * sd).to_numpy()


def stoch(high, low, close, n=14, d=3):
    h, l, c = pd.Series(_np(high)), pd.Series(_np(low)), pd.Series(_np(close))
    hh, ll = h.rolling(int(n)).max(), l.rolling(int(n)).min()
    k = 100 * (c - ll) / (hh - ll).replace(0, np.nan)
    return k.to_numpy(), k.rolling(int(d)).mean().to_numpy()


def adx(high, low, close, n=14):
    h, l, c = _np(high), _np(low), _np(close)
    up = np.diff(h, prepend=h[0])
    dn = -np.diff(l, prepend=l[0])
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = pd.Series(atr(h, l, c, n))
    pdi = 100 * pd.Series(plus_dm).ewm(alpha=1.0 / n, adjust=False).mean() / a
    mdi = 100 * pd.Series(minus_dm).ewm(alpha=1.0 / n, adjust=False).mean() / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1.0 / n, adjust=False).mean().to_numpy()


def donchian(high, low, n=20):
    u = pd.Series(_np(high)).rolling(int(n)).max().to_numpy()
    l = pd.Series(_np(low)).rolling(int(n)).min().to_numpy()
    return u, l, (u + l) / 2.0


def highest(x, n):
    return pd.Series(_np(x)).rolling(int(n)).max().to_numpy()


def lowest(x, n):
    return pd.Series(_np(x)).rolling(int(n)).min().to_numpy()


def _last_two(x):
    if isinstance(x, (int, float)):
        return float(x), float(x)
    try:
        return float(x[-2]), float(x[-1])
    except IndexError:
        return math.nan, math.nan
    except TypeError:
        v = float(x)
        return v, v


def crossover(a, b):
    """True when `a` crossed above `b` on the current bar."""
    a0, a1 = _last_two(a)
    b0, b1 = _last_two(b)
    if any(math.isnan(v) for v in (a0, a1, b0, b1)):
        return False
    return a0 <= b0 and a1 > b1


def crossunder(a, b):
    return crossover(b, a)


INDICATORS = dict(
    ema=ema, sma=sma, wma=wma, rsi=rsi, macd=macd, atr=atr, supertrend=supertrend,
    vwap=vwap, bollinger=bollinger, stoch=stoch, adx=adx, donchian=donchian,
    highest=highest, lowest=lowest, crossover=crossover, crossunder=crossunder,
)


# ---------------------------------------------------------------------------
# Lookahead-safe array views
# ---------------------------------------------------------------------------

class _Array:
    """Numpy-backed series; indexing is relative to the engine's current bar.

    `arr[-1]` is the current bar's value; absolute/positive indices and slices
    are clamped to bars [0..i]. Reading past the current bar raises IndexError.
    """
    __slots__ = ("_a", "_bt")

    def __init__(self, a, bt):
        self._a = np.asarray(a, dtype=np.float64)
        self._bt = bt

    def _len(self):
        return self._bt._exposed_len

    def __len__(self):
        return self._len()

    def __getitem__(self, idx):
        L = self._len()
        if isinstance(idx, slice):
            return self._a[:L][idx]
        idx = int(idx)
        if idx < 0:
            idx += L
        if idx < 0 or idx >= L:
            raise IndexError(f"bar index {idx} not available yet (no lookahead; {L} bars visible)")
        return float(self._a[idx])

    def __array__(self, dtype=None, copy=None):
        a = self._a[:self._len()]
        return a.astype(dtype) if dtype is not None else a

    @property
    def raw(self):
        """Full underlying array — engine internal use only."""
        return self._a


class _HTFSeries(_Array):
    """HTF series projected onto base bars (lag-correct). Keeps the raw HTF
    array + mapping so indicators can be computed on true HTF candles."""
    __slots__ = ("htf_raw", "map_idx")

    def __init__(self, mapped, htf_raw, map_idx, bt):
        super().__init__(mapped, bt)
        self.htf_raw = np.asarray(htf_raw, dtype=np.float64)
        self.map_idx = map_idx


class _HTFView:
    def __init__(self, tf, fields, bt):
        self.tf = tf
        for name, (mapped, raw, idx) in fields.items():
            setattr(self, name, _HTFSeries(mapped, raw, idx, bt))


class _Data:
    def __init__(self, bt):
        self._bt = bt
        self.open = _Array(bt._open, bt)
        self.high = _Array(bt._high, bt)
        self.low = _Array(bt._low, bt)
        self.close = _Array(bt._close, bt)
        self.volume = _Array(bt._volume, bt)
        self.ts = _Array(bt._ts, bt)
        # session ordinal (IST day) — handy for vwap anchoring
        self.session = _Array((bt._ts + IST_OFFSET) // 86400, bt)

    def __len__(self):
        return self._bt._exposed_len


# ---------------------------------------------------------------------------
# Position / strategy API
# ---------------------------------------------------------------------------

class Position:
    def __init__(self, bt):
        self._bt = bt

    @property
    def _pos(self):
        return self._bt._pos

    @property
    def is_long(self):
        return self._pos is not None and self._pos["side"] == 1

    @property
    def is_short(self):
        return self._pos is not None and self._pos["side"] == -1

    @property
    def size(self):
        return self._pos["qty"] * self._pos["side"] if self._pos else 0

    @property
    def entry_price(self):
        return self._pos["entry_px"] if self._pos else None

    @property
    def pnl(self):
        """Unrealized gross P&L at the current bar close."""
        p = self._pos
        if not p:
            return 0.0
        c = self._bt._close[self._bt._i]
        return (c - p["entry_px"]) * p["qty"] * p["side"]

    def __bool__(self):
        return self._pos is not None

    def close(self, size=None, fraction=None):
        if self._pos:
            self._bt._queue_order({"action": "close", "size": size, "fraction": fraction})


class BaseStrategy:
    params = {}

    def init(self):
        pass

    def next(self):
        pass

    # -- wiring -------------------------------------------------------------
    def _bind(self, bt):
        self._bt = bt
        self.data = _Data(bt)
        self.position = Position(bt)

    @property
    def i(self):
        return self._bt._i

    @property
    def p(self):
        return self._bt._p

    def I(self, func, *args, timeframe=None, name=None, overlay=None, **kwargs):
        return self._bt._register_indicator(func, args, kwargs, timeframe, name, overlay)

    def resample(self, tf):
        return self._bt._resample(tf)

    def buy(self, size=None, sl=None, tp=None, sl_pct=None, tp_pct=None,
            trail_pct=None, trail_atr=None, trail_atr_period=14,
            break_even_at_pct=None, tag=""):
        self._bt._queue_order({"action": "buy", "size": size, "sl": sl, "tp": tp,
                               "sl_pct": sl_pct, "tp_pct": tp_pct, "trail_pct": trail_pct,
                               "trail_atr": trail_atr, "trail_atr_period": trail_atr_period,
                               "break_even_at_pct": break_even_at_pct, "tag": tag})

    def sell(self, size=None, sl=None, tp=None, sl_pct=None, tp_pct=None,
             trail_pct=None, trail_atr=None, trail_atr_period=14,
             break_even_at_pct=None, tag=""):
        self._bt._queue_order({"action": "sell", "size": size, "sl": sl, "tp": tp,
                               "sl_pct": sl_pct, "tp_pct": tp_pct, "trail_pct": trail_pct,
                               "trail_atr": trail_atr, "trail_atr_period": trail_atr_period,
                               "break_even_at_pct": break_even_at_pct, "tag": tag})

    def cancel_all(self):
        self._bt._pending = []

    def log(self, *args):
        print(*args)


class _ParamView:
    def __init__(self, d):
        self.__dict__.update(d)

    def __getitem__(self, k):
        return self.__dict__[k]


# ---------------------------------------------------------------------------
# Charges
# ---------------------------------------------------------------------------

def compute_leg_charges(side, qty, price, rows):
    """Itemized statutory + brokerage charges for one trade leg.

    Row: {name, basis: buy|sell|both, type: percent|flat_per_order|per_crore|percent_of,
          value, cap?, of?: [names]}  — `percent_of` applies `value`% to the sum of
    the named charges (e.g. GST on brokerage+txn+SEBI).
    """
    turnover = qty * price
    items = {}
    deferred = []
    for r in rows:
        basis = r.get("basis", "both")
        if basis != "both" and basis != side:
            items[r["name"]] = 0.0
            continue
        t = r["type"]
        if t == "percent":
            amt = turnover * r["value"] / 100.0
        elif t == "flat_per_order":
            amt = float(r["value"])
        elif t == "per_crore":
            amt = turnover / 1e7 * r["value"]
        elif t == "percent_of":
            deferred.append(r)
            continue
        else:
            amt = 0.0
        cap = r.get("cap")
        if cap is not None:
            amt = min(amt, float(cap))
        items[r["name"]] = round(amt, 4)
    for r in deferred:
        base = sum(items.get(n, 0.0) for n in r.get("of", []))
        items[r["name"]] = round(base * r["value"] / 100.0, 4)
    return items


# ---------------------------------------------------------------------------
# Backtest engine
# ---------------------------------------------------------------------------

class Backtest:
    def __init__(self, strategy_cls, ts, open_, high, low, close, volume, config, params=None):
        self._ts = np.asarray(ts, dtype=np.float64)
        self._open = np.asarray(open_, dtype=np.float64)
        self._high = np.asarray(high, dtype=np.float64)
        self._low = np.asarray(low, dtype=np.float64)
        self._close = np.asarray(close, dtype=np.float64)
        self._volume = np.asarray(volume, dtype=np.float64)
        self.n = len(self._close)
        self.cfg = config
        self.charges_rows = config.get("charges", [])
        self.capital = float(config.get("capital", 100000))
        self.execution = config.get("execution", "next_open")
        self.slip_type = config.get("slippage_type", "pct")
        self.slip_val = float(config.get("slippage_value", 0.0))
        self.margin_mult = float(config.get("margin_multiplier", 1.0))
        self.interval = config.get("interval", "1d")
        sq = config.get("squareoff") or {}
        self.squareoff_enabled = bool(sq.get("enabled", False))
        hh, mm = (sq.get("time") or "15:15").split(":")
        self.squareoff_min = int(hh) * 60 + int(mm)
        self.logs = []
        self.warnings = []

        # state
        self._i = -1
        self._exposed_len = self.n  # full view during init(); per-bar during run
        self._pos = None
        self._pending = []
        self._last_signal = None
        self._trades = []
        self._realized_net = 0.0
        self._open_entry_charges = 0.0
        self.equity = np.zeros(self.n)
        self.closed_equity = np.zeros(self.n)
        self._resample_cache = {}
        self._atr_cache = {}
        self.indicators = []
        self._base_dt = float(np.median(np.diff(self._ts))) if self.n > 1 else 86400.0

        # resolve params: class defaults overridden by `params` arg
        defaults = {k: v.default for k, v in strategy_cls.params.items()}
        if params:
            for k, v in params.items():
                if k in defaults:
                    if isinstance(defaults[k], bool):
                        v = bool(v)
                    elif isinstance(defaults[k], int) and not isinstance(defaults[k], bool):
                        v = int(v)
                    elif isinstance(defaults[k], float):
                        v = float(v)
                    defaults[k] = v
        self._p = _ParamView(defaults)

        self.strategy = strategy_cls()
        self.strategy._bind(self)
        self.strategy.init()
        self._exposed_len = 0

    # -- logging -------------------------------------------------------------
    def warn(self, msg):
        self.warnings.append(msg)
        print(f"[engine] {msg}")

    # -- indicators / HTF ------------------------------------------------------
    def _register_indicator(self, func, args, kwargs, timeframe, name, overlay):
        if timeframe:
            view = self._resample(timeframe)
            map_idx = None
            raw_args = []
            for a in args:
                if isinstance(a, _HTFSeries):
                    raw_args.append(a.htf_raw)
                    map_idx = a.map_idx
                else:
                    raw_args.append(a)
            if map_idx is None:
                map_idx = getattr(view.close, "map_idx")
            values = func(*raw_args, **kwargs)
            def project(v):
                v = np.asarray(v, dtype=np.float64)
                out = np.where(map_idx >= 0, v[np.clip(map_idx, 0, None)], np.nan)
                return out
            if isinstance(values, tuple):
                values = tuple(project(v) for v in values)
            else:
                values = project(values)
        else:
            plain = [np.asarray(a.raw if isinstance(a, _Array) else a) if not np.isscalar(a) and not isinstance(a, (int, float, str, bool)) else a for a in args]
            values = func(*plain, **kwargs)

        base = name or getattr(func, "__name__", "ind")
        if isinstance(values, tuple):
            outs = []
            for j, v in enumerate(values):
                outs.append(self._store_indicator(f"{base}[{j}]", v, overlay, timeframe))
            return tuple(outs)
        return self._store_indicator(base, values, overlay, timeframe)

    def _store_indicator(self, name, values, overlay, timeframe):
        v = np.asarray(values, dtype=np.float64)
        if len(v) != self.n:
            raise ValueError(f"indicator '{name}' length {len(v)} != data length {self.n}")
        if overlay is None:
            ok = v[~np.isnan(v)]
            lo, hi = np.nanmin(self._low) * 0.5, np.nanmax(self._high) * 1.5
            overlay = bool(len(ok) and np.mean((ok >= lo) & (ok <= hi)) > 0.8)
        self.indicators.append({"name": name, "values": v, "overlay": bool(overlay), "timeframe": timeframe})
        return _Array(v, self)

    def _resample(self, tf):
        if tf in self._resample_cache:
            return self._resample_cache[tf]
        if tf not in _TF_PANDAS:
            raise ValueError(f"unsupported timeframe '{tf}' (use one of {list(_TF_PANDAS)})")
        # resample on IST-shifted clock so '1d' aligns with Indian sessions
        idx = pd.to_datetime(self._ts + IST_OFFSET, unit="s")
        df = pd.DataFrame({"open": self._open, "high": self._high, "low": self._low,
                           "close": self._close, "volume": self._volume}, index=idx)
        agg = df.resample(_TF_PANDAS[tf], label="left", closed="left").agg(
            {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}).dropna(subset=["close"])
        # unit-safe epoch seconds (pandas 2 uses ns index, pandas 3 uses s)
        open_ts = agg.index.to_numpy().astype("datetime64[s]").astype(np.int64)
        close_ts = open_ts + _TF_SECONDS[tf]
        # HTF candle k is visible at base bar i iff it fully closed by bar i's close
        base_close = (self._ts + IST_OFFSET) + self._base_dt
        map_idx = np.searchsorted(close_ts, base_close, side="right") - 1
        fields = {}
        for col in ("open", "high", "low", "close", "volume"):
            raw = agg[col].to_numpy(dtype=np.float64)
            mapped = np.where(map_idx >= 0, raw[np.clip(map_idx, 0, None)], np.nan)
            fields[col] = (mapped, raw, map_idx)
        view = _HTFView(tf, fields, self)
        self._resample_cache[tf] = view
        return view

    # -- orders ----------------------------------------------------------------
    def _queue_order(self, order):
        try:
            if order.get("trail_pct") is not None and float(order["trail_pct"]) <= 0:
                self.warn(f"bar {self._i}: trail_pct must be greater than 0")
                return
            if order.get("trail_atr") is not None and float(order["trail_atr"]) <= 0:
                self.warn(f"bar {self._i}: trail_atr must be greater than 0")
                return
            if order.get("break_even_at_pct") is not None and float(order["break_even_at_pct"]) < 0:
                self.warn(f"bar {self._i}: break_even_at_pct cannot be negative")
                return
            if order.get("fraction") is not None and (
                    order.get("size") is not None or not math.isfinite(float(order["fraction"]))
                    or not 0 < float(order["fraction"]) <= 1):
                self.warn(f"bar {self._i}: partial close fraction must be greater than 0 and at most 1")
                return
        except (TypeError, ValueError):
            self.warn(f"bar {self._i}: exit settings must be numeric")
            return
        if order["action"] != "close" and order.get("trail_pct") is not None and order.get("trail_atr") is not None:
            self.warn(f"bar {self._i}: choose either trail_pct or trail_atr, not both")
            return
        if order["action"] == "buy" and self._pos and self._pos["side"] == 1:
            self.warn(f"bar {self._i}: buy() rejected — already long (no pyramiding in v1)")
            return
        if order["action"] == "sell" and self._pos and self._pos["side"] == -1:
            self.warn(f"bar {self._i}: sell() rejected — already short (no pyramiding in v1)")
            return
        order["placed_i"] = self._i
        if order["action"] in ("buy", "sell") and self._i == self.n - 1:
            self._last_signal = {"action": order["action"], "bar_index": self._i, "price": float(self._close[self._i]), "tag": str(order.get("tag", ""))}
        if self.execution == "same_close":
            self._execute_order(order, self._i, self._close[self._i], "close")
        else:
            self._pending.append(order)

    def _slip(self, price, buying):
        if self.slip_type == "pct":
            return price * (1 + self.slip_val / 100.0) if buying else price * (1 - self.slip_val / 100.0)
        return price + self.slip_val if buying else price - self.slip_val

    def _size_qty(self, order, price, equity, stop_price=None):
        if order.get("size"):
            return int(order["size"])
        s = self.cfg.get("sizing") or {}
        mode = s.get("mode", "pct_equity")
        if mode == "fixed_qty":
            return int(s.get("qty", 1))
        if mode == "fixed_value":
            return int(float(s.get("value", 100000)) // price)
        if mode == "lots":
            return int(s.get("lots", 1)) * int(s.get("lot_size", 1))
        if mode == "risk_pct":
            if stop_price is None or not math.isfinite(float(stop_price)) or abs(price - float(stop_price)) <= 0:
                self.warn(f"bar {self._i}: risk-% sizing needs a valid stop price")
                return 0
            risk_cash = equity * float(s.get("risk_pct", 1.0)) / 100.0
            return int(risk_cash // abs(price - float(stop_price)))
        return int(equity * float(s.get("pct", 100)) / 100.0 // price)

    def _execute_order(self, order, i, ref_price, fill_kind):
        action = order["action"]
        if action == "close":
            if self._pos:
                qty = self._pos["qty"]
                if order.get("fraction") is not None:
                    qty = max(1, int(round(qty * float(order["fraction"]))))
                elif order.get("size") is not None:
                    qty = max(0, int(order["size"]))
                px = self._slip(ref_price, buying=self._pos["side"] == -1)
                self._close_position(i, px, "signal", qty)
            return
        if self._pos:
            # reversal: close existing, then open opposite
            px = self._slip(ref_price, buying=self._pos["side"] == -1)
            self._close_position(i, px, "signal")
        side = 1 if action == "buy" else -1
        px = self._slip(ref_price, buying=side == 1)
        eq = self._current_equity(ref_price)
        sl = order.get("sl")
        tp = order.get("tp")
        if order.get("sl_pct") is not None:
            sl = px * (1 - side * order["sl_pct"] / 100.0)
        if order.get("tp_pct") is not None:
            tp = px * (1 + side * order["tp_pct"] / 100.0)
        qty = self._size_qty(order, px, eq, sl)
        if qty <= 0:
            self.warn(f"bar {i}: order rejected — sized to 0 qty at price {px:.2f}")
            return
        required = qty * px / self.margin_mult
        if required > eq:
            self.warn(f"bar {i}: order rejected — needs ₹{required:,.0f} margin, equity ₹{eq:,.0f}")
            return
        trail_pct = order.get("trail_pct")
        trail_atr = order.get("trail_atr")
        trail_period = max(1, int(order.get("trail_atr_period", 14)))
        trail_stop = None
        if trail_pct is not None:
            trail_stop = px * (1 - side * float(trail_pct) / 100.0)
        elif trail_atr is not None:
            atr_values = self._atr_cache.get(trail_period)
            if atr_values is None:
                atr_values = atr(self._high, self._low, self._close, trail_period)
                self._atr_cache[trail_period] = atr_values
            atr_i = min(max(int(order.get("placed_i", i)), 0), self.n - 1)
            atr_value = atr_values[atr_i]
            if not np.isnan(atr_value) and atr_value > 0:
                trail_stop = px - side * float(trail_atr) * atr_value
        leg = "buy" if side == 1 else "sell"
        charges = compute_leg_charges(leg, qty, px, self.charges_rows)
        self._open_entry_charges = sum(charges.values())
        self._pos = {"side": side, "qty": qty, "entry_px": px, "entry_i": i,
                     "entry_ts": self._ts[i], "sl": sl, "tp": tp, "tag": order.get("tag", ""),
                     "entry_charges": charges, "fill_kind": fill_kind,
                     "trail_pct": trail_pct, "trail_atr": trail_atr,
                     "trail_atr_period": trail_period, "trail_sl": trail_stop,
                     "best_high": px, "best_low": px,
                     "trail_start_i": i if fill_kind == "open" else i + 1,
                     "break_even_at_pct": order.get("break_even_at_pct"),
                     "break_even_active": False}

    def _close_position(self, i, px, reason, qty=None):
        p = self._pos
        if not p:
            return
        close_qty = min(p["qty"], int(qty if qty is not None else p["qty"]))
        if close_qty <= 0:
            return
        leg = "sell" if p["side"] == 1 else "buy"
        ratio = close_qty / p["qty"]
        entry_charges = {k: v * ratio for k, v in p["entry_charges"].items()}
        p["entry_charges"] = {k: v - entry_charges[k] for k, v in p["entry_charges"].items()}
        exit_charges = compute_leg_charges(leg, close_qty, px, self.charges_rows)
        gross = (px - p["entry_px"]) * close_qty * p["side"]
        total_charges = sum(entry_charges.values()) + sum(exit_charges.values())
        net = gross - total_charges
        self._realized_net += net
        p["qty"] -= close_qty
        self._open_entry_charges = sum(p["entry_charges"].values())
        turnover_in = close_qty * p["entry_px"]
        self._trades.append({
            "entry_ts": float(p["entry_ts"]), "exit_ts": float(self._ts[i]),
            "side": "long" if p["side"] == 1 else "short",
            "qty": close_qty, "entry_px": round(p["entry_px"], 4), "exit_px": round(px, 4),
            "gross_pnl": round(gross, 2), "charges": round(total_charges, 2),
            "charges_breakdown": {k: round(entry_charges.get(k, 0) + exit_charges.get(k, 0), 2)
                                  for k in set(entry_charges) | set(exit_charges)},
            "net_pnl": round(net, 2),
            "return_pct": round(net / turnover_in * 100.0, 4) if turnover_in else 0.0,
            "bars_held": int(i - p["entry_i"]),
            "entry_i": int(p["entry_i"]), "exit_i": int(i),
            "exit_reason": reason, "tag": p["tag"],
            "cum_net_pnl": round(self._realized_net, 2),
        })
        if p["qty"] <= 0:
            self._pos = None

    def _update_trailing_stops(self, i):
        """Ratchet stops using only the previous, fully completed bar."""
        p = self._pos
        if not p or i <= 0 or i - 1 < p["trail_start_i"]:
            return
        side = p["side"]
        previous_high, previous_low = self._high[i - 1], self._low[i - 1]
        trigger = p.get("break_even_at_pct")
        if trigger is not None and not p["break_even_active"]:
            reached = (previous_high >= p["entry_px"] * (1 + float(trigger) / 100.0)
                       if side == 1 else previous_low <= p["entry_px"] * (1 - float(trigger) / 100.0))
            if reached:
                p["break_even_active"] = True
                p["break_even_sl"] = p["entry_px"]

        if p.get("trail_pct") is not None:
            if side == 1:
                p["best_high"] = max(p["best_high"], previous_high)
                candidate = p["best_high"] * (1 - float(p["trail_pct"]) / 100.0)
                p["trail_sl"] = max(p["trail_sl"], candidate) if p["trail_sl"] is not None else candidate
            else:
                p["best_low"] = min(p["best_low"], previous_low)
                candidate = p["best_low"] * (1 + float(p["trail_pct"]) / 100.0)
                p["trail_sl"] = min(p["trail_sl"], candidate) if p["trail_sl"] is not None else candidate
        elif p.get("trail_atr") is not None:
            period = p["trail_atr_period"]
            values = self._atr_cache.get(period)
            if values is None:
                values = atr(self._high, self._low, self._close, period)
                self._atr_cache[period] = values
            atr_value = values[i - 1]
            if not np.isnan(atr_value) and atr_value > 0:
                if side == 1:
                    p["best_high"] = max(p["best_high"], previous_high)
                    candidate = p["best_high"] - float(p["trail_atr"]) * atr_value
                    p["trail_sl"] = max(p["trail_sl"], candidate) if p["trail_sl"] is not None else candidate
                else:
                    p["best_low"] = min(p["best_low"], previous_low)
                    candidate = p["best_low"] + float(p["trail_atr"]) * atr_value
                    p["trail_sl"] = min(p["trail_sl"], candidate) if p["trail_sl"] is not None else candidate

    def _check_sl_tp(self, i):
        """Intrabar SL/TP on bar i's high/low. Worst case: SL before TP."""
        p = self._pos
        if not p:
            return
        h, l, o = self._high[i], self._low[i], self._open[i]
        side = p["side"]
        stops = [x for x in (p["sl"], p.get("trail_sl"), p.get("break_even_sl")) if x is not None]
        sl = (max(stops) if side == 1 else min(stops)) if stops else None
        tp = p["tp"]
        sl_hit = sl is not None and (l <= sl if side == 1 else h >= sl)
        tp_hit = tp is not None and (h >= tp if side == 1 else l <= tp)
        if sl_hit:  # worst case first
            level = sl
            if (side == 1 and o < sl) or (side == -1 and o > sl):
                level = o  # gapped through the stop — fill at open
            px = self._slip(level, buying=side == -1)
            self._close_position(i, px, "sl")
        elif tp_hit:
            level = tp
            if (side == 1 and o > tp) or (side == -1 and o < tp):
                level = o
            px = self._slip(level, buying=side == -1)
            self._close_position(i, px, "tp")

    def _current_equity(self, mark_price):
        eq = self.capital + self._realized_net
        if self._pos:
            p = self._pos
            eq += (mark_price - p["entry_px"]) * p["qty"] * p["side"] - self._open_entry_charges
        return eq

    # -- run loop -----------------------------------------------------------
    def run_chunk(self, max_bars=5000):
        """Process up to max_bars bars. Returns (bars_done, total, finished)."""
        end = min(self._i + 1 + max_bars, self.n)
        i = self._i + 1
        while i < end:
            self._i = i
            self._exposed_len = i + 1
            # 1) pending orders fill at this bar's open
            if self._pending:
                pending, self._pending = self._pending, []
                for o in pending:
                    self._execute_order(o, i, self._open[i], "open")
            self._update_trailing_stops(i)
            # 2) intrabar SL/TP
            self._check_sl_tp(i)
            # 3) strategy decision with data up to bar i
            self.strategy.next()
            # 4) intraday square-off
            if self.squareoff_enabled and self._pos:
                minute = int(((self._ts[i] + IST_OFFSET) % 86400) // 60)
                if minute >= self.squareoff_min:
                    px = self._slip(self._close[i], buying=self._pos["side"] == -1)
                    self._close_position(i, px, "eod")
                    self._pending = []
            # 5) mark to market
            self.equity[i] = self._current_equity(self._close[i])
            self.closed_equity[i] = self.capital + self._realized_net
            i += 1
        finished = self._i >= self.n - 1
        if finished and self._pos:
            px = self._slip(self._close[self.n - 1], buying=self._pos["side"] == -1)
            self._close_position(self.n - 1, px, "end_of_data")
            self.equity[self.n - 1] = self._current_equity(self._close[self.n - 1])
            self.closed_equity[self.n - 1] = self.capital + self._realized_net
        return self._i + 1, self.n, finished

    # -- results ---------------------------------------------------------------
    def finalize(self):
        eq = self.equity
        n = self.n
        ts = self._ts
        bpy = BARS_PER_YEAR.get(self.interval, 252.0)
        rf = float(self.cfg.get("risk_free", 0.065))

        peak = np.maximum.accumulate(eq)
        dd = (eq - peak) / np.where(peak == 0, 1, peak) * 100.0
        max_dd_pct = float(dd.min()) if n else 0.0
        max_dd_rs = float((eq - peak).min()) if n else 0.0
        # drawdown duration: longest run below previous peak
        underwater = dd < 0
        max_run = run = 0
        dd_end = 0
        for k in range(n):
            run = run + 1 if underwater[k] else 0
            if run > max_run:
                max_run, dd_end = run, k
        dd_days = 0.0
        if max_run:
            dd_days = (ts[dd_end] - ts[dd_end - max_run + 1]) / 86400.0

        rets = np.diff(eq) / np.where(eq[:-1] == 0, 1, eq[:-1])
        excess = rets - rf / bpy
        vol_ann = float(np.std(rets, ddof=1) * math.sqrt(bpy)) * 100 if len(rets) > 1 else 0.0
        sharpe = float(np.mean(excess) / np.std(rets, ddof=1) * math.sqrt(bpy)) if len(rets) > 1 and np.std(rets, ddof=1) > 0 else 0.0
        downside = rets[rets < 0]
        sortino = float(np.mean(excess) / np.std(downside, ddof=1) * math.sqrt(bpy)) if len(downside) > 1 and np.std(downside, ddof=1) > 0 else 0.0

        years = max((ts[-1] - ts[0]) / (365.25 * 86400.0), 1e-9) if n > 1 else 1e-9
        final = float(eq[-1]) if n else self.capital
        cagr = ((final / self.capital) ** (1 / years) - 1) * 100 if final > 0 else -100.0
        calmar = float(cagr / abs(max_dd_pct)) if max_dd_pct < 0 else 0.0

        trades = self._trades
        wins = [t for t in trades if t["net_pnl"] > 0]
        losses = [t for t in trades if t["net_pnl"] <= 0]
        gross_win = sum(t["net_pnl"] for t in wins)
        gross_loss = abs(sum(t["net_pnl"] for t in losses))
        total_charges = sum(t["charges"] for t in trades)
        gross_pnl = sum(t["gross_pnl"] for t in trades)
        net_pnl = sum(t["net_pnl"] for t in trades)
        avg_win = gross_win / len(wins) if wins else 0.0
        avg_loss = gross_loss / len(losses) if losses else 0.0
        win_rate = len(wins) / len(trades) * 100 if trades else 0.0
        expectancy = net_pnl / len(trades) if trades else 0.0
        expectancy_r = (expectancy / avg_loss) if avg_loss else 0.0

        max_consec_loss = cl = 0
        for t in trades:
            cl = cl + 1 if t["net_pnl"] <= 0 else 0
            max_consec_loss = max(max_consec_loss, cl)

        trade_bars = sum(t["bars_held"] for t in trades)
        # Partial exit rows overlap the same open-position interval. Count the
        # union for exposure, while keeping average holding time per row below.
        intervals = sorted((t["entry_i"], t["exit_i"]) for t in trades)
        in_market = 0
        active_start = active_end = None
        for start, end in intervals:
            if active_start is None:
                active_start, active_end = start, end
            elif start <= active_end:
                active_end = max(active_end, end)
            else:
                in_market += active_end - active_start
                active_start, active_end = start, end
        if active_start is not None:
            in_market += active_end - active_start
        longs = [t for t in trades if t["side"] == "long"]
        shorts = [t for t in trades if t["side"] == "short"]

        def side_stats(arr):
            w = [t for t in arr if t["net_pnl"] > 0]
            return {"count": len(arr),
                    "win_rate": round(len(w) / len(arr) * 100, 2) if arr else 0.0,
                    "net_pnl": round(sum(t["net_pnl"] for t in arr), 2)}

        bh = self.capital * self._close / self._close[0] if n and self._close[0] else np.full(n, self.capital)
        bh_ret = (float(bh[-1]) / self.capital - 1) * 100 if n else 0.0
        net_ret = (final / self.capital - 1) * 100

        # monthly returns from equity (IST calendar)
        monthly = []
        if n > 1:
            midx = pd.to_datetime(ts + IST_OFFSET, unit="s")
            s = pd.Series(eq, index=midx)
            try:
                me = s.resample("ME").last()
            except ValueError:
                me = s.resample("M").last()
            prev = self.capital
            for stamp, v in me.items():
                if math.isnan(v):
                    continue
                monthly.append({"year": int(stamp.year), "month": int(stamp.month),
                                "ret": round((v / prev - 1) * 100, 2)})
                prev = v

        metrics = {
            "net_pnl": round(net_pnl, 2), "net_pnl_pct": round(net_ret, 2),
            "gross_pnl": round(gross_pnl, 2), "total_charges": round(total_charges, 2),
            "cagr": round(cagr, 2), "buy_hold_pct": round(bh_ret, 2),
            "alpha_vs_bh": round(net_ret - bh_ret, 2),
            "max_dd_pct": round(max_dd_pct, 2), "max_dd_rs": round(max_dd_rs, 2),
            "max_dd_bars": int(max_run), "max_dd_days": round(dd_days, 1),
            "sharpe": round(sharpe, 2), "sortino": round(sortino, 2), "calmar": round(calmar, 2),
            "volatility_ann": round(vol_ann, 2), "max_consec_losses": int(max_consec_loss),
            "total_trades": len(trades), "win_rate": round(win_rate, 2),
            "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else (999.0 if gross_win else 0.0),
            "expectancy": round(expectancy, 2), "expectancy_r": round(expectancy_r, 2),
            "avg_win": round(avg_win, 2), "avg_loss": round(avg_loss, 2),
            "payoff_ratio": round(avg_win / avg_loss, 2) if avg_loss else 0.0,
            "largest_win": round(max((t["net_pnl"] for t in trades), default=0.0), 2),
            "largest_loss": round(min((t["net_pnl"] for t in trades), default=0.0), 2),
            "avg_bars_held": round(trade_bars / len(trades), 1) if trades else 0.0,
            "avg_charges": round(total_charges / len(trades), 2) if trades else 0.0,
            "long_stats": side_stats(longs), "short_stats": side_stats(shorts),
            "exposure_pct": round(in_market / n * 100, 2) if n else 0.0,
            "sl_exits": sum(1 for t in trades if t["exit_reason"] == "sl"),
            "tp_exits": sum(1 for t in trades if t["exit_reason"] == "tp"),
            "signal_exits": sum(1 for t in trades if t["exit_reason"] == "signal"),
            "eod_exits": sum(1 for t in trades if t["exit_reason"] in ("eod", "end_of_data")),
            "final_equity": round(final, 2), "initial_capital": self.capital,
            "charges_pct_of_gross": round(total_charges / abs(gross_pnl) * 100, 2) if gross_pnl else 0.0,
        }
        self.bh = bh
        self.drawdown = dd
        return {
            "metrics": metrics, "trades": trades, "monthly": monthly,
            "warnings": self.warnings,
            "lastSignal": self._last_signal,
            "indicators": [{"name": d["name"], "overlay": d["overlay"], "timeframe": d["timeframe"]}
                           for d in self.indicators],
        }


# ---------------------------------------------------------------------------
# Strategy compilation (shared by worker and tests)
# ---------------------------------------------------------------------------

def build_strategy_class(code):
    """Exec user code with the engine API in scope; return the BaseStrategy subclass."""
    ns = {"BaseStrategy": BaseStrategy, "Param": Param, "np": np, "pd": pd,
          "math": math, **INDICATORS}
    exec(compile(code, "<strategy>", "exec"), ns)
    candidates = [v for v in ns.values()
                  if isinstance(v, type) and issubclass(v, BaseStrategy) and v is not BaseStrategy]
    if not candidates:
        raise ValueError("No class subclassing BaseStrategy found in strategy code")
    return candidates[-1]
