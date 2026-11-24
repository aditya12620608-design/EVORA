"use client";

import { useEffect, useRef } from "react";
import type { AreaData } from "lightweight-charts";
import { useStore } from "@/lib/store";
import EmptyState from "../EmptyState";
import { mountChart, toChartTime } from "./chart-utils";

export default function DrawdownTab() {
  const result = useStore((s) => s.result);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !result) return;
    const [chart, dispose] = mountChart(el);
    const { ts, drawdown } = result.series;
    const n = ts.length;

    const data: AreaData[] = new Array(n);
    for (let i = 0; i < n; i++) {
      data[i] = { time: toChartTime(ts[i]), value: drawdown[i] };
    }

    const area = chart.addAreaSeries({
      lineColor: "#e5675c",
      topColor: "#e5675c08",
      bottomColor: "#e5675c55",
      lineWidth: 1,
      invertFilledArea: true,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
    });
    area.setData(data);
    area.createPriceLine({ price: 0, color: "#5e6a7d", lineWidth: 1, lineStyle: 0, title: "" });

    chart.timeScale().fitContent();
    return dispose;
  }, [result]);

  if (!result) return <EmptyState msg="No drawdown series yet" hint="Run a backtest first" />;

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-1 z-10 font-mono text-[10px] text-down">
        underwater curve — % below running equity peak (max {result.metrics.max_dd_pct}%)
      </div>
    </div>
  );
}
