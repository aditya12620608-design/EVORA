/** Main-thread wrapper around the Pyodide worker: promise APIs + auto-restart. */

import type {
  BacktestResult,
  CandleBuffers,
  MainToWorker,
  ParamSpec,
  OptimizationGrid,
  OptimizationObjective,
  OptimizationRow,
  RunConfig,
  WorkerToMain,
} from "./worker-protocol";

export interface RunProgress {
  pct: number;
  barIndex: number;
  totalBars: number;
  etaMs: number | null;
}

export interface OptimizationProgress {
  completed: number;
  total: number;
  barIndex: number;
  totalBars: number;
}

type Listener = (msg: WorkerToMain) => void;

export class PyError extends Error {
  traceback: string;
  lineNumber: number | null;
  constructor(message: string, traceback: string, lineNumber: number | null) {
    super(message);
    this.traceback = traceback;
    this.lineNumber = lineNumber;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Backtest cancelled");
  }
}

class BacktestWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private listeners = new Set<Listener>();
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; kind: "run" | "params" | "optimize"; startedAt: number }
  >();
  onCrash: ((message: string) => void) | null = null;

  /** Subscribe to raw worker messages (logs, init progress). Returns unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.spawn();
    });
    return this.readyPromise;
  }

  private spawn() {
    this.worker = new Worker("/workers/backtest.worker.js");
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.handle(e.data);
    this.worker.onerror = (e) => this.crash(`Worker error: ${e.message || "unknown"}`);
    this.send({ type: "INIT" });
  }

  private crash(message: string) {
    for (const [, p] of this.pending) p.reject(new Error(message));
    this.pending.clear();
    this.readyReject?.(new Error(message));
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.onCrash?.(message);
  }

  /** Terminate and boot a fresh worker (used after FATAL / hung runs). */
  restart() {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    for (const [, p] of this.pending) p.reject(new Error("Worker restarted"));
    this.pending.clear();
    return this.init();
  }

  private send(msg: MainToWorker, transfer?: Transferable[]) {
    this.worker?.postMessage(msg, transfer || []);
  }

  private handle(msg: WorkerToMain) {
    for (const fn of this.listeners) fn(msg);
    switch (msg.type) {
      case "READY":
        this.readyResolve?.();
        break;
      case "PARAMS": {
        const p = this.pending.get(msg.id);
        if (p?.kind === "params") {
          this.pending.delete(msg.id);
          p.resolve(msg.params);
        }
        break;
      }
      case "RESULT": {
        const p = this.pending.get(msg.id);
        if (p?.kind === "run") {
          this.pending.delete(msg.id);
          const result: BacktestResult = {
            metrics: msg.metrics,
            trades: msg.trades,
            monthly: msg.monthly,
            warnings: msg.warnings,
            lastSignal: msg.lastSignal,
            series: {
              ts: msg.ts,
              equity: msg.equity,
              closedEquity: msg.closedEquity,
              drawdown: msg.drawdown,
              buyHold: msg.buyHold,
            },
            indicators: msg.indicators,
            elapsedMs: msg.elapsedMs,
          };
          p.resolve(result);
        }
        break;
      }
      case "OPTIMIZATION_RESULT": {
        const p = this.pending.get(msg.id);
        if (p?.kind === "optimize") {
          this.pending.delete(msg.id);
          p.resolve({ rows: msg.rows, elapsedMs: msg.elapsedMs });
        }
        break;
      }
      case "PY_ERROR": {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.reject(new PyError(msg.message, msg.traceback, msg.lineNumber));
        }
        break;
      }
      case "CANCELLED": {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.reject(new CancelledError());
        }
        break;
      }
      case "FATAL":
        this.crash(msg.message);
        break;
    }
  }

  async extractParams(code: string): Promise<ParamSpec[]> {
    await this.init();
    const id = this.nextId++;
    return new Promise<ParamSpec[]>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        kind: "params",
        startedAt: Date.now(),
      });
      this.send({ type: "EXTRACT_PARAMS", id, code });
    });
  }

  async run(
    strategyCode: string,
    params: Record<string, number | string | boolean>,
    config: RunConfig,
    buffers: CandleBuffers,
    onProgress?: (p: RunProgress) => void
  ): Promise<BacktestResult> {
    await this.init();
    const id = this.nextId++;
    const startedAt = Date.now();
    const unsub = this.subscribe((msg) => {
      if (msg.type === "PROGRESS" && msg.id === id && onProgress) {
        const elapsed = Date.now() - startedAt;
        const etaMs = msg.pct > 1 ? (elapsed / msg.pct) * (100 - msg.pct) : null;
        onProgress({ pct: msg.pct, barIndex: msg.barIndex, totalBars: msg.totalBars, etaMs });
      }
    });
    try {
      return await new Promise<BacktestResult>((resolve, reject) => {
        this.pending.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          kind: "run",
          startedAt,
        });
        // Buffers are copied (not transferred) so the main thread keeps its
        // cached candles for the chart tab.
        this.send({ type: "RUN_BACKTEST", id, strategyCode, params, config, buffers });
      });
    } finally {
      unsub();
    }
  }

  async optimize(
    strategyCode: string,
    params: Record<string, number | string | boolean>,
    config: RunConfig,
    buffers: CandleBuffers,
    grid: OptimizationGrid[],
    objective: OptimizationObjective,
    onProgress?: (p: OptimizationProgress) => void
  ): Promise<{ rows: OptimizationRow[]; elapsedMs: number }> {
    await this.init();
    const id = this.nextId++;
    const startedAt = Date.now();
    const unsub = this.subscribe((msg) => {
      if (msg.type === "OPTIMIZE_PROGRESS" && msg.id === id) onProgress?.(msg);
    });
    try {
      return await new Promise<{ rows: OptimizationRow[]; elapsedMs: number }>((resolve, reject) => {
        this.pending.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          kind: "optimize",
          startedAt,
        });
        this.send({ type: "OPTIMIZE", id, strategyCode, params, config, buffers, grid, objective });
      });
    } finally {
      unsub();
    }
  }

  cancel() {
    this.send({ type: "CANCEL" });
  }
}

/** Singleton — Pyodide loads once and stays warm. */
export const backtestWorker = new BacktestWorkerClient();
