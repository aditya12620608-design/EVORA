"use client";

import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { fDateTime, fINR, fNum, fPct, pnlClass } from "@/lib/format";
import type { Trade } from "@/lib/worker-protocol";
import EmptyState from "../EmptyState";

const ROW_H = 24;

type SortKey = keyof Trade;

const COLS: { key: SortKey; label: string; w: string; align?: "right" }[] = [
  { key: "entry_ts", label: "Entry", w: "w-32" },
  { key: "exit_ts", label: "Exit", w: "w-32" },
  { key: "side", label: "Side", w: "w-14" },
  { key: "qty", label: "Qty", w: "w-16", align: "right" },
  { key: "entry_px", label: "Entry ₹", w: "w-20", align: "right" },
  { key: "exit_px", label: "Exit ₹", w: "w-20", align: "right" },
  { key: "gross_pnl", label: "Gross", w: "w-24", align: "right" },
  { key: "charges", label: "Charges", w: "w-20", align: "right" },
  { key: "net_pnl", label: "Net P&L", w: "w-24", align: "right" },
  { key: "return_pct", label: "Return", w: "w-16", align: "right" },
  { key: "bars_held", label: "Bars", w: "w-14", align: "right" },
  { key: "exit_reason", label: "Reason", w: "w-20" },
  { key: "tag", label: "Tag", w: "w-20" },
  { key: "cum_net_pnl", label: "Running net", w: "w-24", align: "right" },
];

const REASON_TONE: Record<string, string> = {
  sl: "text-down",
  tp: "text-up",
  signal: "text-cyan",
  eod: "text-amber",
  end_of_data: "text-dim",
};

function exportCsv(trades: Trade[], intraday: boolean) {
  const head = COLS.map((c) => c.label).join(",");
  const rows = trades.map((t) =>
    [
      fDateTime(t.entry_ts, intraday),
      fDateTime(t.exit_ts, intraday),
      t.side,
      t.qty,
      t.entry_px,
      t.exit_px,
      t.gross_pnl,
      t.charges,
      t.net_pnl,
      t.return_pct,
      t.bars_held,
      t.exit_reason,
      t.tag,
      t.cum_net_pnl,
    ].join(",")
  );
  const blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "quantdeck-trades.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function TradesTab() {
  const result = useStore((s) => s.result);
  const meta = useStore((s) => s.resultMeta);
  const jumpToTrade = useStore((s) => s.jumpToTrade);
  const [sortKey, setSortKey] = useState<SortKey>("entry_ts");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [sideFilter, setSideFilter] = useState<"all" | "long" | "short">("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const scrollRef = useRef<HTMLDivElement>(null);

  const intraday = meta != null && meta.interval !== "1d";

  const filtered = useMemo(() => {
    if (!result) return [];
    let arr = result.trades.map((t, i) => ({ ...t, _idx: i }));
    if (sideFilter !== "all") arr = arr.filter((t) => t.side === sideFilter);
    if (reasonFilter !== "all") arr = arr.filter((t) => t.exit_reason === reasonFilter);
    arr.sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c * sortDir;
    });
    return arr;
  }, [result, sideFilter, reasonFilter, sortKey, sortDir]);

  if (!result) return <EmptyState msg="No trades yet" hint="Run a backtest to populate the blotter" />;
  if (!result.trades.length) return <EmptyState msg="Strategy produced 0 trades" hint="Loosen entry conditions or widen the data range" />;

  // windowed rendering — happily handles 10k+ rows
  const total = filtered.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + 10);
  const slice = filtered.slice(start, end);

  const header = (c: (typeof COLS)[number]) => (
    <button
      key={c.key}
      className={`${c.w} shrink-0 rounded-none px-1.5 py-1.5 text-left text-[11px] font-medium text-dim hover:text-ink ${
        c.align === "right" ? "text-right" : ""
      }`}
      onClick={() => {
        if (sortKey === c.key) setSortDir(sortDir === 1 ? -1 : 1);
        else {
          setSortKey(c.key);
          setSortDir(1);
        }
      }}
    >
      {c.label}
      {sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <select
          value={sideFilter}
          onChange={(e) => setSideFilter(e.target.value as typeof sideFilter)}
          className="h-5 border border-line bg-panel2 px-1 font-mono text-[10px]"
        >
          <option value="all">all sides</option>
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="h-5 border border-line bg-panel2 px-1 font-mono text-[10px]"
        >
          <option value="all">all exits</option>
          {["signal", "sl", "tp", "eod", "end_of_data"].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px] text-faint">
          {total.toLocaleString("en-IN")} trades · click a row to view on chart
        </span>
        <button
          onClick={() => exportCsv(filtered, intraday)}
          className="ml-auto h-5 border border-line px-2 font-mono text-[10px] text-cyan hover:border-cyan"
        >
          ↓ CSV
        </button>
      </div>

      <div className="flex border-b border-line bg-panel pr-2">{COLS.map(header)}</div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          setViewH(e.currentTarget.clientHeight);
        }}
      >
        <div style={{ height: total * ROW_H, position: "relative" }}>
          {slice.map((t, j) => {
            const i = start + j;
            return (
              <button
                key={`${t.entry_i}-${t.exit_i}-${i}`}
                onClick={() => jumpToTrade(t._idx)}
                className={`absolute left-0 flex w-full items-center border-b border-line/30 text-left hover:bg-panel2 ${
                  i % 2 ? "bg-panel/40" : ""
                }`}
                style={{ top: i * ROW_H, height: ROW_H }}
                title={Object.entries(t.charges_breakdown)
                  .map(([k, v]) => `${k}: ₹${fNum(v, 2)}`)
                  .join("\n")}
              >
                <span className="w-32 shrink-0 px-1.5 font-mono text-[10px] text-dim">
                  {fDateTime(t.entry_ts, intraday)}
                </span>
                <span className="w-32 shrink-0 px-1.5 font-mono text-[10px] text-dim">
                  {fDateTime(t.exit_ts, intraday)}
                </span>
                <span
                  className={`w-14 shrink-0 px-1.5 font-mono text-[10px] ${
                    t.side === "long" ? "text-up" : "text-down"
                  }`}
                >
                  {t.side === "long" ? "▲ L" : "▼ S"}
                </span>
                <span className="num w-16 shrink-0 px-1.5 text-right text-[10px]">{t.qty}</span>
                <span className="num w-20 shrink-0 px-1.5 text-right text-[10px]">{fNum(t.entry_px)}</span>
                <span className="num w-20 shrink-0 px-1.5 text-right text-[10px]">{fNum(t.exit_px)}</span>
                <span className={`num w-24 shrink-0 px-1.5 text-right text-[10px] ${pnlClass(t.gross_pnl)}`}>
                  {fINR(t.gross_pnl, 2)}
                </span>
                <span className="num w-20 shrink-0 px-1.5 text-right text-[10px] text-amber">
                  {fNum(t.charges, 2)}
                </span>
                <span className={`num w-24 shrink-0 px-1.5 text-right text-[10px] font-bold ${pnlClass(t.net_pnl)}`}>
                  {fINR(t.net_pnl, 2)}
                </span>
                <span className={`num w-16 shrink-0 px-1.5 text-right text-[10px] ${pnlClass(t.return_pct)}`}>
                  {fPct(t.return_pct)}
                </span>
                <span className="num w-14 shrink-0 px-1.5 text-right text-[10px] text-dim">{t.bars_held}</span>
                <span className={`w-20 shrink-0 px-1.5 font-mono text-[10px] ${REASON_TONE[t.exit_reason] ?? ""}`}>
                  {t.exit_reason}
                </span>
                <span className="w-20 shrink-0 truncate px-1.5 font-mono text-[10px] text-faint">{t.tag}</span>
                <span className={`num w-24 shrink-0 px-1.5 text-right text-[10px] ${pnlClass(t.cum_net_pnl)}`}>
                  {fINR(t.cum_net_pnl, 2)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
