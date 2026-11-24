"use client";

import { useStore, type BottomTab } from "@/lib/store";
import OverviewTab from "./tabs/OverviewTab";
import TradesTab from "./tabs/TradesTab";
import ConsoleTab from "./tabs/ConsoleTab";
import MonthlyTab from "./tabs/MonthlyTab";
import DocsTab from "./tabs/DocsTab";
import DataTab from "./tabs/DataTab";
import ChartTab from "./charts/ChartTab";
import EquityTab from "./charts/EquityTab";
import DrawdownTab from "./charts/DrawdownTab";
import OptimizeTab from "./tabs/OptimizeTab";
import HistoryTab from "./tabs/HistoryTab";
import ScannerTab from "./tabs/ScannerTab";

const TABS: { id: BottomTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "optimize", label: "Optimize" },
  { id: "history", label: "Run history" },
  { id: "scanner", label: "Scanner" },
  { id: "equity", label: "Equity Curve" },
  { id: "drawdown", label: "Drawdown" },
  { id: "trades", label: "Trades" },
  { id: "chart", label: "Chart" },
  { id: "monthly", label: "Monthly" },
  { id: "console", label: "Console" },
  { id: "data", label: "Data" },
  { id: "docs", label: "Docs" },
];

export default function BottomPanel() {
  const bottomTab = useStore((s) => s.bottomTab);
  const setBottomTab = useStore((s) => s.setBottomTab);
  const result = useStore((s) => s.result);
  const activeId = useStore((s) => s.activeId);
  const consoleLines = useStore((s) => s.consoleLines);
  const errCount = consoleLines.filter((l) => l.level === "error").length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setBottomTab(t.id)}
            role="tab"
            aria-selected={bottomTab === t.id}
            className={`flex h-7 shrink-0 items-center px-3 text-[12px] ${
              bottomTab === t.id
                ? "bg-panel2 font-medium text-ink shadow-[inset_0_-2px_0_#d9a441]"
                : "text-dim hover:bg-panel2/60 hover:text-ink"
            }`}
          >
            {t.label}
            {t.id === "trades" && result ? (
              <span className="num ml-1.5 rounded bg-line px-1 text-[10px] text-dim">{result.trades.length}</span>
            ) : null}
            {t.id === "console" && errCount > 0 ? (
              <span className="num ml-1.5 rounded bg-down/20 px-1 text-[10px] text-down">{errCount}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-bg">
        {bottomTab === "overview" && <OverviewTab />}
        {bottomTab === "optimize" && <OptimizeTab key={activeId ?? "none"} />}
        {bottomTab === "history" && <HistoryTab key={activeId ?? "none"} />}
        {bottomTab === "scanner" && <ScannerTab />}
        {bottomTab === "equity" && <EquityTab />}
        {bottomTab === "drawdown" && <DrawdownTab />}
        {bottomTab === "trades" && <TradesTab />}
        {bottomTab === "chart" && <ChartTab />}
        {bottomTab === "monthly" && <MonthlyTab />}
        {bottomTab === "console" && <ConsoleTab />}
        {bottomTab === "data" && <DataTab />}
        {bottomTab === "docs" && <DocsTab />}
      </div>
    </div>
  );
}
