"use client";

import { useEffect, useRef } from "react";
import type { AreaData, LineData, SeriesMarker, UTCTimestamp } from "lightweight-charts";
import { useStore } from "@/lib/store";
import EmptyState from "../EmptyState";
import { DOWN, mountChart, toChartTime, UP } from "./chart-utils";

export default function EquityTab() {
  const result = useStore((s) => s.result);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !result) return;
    const [chart, dispose] = mountChart(el);
    const { ts, equity, buyHold } = result.series;
    const n = ts.length;

    const eqData: AreaData[] = new Array(n);
    const bhData: LineData[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const time = toChartTime(ts[i]);
      eqData[i] = { time, value: equity[i] };
      bhData[i] = { time, value: buyHold[i] };
    }

    const eq = chart.addAreaSeries({
      lineColor: UP,
      topColor: "#3fb68b33",
      bottomColor: "#3fb68b05",
      lineWidth: 2,
      title: "strategy",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    eq.setData(eqData);

    const bh = chart.addLineSeries({
      color: "#9aa3b2",
      lineWidth: 1,
      title: "buy & hold",
      priceLineVisible: false,
    });
    bh.setData(bhData);

    // mark the peak that preceded the deepest drawdown + the trough itself
    const dd = result.series.drawdown;
    let troughI = 0;
    for (let i = 1; i < n; i++) if (dd[i] < dd[troughI]) troughI = i;
    let peakI = 0;
    for (let i = 0; i <= troughI; i++) if (equity[i] >= equity[peakI]) peakI = i;
    if (dd[troughI] < 0) {
      const markers: SeriesMarker<UTCTimestamp>[] = [
        {
          time: toChartTime(ts[peakI]),
          position: "aboveBar",
          shape: "circle",
          color: "#d9a441",
          text: "peak",
          size: 1,
        },
        {
          time: toChartTime(ts[troughI]),
          position: "belowBar",
          shape: "circle",
          color: DOWN,
          text: `max DD ${dd[troughI].toFixed(1)}%`,
          size: 1,
        },
      ];
      eq.setMarkers(markers);
    }

    chart.timeScale().fitContent();
    return dispose;
  }, [result]);

  if (!result) return <EmptyState msg="No equity curve yet" hint="Run a backtest first" />;

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-1 z-10 font-mono text-[10px]">
        <span className="text-up">— strategy (MTM)</span>
        <span className="ml-3 text-dim">— buy &amp; hold</span>
      </div>
    </div>
  );
}
