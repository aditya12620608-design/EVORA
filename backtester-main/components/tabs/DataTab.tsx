"use client";

import { useStore } from "@/lib/store";
import { fDateTime, fNum } from "@/lib/format";
import EmptyState from "../EmptyState";

export default function DataTab() {
  const dataSlice = useStore((s) => s.dataSlice);
  const dataLoading = useStore((s) => s.dataLoading);
  const dataError = useStore((s) => s.dataError);
  const loadData = useStore((s) => s.loadData);
  const active = useStore((s) => s.active());

  const intraday = dataSlice != null && dataSlice.interval !== "1d";

  const previewRows = (() => {
    if (!dataSlice) return [];
    const b = dataSlice.buffers;
    const n = dataSlice.count;
    const idx = n <= 12 ? [...Array(n).keys()] : [0, 1, 2, 3, 4, -1, ...Array.from({ length: 6 }, (_, i) => n - 6 + i)];
    return idx.map((i) =>
      i === -1
        ? null
        : { i, ts: b.ts[i], o: b.open[i], h: b.high[i], l: b.low[i], c: b.close[i], v: b.volume[i] }
    );
  })();

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => loadData(false)}
          disabled={dataLoading}
          className="h-7 bg-accent px-3 text-[12px] font-semibold text-canvas hover:brightness-110 disabled:opacity-60"
        >
          {dataLoading ? "Loading…" : "Load data"}
        </button>
        <button
          onClick={() => loadData(true)}
          disabled={dataLoading}
          className="h-7 border border-line px-3 text-[12px] text-dim hover:border-amber hover:text-amber disabled:opacity-50"
          title="Drop the IndexedDB cache for this symbol/interval and refetch"
        >
          Clear cache and refetch
        </button>
        {active && (
          <span className="font-mono text-[10px] text-dim">
            {active.dataConfig.symbol} · {active.dataConfig.interval} ·{" "}
            {active.dataConfig.dateMode === "custom"
              ? `${active.dataConfig.fromDate} → ${active.dataConfig.toDate ?? "today"}`
              : `${active.dataConfig.rangeDays}d window`}
          </span>
        )}
      </div>

      {dataError && (
        <div className="mb-3 border border-down/40 bg-down/10 p-2 font-mono text-[11px] text-down">
          {dataError}
        </div>
      )}

      {!dataSlice && !dataError && (
        <EmptyState msg="No data loaded" hint="LOAD DATA fetches via the Yahoo proxy and caches in IndexedDB" />
      )}

      {dataSlice && (
        <>
          <div className="mb-3 grid max-w-2xl grid-cols-2 gap-1 sm:grid-cols-4">
            {[
              ["candles", dataSlice.count.toLocaleString("en-IN")],
              ["source", dataSlice.cacheHit ? "IndexedDB cache" : "Yahoo (fresh)"],
              ["first bar", fDateTime(dataSlice.from, intraday)],
              ["last bar", fDateTime(dataSlice.to, intraday)],
              ["gaps detected", String(dataSlice.gaps)],
              ["clamped", dataSlice.clamped ? `yes (~${dataSlice.clampedToDays}d limit)` : "no"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md bg-panel2/60 p-2.5">
                <div className="num text-[12px]">{v}</div>
                <div className="mt-0.5 text-[11px] capitalize text-dim">{k}</div>
              </div>
            ))}
          </div>

          <table className="border-collapse">
            <thead>
              <tr>
                {["#", "Time", "Open", "High", "Low", "Close", "Volume"].map((h) => (
                  <th key={h} className="border border-line bg-panel px-2 py-1 text-right font-sans text-[11px] font-medium text-dim first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, j) =>
                r === null ? (
                  <tr key={`gap-${j}`}>
                    <td colSpan={7} className="border border-line px-2 text-center font-mono text-[10px] text-faint">
                      ⋯ {((dataSlice.count) - 11).toLocaleString("en-IN")} more rows ⋯
                    </td>
                  </tr>
                ) : (
                  <tr key={r.i}>
                    <td className="num border border-line px-2 py-0.5 text-[10px] text-faint">{r.i}</td>
                    <td className="num border border-line px-2 py-0.5 text-[10px] text-dim">{fDateTime(r.ts, intraday)}</td>
                    {[r.o, r.h, r.l, r.c].map((x, k) => (
                      <td key={k} className="num border border-line px-2 py-0.5 text-right text-[10px]">{fNum(x)}</td>
                    ))}
                    <td className="num border border-line px-2 py-0.5 text-right text-[10px] text-dim">
                      {r.v.toLocaleString("en-IN")}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
