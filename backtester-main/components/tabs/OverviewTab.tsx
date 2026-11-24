"use client";

import { useStore } from "@/lib/store";
import { fINR, fNum, fPct, pnlClass } from "@/lib/format";
import EmptyState from "../EmptyState";

interface Card {
  label: string;
  value: string;
  tone?: string; // text color class
  formula: string;
}

function Tooltip({ text }: { text: string }) {
  // opens downward: an upward tooltip on the first row gets clipped by the scroll container
  return (
    <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-64 rounded-md border border-line bg-canvas p-2.5 text-[10px] leading-snug text-dim shadow-xl group-hover:block">
      {text}
    </div>
  );
}

function MetricCard({ c }: { c: Card }) {
  return (
    <div className="group relative rounded-md bg-panel2/60 p-2.5 hover:bg-panel2">
      <div className={`num text-[15px] leading-tight ${c.tone ?? "text-ink"}`}>{c.value}</div>
      <div className="mt-1 text-[11px] text-dim">{c.label}</div>
      <Tooltip text={c.formula} />
    </div>
  );
}

function HeadlineCard({ c }: { c: Card }) {
  return (
    <div className="group relative rounded-md border border-line bg-panel2 px-3 py-3 hover:border-faint">
      <div className="text-[11px] text-dim">{c.label}</div>
      <div className={`mt-1.5 text-[26px] font-medium leading-none tabular-nums tracking-tight ${c.tone ?? "text-ink"}`}>{c.value}</div>
      <Tooltip text={c.formula} />
    </div>
  );
}

function Group({ title, cards }: { title: string; cards: Card[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-dim">{title}</div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <MetricCard key={c.label} c={c} />
        ))}
      </div>
    </div>
  );
}

export default function OverviewTab() {
  const result = useStore((s) => s.result);
  const meta = useStore((s) => s.resultMeta);
  if (!result) return <EmptyState msg="No run yet" hint="Press Run backtest (Ctrl/Cmd + Enter) to test the selected strategy." />;
  const m = result.metrics;

  const returns: Card[] = [
    {
      label: "Net P&L",
      value: `${fINR(m.net_pnl)} (${fPct(m.net_pnl_pct, 2, true)})`,
      tone: pnlClass(m.net_pnl),
      formula: "Σ net P&L of all trades = gross P&L − total charges",
    },
    { label: "Gross P&L", value: fINR(m.gross_pnl), tone: pnlClass(m.gross_pnl), formula: "Σ (exit − entry) × qty × side, before charges" },
    { label: "Total Charges", value: fINR(m.total_charges), tone: "text-amber", formula: "Σ itemized charges across all trade legs (brokerage, STT, txn, SEBI, GST, stamp, DP)" },
    { label: "CAGR", value: fPct(m.cagr, 2, true), tone: pnlClass(m.cagr), formula: "(final equity / initial capital)^(1/years) − 1, years from data span" },
    { label: "Buy & Hold", value: fPct(m.buy_hold_pct, 2, true), tone: pnlClass(m.buy_hold_pct), formula: "Return of holding the underlying across the same data window" },
    { label: "Alpha vs B&H", value: fPct(m.alpha_vs_bh, 2, true), tone: pnlClass(m.alpha_vs_bh), formula: "Strategy net return % − buy & hold return %" },
  ];

  const risk: Card[] = [
    {
      label: "Max Drawdown",
      value: `${fPct(m.max_dd_pct)} (${fINR(m.max_dd_rs)})`,
      tone: "text-down",
      formula: `Largest peak-to-trough equity drop. Duration: ${m.max_dd_bars} bars ≈ ${m.max_dd_days} days underwater`,
    },
    { label: "Sharpe", value: fNum(m.sharpe), tone: pnlClass(m.sharpe - 1, 0), formula: "mean(bar returns − rf/bar) / std(bar returns) × √(bars per year); rf from Run Config" },
    { label: "Sortino", value: fNum(m.sortino), tone: pnlClass(m.sortino - 1, 0), formula: "Like Sharpe but denominator = std of negative bar returns only" },
    { label: "Calmar", value: fNum(m.calmar), tone: pnlClass(m.calmar - 1, 0), formula: "CAGR / |max drawdown %|" },
    { label: "Volatility (ann.)", value: fPct(m.volatility_ann), formula: "std(bar returns) × √(bars per year)" },
    { label: "Max Consec Losses", value: String(m.max_consec_losses), tone: "text-amber", formula: "Longest streak of consecutive losing trades" },
  ];

  const trades: Card[] = [
    { label: "Trades", value: String(m.total_trades), formula: "Closed round-trip trades" },
    { label: "Win Rate", value: fPct(m.win_rate), tone: pnlClass(m.win_rate - 50, 0), formula: "winning trades / total trades" },
    { label: "Profit Factor", value: fNum(m.profit_factor), tone: pnlClass(m.profit_factor - 1, 0), formula: "Σ wins / |Σ losses| (net of charges)" },
    { label: "Expectancy", value: `${fINR(m.expectancy)} (${fNum(m.expectancy_r)}R)`, tone: pnlClass(m.expectancy), formula: "Avg net P&L per trade; R = expectancy / avg loss" },
    { label: "Avg Win / Loss", value: `${fINR(m.avg_win)} / ${fINR(-m.avg_loss)}`, formula: `Payoff ratio ${fNum(m.payoff_ratio)} = avg win / avg loss` },
    { label: "Largest Win / Loss", value: `${fINR(m.largest_win)} / ${fINR(m.largest_loss)}`, formula: "Best and worst single trade, net of charges" },
    { label: "Avg Bars Held", value: fNum(m.avg_bars_held, 1), formula: "Mean holding period in bars" },
    { label: "Avg Charges/Trade", value: fINR(m.avg_charges, 2), tone: "text-amber", formula: "total charges / trades" },
    {
      label: "Long",
      value: `${m.long_stats.count} · ${fPct(m.long_stats.win_rate, 0)} · ${fINR(m.long_stats.net_pnl)}`,
      tone: pnlClass(m.long_stats.net_pnl),
      formula: "Long trades: count · win rate · net P&L",
    },
    {
      label: "Short",
      value: `${m.short_stats.count} · ${fPct(m.short_stats.win_rate, 0)} · ${fINR(m.short_stats.net_pnl)}`,
      tone: pnlClass(m.short_stats.net_pnl),
      formula: "Short trades: count · win rate · net P&L",
    },
  ];

  const exposure: Card[] = [
    { label: "Time in Market", value: fPct(m.exposure_pct), formula: "bars holding a position / total bars" },
    { label: "SL / TP / Signal / EOD", value: `${m.sl_exits} / ${m.tp_exits} / ${m.signal_exits} / ${m.eod_exits}`, formula: "Exit reason breakdown: stop-loss / target / strategy signal / square-off + end of data" },
    { label: "Final Equity", value: fINR(m.final_equity), tone: pnlClass(m.final_equity - m.initial_capital), formula: "capital + Σ net P&L (marked to market)" },
    {
      label: "Charges % of Gross",
      value: fPct(m.charges_pct_of_gross),
      tone: "text-amber",
      formula: "Cost drag: total charges / |gross P&L|. The breakeven move per trade is roughly avg charges / avg turnover.",
    },
  ];

  const headline: Card[] = [
    { label: "Net P&L", value: fINR(m.net_pnl), tone: pnlClass(m.net_pnl), formula: returns[0].formula },
    { label: "Return", value: fPct(m.net_pnl_pct, 2, true), tone: pnlClass(m.net_pnl_pct), formula: "Net P&L / initial capital" },
    returns[3],
    { label: "Max Drawdown", value: fPct(m.max_dd_pct), tone: "text-down", formula: risk[0].formula },
    risk[1],
    trades[1],
  ];

  return (
    <div className="h-full space-y-5 overflow-y-auto p-3">
      {meta && (
        <div className="text-[11px] text-faint">
          {meta.symbol} on {meta.interval} bars, run at {new Date(meta.ranAt).toLocaleTimeString("en-IN")} in{" "}
          <span className="num">{fNum(result.elapsedMs / 1000, 2)}s</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
        {headline.map((c) => (
          <HeadlineCard key={c.label} c={c} />
        ))}
      </div>
      <Group title="Returns" cards={returns} />
      <Group title="Risk" cards={risk} />
      <Group title="Trades" cards={trades} />
      <Group title="Exposure and costs" cards={exposure} />
    </div>
  );
}
