"use client";

import { useMemo, useState } from "react";
import { fINR, fNum } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { OptimizationObjective, OptimizationRow, ParamSpec } from "@/lib/worker-protocol";
import EmptyState from "../EmptyState";

const HARD_CAP = 500;
const STRIDES = [1, 2, 5, 10, 20, 50];
const OBJECTIVES: { id: OptimizationObjective; label: string }[] = [
  { id: "net_pnl", label: "Net P&L" },
  { id: "sharpe", label: "Sharpe" },
  { id: "calmar", label: "Calmar" },
  { id: "profit_factor", label: "Profit factor" },
];

function numericParams(specs: ParamSpec[]) {
  return specs.filter((spec) =>
    (spec.type === "int" || spec.type === "float") &&
    spec.min != null && spec.max != null && spec.step != null &&
    Number.isFinite(spec.min) && Number.isFinite(spec.max) && Number.isFinite(spec.step) &&
    spec.step > 0 && spec.max >= spec.min
  );
}

function gridValues(spec: ParamSpec, stride: number) {
  const min = spec.min!;
  const max = spec.max!;
  const step = spec.step! * stride;
  const decimals = Math.min(8, Math.max(0, ...[min, max, step].map((n) => (String(n).split(".")[1] ?? "").length)));
  const values: number[] = [];
  for (let i = 0; i < HARD_CAP + 1; i++) {
    const value = min + i * step;
    if (value > max + step * 1e-8) break;
    values.push(Number(value.toFixed(decimals)));
  }
  return values;
}

function objectiveText(objective: OptimizationObjective, value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (objective === "net_pnl") return fINR(value, 0);
  return fNum(value, 3);
}

type SortKey = "objectiveValue" | "net_pnl" | "sharpe" | "calmar" | "profit_factor" | "total_trades";

function objectiveOf(row: OptimizationRow, key: SortKey) {
  if (key === "objectiveValue") return row.objectiveValue ?? Number.NEGATIVE_INFINITY;
  return row.metrics[key];
}

function Heatmap({
  rows,
  first,
  second,
  objective,
  onApply,
}: {
  rows: OptimizationRow[];
  first: { spec: ParamSpec; values: number[] };
  second: { spec: ParamSpec; values: number[] };
  objective: OptimizationObjective;
  onApply: (params: Record<string, number | string | boolean>) => void;
}) {
  const byPair = new Map(rows.map((row) => [`${row.params[first.spec.key]}|${row.params[second.spec.key]}`, row]));
  const scores = rows.map((row) => row.objectiveValue).filter((value): value is number => value != null && Number.isFinite(value));
  const lo = Math.min(...scores, 0);
  const hi = Math.max(...scores, 0);
  const color = (score: number | null) => {
    if (score == null || hi === lo) return "rgba(148,163,184,.08)";
    const strength = 0.1 + 0.36 * ((score - lo) / (hi - lo));
    return score >= 0 ? `rgba(63,182,139,${strength})` : `rgba(229,103,92,${strength})`;
  };
  const yValues = [...second.values].reverse();

  return (
    <div className="overflow-auto rounded-md border border-line">
      <table className="border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-panel px-2 py-1.5 text-left text-dim">{second.spec.label} ↓ / {first.spec.label} →</th>
            {first.values.map((value) => <th key={value} className="min-w-14 bg-panel px-1 py-1.5 font-mono font-normal text-dim">{value}</th>)}
          </tr>
        </thead>
        <tbody>
          {yValues.map((y) => (
            <tr key={y}>
              <th className="sticky left-0 bg-panel px-2 py-1 text-left font-mono font-normal text-dim">{y}</th>
              {first.values.map((x) => {
                const row = byPair.get(`${x}|${y}`);
                return (
                  <td key={x} className="border border-line/50 p-0">
                    <button
                      disabled={!row}
                      onClick={() => row && onApply(row.params)}
                      title={row ? `Apply ${first.spec.label} ${x}, ${second.spec.label} ${y}` : "No result"}
                      style={{ backgroundColor: color(row?.objectiveValue ?? null) }}
                      className="h-8 w-full px-1 font-mono text-[9px] text-ink hover:outline hover:outline-1 hover:outline-accent disabled:cursor-default"
                    >
                      {row ? objectiveText(objective, row.objectiveValue) : "·"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OptimizeTab() {
  const active = useStore((state) => state.active());
  const specs = useStore((state) => state.paramSpecs);
  const result = useStore((state) => state.result);
  const dataSlice = useStore((state) => state.dataSlice);
  const rows = useStore((state) => state.optimizationRows);
  const elapsedMs = useStore((state) => state.optimizationElapsedMs);
  const runState = useStore((state) => state.optimizationState);
  const progress = useStore((state) => state.optimizationProgress);
  const optimize = useStore((state) => state.optimizeBacktest);
  const cancel = useStore((state) => state.cancelOptimization);
  const applyParams = useStore((state) => state.applyOptimizationParams);
  const [selectedKeys, setSelectedKeys] = useState<string[] | null>(null);
  const [strides, setStrides] = useState<Record<string, number>>({});
  const [objective, setObjective] = useState<OptimizationObjective>("net_pnl");
  const [sortKey, setSortKey] = useState<SortKey>("objectiveValue");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);

  const eligible = useMemo(() => numericParams(specs), [specs]);
  const activeKeys = selectedKeys ?? eligible.slice(0, 1).map((spec) => spec.key);

  const selected = useMemo(() => activeKeys
    .map((key) => eligible.find((spec) => spec.key === key))
    .filter((spec): spec is ParamSpec => !!spec), [activeKeys, eligible]);
  const grid = useMemo(() => selected.map((spec) => ({
    spec,
    values: gridValues(spec, strides[spec.key] ?? 1),
  })), [selected, strides]);
  const combinationCount = selected.length ? grid.reduce((count, dimension) => count * dimension.values.length, 1) : 0;
  const overLimit = combinationCount > HARD_CAP;
  const perRunMs = result?.elapsedMs ?? (dataSlice ? Math.max(150, dataSlice.count * 0.25) : 1500);
  const estimatedMs = perRunMs * combinationCount;
  const sortedRows = useMemo(() => [...rows].sort((a, b) =>
    (Number(objectiveOf(a, sortKey)) - Number(objectiveOf(b, sortKey))) * sortDirection
  ), [rows, sortKey, sortDirection]);
  const metricColumns: [SortKey, string][] = ([
    ["objectiveValue", OBJECTIVES.find((item) => item.id === objective)?.label ?? "Score"],
    ["net_pnl", "Net P&L"], ["sharpe", "Sharpe"], ["calmar", "Calmar"], ["profit_factor", "Profit factor"], ["total_trades", "Trades"],
  ] as [SortKey, string][]).filter(([key]) => key === "objectiveValue" || key !== objective);
  const running = runState !== "idle";
  const pct = progress && progress.total > 0
    ? Math.min(100, ((progress.completed + (progress.totalBars ? progress.barIndex / progress.totalBars : 0)) / progress.total) * 100)
    : 0;

  const toggleParam = (key: string) => {
    setSelectedKeys((current) => {
      const selectedNow = current ?? eligible.slice(0, 1).map((spec) => spec.key);
      if (selectedNow.includes(key)) return selectedNow.filter((item) => item !== key);
      if (selectedNow.length >= 3) return selectedNow;
      return [...selectedNow, key];
    });
  };
  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection(sortDirection === 1 ? -1 : 1);
    else { setSortKey(key); setSortDirection(-1); }
  };

  if (!active) return <EmptyState msg="Choose a strategy" hint="Select a strategy with numeric parameters to optimize it" />;

  return (
    <div className="h-full overflow-auto p-3 text-[11px]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Parameter optimizer</h2>
          <p className="mt-1 max-w-3xl text-dim">Grid values come from each parameter’s declared minimum, maximum, and step. Increase the step multiplier to search a coarser grid.</p>
        </div>
        <label className="flex items-center gap-2 text-dim">Objective
          <select value={objective} onChange={(event) => setObjective(event.target.value as OptimizationObjective)} className="h-7 border border-line bg-panel2 px-2 font-mono text-ink">
            {OBJECTIVES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>

      {eligible.length === 0 ? (
        <EmptyState msg="No optimizable parameters" hint="Add numeric Param entries with min, max, and step to the strategy" />
      ) : (
        <div className="mb-3 rounded-md border border-line bg-panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-ink">Parameters to search <span className="text-dim">(up to 3)</span></span>
            <span className={`font-mono ${overLimit ? "text-amber" : "text-dim"}`}>{combinationCount.toLocaleString("en-IN")} / {HARD_CAP} combinations</span>
          </div>
          <div className="space-y-1">
            {eligible.map((spec) => {
              const checked = activeKeys.includes(spec.key);
              const multiplier = strides[spec.key] ?? 1;
              return (
                <div key={spec.key} className="flex min-h-8 items-center gap-2 border-t border-line/60 py-1.5">
                  <label className="flex min-w-32 items-center gap-2 text-ink">
                    <input type="checkbox" aria-label={spec.label} checked={checked} onChange={() => toggleParam(spec.key)} disabled={!checked && activeKeys.length >= 3} className="accent-[#d9a441]" />
                    <span>{spec.label}</span>
                  </label>
                  <span className="font-mono text-dim">{spec.min} … {spec.max} · step {spec.step}</span>
                  {checked && <label className="ml-auto flex items-center gap-1 text-dim">Grid spacing
                    <select value={multiplier} onChange={(event) => setStrides((current) => ({ ...current, [spec.key]: Number(event.target.value) }))} className="h-6 border border-line bg-panel2 px-1 font-mono text-ink">
                      {STRIDES.map((value) => <option key={value} value={value}>{value}×</option>)}
                    </select>
                  </label>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div className="text-dim">
              <span className="text-ink">Estimated time:</span> ~{fNum(estimatedMs / 1000, 1)}s
              <span className="ml-1 text-faint">{result ? "using the latest backtest time" : "rough estimate until a backtest is measured"}</span>
            </div>
            {running ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-dim">{progress?.completed ?? 0}/{progress?.total ?? combinationCount} combinations · {Math.round(pct)}%</span>
                <button onClick={cancel} className="h-7 border border-down/50 px-3 text-down hover:bg-down/10">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => void optimize(grid.map(({ spec, values }) => ({ key: spec.key, values })), objective)}
                disabled={!selected.length || overLimit}
                className="h-7 bg-accent px-3 font-medium text-canvas hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >Run optimization</button>
            )}
          </div>
          {overLimit && <p className="mt-2 text-amber">This exceeds the hard limit of 500. Increase one or more grid spacing multipliers or select fewer parameters.</p>}
          {running && <div className="mt-2 h-1 overflow-hidden rounded bg-line"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="mb-2 rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-amber">
            <span className="font-medium">Overfitting warning:</span> The best historical settings may fit noise. Check a separate period before drawing conclusions. Backtests are historical simulations, not a promise of returns.
          </div>
          <div className="mb-3 flex items-center justify-between text-dim">
            <span>{rows.length} combinations · completed in {fNum((elapsedMs ?? 0) / 1000, 2)}s</span>
            <span>Click a result to apply its parameters.</span>
          </div>
          {selected.length === 2 && (
            <section className="mb-4">
              <h3 className="mb-1.5 font-medium text-ink">{OBJECTIVES.find((item) => item.id === objective)?.label} heatmap</h3>
              <Heatmap rows={rows} first={grid[0]} second={grid[1]} objective={objective} onApply={applyParams} />
            </section>
          )}
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  {selected.map((spec) => <th key={spec.key} className="whitespace-nowrap border-b border-line px-2 py-2 font-medium text-dim">{spec.label}</th>)}
                  {metricColumns.map(([key, label]) => (
                    <th key={key} className="whitespace-nowrap border-b border-line px-2 py-2 text-right font-medium text-dim">
                      <button onClick={() => setSort(key)} className="hover:text-ink">{label}{sortKey === key ? (sortDirection === 1 ? " ↑" : " ↓") : ""}</button>
                    </th>
                  ))}
                  <th className="border-b border-line px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={`${index}-${JSON.stringify(row.params)}`} className="border-b border-line/50 hover:bg-panel2/70">
                    {selected.map((spec) => <td key={spec.key} className="px-2 py-1.5 font-mono text-ink">{String(row.params[spec.key])}</td>)}
                    {metricColumns.map(([key]) => (
                      <td key={key} className={`px-2 py-1.5 text-right font-mono ${key === "objectiveValue" ? "text-accent" : "text-ink"}`}>
                        {key === "objectiveValue" ? objectiveText(objective, row.objectiveValue)
                          : key === "net_pnl" ? fINR(row.metrics.net_pnl, 0)
                            : key === "total_trades" ? String(row.metrics.total_trades)
                              : fNum(row.metrics[key], 2)}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right"><button onClick={() => applyParams(row.params)} className="border border-line px-2 py-1 text-[10px] text-cyan hover:border-cyan">Apply</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
