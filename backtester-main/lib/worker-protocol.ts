/** Typed postMessage protocol between the main thread and the Pyodide backtest worker. */

export interface CandleBuffers {
  ts: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
}

export type SizingMode = "fixed_qty" | "fixed_value" | "pct_equity" | "risk_pct" | "lots";

export interface ChargeRow {
  name: string;
  basis: "buy" | "sell" | "both";
  type: "percent" | "flat_per_order" | "per_crore" | "percent_of";
  value: number;
  cap?: number | null;
  of?: string[];
}

export interface RunConfig {
  capital: number;
  execution: "next_open" | "same_close";
  slippage_type: "pct" | "abs";
  slippage_value: number;
  margin_multiplier: number;
  interval: string;
  risk_free: number;
  sizing: {
    mode: SizingMode;
    qty?: number;
    value?: number;
    pct?: number;
    risk_pct?: number;
    lots?: number;
    lot_size?: number;
  };
  squareoff: { enabled: boolean; time: string };
  charges: ChargeRow[];
  /** When false the run is charged nothing; the profile rows are kept. */
  chargesEnabled?: boolean;
  /** UI bookkeeping only — engine ignores it. */
  chargesProfileId?: string;
}

export interface ParamSpec {
  key: string;
  default: number | string | boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  label: string;
  choices: string[] | null;
  type: "int" | "float" | "bool" | "choice" | "str";
}

export interface Trade {
  entry_ts: number;
  exit_ts: number;
  side: "long" | "short";
  qty: number;
  entry_px: number;
  exit_px: number;
  gross_pnl: number;
  charges: number;
  charges_breakdown: Record<string, number>;
  net_pnl: number;
  return_pct: number;
  bars_held: number;
  entry_i: number;
  exit_i: number;
  exit_reason: "signal" | "sl" | "tp" | "eod" | "end_of_data";
  tag: string;
  cum_net_pnl: number;
}

export type OptimizationObjective = "net_pnl" | "sharpe" | "calmar" | "profit_factor";

export interface OptimizationGrid {
  key: string;
  values: number[];
}

export interface OptimizationRow {
  params: Record<string, number | string | boolean>;
  metrics: Metrics;
  objectiveValue: number | null;
}

export interface SideStats {
  count: number;
  win_rate: number;
  net_pnl: number;
}

export interface Metrics {
  net_pnl: number;
  net_pnl_pct: number;
  gross_pnl: number;
  total_charges: number;
  cagr: number;
  buy_hold_pct: number;
  alpha_vs_bh: number;
  max_dd_pct: number;
  max_dd_rs: number;
  max_dd_bars: number;
  max_dd_days: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  volatility_ann: number;
  max_consec_losses: number;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  expectancy: number;
  expectancy_r: number;
  avg_win: number;
  avg_loss: number;
  payoff_ratio: number;
  largest_win: number;
  largest_loss: number;
  avg_bars_held: number;
  avg_charges: number;
  long_stats: SideStats;
  short_stats: SideStats;
  exposure_pct: number;
  sl_exits: number;
  tp_exits: number;
  signal_exits: number;
  eod_exits: number;
  final_equity: number;
  initial_capital: number;
  charges_pct_of_gross: number;
}

export interface MonthlyReturn {
  year: number;
  month: number;
  ret: number;
}

export interface IndicatorSeries {
  name: string;
  overlay: boolean;
  timeframe: string | null;
  values: Float64Array;
}

export interface BacktestResult {
  metrics: Metrics;
  trades: Trade[];
  monthly: MonthlyReturn[];
  warnings: string[];
  lastSignal: { action: "buy" | "sell"; bar_index: number; price: number; tag: string } | null;
  series: {
    ts: Float64Array;
    equity: Float64Array;
    closedEquity: Float64Array;
    drawdown: Float64Array;
    buyHold: Float64Array;
  };
  indicators: IndicatorSeries[];
  elapsedMs: number;
}

// main -> worker
export type MainToWorker =
  | { type: "INIT" }
  | { type: "EXTRACT_PARAMS"; id: number; code: string }
  | {
      type: "RUN_BACKTEST";
      id: number;
      strategyCode: string;
      params: Record<string, number | string | boolean>;
      config: RunConfig;
      buffers: CandleBuffers;
    }
  | {
      type: "OPTIMIZE";
      id: number;
      strategyCode: string;
      params: Record<string, number | string | boolean>;
      config: RunConfig;
      buffers: CandleBuffers;
      grid: OptimizationGrid[];
      objective: OptimizationObjective;
    }
  | { type: "CANCEL" };

// worker -> main
export type WorkerToMain =
  | { type: "INIT_PROGRESS"; stage: string; pct: number }
  | { type: "READY"; pyodideVersion: string; interruptible: boolean }
  | { type: "PROGRESS"; id: number; pct: number; barIndex: number; totalBars: number }
  | { type: "OPTIMIZE_PROGRESS"; id: number; completed: number; total: number; barIndex: number; totalBars: number }
  | { type: "PARAMS"; id: number; params: ParamSpec[] }
  | {
      type: "RESULT";
      id: number;
      metrics: Metrics;
      trades: Trade[];
      monthly: MonthlyReturn[];
      warnings: string[];
      lastSignal: BacktestResult["lastSignal"];
      ts: Float64Array;
      equity: Float64Array;
      closedEquity: Float64Array;
      drawdown: Float64Array;
      buyHold: Float64Array;
      indicators: { name: string; overlay: boolean; timeframe: string | null; values: Float64Array }[];
      elapsedMs: number;
    }
  | { type: "OPTIMIZATION_RESULT"; id: number; rows: OptimizationRow[]; elapsedMs: number }
  | { type: "PY_ERROR"; id: number; message: string; traceback: string; lineNumber: number | null }
  | { type: "CANCELLED"; id: number }
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "FATAL"; message: string };
