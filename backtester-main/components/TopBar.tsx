"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveDateRange, useStore } from "@/lib/store";
import { INTERVALS, INTERVAL_LIMITS_DAYS, SYMBOL_PRESETS } from "@/lib/data-service";
import { fDuration } from "@/lib/format";
import Watchlist from "./Watchlist";

const toISODate = (unixSec: number) => {
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: "1M", days: 31 },
  { label: "3M", days: 92 },
  { label: "6M", days: 183 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "5Y", days: 1825 },
  { label: "10Y", days: 3650 },
];

function SymbolPicker() {
  const active = useStore((s) => s.active());
  const updateDataConfig = useStore((s) => s.updateDataConfig);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const symbol = active?.dataConfig.symbol ?? "^NSEI";
  const preset = SYMBOL_PRESETS.find((p) => p.symbol === symbol);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SYMBOL_PRESETS;
    return SYMBOL_PRESETS.filter(
      (p) => p.symbol.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (sym: string) => {
    updateDataConfig({ symbol: sym });
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        className="flex h-8 items-center gap-2 border border-line bg-panel2 px-3 hover:border-faint"
        onClick={() => setOpen(!open)}
        title={symbol}
      >
        <span className="text-[13px] font-medium text-ink">{preset?.label ?? symbol}</span>
        {preset && <span className="font-mono text-[10px] text-dim">{symbol}</span>}
        <span className="text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-line bg-panel2 shadow-[0_12px_40px_rgba(5,8,14,0.55)]">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) choose(query.trim().toUpperCase());
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search or type any Yahoo symbol…"
            className="w-full rounded-none border-b border-line bg-panel px-3 py-2 text-[12px] placeholder:text-faint"
          />
          <div className="max-h-72 overflow-y-auto">
            {filtered.map((p) => (
              <button
                key={p.symbol}
                onClick={() => choose(p.symbol)}
                className={`flex w-full items-center justify-between rounded-none px-3 py-1.5 text-left hover:bg-line/60 ${
                  p.symbol === symbol ? "bg-line/60" : ""
                }`}
              >
                <span className="text-[12px]">{p.label}</span>
                <span className="font-mono text-[10px] text-dim">{p.symbol}</span>
              </button>
            ))}
            {query.trim() && (
              <button
                onClick={() => choose(query.trim().toUpperCase())}
                className="w-full rounded-none border-t border-line px-3 py-2 text-left text-[11px] text-cyan hover:bg-line/60"
              >
                Use “{query.trim().toUpperCase()}” as a Yahoo symbol
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const active = useStore((s) => s.active());
  const updateDataConfig = useStore((s) => s.updateDataConfig);
  const updateRunConfig = useStore((s) => s.updateRunConfig);
  const runState = useStore((s) => s.runState);
  const optimizationState = useStore((s) => s.optimizationState);
  const runProgress = useStore((s) => s.runProgress);
  const runBacktest = useStore((s) => s.runBacktest);
  const cancelRun = useStore((s) => s.cancelRun);
  const dataSlice = useStore((s) => s.dataSlice);
  const dirty = useStore((s) => s.dirty);
  const toggleLeftRail = useStore((s) => s.toggleLeftRail);

  if (!active) return null;
  const { interval, rangeDays, dateMode } = active.dataConfig;
  const limit = INTERVAL_LIMITS_DAYS[interval] ?? 9999;
  const isCustom = dateMode === "custom";
  const effective = resolveDateRange(active.dataConfig);
  const fromISO = toISODate(effective.from);
  // resolveDateRange adds a day to include the whole "to" day — undo for display
  const toISO = toISODate(isCustom && active.dataConfig.toDate ? effective.to - 86400 : effective.to);

  const setCustomDates = (patch: { fromDate?: string; toDate?: string }) => {
    if (patch.fromDate === "" || patch.toDate === "") return; // ignore cleared input
    updateDataConfig({
      dateMode: "custom",
      fromDate: patch.fromDate ?? fromISO,
      toDate: patch.toDate ?? toISO,
    });
  };

  const ctl = "h-8 border border-line bg-panel2";

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 rounded-lg border border-line bg-panel px-2">
      <button
        onClick={toggleLeftRail}
        title="Show or hide strategies"
        aria-label="Show or hide strategies"
        className="flex h-8 w-8 items-center justify-center text-dim hover:bg-panel2 hover:text-ink"
      >
        ☰
      </button>
      <div className="mr-3 select-none text-[15px] font-semibold tracking-tight text-ink">
        Quant<span className="font-normal text-dim">Deck</span>
      </div>

      <SymbolPicker />
      <button onClick={() => setWatchlistOpen(true)} className="h-8 border border-line px-3 text-xs text-dim hover:text-ink">Watchlists</button>

      <select
        value={interval}
        onChange={(e) => updateDataConfig({ interval: e.target.value })}
        className={`${ctl} px-2 font-mono text-[12px]`}
        title="Bar interval"
      >
        {INTERVALS.map((iv) => (
          <option key={iv} value={iv}>
            {iv}
          </option>
        ))}
      </select>

      <div className="flex h-8 items-center gap-0.5 rounded-md bg-panel2 p-0.5" role="group" aria-label="Lookback">
        {RANGE_PRESETS.map((r) => {
          const clamped = r.days > limit;
          return (
            <button
              key={r.label}
              onClick={() => updateDataConfig({ rangeDays: r.days, dateMode: "lookback" })}
              title={clamped ? `Yahoo keeps only ~${limit} days of ${interval} data, so this will be shortened` : `Last ${r.days} days`}
              className={`h-full px-2 font-mono text-[11px] ${
                !isCustom && rangeDays === r.days
                  ? "bg-accent/15 text-accent"
                  : clamped
                    ? "text-faint hover:text-amber"
                    : "text-dim hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div
        className={`flex h-8 items-center gap-1 rounded-md border bg-panel2 px-2 font-mono text-[11px] ${
          isCustom ? "border-accent/50" : "border-line"
        }`}
        title="Custom date range. Editing a date turns off the lookback presets."
      >
        <input
          type="date"
          value={fromISO}
          max={toISO}
          onChange={(e) => setCustomDates({ fromDate: e.target.value })}
          className={`bg-transparent text-[11px] [color-scheme:dark] ${isCustom ? "text-ink" : "text-dim"}`}
        />
        <span className="text-faint">to</span>
        <input
          type="date"
          value={toISO}
          min={fromISO}
          max={toISODate(Date.now() / 1000)}
          onChange={(e) => setCustomDates({ toDate: e.target.value })}
          className={`bg-transparent text-[11px] [color-scheme:dark] ${isCustom ? "text-ink" : "text-dim"}`}
        />
        {isCustom && (
          <button
            onClick={() => updateDataConfig({ dateMode: "lookback" })}
            title="Back to lookback presets"
            aria-label="Clear custom dates"
            className="px-0.5 text-faint hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      <label className={`${ctl} flex items-center gap-1.5 rounded-md px-2 text-[11px] text-dim`} title="Starting capital">
        Capital ₹
        <input
          type="number"
          value={active.runConfig.capital}
          min={1000}
          step={10000}
          onChange={(e) => updateRunConfig({ capital: Number(e.target.value) || 0 })}
          className="w-24 bg-transparent text-right text-[12px] text-ink"
        />
      </label>

      <div className="ml-auto flex items-center gap-3">
        {dataSlice && (
          <span className="hidden text-[11px] text-dim xl:block" title="Data cache status">
            <span className="num">{dataSlice.count.toLocaleString("en-IN")}</span> bars,{" "}
            <span className={dataSlice.cacheHit ? "text-up" : "text-amber"}>
              {dataSlice.cacheHit ? "from cache" : "freshly fetched"}
            </span>
            {dataSlice.gaps > 0 && <span className="text-amber">, {dataSlice.gaps} gaps</span>}
          </span>
        )}
        {dirty && (
          <span className="flex items-center gap-1.5 text-[11px] text-amber">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            Unsaved
          </span>
        )}

        {runState === "running" && runProgress ? (
          <div className="flex items-center gap-3">
            <div className="flex w-48 flex-col gap-1">
              <div className="flex justify-between text-[10px] text-dim">
                <span className="num">
                  {runProgress.barIndex.toLocaleString("en-IN")} / {runProgress.totalBars.toLocaleString("en-IN")} bars
                </span>
                <span className="num">{runProgress.etaMs != null ? `${fDuration(runProgress.etaMs)} left` : "…"}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div className="h-1 rounded-full bg-accent transition-all" style={{ width: `${runProgress.pct}%` }} />
              </div>
            </div>
            <button
              onClick={cancelRun}
              title="Esc"
              className="h-8 border border-down/50 px-4 text-[12px] font-medium text-down hover:bg-down/10"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={runBacktest}
            disabled={runState !== "idle" || optimizationState !== "idle"}
            title="Ctrl/Cmd + Enter"
            className="flex h-8 items-center gap-2 bg-accent px-4 text-[13px] font-semibold text-canvas shadow-[0_0_0_1px_#d9a441,0_6px_20px_-6px_#d9a44199] hover:brightness-110 disabled:opacity-60"
          >
            {optimizationState !== "idle" ? "Optimization running…" : runState === "loading-data" ? "Loading data…" : "Run backtest"}
            {runState !== "loading-data" && optimizationState === "idle" && (
              <kbd className="rounded bg-canvas/15 px-1 font-mono text-[10px] font-medium">⌘↵</kbd>
            )}
          </button>
        )}
      </div>
      {watchlistOpen && <Watchlist onClose={() => setWatchlistOpen(false)} />}
    </div>
  );
}
