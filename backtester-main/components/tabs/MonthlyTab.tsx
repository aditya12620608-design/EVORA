"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { fNum } from "@/lib/format";
import EmptyState from "../EmptyState";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cellBg(ret: number): string {
  if (ret === 0) return "transparent";
  const a = Math.min(Math.abs(ret) / 8, 1) * 0.55 + 0.08;
  return ret > 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
}

export default function MonthlyTab() {
  const result = useStore((s) => s.result);

  const grid = useMemo(() => {
    if (!result) return null;
    const byYear = new Map<number, (number | null)[]>();
    for (const m of result.monthly) {
      if (!byYear.has(m.year)) byYear.set(m.year, Array(12).fill(null));
      byYear.get(m.year)![m.month - 1] = m.ret;
    }
    return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
  }, [result]);

  if (!result || !grid?.length)
    return <EmptyState msg="No monthly data" hint="Run a backtest spanning at least one month" />;

  return (
    <div className="h-full overflow-auto p-3">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="border border-line bg-panel px-2 py-1 text-left font-sans text-[11px] font-medium text-dim">Year</th>
            {MONTHS.map((m) => (
              <th key={m} className="border border-line bg-panel px-2 py-1 font-sans text-[11px] font-medium text-dim">
                {m}
              </th>
            ))}
            <th className="border border-line bg-panel px-2 py-1 font-sans text-[11px] font-medium text-dim">YTD</th>
          </tr>
        </thead>
        <tbody>
          {grid.map(([year, months]) => {
            const ytd = months.reduce<number>((acc, r) => (r == null ? acc : (1 + acc) * (1 + r / 100) - 1), 0);
            return (
              <tr key={year}>
                <td className="border border-line bg-panel px-2 py-1 font-mono text-[10px] text-dim">{year}</td>
                {months.map((r, i) => (
                  <td
                    key={i}
                    className="num border border-line px-2 py-1 text-right text-[10px]"
                    style={{ background: r == null ? undefined : cellBg(r) }}
                  >
                    {r == null ? <span className="text-faint">·</span> : fNum(r, 1)}
                  </td>
                ))}
                <td
                  className="num border border-line px-2 py-1 text-right text-[10px] font-bold"
                  style={{ background: cellBg(ytd * 100) }}
                >
                  {fNum(ytd * 100, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 font-mono text-[10px] text-faint">
        % return on marked-to-market equity, calendar months (IST)
      </div>
    </div>
  );
}
