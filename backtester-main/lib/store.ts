"use client";

import { create } from "zustand";
import { backtestWorker, CancelledError, PyError, type OptimizationProgress, type RunProgress } from "./worker-client";
import type { BacktestResult, OptimizationGrid, OptimizationObjective, OptimizationRow, ParamSpec, RunConfig } from "./worker-protocol";
import { storage, type ChargesProfileRecord, type RunHistoryRecord, type StrategyRecord } from "./db";
import { getData, clearCache, type DataSlice } from "./data-service";
import { CHARGES_PRESETS } from "./charges-presets";
import { EMA_CROSSOVER } from "./example-strategies";

export type BottomTab =
  | "overview"
  | "equity"
  | "drawdown"
  | "trades"
  | "chart"
  | "monthly"
  | "console"
  | "data"
  | "docs"
  | "optimize"
  | "history"
  | "scanner";

export interface ConsoleLine {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
  lineNumber?: number | null;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  msg: string;
}

export interface RunErrorInfo {
  message: string;
  traceback: string;
  lineNumber: number | null;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  capital: 1_000_000,
  execution: "next_open",
  slippage_type: "pct",
  slippage_value: 0,
  margin_multiplier: 1,
  interval: "1d",
  risk_free: 0.065,
  sizing: { mode: "pct_equity", pct: 100, risk_pct: 1, qty: 1, value: 100000, lots: 1, lot_size: 75 },
  squareoff: { enabled: false, time: "15:15" },
  charges: CHARGES_PRESETS.find((p) => p.id === "equity-intraday")!.rows,
  chargesProfileId: "equity-intraday",
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Resolve a strategy's data config to a unix-seconds [from, to] window. */
export function resolveDateRange(dc: StrategyRecord["dataConfig"]): { from: number; to: number } {
  const now = Date.now() / 1000;
  if (dc.dateMode === "custom" && dc.fromDate) {
    const from = Date.parse(`${dc.fromDate}T00:00:00`) / 1000;
    // include the whole "to" day
    const to = dc.toDate ? Date.parse(`${dc.toDate}T00:00:00`) / 1000 + 86400 : now;
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      return { from, to: Math.min(to, now) };
    }
  }
  return { from: now - dc.rangeDays * 86400, to: now };
}

const rangeKey = (dc: StrategyRecord["dataConfig"]) => {
  const { from, to } = resolveDateRange(dc);
  // round to a day so the rolling "now" doesn't invalidate the slice every second
  return `${dc.symbol}|${dc.interval}|${Math.floor(from / 86400)}|${Math.floor(to / 86400)}`;
};

function newStrategyRecord(name: string, code: string): StrategyRecord {
  return {
    id: uid(),
    name,
    code,
    paramOverrides: {},
    paramSpecs: [],
    runConfig: structuredClone(DEFAULT_RUN_CONFIG),
    dataConfig: { symbol: "^NSEI", interval: "1d", rangeDays: 1825 },
    lastResult: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

interface AppState {
  // pyodide
  pyodide: { phase: "idle" | "loading" | "ready" | "error"; stage: string; pct: number; interruptible: boolean };
  // strategies
  strategies: StrategyRecord[];
  activeId: string | null;
  dirty: boolean;
  // params
  paramSpecs: ParamSpec[];
  paramError: string | null;
  // data
  dataSlice: DataSlice | null;
  dataSliceKey: string | null;
  dataLoading: boolean;
  dataError: string | null;
  // run
  runState: "idle" | "loading-data" | "running";
  runProgress: RunProgress | null;
  optimizationState: "idle" | "loading-data" | "running";
  optimizationProgress: OptimizationProgress | null;
  optimizationRows: OptimizationRow[];
  optimizationElapsedMs: number | null;
  result: BacktestResult | null;
  resultMeta: { symbol: string; interval: string; ranAt: number } | null;
  runError: RunErrorInfo | null;
  // charges profiles
  customProfiles: ChargesProfileRecord[];
  // ui
  bottomTab: BottomTab;
  selectedTrade: number | null;
  consoleLines: ConsoleLine[];
  toasts: Toast[];
  leftRailOpen: boolean;
  runHistory: RunHistoryRecord[];
  scanState: "idle" | "running";
  scanProgress: { done: number; total: number; symbol: string } | null;
  scanResults: { symbol: string; action: "buy" | "sell"; price: number; tag: string }[];

  // actions
  initApp: () => Promise<void>;
  active: () => StrategyRecord | null;
  selectStrategy: (id: string) => void;
  createStrategy: (name?: string, code?: string) => void;
  duplicateStrategy: (id: string) => void;
  renameStrategy: (id: string, name: string) => void;
  deleteStrategy: (id: string) => void;
  updateCode: (code: string) => void;
  persistActive: () => Promise<void>;
  extractParams: () => Promise<void>;
  setParamOverride: (key: string, value: number | string | boolean) => void;
  resetParam: (key: string) => void;
  updateRunConfig: (patch: Partial<RunConfig>) => void;
  updateDataConfig: (patch: Partial<StrategyRecord["dataConfig"]>) => void;
  applyChargesProfile: (id: string) => void;
  saveCustomProfile: (p: ChargesProfileRecord) => Promise<void>;
  deleteCustomProfile: (id: string) => Promise<void>;
  loadData: (force?: boolean) => Promise<DataSlice | null>;
  runBacktest: () => Promise<void>;
  cancelRun: () => void;
  optimizeBacktest: (grid: OptimizationGrid[], objective: OptimizationObjective) => Promise<void>;
  cancelOptimization: () => void;
  applyOptimizationParams: (params: Record<string, number | string | boolean>) => void;
  setBottomTab: (t: BottomTab) => void;
  jumpToTrade: (i: number) => void;
  pushConsole: (line: ConsoleLine) => void;
  clearConsole: () => void;
  toast: (kind: Toast["kind"], msg: string) => void;
  dismissToast: (id: number) => void;
  toggleLeftRail: () => void;
  refreshRunHistory: () => Promise<void>;
  scanWatchlist: () => Promise<void>;
  cancelScan: () => void;
}

let toastSeq = 1;
let optimizationRunSeq = 0;
let scanCancelled = false;

export const useStore = create<AppState>((set, get) => ({
  pyodide: { phase: "idle", stage: "Booting…", pct: 0, interruptible: false },
  strategies: [],
  activeId: null,
  dirty: false,
  paramSpecs: [],
  paramError: null,
  dataSlice: null,
  dataSliceKey: null,
  dataLoading: false,
  dataError: null,
  runState: "idle",
  runProgress: null,
  optimizationState: "idle",
  optimizationProgress: null,
  optimizationRows: [],
  optimizationElapsedMs: null,
  result: null,
  resultMeta: null,
  runError: null,
  customProfiles: [],
  bottomTab: "overview",
  selectedTrade: null,
  consoleLines: [],
  toasts: [],
  leftRailOpen: true,
  runHistory: [],
  scanState: "idle",
  scanProgress: null,
  scanResults: [],

  active: () => {
    const { strategies, activeId } = get();
    return strategies.find((s) => s.id === activeId) ?? null;
  },

  initApp: async () => {
    if (get().pyodide.phase !== "idle") return;
    set({ pyodide: { ...get().pyodide, phase: "loading" } });

    backtestWorker.subscribe((msg) => {
      if (msg.type === "INIT_PROGRESS") {
        set({ pyodide: { ...get().pyodide, stage: msg.stage, pct: msg.pct } });
      } else if (msg.type === "LOG") {
        get().pushConsole({ ts: Date.now(), level: msg.level, msg: msg.msg });
      }
    });
    backtestWorker.onCrash = (message) => {
      get().toast("error", `Python worker crashed — restarting (${message})`);
      set({ runState: "idle", runProgress: null });
      backtestWorker.restart().then(() => {
        set({ pyodide: { ...get().pyodide, phase: "ready", pct: 100 } });
        get().toast("success", "Python worker back online");
      });
    };

    // load persisted strategies + profiles while pyodide boots
    const [stored, profiles] = await Promise.all([
      storage.listStrategies(),
      storage.listChargesProfiles(),
    ]);
    let strategies = stored;
    if (!strategies.length) {
      const first = newStrategyRecord("EMA Crossover", EMA_CROSSOVER);
      await storage.putStrategy(first);
      strategies = [first];
    }
    const last = strategies[0];
    set({
      strategies,
      customProfiles: profiles,
      activeId: last.id,
      paramSpecs: last.paramSpecs,
      result: null,
    });

    try {
      await backtestWorker.init();
      set({ pyodide: { ...get().pyodide, phase: "ready", pct: 100, stage: "Ready" } });
      get().extractParams();
    } catch (e) {
      set({ pyodide: { ...get().pyodide, phase: "error", stage: String(e) } });
    }
  },

  selectStrategy: (id) => {
    if (get().optimizationState !== "idle") {
      get().toast("info", "Wait for optimization to finish or cancel it before switching strategies");
      return;
    }
    const s = get().strategies.find((x) => x.id === id);
    if (!s) return;
    set({
      activeId: id,
      paramSpecs: s.paramSpecs,
      result: null,
      resultMeta: null,
      runError: null,
      selectedTrade: null,
      optimizationRows: [],
      optimizationElapsedMs: null,
    });
    get().extractParams();
  },

  createStrategy: (name = "Untitled Strategy", code = EMA_CROSSOVER) => {
    if (get().optimizationState !== "idle") {
      get().toast("info", "Cancel optimization before creating a strategy");
      return;
    }
    const s = newStrategyRecord(name, code);
    set({ strategies: [s, ...get().strategies] });
    storage.putStrategy(s);
    get().selectStrategy(s.id);
  },

  duplicateStrategy: (id) => {
    if (get().optimizationState !== "idle") return;
    const src = get().strategies.find((x) => x.id === id);
    if (!src) return;
    const copy: StrategyRecord = structuredClone({ ...src });
    copy.id = uid();
    copy.name = `${src.name} (copy)`;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    set({ strategies: [copy, ...get().strategies] });
    storage.putStrategy(copy);
    get().selectStrategy(copy.id);
  },

  renameStrategy: (id, name) => {
    set({
      strategies: get().strategies.map((s) => (s.id === id ? { ...s, name, updatedAt: Date.now() } : s)),
    });
    const s = get().strategies.find((x) => x.id === id);
    if (s) storage.putStrategy(s);
  },

  deleteStrategy: (id) => {
    if (get().optimizationState !== "idle") {
      get().toast("info", "Cancel optimization before deleting a strategy");
      return;
    }
    const rest = get().strategies.filter((s) => s.id !== id);
    set({ strategies: rest });
    storage.deleteStrategy(id);
    if (get().activeId === id) {
      if (rest.length) get().selectStrategy(rest[0].id);
      else get().createStrategy();
    }
  },

  updateCode: (code) => {
    if (get().optimizationState !== "idle") return;
    const { activeId, strategies } = get();
    set({
      strategies: strategies.map((s) =>
        s.id === activeId ? { ...s, code, updatedAt: Date.now() } : s
      ),
      dirty: true,
    });
  },

  persistActive: async () => {
    const s = get().active();
    if (!s) return;
    await storage.putStrategy(s);
    set({ dirty: false });
  },

  extractParams: async () => {
    const s = get().active();
    if (!s || get().pyodide.phase !== "ready") return;
    try {
      const specs = await backtestWorker.extractParams(s.code);
      set({
        paramSpecs: specs,
        paramError: null,
        strategies: get().strategies.map((x) => (x.id === s.id ? { ...x, paramSpecs: specs } : x)),
      });
    } catch (e) {
      if (e instanceof PyError) set({ paramError: e.message });
    }
  },

  setParamOverride: (key, value) => {
    if (get().optimizationState !== "idle") return;
    const s = get().active();
    if (!s) return;
    const paramOverrides = { ...s.paramOverrides, [key]: value };
    set({
      strategies: get().strategies.map((x) => (x.id === s.id ? { ...x, paramOverrides } : x)),
    });
    storage.putStrategy({ ...s, paramOverrides });
  },

  resetParam: (key) => {
    if (get().optimizationState !== "idle") return;
    const s = get().active();
    if (!s) return;
    const paramOverrides = { ...s.paramOverrides };
    delete paramOverrides[key];
    set({
      strategies: get().strategies.map((x) => (x.id === s.id ? { ...x, paramOverrides } : x)),
    });
    storage.putStrategy({ ...s, paramOverrides });
  },

  updateRunConfig: (patch) => {
    if (get().optimizationState !== "idle") return;
    const s = get().active();
    if (!s) return;
    const runConfig = { ...s.runConfig, ...patch };
    set({ strategies: get().strategies.map((x) => (x.id === s.id ? { ...x, runConfig } : x)) });
    storage.putStrategy({ ...s, runConfig });
  },

  updateDataConfig: (patch) => {
    if (get().optimizationState !== "idle") return;
    const s = get().active();
    if (!s) return;
    const dataConfig = { ...s.dataConfig, ...patch };
    set({ strategies: get().strategies.map((x) => (x.id === s.id ? { ...x, dataConfig } : x)) });
    storage.putStrategy({ ...s, dataConfig });
  },

  applyChargesProfile: (id) => {
    const all = [...CHARGES_PRESETS, ...get().customProfiles];
    const p = all.find((x) => x.id === id);
    if (!p) return;
    get().updateRunConfig({ charges: structuredClone(p.rows), chargesProfileId: id });
  },

  saveCustomProfile: async (p) => {
    await storage.putChargesProfile(p);
    const rest = get().customProfiles.filter((x) => x.id !== p.id);
    set({ customProfiles: [...rest, p] });
  },

  deleteCustomProfile: async (id) => {
    await storage.deleteChargesProfile(id);
    set({ customProfiles: get().customProfiles.filter((x) => x.id !== id) });
  },

  loadData: async (force = false) => {
    const s = get().active();
    if (!s) return null;
    const { symbol, interval } = s.dataConfig;
    set({ dataLoading: true, dataError: null });
    try {
      if (force) await clearCache(symbol, interval);
      const { from, to } = resolveDateRange(s.dataConfig);
      const slice = await getData(symbol, interval, from, to, force);
      set({ dataSlice: slice, dataSliceKey: rangeKey(s.dataConfig), dataLoading: false });
      if (slice.clamped) {
        get().toast(
          "info",
          `Range clamped to ~${slice.clampedToDays} days — Yahoo's limit for ${interval} data`
        );
      }
      return slice;
    } catch (e) {
      set({ dataLoading: false, dataError: String(e instanceof Error ? e.message : e) });
      return null;
    }
  },

  runBacktest: async () => {
    const st = get();
    const s = st.active();
    if (!s || st.runState !== "idle" || st.pyodide.phase !== "ready" || st.optimizationState !== "idle") return;

    set({ runState: "loading-data", runError: null, selectedTrade: null });
    await st.persistActive();

    let slice = st.dataSlice;
    // reload when symbol, interval, or the requested date window changed
    const cfgMatch = slice && st.dataSliceKey === rangeKey(s.dataConfig);
    if (!cfgMatch) slice = await get().loadData();
    if (!slice) {
      set({ runState: "idle" });
      get().toast("error", get().dataError ?? "Data load failed");
      return;
    }

    set({ runState: "running", runProgress: { pct: 0, barIndex: 0, totalBars: slice.count, etaMs: null } });
    const config: RunConfig = {
      ...s.runConfig,
      interval: slice.interval,
      charges: s.runConfig.chargesEnabled === false ? [] : s.runConfig.charges,
    };
    const t0 = Date.now();
    try {
      const result = await backtestWorker.run(
        s.code,
        s.paramOverrides,
        config,
        slice.buffers,
        (p) => set({ runProgress: p })
      );
      const resultMeta = { symbol: slice.symbol, interval: slice.interval, ranAt: Date.now() };
      set({ result, resultMeta, runState: "idle", runProgress: null, bottomTab: "overview" });
      // instrumentation hook for automated acceptance tests
      (window as unknown as Record<string, unknown>).__qdLastRun = {
        ranAt: resultMeta.ranAt,
        wallMs: Date.now() - t0,
        engineMs: result.elapsedMs,
        trades: result.trades.length,
      };
      for (const w of result.warnings.slice(0, 50)) {
        get().pushConsole({ ts: Date.now(), level: "warn", msg: w });
      }
      get().pushConsole({
        ts: Date.now(),
        level: "info",
        msg: `Run complete: ${result.metrics.total_trades} trades on ${slice.count.toLocaleString()} bars in ${((Date.now() - t0) / 1000).toFixed(2)}s`,
      });
      const snapshot = {
        metrics: result.metrics,
        trades: result.trades,
        monthly: result.monthly,
        warnings: result.warnings,
        elapsedMs: result.elapsedMs,
        ranAt: resultMeta.ranAt,
        symbol: resultMeta.symbol,
        interval: resultMeta.interval,
      };
      const cur = get().active();
      if (cur) {
        const upd = { ...cur, lastResult: snapshot };
        set({ strategies: get().strategies.map((x) => (x.id === upd.id ? upd : x)) });
        storage.putStrategy(upd);
        const historyRecord: RunHistoryRecord = {
          id: `${cur.id}-${resultMeta.ranAt}`,
          strategyId: cur.id,
          strategyName: cur.name,
          symbol: slice.symbol,
          interval: slice.interval,
          ranAt: resultMeta.ranAt,
          metrics: result.metrics,
          equity: Array.from(result.series.equity).filter((_, i) => i % Math.max(1, Math.floor(result.series.equity.length / 500)) === 0),
        };
        void storage.putRunHistory(historyRecord).then(() => get().refreshRunHistory());
      }
    } catch (e) {
      set({ runState: "idle", runProgress: null });
      if (e instanceof CancelledError) {
        get().toast("info", "Backtest cancelled");
      } else if (e instanceof PyError) {
        set({
          runError: { message: e.message, traceback: e.traceback, lineNumber: e.lineNumber },
          bottomTab: "console",
        });
        get().pushConsole({ ts: Date.now(), level: "error", msg: e.traceback, lineNumber: e.lineNumber });
      } else {
        get().toast("error", String(e instanceof Error ? e.message : e));
      }
    }
  },

  cancelRun: () => {
    if (get().runState === "running") backtestWorker.cancel();
  },

  optimizeBacktest: async (grid, objective) => {
    const st = get();
    const s = st.active();
    const combinations = grid.reduce((count, dimension) => count * dimension.values.length, 1);
    if (!s || !grid.length || grid.some((dimension) => !dimension.values.length)) return;
    if (combinations > 500) {
      get().toast("error", `This grid has ${combinations.toLocaleString("en-IN")} combinations; the limit is 500`);
      return;
    }
    if (st.runState !== "idle" || st.optimizationState !== "idle" || st.pyodide.phase !== "ready") return;

    const sequence = ++optimizationRunSeq;
    set({ optimizationState: "loading-data", optimizationRows: [], optimizationProgress: null, optimizationElapsedMs: null });
    try {
      await st.persistActive();
    } catch (e) {
      set({ optimizationState: "idle" });
      get().toast("error", `Could not save strategy before optimization: ${String(e instanceof Error ? e.message : e)}`);
      return;
    }
    if (sequence !== optimizationRunSeq) return;
    let slice = get().dataSlice;
    if (!slice || get().dataSliceKey !== rangeKey(s.dataConfig)) slice = await get().loadData();
    if (sequence !== optimizationRunSeq) return;
    if (!slice) {
      set({ optimizationState: "idle" });
      get().toast("error", get().dataError ?? "Data load failed");
      return;
    }

    const config: RunConfig = {
      ...s.runConfig,
      interval: slice.interval,
      charges: s.runConfig.chargesEnabled === false ? [] : s.runConfig.charges,
    };
    set({ optimizationState: "running", optimizationProgress: { completed: 0, total: combinations, barIndex: 0, totalBars: slice.count } });
    try {
      const result = await backtestWorker.optimize(
        s.code,
        s.paramOverrides,
        config,
        slice.buffers,
        grid,
        objective,
        (progress) => set({ optimizationProgress: progress })
      );
      set({ optimizationRows: result.rows, optimizationElapsedMs: result.elapsedMs, optimizationState: "idle", optimizationProgress: null, bottomTab: "optimize" });
      get().toast("success", `Optimization complete: ${result.rows.length} combinations`);
    } catch (e) {
      set({ optimizationState: "idle", optimizationProgress: null });
      if (e instanceof CancelledError) get().toast("info", "Optimization cancelled");
      else if (e instanceof PyError) {
        set({ runError: { message: e.message, traceback: e.traceback, lineNumber: e.lineNumber }, bottomTab: "console" });
        get().pushConsole({ ts: Date.now(), level: "error", msg: e.traceback, lineNumber: e.lineNumber });
      } else get().toast("error", String(e instanceof Error ? e.message : e));
    }
  },

  cancelOptimization: () => {
    if (get().optimizationState === "loading-data") {
      optimizationRunSeq++;
      set({ optimizationState: "idle", optimizationProgress: null });
      get().toast("info", "Optimization cancelled before the run started");
    } else if (get().optimizationState === "running") backtestWorker.cancel();
  },

  applyOptimizationParams: (params) => {
    const s = get().active();
    if (!s) return;
    const paramOverrides = { ...s.paramOverrides, ...params };
    const updated = { ...s, paramOverrides };
    set({ strategies: get().strategies.map((item) => item.id === s.id ? updated : item) });
    storage.putStrategy(updated);
    get().toast("success", "Optimized parameters applied to this strategy");
  },

  setBottomTab: (t) => set({ bottomTab: t }),

  jumpToTrade: (i) => set({ selectedTrade: i, bottomTab: "chart" }),

  pushConsole: (line) => {
    const lines = [...get().consoleLines, line];
    set({ consoleLines: lines.length > 1000 ? lines.slice(-1000) : lines });
  },

  clearConsole: () => set({ consoleLines: [] }),

  toast: (kind, msg) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, kind, msg }] });
    setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  toggleLeftRail: () => set({ leftRailOpen: !get().leftRailOpen }),
  refreshRunHistory: async () => set({ runHistory: await storage.listRunHistory(get().activeId ?? undefined) }),
  scanWatchlist: async () => {
    const s = get().active();
    if (!s || get().scanState !== "idle" || get().runState !== "idle" || get().optimizationState !== "idle") return;
    let baskets: Record<string, string[]> = {};
    try { baskets = JSON.parse(localStorage.getItem("qd-watchlists-v1") ?? "{}"); } catch { /* use starter basket below */ }
    const symbols = [...new Set(Object.values(baskets).flat())].slice(0, 50);
    const basket = symbols.length ? symbols : ["RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS", "TCS.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS", "AXISBANK.NS"];
    scanCancelled = false;
    set({ scanState: "running", scanResults: [], scanProgress: { done: 0, total: basket.length, symbol: "" } });
    const found: AppState["scanResults"] = [];
    try {
      for (let i = 0; i < basket.length; i++) {
        if (scanCancelled) break;
        const symbol = basket[i];
        set({ scanProgress: { done: i, total: basket.length, symbol } });
        const dc = { ...s.dataConfig, symbol };
        const { from, to } = resolveDateRange(dc);
        const slice = await getData(symbol, dc.interval, from, to);
        if (scanCancelled) break;
        const cfg = { ...s.runConfig, interval: dc.interval, charges: s.runConfig.chargesEnabled === false ? [] : s.runConfig.charges };
        const result = await backtestWorker.run(s.code, s.paramOverrides, cfg, slice.buffers);
        if (result.lastSignal) found.push({ symbol, ...result.lastSignal });
        set({ scanResults: [...found], scanProgress: { done: i + 1, total: basket.length, symbol } });
      }
      if (!scanCancelled) get().toast("success", `Scan complete: ${found.length} latest-bar signal${found.length === 1 ? "" : "s"}`);
      else get().toast("info", "Scan cancelled");
    } catch (e) {
      if (scanCancelled) get().toast("info", "Scan cancelled");
      else get().toast("error", `Scan stopped: ${String(e instanceof Error ? e.message : e)}`);
    } finally { set({ scanState: "idle", scanProgress: null }); }
  },
  cancelScan: () => { scanCancelled = true; if (get().scanState === "running") backtestWorker.cancel(); },
}));
