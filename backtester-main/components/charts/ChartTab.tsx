"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  LineData,
  MouseEventParams,
  SeriesMarker,
  UTCTimestamp,
} from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import { useStore } from "@/lib/store";
import { fNum } from "@/lib/format";
import EmptyState from "../EmptyState";
import { DOWN, mountChart, OVERLAY_COLORS, toChartTime, UP } from "./chart-utils";

const REASON_COLOR: Record<string, string> = {
  sl: DOWN,
  tp: UP,
  signal: "#7fb2e5",
  eod: "#d9a441",
  end_of_data: "#9aa3b2",
};

const MAX_CONNECTORS = 300;

export default function ChartTab() {
  const dataSlice = useStore((s) => s.dataSlice);
  const result = useStore((s) => s.result);
  const meta = useStore((s) => s.resultMeta);
  const selectedTrade = useStore((s) => s.selectedTrade);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [legend, setLegend] = useState<string>("");

  const dataMatchesRun =
    dataSlice && (!meta || (meta.symbol === dataSlice.symbol && meta.interval === dataSlice.interval));

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !dataSlice) return;
    const [chart, dispose] = mountChart(el);
    chartRef.current = chart;

    const b = dataSlice.buffers;
    const n = dataSlice.count;
    const candleData: CandlestickData[] = new Array(n);
    for (let i = 0; i < n; i++) {
      candleData[i] = {
        time: toChartTime(b.ts[i]),
        open: b.open[i],
        high: b.high[i],
        low: b.low[i],
        close: b.close[i],
      };
    }

    const candles = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: "#3fb68b99",
      wickDownColor: "#e5675c99",
    });
    candles.setData(candleData);
    candlesRef.current = candles;

    if (showVolume) {
      const vol = chart.addHistogramSeries({
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      const volData: HistogramData[] = new Array(n);
      for (let i = 0; i < n; i++) {
        volData[i] = {
          time: toChartTime(b.ts[i]),
          value: b.volume[i],
          color: b.close[i] >= b.open[i] ? "#3fb68b33" : "#e5675c33",
        };
      }
      vol.setData(volData);
    }

    // indicator overlays + oscillator band (run must match the loaded data)
    if (result && dataMatchesRun) {
      const hasOsc = result.indicators.some((d) => !d.overlay);
      result.indicators.forEach((ind, k) => {
        const color = OVERLAY_COLORS[k % OVERLAY_COLORS.length];
        const series = chart.addLineSeries({
          color,
          lineWidth: 1,
          priceScaleId: ind.overlay ? "right" : "osc",
          lastValueVisible: false,
          priceLineVisible: false,
          title: ind.name,
        });
        const data: LineData[] = [];
        for (let i = 0; i < n; i++) {
          const v = ind.values[i];
          if (!Number.isNaN(v)) data.push({ time: toChartTime(result.series.ts[i]), value: v });
        }
        series.setData(data);
      });
      if (hasOsc) {
        chart.priceScale("osc").applyOptions({ scaleMargins: { top: 0.72, bottom: showVolume ? 0.16 : 0.02 } });
        chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.3 } });
      }

      // trade markers
      const markers: SeriesMarker<UTCTimestamp>[] = [];
      for (const t of result.trades) {
        const entryTime = toChartTime(t.entry_ts);
        const exitTime = toChartTime(t.exit_ts);
        markers.push({
          time: entryTime,
          position: t.side === "long" ? "belowBar" : "aboveBar",
          shape: t.side === "long" ? "arrowUp" : "arrowDown",
          color: t.side === "long" ? UP : DOWN,
          text: t.qty > 1 ? `${t.side === "long" ? "▲" : "▼"}${t.qty}` : undefined,
          size: 1,
        });
        markers.push({
          time: exitTime,
          position: t.side === "long" ? "aboveBar" : "belowBar",
          shape: "circle",
          color: REASON_COLOR[t.exit_reason] ?? "#9aa3b2",
          text: `×${t.exit_reason === "end_of_data" ? "end" : t.exit_reason}`,
          size: 0,
        });
      }
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      candles.setMarkers(markers);

      // dashed entry→exit connectors colored by P&L (capped for huge runs)
      const connectorTrades =
        result.trades.length <= MAX_CONNECTORS
          ? result.trades
          : selectedTrade != null
            ? [result.trades[selectedTrade]]
            : [];
      for (const t of connectorTrades) {
        if (!t || t.entry_ts === t.exit_ts) continue;
        const line = chart.addLineSeries({
          color: t.net_pnl >= 0 ? "#3fb68bbb" : "#e5675cbb",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        line.setData([
          { time: toChartTime(t.entry_ts), value: t.entry_px },
          { time: toChartTime(t.exit_ts), value: t.exit_px },
        ]);
      }
    }

    // crosshair OHLC legend
    const onMove = (param: MouseEventParams) => {
      const d = param.seriesData.get(candles) as CandlestickData | undefined;
      if (!d) {
        setLegend("");
        return;
      }
      const chg = ((d.close - d.open) / d.open) * 100;
      setLegend(
        `O ${fNum(d.open)}  H ${fNum(d.high)}  L ${fNum(d.low)}  C ${fNum(d.close)}  ${chg >= 0 ? "+" : ""}${fNum(chg)}%`
      );
    };
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      dispose();
      chartRef.current = null;
      candlesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSlice, result, showVolume, dataMatchesRun, selectedTrade == null]);

  // zoom to the selected trade
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || selectedTrade == null || !result) return;
    const t = result.trades[selectedTrade];
    if (!t) return;
    const rts = result.series.ts;
    const barSec = rts.length > 1 ? rts[1] - rts[0] : 86400;
    const span = Math.max(t.exit_ts - t.entry_ts, barSec) + 25 * barSec;
    chart.timeScale().setVisibleRange({
      from: toChartTime(t.entry_ts - span),
      to: toChartTime(t.exit_ts + span),
    });
  }, [selectedTrade, result]);

  if (!dataSlice) {
    return <EmptyState msg="No data loaded" hint="Run a backtest or load data from the Data tab" />;
  }

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-1 z-10 font-mono text-[10px] text-dim">
        <span className="text-ink">{dataSlice.symbol}</span> · {dataSlice.interval} · IST{" "}
        {legend && <span className="ml-2 text-cyan">{legend}</span>}
        {!dataMatchesRun && result && (
          <span className="ml-2 text-amber">⚠ data changed since last run — markers hidden, re-run</span>
        )}
        {result && result.trades.length > MAX_CONNECTORS && (
          <span className="ml-2 text-faint">
            connectors hidden &gt;{MAX_CONNECTORS} trades — click a trade row to draw one
          </span>
        )}
      </div>
      <button
        onClick={() => setShowVolume(!showVolume)}
        className={`absolute right-16 top-1.5 z-10 border border-line bg-panel2 px-2 py-0.5 text-[11px] ${
          showVolume ? "bg-accent/15 text-accent" : "text-dim"
        }`}
      >
        Volume
      </button>
    </div>
  );
}
