"""Engine unit tests — run with plain CPython: python3 scripts/test-engine.py"""
import json
import math
import os
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "public", "py"))
import engine  # noqa: E402
from engine import (Backtest, BaseStrategy, Param, build_strategy_class,  # noqa: E402
                    compute_leg_charges, crossover, ema, extract_params)

PASS = 0
FAIL = []


def check(name, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print(f"  ok  {name}")
    else:
        FAIL.append(name)
        print(f" FAIL {name} {detail}")


def approx(a, b, tol=1e-6):
    return abs(a - b) <= tol


def make_data(n=300, start=1_700_000_000, dt=86400, base=100.0, drift=0.1, seed=7):
    rng = np.random.default_rng(seed)
    ts = start + np.arange(n, dtype=np.float64) * dt
    close = base + np.cumsum(rng.normal(drift, 1.0, n))
    close = np.maximum(close, 5.0)
    open_ = np.concatenate(([base], close[:-1])) + rng.normal(0, 0.05, n)
    high = np.maximum(open_, close) + np.abs(rng.normal(0.3, 0.2, n))
    low = np.minimum(open_, close) - np.abs(rng.normal(0.3, 0.2, n))
    vol = np.abs(rng.normal(1e5, 1e4, n))
    return ts, open_, high, low, close, vol


BASE_CFG = {"capital": 1_000_000, "execution": "next_open", "slippage_type": "pct",
            "slippage_value": 0.0, "charges": [], "interval": "1d",
            "sizing": {"mode": "fixed_qty", "qty": 1}, "margin_multiplier": 1.0}


# ---------------------------------------------------------------- no lookahead
print("\n# no-lookahead")
seen = []

class Probe(BaseStrategy):
    def next(self):
        seen.append((self.i, self.data.close[-1], len(self.data)))
        try:
            _ = self.data.close[self.i + 1]
            seen.append(("LOOKAHEAD", self.i))
        except IndexError:
            pass

ts, o, h, l, c, v = make_data(50)
bt = Backtest(Probe, ts, o, h, l, c, v, dict(BASE_CFG))
while not bt.run_chunk(7)[2]:
    pass
check("next() called for every bar", len(seen) == 50)
check("data.close[-1] equals close[i] at each bar",
      all(s[1] == c[s[0]] and s[2] == s[0] + 1 for s in seen if s[0] != "LOOKAHEAD"))
check("reading past current bar raises IndexError",
      not any(s[0] == "LOOKAHEAD" for s in seen))

# vectorized indicator registered in init is masked during next()
masked = []

class ProbeInd(BaseStrategy):
    def init(self):
        self.e = self.I(ema, self.data.close, 5)
    def next(self):
        full = engine.ema(c, 5)
        masked.append(approx(self.e[-1], full[self.i], 1e-9) and len(self.e) == self.i + 1)

bt = Backtest(ProbeInd, ts, o, h, l, c, v, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
check("self.I series masked to current bar", all(masked) and len(masked) == 50)

# ------------------------------------------------------------ next-open fills
print("\n# execution model")

class BuyAt10(BaseStrategy):
    def next(self):
        if self.i == 10 and not self.position:
            self.buy()
        if self.i == 20 and self.position:
            self.position.close()

bt = Backtest(BuyAt10, ts, o, h, l, c, v, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
r = bt.finalize()
t = r["trades"][0]
check("signal at bar 10 fills at open of bar 11",
      t["entry_i"] == 11 and approx(t["entry_px"], o[11], 1e-4), f"got {t}")
check("close signal at bar 20 exits at open of bar 21",
      t["exit_i"] == 21 and approx(t["exit_px"], o[21], 1e-4))

cfg = dict(BASE_CFG, execution="same_close")
bt = Backtest(BuyAt10, ts, o, h, l, c, v, cfg)
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("same_close mode fills at close of signal bar",
      t["entry_i"] == 10 and approx(t["entry_px"], c[10], 1e-4))

# risk-% sizing uses the configured capital risk divided by entry-to-stop distance
print("\n# risk sizing")
class BuyWithStop(BaseStrategy):
    def next(self):
        if self.i == 10 and not self.position:
            self.buy(sl_pct=10)
        if self.i == 20 and self.position:
            self.position.close()

risk_cfg = dict(BASE_CFG, capital=1000,
                sizing={"mode": "risk_pct", "risk_pct": 1}, margin_multiplier=10)
bt = Backtest(BuyWithStop, ts, o, h, l, c, v, risk_cfg)
while not bt.run_chunk(100)[2]:
    pass
risk_trades = bt.finalize()["trades"]
check("risk-% sizing derives quantity from stop distance", bool(risk_trades) and risk_trades[0]["qty"] == 1)

class BuyWithoutStop(BaseStrategy):
    def next(self):
        if self.i == 10 and not self.position:
            self.buy()

bt = Backtest(BuyWithoutStop, ts, o, h, l, c, v, risk_cfg)
while not bt.run_chunk(100)[2]:
    pass
missing_stop_result = bt.finalize()
check("risk-% sizing rejects entry without stop", not missing_stop_result["trades"] and any("needs a valid stop" in w for w in missing_stop_result["warnings"]))

# slippage
cfg = dict(BASE_CFG, slippage_type="pct", slippage_value=0.1)
bt = Backtest(BuyAt10, ts, o, h, l, c, v, cfg)
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("pct slippage applied against trader on both legs",
      approx(t["entry_px"], o[11] * 1.001, 1e-4) and approx(t["exit_px"], o[21] * 0.999, 1e-4))

# ---------------------------------------------------- SL/TP worst-case same bar
print("\n# SL/TP intrabar, worst case")
n = 10
ts2 = 1_700_000_000 + np.arange(n) * 86400.0
o2 = np.full(n, 100.0); c2 = np.full(n, 100.0)
h2 = np.full(n, 100.5); l2 = np.full(n, 99.5); v2 = np.full(n, 1e5)
# entry fills at open of bar 3 (=100). Bar 4 hits BOTH sl (98) and tp (102).
h2[4], l2[4], c2[4] = 103.0, 97.0, 100.0

class SLTP(BaseStrategy):
    def next(self):
        if self.i == 2 and not self.position:
            self.buy(sl_pct=2.0, tp_pct=2.0)

bt = Backtest(SLTP, ts2, o2, h2, l2, c2, v2, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("both hit same bar -> SL first (worst case)", t["exit_reason"] == "sl", t["exit_reason"])
check("fills at SL level, not close", approx(t["exit_px"], 98.0, 1e-6), t["exit_px"])

# gap through stop -> fill at open
o3 = o2.copy(); h3 = h2.copy(); l3 = l2.copy(); c3 = c2.copy()
h3[4], l3[4], c3[4] = 100.5, 99.5, 100.0
o3[4] = 95.0; l3[4] = 94.0
bt = Backtest(SLTP, ts2, o3, h3, l3, c3, v2, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("gap below SL fills at open (worse)", t["exit_reason"] == "sl" and approx(t["exit_px"], 95.0, 1e-6), t)

# short side TP
class ShortTP(BaseStrategy):
    def next(self):
        if self.i == 2 and not self.position:
            self.sell(sl_pct=2.0, tp_pct=2.0)

h4 = np.full(n, 100.5); l4 = l2.copy(); l4[4] = 97.0  # only short TP (98) hit on bar 4
bt = Backtest(ShortTP, ts2, o2, h4, l4, c2, v2, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("short TP at 98 fills correctly", t["side"] == "short" and t["exit_reason"] == "tp"
      and approx(t["exit_px"], 98.0, 1e-6), t)

# ------------------------------------------------------- trailing + break-even
print("\n# trailing and break-even stops use prior completed bars")
nt = 6
tt = 1_700_000_000 + np.arange(nt) * 86400.0
ot = np.full(nt, 100.0); ct = ot.copy()
ht = np.array([101.0, 110.0, 130.0, 101.0, 101.0, 101.0])
lt = np.array([99.0, 96.0, 104.0, 99.0, 99.0, 99.0])
ot[2] = 106.0  # avoid a gap through the newly ratcheted 104.5 stop
vt = np.full(nt, 1e5)

class TrailPct(BaseStrategy):
    def next(self):
        if self.i == 0:
            self.buy(trail_pct=5)

bt = Backtest(TrailPct, tt, ot, ht, lt, ct, vt, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("percent trail waits for completed high then exits at prior-high stop",
      t["exit_reason"] == "sl" and approx(t["exit_px"], 104.5), t)

ha = np.array([101.0, 110.0, 110.0, 101.0, 101.0, 101.0])
la = np.array([99.0, 99.0, 98.0, 99.0, 99.0, 99.0])
class TrailATR(BaseStrategy):
    def next(self):
        if self.i == 0:
            self.buy(trail_atr=1, trail_atr_period=1)

bt = Backtest(TrailATR, tt, ot, ha, la, ct, vt, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("ATR trail uses prior ATR and extreme", t["exit_reason"] == "sl" and approx(t["exit_px"], 99.0), t)

hb = np.array([101.0, 106.0, 101.0, 101.0, 101.0, 101.0])
lb = np.array([99.0, 104.0, 99.0, 99.0, 99.0, 99.0])
class BreakEven(BaseStrategy):
    def next(self):
        if self.i == 0:
            self.buy(break_even_at_pct=5)

bt = Backtest(BreakEven, tt, ot, hb, lb, ct, vt, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
t = bt.finalize()["trades"][0]
check("break-even activates from prior completed-bar move", t["exit_reason"] == "sl" and approx(t["exit_px"], 100.0), t)

# ------------------------------------------------------------- partial exits
print("\n# partial exits are separate rows with allocated entry charges")
op = np.array([100.0, 100, 100, 110, 110, 90, 90])
cp = op.copy(); hp = op + 1; lp = op - 1; vp = np.full(len(op), 1000.0)
PARTIAL_CHARGE = [{"name": "Order fee", "basis": "both", "type": "flat_per_order", "value": 10}]
class PartialExit(BaseStrategy):
    def next(self):
        if self.i == 0 and not self.position:
            self.buy(size=10)
        elif self.i == 2 and self.position:
            self.position.close(fraction=0.5)
        elif self.i == 4 and self.position:
            self.position.close()

bt = Backtest(PartialExit, np.arange(len(op), dtype=np.float64) * 86400 + 1_700_000_000,
              op, hp, lp, cp, vp, dict(BASE_CFG, charges=PARTIAL_CHARGE))
while not bt.run_chunk(100)[2]:
    pass
partial = bt.finalize()["trades"]
check("half close then final close create two trade rows",
      len(partial) == 2 and [t["qty"] for t in partial] == [5, 5], partial)
check("entry fee is allocated and each exit fee charged",
      all(approx(t["charges"], 15.0) for t in partial)
      and all(approx(t["charges_breakdown"]["Order fee"], 15.0) for t in partial), partial)
check("partial trade net P&L and running total are reconciled",
      [t["net_pnl"] for t in partial] == [35.0, -65.0]
      and approx(partial[-1]["cum_net_pnl"], -30.0), partial)
check("partial exits do not double-count market exposure",
      approx(bt.finalize()["metrics"]["exposure_pct"], round(4 / 7 * 100, 2), 0.01))

# ------------------------------------------------------------ HTF lag-correct
print("\n# HTF resample lag-correctness")
# 5-minute bars over 3 days, 09:15-15:25 IST
bars = []
day0 = (1_700_000_000 // 86400) * 86400 - engine.IST_OFFSET  # midnight IST
for d in range(3):
    start = day0 + d * 86400 + (9 * 60 + 15) * 60
    for k in range(74):  # 09:15 .. 15:20 starts
        bars.append(start + k * 300)
ts5 = np.array(bars, dtype=np.float64)
n5 = len(ts5)
c5 = 100 + np.arange(n5, dtype=np.float64) * 0.1  # strictly increasing => easy to verify
o5 = c5 - 0.05; h5 = c5 + 0.1; l5 = o5 - 0.1; v5 = np.full(n5, 1000.0)

htf_seen = []

class HTFProbe(BaseStrategy):
    def init(self):
        self.htf = self.resample("1h")
    def next(self):
        try:
            htf_seen.append((self.i, self.htf.close[-1]))
        except IndexError:
            htf_seen.append((self.i, math.nan))

bt = Backtest(HTFProbe, ts5, o5, h5, l5, c5, v5, dict(BASE_CFG))
while not bt.run_chunk(1000)[2]:
    pass

# independently compute expected: last fully-closed hour candle as of bar close
ist = ts5 + engine.IST_OFFSET
hour_open = (ist // 3600) * 3600
ok_lag = True
for i, val in htf_seen:
    bar_close = ist[i] + 300
    # close of last hour candle whose [open, open+3600] fully closed by bar_close
    members = None
    best = None
    seen_hours = sorted(set(hour_open[:i + 1]))
    for hop in seen_hours:
        if hop + 3600 <= bar_close:
            idxs = np.where(hour_open[:i + 1] == hop)[0]
            best = c5[idxs[-1]]
    if best is None:
        if not math.isnan(val):
            ok_lag = False
            break
    elif not approx(val, best, 1e-9):
        ok_lag = False
        print(f"   mismatch at bar {i}: got {val}, want {best}")
        break
check("htf.close[-1] == last fully-closed 1h candle (no lookahead)", ok_lag)

future_used = any(not math.isnan(val) and val > c5[i] + 1e-9 for i, val in htf_seen)
check("htf never exposes future data (monotone series test)", not future_used)

# HTF indicator projection
class HTFInd(BaseStrategy):
    def init(self):
        htf = self.resample("1h")
        self.t = self.I(ema, htf.close, 3, timeframe="1h")
    def next(self):
        pass

bt = Backtest(HTFInd, ts5, o5, h5, l5, c5, v5, dict(BASE_CFG))
while not bt.run_chunk(1000)[2]:
    pass
ind = bt.indicators[0]["values"]
check("HTF indicator projected to base length, NaN before first close",
      len(ind) == n5 and math.isnan(ind[0]) and not math.isnan(ind[-1]))

# --------------------------------------------------------------- charges math
print("\n# charges vs hand-computed Zerodha equity-intraday example")
INTRADAY = [
    {"name": "Brokerage", "basis": "both", "type": "percent", "value": 0.03, "cap": 20},
    {"name": "STT", "basis": "sell", "type": "percent", "value": 0.025},
    {"name": "Exchange Txn", "basis": "both", "type": "percent", "value": 0.00297},
    {"name": "SEBI", "basis": "both", "type": "per_crore", "value": 10},
    {"name": "Stamp Duty", "basis": "buy", "type": "percent", "value": 0.003},
    {"name": "GST", "basis": "both", "type": "percent_of", "value": 18,
     "of": ["Brokerage", "Exchange Txn", "SEBI"]},
]
# Buy 100 @ ₹1000 => turnover 100,000
buy = compute_leg_charges("buy", 100, 1000.0, INTRADAY)
check("brokerage = min(0.03% of 1L, ₹20) = ₹20", approx(buy["Brokerage"], 20.0))
check("STT not charged on buy (intraday)", approx(buy["STT"], 0.0))
check("exchange txn 0.00297% of 1L = ₹2.97", approx(buy["Exchange Txn"], 2.97))
check("SEBI ₹10/crore on 1L = ₹0.10", approx(buy["SEBI"], 0.10))
check("stamp 0.003% buy = ₹3.00", approx(buy["Stamp Duty"], 3.0))
check("GST 18% on (20+2.97+0.10) = ₹4.1526", approx(buy["GST"], 4.1526, 1e-4))
sell = compute_leg_charges("sell", 100, 1010.0, INTRADAY)
check("sell STT 0.025% of 1.01L = ₹25.25", approx(sell["STT"], 25.25))
check("sell stamp = 0", approx(sell["Stamp Duty"], 0.0))
small = compute_leg_charges("buy", 10, 100.0, INTRADAY)
check("brokerage 0.03% of ₹1000 = ₹0.30 (below cap)", approx(small["Brokerage"], 0.30))

# ------------------------------------------------------------- metrics fixture
print("\n# metrics on a known fixture")
nf = 6
tsf = 1_700_000_000 + np.arange(nf) * 86400.0
of_ = np.array([100.0, 100, 110, 110, 100, 100])
cf = np.array([100.0, 110, 110, 100, 100, 100])
hf = np.maximum(of_, cf) + 1; lf = np.minimum(of_, cf) - 1
vf = np.full(nf, 1e5)

class TwoTrades(BaseStrategy):
    def next(self):
        if self.i == 0:
            self.buy()      # fills bar1 open=100, exits...
        if self.i == 1:
            self.position.close()  # exits bar2 open=110 -> +10
        if self.i == 2:
            self.buy()      # fills bar3 open=110
        if self.i == 3:
            self.position.close()  # exits bar4 open=100 -> -10

cfgf = dict(BASE_CFG, capital=1000.0)
bt = Backtest(TwoTrades, tsf, of_, hf, lf, cf, vf, cfgf)
while not bt.run_chunk(100)[2]:
    pass
res = bt.finalize()
m = res["metrics"]
check("2 trades", m["total_trades"] == 2)
check("win rate 50%", approx(m["win_rate"], 50.0))
check("net pnl 0", approx(m["net_pnl"], 0.0))
check("profit factor 1.0", approx(m["profit_factor"], 1.0))
check("expectancy 0/trade", approx(m["expectancy"], 0.0))
check("avg win 10 / avg loss 10 / payoff 1", approx(m["avg_win"], 10) and approx(m["avg_loss"], 10)
      and approx(m["payoff_ratio"], 1.0))
check("largest win/loss ±10", approx(m["largest_win"], 10) and approx(m["largest_loss"], -10))
check("exposure 2/6 bars", approx(m["exposure_pct"], round(2 / 6 * 100, 2), 0.01))
check("max consecutive losses = 1", m["max_consec_losses"] == 1)
# equity MTM: bar1 open 100 -> close 110 = +10 unrealized
check("equity marked to market per bar", approx(bt.equity[1], 1010.0))
check("buy&hold benchmark present", approx(m["buy_hold_pct"], 0.0))

# ------------------------------------------------------------ sizing & margin
print("\n# sizing, margin, pyramiding guard")
cfg = dict(BASE_CFG, capital=1000.0, sizing={"mode": "fixed_qty", "qty": 50})
bt = Backtest(BuyAt10, ts, o, h, l, c, v, cfg)
while not bt.run_chunk(100)[2]:
    pass
res = bt.finalize()
check("order exceeding capital rejected with warning",
      len(res["trades"]) == 0 and any("rejected" in w for w in res["warnings"]))

cfg = dict(BASE_CFG, capital=1000.0, sizing={"mode": "fixed_qty", "qty": 50}, margin_multiplier=10.0)
bt = Backtest(BuyAt10, ts, o, h, l, c, v, cfg)
while not bt.run_chunk(100)[2]:
    pass
check("margin multiplier allows the same order", len(bt.finalize()["trades"]) == 1)

class DoubleBuy(BaseStrategy):
    def next(self):
        if self.i in (2, 5) and True:
            self.buy()

bt = Backtest(DoubleBuy, ts, o, h, l, c, v, dict(BASE_CFG))
while not bt.run_chunk(100)[2]:
    pass
res = bt.finalize()
check("buy() while long rejected (no pyramiding)",
      any("already long" in w for w in res["warnings"]))

cfg = dict(BASE_CFG, sizing={"mode": "lots", "lots": 2, "lot_size": 75})
bt = Backtest(BuyAt10, ts, o, h, l, c, v, dict(cfg, margin_multiplier=5.0))
while not bt.run_chunk(100)[2]:
    pass
check("lots sizing: qty = 2 × 75", bt.finalize()["trades"][0]["qty"] == 150)

# ------------------------------------------------------------------ square-off
print("\n# intraday square-off")
class HoldForever(BaseStrategy):
    def next(self):
        if self.i == 1 and not self.position:
            self.buy()

bt = Backtest(HoldForever, ts5, o5, h5, l5, c5, v5,
              dict(BASE_CFG, squareoff={"enabled": True, "time": "15:15"}, interval="5m"))
while not bt.run_chunk(1000)[2]:
    pass
res = bt.finalize()
t0 = res["trades"][0]
exit_min = int(((t0["exit_ts"] + engine.IST_OFFSET) % 86400) // 60)
check("position force-closed at/after 15:15 IST with reason eod",
      t0["exit_reason"] == "eod" and exit_min >= 15 * 60 + 15, t0)

# ------------------------------------------------------------ param extraction
print("\n# AST param extraction")
CODE = '''
class Strategy(BaseStrategy):
    params = {
        "fast_ema": Param(9, min=2, max=100, step=1, label="Fast EMA"),
        "sl_pct": Param(1.0, min=0.1, max=10.0, step=0.1, label="Stop Loss %"),
        "use_htf": Param(True, label="Use 1h trend filter"),
        "htf": Param("1h", choices=["15m","1h","1d"], label="Higher TF"),
    }
    def init(self):
        self.fast = self.I(ema, self.data.close, self.p.fast_ema)
        self.slow = self.I(ema, self.data.close, 21)
    def next(self):
        if crossover(self.fast, self.slow):
            self.buy(sl_pct=self.p.sl_pct, tp_pct=2.0)
        elif crossover(self.slow, self.fast):
            self.position.close()
'''
spec = json.loads(extract_params(CODE))
check("4 params extracted without exec", len(spec) == 4)
types = {s["key"]: s["type"] for s in spec}
check("types inferred", types == {"fast_ema": "int", "sl_pct": "float", "use_htf": "bool", "htf": "choice"})
check("choices preserved", next(s for s in spec if s["key"] == "htf")["choices"] == ["15m", "1h", "1d"])
check("min/max/step preserved", next(s for s in spec if s["key"] == "fast_ema")["max"] == 100)

# ------------------------------------------------------- end-to-end smoke test
print("\n# end-to-end EMA crossover with charges + param override")
ts9, o9, h9, l9, c9, v9 = make_data(1200, dt=86400, drift=0.05, seed=42)
cls = build_strategy_class(CODE)
cfg = dict(BASE_CFG, charges=INTRADAY, sizing={"mode": "pct_equity", "pct": 50})
bt = Backtest(cls, ts9, o9, h9, l9, c9, v9, cfg, params={"fast_ema": 5, "use_htf": False})
while not bt.run_chunk(500)[2]:
    pass
res = bt.finalize()
m = res["metrics"]
check("strategy produced trades", m["total_trades"] > 3, m["total_trades"])
check("param override applied (p.fast_ema=5)", bt._p.fast_ema == 5)
check("all trades have itemized charges",
      all(t["charges"] > 0 and "GST" in t["charges_breakdown"] for t in res["trades"]))
check("trade fields complete", all(k in res["trades"][0] for k in
      ("entry_ts", "exit_ts", "side", "qty", "entry_px", "exit_px", "gross_pnl",
       "charges", "net_pnl", "return_pct", "bars_held", "exit_reason", "tag", "cum_net_pnl")))
check("metrics serializable to JSON", bool(json.dumps(res)))
check("equity curve fully populated", len(bt.equity) == 1200 and bt.equity[0] != 0)
check("indicator series registered", len(bt.indicators) == 2 and bt.indicators[0]["overlay"])
check("gross - charges = net (per trade)",
      all(approx(t["gross_pnl"] - t["charges"], t["net_pnl"], 0.011) for t in res["trades"]))

# ------------------------------------------------------------ gallery templates
print("\n# built-in templates on daily index-like data")
template_source = (Path(__file__).resolve().parents[1] / "lib" / "example-strategies.ts").read_text(encoding="utf-8")
template_codes = re.findall(r"const [A-Z][A-Z0-9_]* = `([\s\S]*?)`;", template_source)
check("all 11 gallery templates discovered", len(template_codes) == 11, len(template_codes))
ntpl = 1200
idx = np.arange(ntpl, dtype=np.float64)
tpl_close = 18000 + 0.03 * idx + 240 * np.sin(idx / 11.0) + 520 * np.sin(idx / 57.0)
tpl_open = tpl_close + 15 * np.sin(idx / 5.0)
tpl_high = np.maximum(tpl_open, tpl_close) + 75
tpl_low = np.minimum(tpl_open, tpl_close) - 75
tpl_ts = 1_700_000_000 + idx * 86400
tpl_volume = np.zeros(ntpl)  # NIFTY index feeds commonly have no usable volume
for template_index, template_code in enumerate(template_codes):
    try:
        template_cls = build_strategy_class(template_code)
        template_bt = Backtest(template_cls, tpl_ts, tpl_open, tpl_high, tpl_low,
                               tpl_close, tpl_volume, dict(BASE_CFG))
        while not template_bt.run_chunk(4000)[2]:
            pass
        template_bt.finalize()
        check(f"template {template_index + 1} runs without error", True)
    except Exception as exc:
        check(f"template {template_index + 1} runs without error", False, str(exc))

# crossover helper
check("crossover scalar/array mix", crossover(np.array([1.0, 3.0]), 2.0) is True
      and crossover(np.array([3.0, 1.0]), 2.0) is False)

print(f"\n{PASS} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", *FAIL, sep="\n  - ")
    sys.exit(1)
