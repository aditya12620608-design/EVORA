"use client";

import {
  createChart,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

/**
 * lightweight-charts renders timestamps in UTC; we shift to IST so intraday
 * bars read in exchange time. Keep this shift everywhere chart time is used.
 */
export const IST_SHIFT = 19_800;
export const toChartTime = (unixSec: number) => (unixSec + IST_SHIFT) as UTCTimestamp;

export const CHART_THEME: DeepPartial<ChartOptions> = {
  layout: {
    background: { color: "#131a26" },
    textColor: "#9aa3b2",
    fontFamily: "var(--font-plex-mono), IBM Plex Mono, monospace",
    fontSize: 10,
  },
  grid: {
    vertLines: { color: "#1a2332" },
    horzLines: { color: "#1a2332" },
  },
  rightPriceScale: { borderColor: "#2a3648" },
  timeScale: { borderColor: "#2a3648", timeVisible: true, secondsVisible: false },
  crosshair: {
    vertLine: { color: "#5e6a7d", labelBackgroundColor: "#2a3648" },
    horzLine: { color: "#5e6a7d", labelBackgroundColor: "#2a3648" },
  },
};

/** Create a chart bound to a container with auto-resize; returns [chart, dispose]. */
export function mountChart(
  el: HTMLElement,
  extra?: DeepPartial<ChartOptions>
): [IChartApi, () => void] {
  const chart = createChart(el, {
    ...CHART_THEME,
    ...extra,
    width: el.clientWidth,
    height: el.clientHeight,
  });
  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
  });
  ro.observe(el);
  return [
    chart,
    () => {
      ro.disconnect();
      chart.remove();
    },
  ];
}

export const UP = "#3fb68b";
export const DOWN = "#e5675c";
export const OVERLAY_COLORS = ["#7fb2e5", "#d9a441", "#a78bfa", "#f472b6", "#34d399", "#fb923c"];
