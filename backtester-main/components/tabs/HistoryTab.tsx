"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { fINR } from "@/lib/format";

const COLORS = ["#d9a441", "#60a5fa", "#4ade80", "#f472b6"];
export default function HistoryTab() {
  const rows = useStore((s) => s.runHistory);
  const refresh = useStore((s) => s.refreshRunHistory);
  const activeId = useStore((s) => s.activeId);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { void refresh(); setSelected([]); }, [refresh, activeId]);
  const chosen = useMemo(() => selected.map((id) => rows.find((row) => row.id === id)).filter((row) => row !== undefined), [rows, selected]);
  const relative = chosen.map((row) => row.equity.map((value) => (value / (row.equity[0] || 1) - 1) * 100));
  const all = relative.flat();
  const low = Math.min(0, ...all), high = Math.max(0, ...all), span = Math.max(0.01, high - low);
  const curves = chosen.map((row, index) => {
    const values = relative[index];
    const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 1000},${260 - ((v - low) / span) * 240}`).join(" ");
    return { row, points };
  });
  return <div className="flex h-full flex-col overflow-auto p-4 text-xs">
    <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Run history</h2><p className="mt-1 text-dim">Compare up to four saved runs for this strategy.</p></div><button onClick={() => void refresh()} className="border border-line px-3 py-1.5 text-dim hover:text-ink">Refresh</button></div>
    <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(260px,0.8fr)_minmax(400px,1.2fr)]">
      <div className="max-h-[440px] overflow-auto rounded border border-line">
        {rows.map((row) => <label key={row.id} className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 hover:bg-panel2">
          <input type="checkbox" checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 4} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, row.id] : prev.filter((id) => id !== row.id))} />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{row.symbol} · {new Date(row.ranAt).toLocaleString()}</span><span className="text-[10px] text-dim">{row.interval} · {row.metrics.total_trades} trades · P&amp;L {fINR(row.metrics.net_pnl)}</span></span>
        </label>)}
        {!rows.length && <p className="p-4 text-dim">No saved runs yet. Run a strategy to start a history.</p>}
      </div>
      <div className="min-w-0">
        {chosen.length > 0 && <>
          <div className="mb-2 flex gap-3">{curves.map(({ row }, i) => <span key={row.id} style={{ color: COLORS[i] }}>{row.symbol} · {new Date(row.ranAt).toLocaleDateString()}</span>)}</div>
          <svg viewBox="0 0 1000 280" preserveAspectRatio="none" className="h-56 w-full rounded border border-line bg-panel"><line x1="0" x2="1000" y1={260 - ((0 - low) / span) * 240} y2={260 - ((0 - low) / span) * 240} stroke="#64748b" strokeDasharray="5 5" />{curves.map(({ row, points }, i) => <polyline key={row.id} points={points} fill="none" stroke={COLORS[i]} strokeWidth="3" vectorEffect="non-scaling-stroke" />)}</svg>
          <div className="mt-3 overflow-auto"><table className="w-full text-left"><thead className="text-dim"><tr><th className="py-1">Metric</th>{chosen.map((row, i) => <th key={row.id} style={{ color: COLORS[i] }} className="py-1">{row.symbol}</th>)}</tr></thead><tbody>{([['Net P&L', (m: typeof chosen[number]["metrics"]) => fINR(m.net_pnl)], ["Return", (m: typeof chosen[number]["metrics"]) => `${m.net_pnl_pct.toFixed(2)}%`], ["Sharpe", (m: typeof chosen[number]["metrics"]) => m.sharpe.toFixed(2)], ["Max drawdown", (m: typeof chosen[number]["metrics"]) => `${m.max_dd_pct.toFixed(2)}%`], ["Trades", (m: typeof chosen[number]["metrics"]) => String(m.total_trades)]] as const).map(([label, fmt]) => <tr key={label} className="border-t border-line"><td className="py-1.5 text-dim">{label}</td>{chosen.map((row) => <td key={row.id} className="num py-1.5">{fmt(row.metrics)}</td>)}</tr>)}</tbody></table></div>
        </>}
      </div>
    </div>
  </div>;
}
