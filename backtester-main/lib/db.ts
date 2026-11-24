/**
 * Persistence: Dexie/IndexedDB behind a StorageAdapter interface so a remote
 * sync backend (e.g. MongoDB) can slot in later without touching callers.
 */

import Dexie, { type EntityTable } from "dexie";
import type { BacktestResult, ChargeRow, ParamSpec, RunConfig } from "./worker-protocol";

export interface CandleCacheEntry {
  key: string; // `${symbol}|${interval}`
  symbol: string;
  interval: string;
  from: number; // unix s of first candle
  to: number; // unix s of last candle
  fetchedAt: number;
  timestamps: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface StoredResult {
  metrics: BacktestResult["metrics"];
  trades: BacktestResult["trades"];
  monthly: BacktestResult["monthly"];
  warnings: string[];
  elapsedMs: number;
  ranAt: number;
  symbol: string;
  interval: string;
}

export interface StrategyRecord {
  id: string;
  name: string;
  code: string;
  paramOverrides: Record<string, number | string | boolean>;
  paramSpecs: ParamSpec[];
  runConfig: RunConfig;
  dataConfig: {
    symbol: string;
    interval: string;
    rangeDays: number;
    /** "lookback" uses rangeDays back from today; "custom" uses fromDate/toDate. */
    dateMode?: "lookback" | "custom";
    fromDate?: string; // YYYY-MM-DD
    toDate?: string; // YYYY-MM-DD
  };
  lastResult: StoredResult | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChargesProfileRecord {
  id: string;
  name: string;
  builtin: boolean;
  rows: ChargeRow[];
}

export interface RunHistoryRecord {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  interval: string;
  ranAt: number;
  metrics: BacktestResult["metrics"];
  equity: number[];
}

export interface StorageAdapter {
  getCandles(key: string): Promise<CandleCacheEntry | undefined>;
  putCandles(entry: CandleCacheEntry): Promise<void>;
  deleteCandles(key: string): Promise<void>;
  listStrategies(): Promise<StrategyRecord[]>;
  getStrategy(id: string): Promise<StrategyRecord | undefined>;
  putStrategy(s: StrategyRecord): Promise<void>;
  deleteStrategy(id: string): Promise<void>;
  listChargesProfiles(): Promise<ChargesProfileRecord[]>;
  putChargesProfile(p: ChargesProfileRecord): Promise<void>;
  deleteChargesProfile(id: string): Promise<void>;
  listRunHistory(strategyId?: string): Promise<RunHistoryRecord[]>;
  putRunHistory(record: RunHistoryRecord): Promise<void>;
}

class QuantDeckDB extends Dexie {
  candles!: EntityTable<CandleCacheEntry, "key">;
  strategies!: EntityTable<StrategyRecord, "id">;
  chargesProfiles!: EntityTable<ChargesProfileRecord, "id">;
  runHistory!: EntityTable<RunHistoryRecord, "id">;

  constructor() {
    super("quantdeck");
    this.version(1).stores({
      candles: "key, symbol, interval",
      strategies: "id, name, updatedAt",
      chargesProfiles: "id, name",
    });
    this.version(2).stores({
      candles: "key, symbol, interval",
      strategies: "id, name, updatedAt",
      chargesProfiles: "id, name",
      runHistory: "id, strategyId, ranAt",
    });
  }
}

class DexieAdapter implements StorageAdapter {
  private db = new QuantDeckDB();

  getCandles(key: string) {
    return this.db.candles.get(key);
  }
  async putCandles(entry: CandleCacheEntry) {
    await this.db.candles.put(entry);
  }
  async deleteCandles(key: string) {
    await this.db.candles.delete(key);
  }
  listStrategies() {
    return this.db.strategies.orderBy("updatedAt").reverse().toArray();
  }
  getStrategy(id: string) {
    return this.db.strategies.get(id);
  }
  async putStrategy(s: StrategyRecord) {
    await this.db.strategies.put(s);
  }
  async deleteStrategy(id: string) {
    await this.db.strategies.delete(id);
  }
  listChargesProfiles() {
    return this.db.chargesProfiles.toArray();
  }
  async putChargesProfile(p: ChargesProfileRecord) {
    await this.db.chargesProfiles.put(p);
  }
  async deleteChargesProfile(id: string) {
    await this.db.chargesProfiles.delete(id);
  }
  async listRunHistory(strategyId?: string) {
    const rows = strategyId
      ? await this.db.runHistory.where("strategyId").equals(strategyId).toArray()
      : await this.db.runHistory.toArray();
    return rows.sort((a, b) => b.ranAt - a.ranAt);
  }
  async putRunHistory(record: RunHistoryRecord) {
    await this.db.runHistory.put(record);
  }
}

export const storage: StorageAdapter = new DexieAdapter();
