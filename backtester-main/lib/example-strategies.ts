/** Ready-to-run strategy templates and their plain-language gallery details. */

export interface StrategyTemplate {
  name: string;
  code: string;
  description: string;
  markets: string;
  timeframes: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
}

const DEFAULT_EMA = `class Strategy(BaseStrategy):
    params = {
        "fast_ema": Param(9, min=2, max=100, step=1, label="Fast EMA"),
        "slow_ema": Param(21, min=5, max=300, step=1, label="Slow EMA"),
        "sl_pct": Param(1.0, min=0.1, max=10.0, step=0.1, label="Stop Loss %"),
        "tp_pct": Param(2.0, min=0.1, max=20.0, step=0.1, label="Target %"),
        "use_htf": Param(False, label="Use HTF trend filter"),
        "htf": Param("1h", choices=["15m", "1h", "1d"], label="Higher TF"),
    }
    def init(self):
        self.fast = self.I(ema, self.data.close, self.p.fast_ema)
        self.slow = self.I(ema, self.data.close, self.p.slow_ema)
        if self.p.use_htf:
            htf = self.resample(self.p.htf)
            self.htf_trend = self.I(ema, htf.close, 50, timeframe=self.p.htf)
    def next(self):
        if crossover(self.fast, self.slow):
            if not self.p.use_htf or self.data.close[-1] > self.htf_trend[-1]:
                self.buy(sl_pct=self.p.sl_pct, tp_pct=self.p.tp_pct)
        elif crossover(self.slow, self.fast):
            self.position.close()
`;

const SMA_CROSSOVER = `class Strategy(BaseStrategy):
    params = {
        "fast": Param(10, min=3, max=40, step=1, label="Fast SMA"),
        "slow": Param(30, min=10, max=100, step=1, label="Slow SMA"),
    }
    def init(self):
        self.fast = self.I(sma, self.data.close, self.p.fast)
        self.slow = self.I(sma, self.data.close, self.p.slow)
    def next(self):
        if crossover(self.fast, self.slow) and not self.position:
            self.buy(tag="sma-cross")
        elif crossunder(self.fast, self.slow) and self.position.is_long:
            self.position.close()
`;

const RSI_MEAN_REVERSION = `class Strategy(BaseStrategy):
    params = {
        "rsi_len": Param(14, min=5, max=30, step=1, label="RSI length"),
        "oversold": Param(30, min=15, max=40, step=1, label="Buy below"),
        "exit_level": Param(55, min=45, max=75, step=1, label="Exit above"),
    }
    def init(self):
        self.rsi = self.I(rsi, self.data.close, self.p.rsi_len)
    def next(self):
        value = self.rsi[-1]
        if math.isnan(value):
            return
        if not self.position and value < self.p.oversold:
            self.buy(tag="rsi-dip")
        elif self.position.is_long and value > self.p.exit_level:
            self.position.close()
`;

const SUPERTREND = `class Strategy(BaseStrategy):
    params = {
        "period": Param(10, min=5, max=25, step=1, label="ATR period"),
        "mult": Param(3.0, min=1.5, max=5.0, step=0.5, label="ATR multiplier"),
    }
    def init(self):
        self.line, self.direction = self.I(supertrend, self.data.high, self.data.low,
                                           self.data.close, self.p.period, self.p.mult)
    def next(self):
        if math.isnan(self.line[-1]):
            return
        if self.direction[-1] == 1 and not self.position:
            self.buy(tag="supertrend-up")
        elif self.direction[-1] == -1 and self.position.is_long:
            self.position.close()
`;

const BOLLINGER_BREAKOUT = `class Strategy(BaseStrategy):
    params = {
        "period": Param(20, min=10, max=50, step=1, label="Band period"),
        "width": Param(2.0, min=1.0, max=3.5, step=0.5, label="Band width"),
    }
    def init(self):
        self.mid, self.upper, self.lower = self.I(bollinger, self.data.close,
                                                  self.p.period, self.p.width)
    def next(self):
        if math.isnan(self.upper[-1]) or math.isnan(self.mid[-1]):
            return
        if not self.position and self.data.close[-1] > self.upper[-1]:
            self.buy(tag="upper-band-break")
        elif self.position.is_long and self.data.close[-1] < self.mid[-1]:
            self.position.close()
`;

const DONCHIAN_BREAKOUT = `class Strategy(BaseStrategy):
    params = {
        "period": Param(20, min=5, max=60, step=1, label="Channel period"),
    }
    def init(self):
        self.upper, self.lower, self.mid = self.I(donchian, self.data.high,
                                                   self.data.low, self.p.period)
    def next(self):
        if self.i < self.p.period or math.isnan(self.upper[-2]):
            return
        if not self.position and self.data.close[-1] > self.upper[-2]:
            self.buy(tag="channel-break")
        elif self.position.is_long and self.data.close[-1] < self.lower[-2]:
            self.position.close()
`;

const MACD_RSI = `class Strategy(BaseStrategy):
    params = {
        "rsi_len": Param(14, min=5, max=30, step=1, label="RSI length"),
        "rsi_floor": Param(50, min=40, max=60, step=1, label="RSI minimum"),
    }
    def init(self):
        self.macd_line, self.signal, self.hist = self.I(macd, self.data.close)
        self.rsi_value = self.I(rsi, self.data.close, self.p.rsi_len)
    def next(self):
        if math.isnan(self.rsi_value[-1]) or math.isnan(self.hist[-1]):
            return
        if not self.position and crossover(self.macd_line, self.signal) and self.rsi_value[-1] > self.p.rsi_floor:
            self.buy(tag="macd-rsi")
        elif self.position.is_long and crossunder(self.macd_line, self.signal):
            self.position.close()
`;

const OPENING_RANGE = `class Strategy(BaseStrategy):
    params = {
        "range_minutes": Param(30, min=15, max=60, step=15, label="Opening range minutes"),
        "stop_pct": Param(1.5, min=0.5, max=5.0, step=0.5, label="Stop loss %"),
    }
    def init(self):
        self.range_session = None
        self.range_high = None
        self.range_low = None
    def next(self):
        # Build 09:15 IST onward. Daily bars safely skip this intraday-only setup.
        session = self.data.session[-1]
        minute = int((int(self.data.ts[-1]) + 19800) % 86400 // 60)
        if self.range_session != session:
            self.range_session = session
            self.range_high = None
            self.range_low = None
        start_minute = 9 * 60 + 15
        end_minute = start_minute + self.p.range_minutes
        if start_minute <= minute < end_minute:
            self.range_high = self.data.high[-1] if self.range_high is None else max(self.range_high, self.data.high[-1])
            self.range_low = self.data.low[-1] if self.range_low is None else min(self.range_low, self.data.low[-1])
            return
        if minute < end_minute or self.range_high is None:
            return
        if not self.position and self.data.close[-1] > self.range_high:
            self.buy(sl_pct=self.p.stop_pct, tag="range-break")
        elif self.position.is_long and self.data.close[-1] < self.range_low:
            self.position.close()
`;

const VWAP_REVERSION = `class Strategy(BaseStrategy):
    params = {
        "rsi_len": Param(14, min=5, max=30, step=1, label="RSI length"),
        "oversold": Param(35, min=15, max=45, step=1, label="Buy below RSI"),
    }
    def init(self):
        d = self.data
        self.vwap_line = self.I(vwap, d.high, d.low, d.close, d.volume, d.session)
        self.rsi_value = self.I(rsi, d.close, self.p.rsi_len)
    def next(self):
        # Yahoo index volume can be zero; skip bars where VWAP is unavailable.
        vwap_now, rsi_now = self.vwap_line[-1], self.rsi_value[-1]
        if math.isnan(vwap_now) or math.isnan(rsi_now):
            return
        if not self.position and self.data.close[-1] < vwap_now and rsi_now < self.p.oversold:
            self.buy(tag="vwap-reversion")
        elif self.position.is_long and self.data.close[-1] >= vwap_now:
            self.position.close()
`;

const ATR_TREND = `class Strategy(BaseStrategy):
    params = {
        "ema_len": Param(30, min=10, max=80, step=1, label="Trend EMA"),
        "atr_mult": Param(3.0, min=1.0, max=6.0, step=0.5, label="ATR trail multiple"),
    }
    def init(self):
        self.trend = self.I(ema, self.data.close, self.p.ema_len)
    def next(self):
        if math.isnan(self.trend[-1]):
            return
        if not self.position and self.data.close[-1] > self.trend[-1]:
            self.buy(trail_atr=self.p.atr_mult, trail_atr_period=14, tag="atr-trend")
        elif self.position.is_long and self.data.close[-1] < self.trend[-1]:
            self.position.close()
`;

const HTF_FILTER = `class Strategy(BaseStrategy):
    params = {
        "fast": Param(10, min=3, max=30, step=1, label="Fast EMA"),
        "slow": Param(30, min=10, max=80, step=1, label="Slow EMA"),
    }
    def init(self):
        self.fast = self.I(ema, self.data.close, self.p.fast)
        self.slow = self.I(ema, self.data.close, self.p.slow)
        htf = self.resample("1d")
        self.htf_trend = self.I(ema, htf.close, 20, timeframe="1d")
    def next(self):
        trend = self.htf_trend[-1]
        if math.isnan(trend):
            return
        if not self.position and crossover(self.fast, self.slow) and self.data.close[-1] > trend:
            self.buy(tag="htf-confirmed")
        elif self.position.is_long and crossunder(self.fast, self.slow):
            self.position.close()
`;

export const TEMPLATES: StrategyTemplate[] = [
  { name: "EMA Crossover", code: DEFAULT_EMA, description: "Buy when a faster exponential average crosses above a slower one; exit on the reverse cross.", markets: "NIFTY 50, liquid stocks", timeframes: "Daily or intraday", difficulty: "Beginner" },
  { name: "SMA Crossover", code: SMA_CROSSOVER, description: "A simple moving-average trend strategy with adjustable fast and slow windows.", markets: "NIFTY 50, liquid stocks", timeframes: "Daily", difficulty: "Beginner" },
  { name: "RSI Mean Reversion", code: RSI_MEAN_REVERSION, description: "Buy when RSI is low and exit after it recovers to a chosen level.", markets: "Liquid stocks and indices", timeframes: "Daily or intraday", difficulty: "Beginner" },
  { name: "Supertrend Trend", code: SUPERTREND, description: "Follow the Supertrend direction and exit when the trend turns down.", markets: "Indices and liquid stocks", timeframes: "Daily or intraday", difficulty: "Intermediate" },
  { name: "Bollinger Breakout", code: BOLLINGER_BREAKOUT, description: "Enter above the upper volatility band and exit below its middle line.", markets: "Liquid stocks and indices", timeframes: "Daily", difficulty: "Intermediate" },
  { name: "Donchian Turtle Breakout", code: DONCHIAN_BREAKOUT, description: "Enter on a close above the previous channel high and exit below its low.", markets: "Trending stocks and indices", timeframes: "Daily", difficulty: "Intermediate" },
  { name: "MACD + RSI Confirmation", code: MACD_RSI, description: "Use a MACD cross only when RSI also confirms upward momentum.", markets: "Liquid stocks and indices", timeframes: "Daily", difficulty: "Intermediate" },
  { name: "Opening Range Breakout", code: OPENING_RANGE, description: "Build the 09:15 IST opening range and enter on a later close above it. This setup is for intraday data.", markets: "NIFTY 50 and liquid stocks", timeframes: "5m–30m", difficulty: "Advanced" },
  { name: "VWAP Reversion", code: VWAP_REVERSION, description: "Look for an oversold close below session VWAP and exit near VWAP. Skips bars without usable volume.", markets: "Liquid stocks and indices with volume", timeframes: "Intraday preferred", difficulty: "Intermediate" },
  { name: "ATR Trend + Trailing Stop", code: ATR_TREND, description: "Follow an EMA trend and trail a stop by a chosen multiple of ATR.", markets: "NIFTY 50, liquid stocks", timeframes: "Daily or intraday", difficulty: "Advanced" },
  { name: "Higher-Timeframe Filter", code: HTF_FILTER, description: "Take a faster-chart EMA cross only when price is above the fully closed daily trend.", markets: "NIFTY 50, liquid stocks", timeframes: "Daily or intraday", difficulty: "Advanced" },
];

/** Kept as an alias for callers that used the original examples export. */
export const EXAMPLES = TEMPLATES;
export const EMA_CROSSOVER = TEMPLATES[0].code;
