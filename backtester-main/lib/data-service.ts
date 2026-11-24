/** Client data service: Yahoo proxy fetch + Dexie range cache + interval limits. */

import { storage, type CandleCacheEntry } from "./db";
import type { CandleBuffers } from "./worker-protocol";

/** Yahoo intraday history limits (approx, enforced client-side by clamping). */
export const INTERVAL_LIMITS_DAYS: Record<string, number> = {
  "1m": 7,
  "5m": 60,
  "15m": 60,
  "1h": 730,
  "1d": 365 * 40, // decades
};

export const INTERVALS = ["1m", "5m", "15m", "1h", "1d"] as const;

export const MAX_BARS = 200_000;

export interface SymbolPreset {
  symbol: string;
  label: string;
  group: string;
}

export const SYMBOL_PRESETS: SymbolPreset[] = [
  { symbol: "^NSEI", label: "NIFTY 50", group: "Indices" },
  { symbol: "^NSEBANK", label: "BANK NIFTY", group: "Indices" },
  { symbol: "NIFTY_FIN_SERVICE.NS", label: "FINNIFTY", group: "Indices" },
  { symbol: "^BSESN", label: "SENSEX", group: "Indices" },
  { symbol: "RELIANCE.NS", label: "Reliance Industries", group: "NSE Stocks" },
  { symbol: "HDFCBANK.NS", label: "HDFC Bank", group: "NSE Stocks" },
  { symbol: "ICICIBANK.NS", label: "ICICI Bank", group: "NSE Stocks" },
  { symbol: "INFY.NS", label: "Infosys", group: "NSE Stocks" },
  { symbol: "TCS.NS", label: "TCS", group: "NSE Stocks" },
  { symbol: "SBIN.NS", label: "State Bank of India", group: "NSE Stocks" },
  { symbol: "BHARTIARTL.NS", label: "Bharti Airtel", group: "NSE Stocks" },
  { symbol: "ITC.NS", label: "ITC", group: "NSE Stocks" },
  { symbol: "LT.NS", label: "Larsen & Toubro", group: "NSE Stocks" },
  { symbol: "TATAMOTORS.NS", label: "Tata Motors", group: "NSE Stocks" },
  { symbol: "AXISBANK.NS", label: "Axis Bank", group: "NSE Stocks" },
  { symbol: "KOTAKBANK.NS", label: "Kotak Mahindra Bank", group: "NSE Stocks" },
  { symbol: "BTC-USD", label: "Bitcoin / USD", group: "Crypto" },
  { symbol: "ETH-USD", label: "Ethereum / USD", group: "Crypto" },
];

export interface DataSlice {
  symbol: string;
  interval: string;
  buffers: CandleBuffers;
  count: number;
  from: number;
  to: number;
  cacheHit: boolean;
  clamped: boolean;
  clampedToDays?: number;
  gaps: number; // count of suspicious gaps (> 3× median bar spacing, intra-session)
}

interface RawCandles {
  timestamps: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

async function fetchYahoo(symbol: string, interval: string, from: number, to: number): Promise<RawCandles> {
  const qs = new URLSearchParams({
    symbol,
    interval,
    period1: String(Math.floor(from)),
    period2: String(Math.ceil(to)),
  });
  const res = await fetch(`/api/data/yahoo?${qs}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Data fetch failed (HTTP ${res.status})`);
  return body as RawCandles;
}

function mergeCandles(a: RawCandles, b: RawCandles): RawCandles {
  // union by timestamp; b wins on collision (fresher fetch)
  const map = new Map<number, [number, number, number, number, number]>();
  const add = (src: RawCandles) => {
    for (let i = 0; i < src.timestamps.length; i++) {
      map.set(src.timestamps[i], [src.open[i], src.high[i], src.low[i], src.close[i], src.volume[i]]);
    }
  };
  add(a);
  add(b);
  const ts = [...map.keys()].sort((x, y) => x - y);
  const out: RawCandles = { timestamps: ts, open: [], high: [], low: [], close: [], volume: [] };
  for (const t of ts) {
    const [o, h, l, c, v] = map.get(t)!;
    out.open.push(o);
    out.high.push(h);
    out.low.push(l);
    out.close.push(c);
    out.volume.push(v);
  }
  return out;
}

function countGaps(ts: number[]): number {
  if (ts.length < 3) return 0;
  const diffs = [];
  for (let i = 1; i < ts.length; i++) diffs.push(ts[i] - ts[i - 1]);
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // ignore overnight/weekend gaps for intraday data (> 4h means session break)
  return diffs.filter((d) => d > median * 3 && d < 4 * 3600).length;
}

export function clampRange(interval: string, from: number, to: number) {
  const limitDays = INTERVAL_LIMITS_DAYS[interval] ?? 365;
  const now = Date.now() / 1000;
  const earliest = now - limitDays * 86400;
  const clamped = from < earliest;
  return { from: Math.max(from, earliest), to: Math.min(to, now), clamped, limitDays };
}

/**
 * Cache-first data load. Fetches only when the cached range doesn't cover the
 * request, merges by timestamp, and stores the union back.
 */
export async function getData(
  symbol: string,
  interval: string,
  from: number,
  to: number,
  force = false
): Promise<DataSlice> {
  const { from: f, to: t, clamped, limitDays } = clampRange(interval, from, to);
  const key = `${symbol}|${interval}`;
  const cached = force ? undefined : await storage.getCandles(key);

  // tolerance of one bar interval on each side when judging coverage
  const tol = interval === "1d" ? 4 * 86400 : 2 * 86400;
  let raw: RawCandles;
  let cacheHit = false;

  if (cached && cached.from <= f + tol && cached.to >= t - tol) {
    raw = cached;
    cacheHit = true;
  } else {
    let fetched: RawCandles;
    if (cached) {
      // extend the cached window: fetch the full requested span (Yahoo charges
      // nothing for overlap) and merge so the cache only ever grows
      fetched = await fetchYahoo(symbol, interval, Math.min(f, cached.from), Math.max(t, cached.to));
      raw = mergeCandles(cached, fetched);
    } else {
      fetched = await fetchYahoo(symbol, interval, f, t);
      raw = fetched;
    }
    if (!raw.timestamps.length) throw new Error("No candles returned for this range");
    const entry: CandleCacheEntry = {
      key,
      symbol,
      interval,
      from: raw.timestamps[0],
      to: raw.timestamps[raw.timestamps.length - 1],
      fetchedAt: Date.now(),
      timestamps: raw.timestamps,
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
      volume: raw.volume,
    };
    await storage.putCandles(entry);
  }

  // slice to the requested window
  let lo = raw.timestamps.findIndex((x) => x >= f);
  if (lo < 0) lo = 0;
  let hi = raw.timestamps.length;
  while (hi > 0 && raw.timestamps[hi - 1] > t) hi--;
  let n = hi - lo;
  if (n <= 0) throw new Error("No candles in the requested window");
  if (n > MAX_BARS) {
    lo = hi - MAX_BARS; // keep the most recent MAX_BARS
    n = MAX_BARS;
  }

  const buffers: CandleBuffers = {
    ts: new Float64Array(raw.timestamps.slice(lo, hi)),
    open: new Float64Array(raw.open.slice(lo, hi)),
    high: new Float64Array(raw.high.slice(lo, hi)),
    low: new Float64Array(raw.low.slice(lo, hi)),
    close: new Float64Array(raw.close.slice(lo, hi)),
    volume: new Float64Array(raw.volume.slice(lo, hi)),
  };

  return {
    symbol,
    interval,
    buffers,
    count: n,
    from: buffers.ts[0],
    to: buffers.ts[n - 1],
    cacheHit,
    clamped,
    clampedToDays: clamped ? limitDays : undefined,
    gaps: countGaps(raw.timestamps.slice(lo, hi)),
  };
}

export async function clearCache(symbol: string, interval: string) {
  await storage.deleteCandles(`${symbol}|${interval}`);
}
