"use client";

import { useEffect, useMemo, useState } from "react";
import { storage } from "@/lib/db";
import { SYMBOL_PRESETS } from "@/lib/data-service";
import { useStore } from "@/lib/store";

const STARTER = {
  "Nifty 50": ["RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS", "TCS.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS", "AXISBANK.NS"],
  "Bank Nifty": ["HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "AXISBANK.NS", "KOTAKBANK.NS"],
};
type BasketMap = Record<string, string[]>;
type Quote = { close: number; change: number };

export default function Watchlist({ onClose }: { onClose: () => void }) {
  const updateDataConfig = useStore((s) => s.updateDataConfig);
  const [baskets, setBaskets] = useState<BasketMap>(STARTER);
  const [selected, setSelected] = useState("Nifty 50");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [symbol, setSymbol] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("qd-watchlists-v1");
      if (raw) setBaskets({ ...STARTER, ...JSON.parse(raw) as BasketMap });
    } catch { /* keep starter lists if saved browser data is malformed */ }
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all((baskets[selected] ?? []).map(async (sym) => {
      const cached = await storage.getCandles(`${sym}|1d`).catch(() => undefined);
      const closes = cached?.close ?? [];
      if (closes.length) return [sym, { close: closes.at(-1)!, change: closes.length > 1 ? (closes.at(-1)! / closes.at(-2)! - 1) * 100 : 0 }] as const;
      return [sym, null] as const;
    })).then((items) => {
      if (alive) setQuotes(Object.fromEntries(items.filter((item): item is readonly [string, Quote] => item[1] !== null)));
    });
    return () => { alive = false; };
  }, [baskets, selected]);
  const save = (next: BasketMap) => { setBaskets(next); localStorage.setItem("qd-watchlists-v1", JSON.stringify(next)); };
  const matches = useMemo(() => SYMBOL_PRESETS.filter((item) => !search || `${item.symbol} ${item.label}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8), [search]);
  const add = (sym: string) => { if (!sym) return; save({ ...baskets, [selected]: [...new Set([...(baskets[selected] ?? []), sym.toUpperCase()])] }); setSymbol(""); setSearch(""); };
  const remove = (sym: string) => save({ ...baskets, [selected]: baskets[selected].filter((item) => item !== sym) });
  return <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="w-full max-w-2xl rounded-lg border border-line bg-panel shadow-2xl">
      <header className="flex items-center justify-between border-b border-line px-4 py-3"><div><b>Watchlists</b><p className="text-[11px] text-dim">Quotes use cached daily data. Select a symbol to load it into the backtester.</p></div><button onClick={onClose} className="text-dim hover:text-ink">✕</button></header>
      <div className="flex items-center gap-2 px-4 pt-3">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="h-8 border border-line bg-panel2 px-2 text-xs">{Object.keys(baskets).map((name) => <option key={name}>{name}</option>)}</select>
        <button onClick={() => { const name = `Watchlist ${Object.keys(baskets).length - 1}`; save({ ...baskets, [name]: [] }); setSelected(name); }} className="h-8 border border-line px-3 text-xs">+ New basket</button>
      </div>
      <div className="max-h-80 overflow-y-auto px-4 py-3">
        {(baskets[selected] ?? []).map((sym) => <div key={sym} className="flex h-9 items-center border-b border-line/70 text-xs">
          <button className="flex flex-1 items-center gap-3 text-left hover:text-accent" onClick={() => { updateDataConfig({ symbol: sym }); onClose(); }}><span className="w-40 font-mono">{sym}</span><span className="num">{quotes[sym] ? `₹${quotes[sym].close.toFixed(2)}` : "No cached quote"}</span>{quotes[sym] && <span className={`num ${quotes[sym].change >= 0 ? "text-up" : "text-down"}`}>{quotes[sym].change >= 0 ? "+" : ""}{quotes[sym].change.toFixed(2)}%</span>}<span className="ml-auto text-[10px] text-dim">Load →</span></button>
          <button aria-label={`Remove ${sym}`} onClick={() => remove(sym)} className="px-2 text-dim hover:text-down">×</button>
        </div>)}
      </div>
      <div className="relative border-t border-line p-4"><div className="flex gap-2"><input value={symbol} onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setSearch(e.target.value); }} placeholder="Add symbol (e.g. RELIANCE.NS)" className="h-8 flex-1 border border-line bg-panel2 px-2 text-xs"/><button onClick={() => add(symbol.trim())} className="h-8 bg-accent px-4 text-xs font-semibold text-canvas">Add</button></div>{search && <div className="absolute bottom-12 left-4 right-20 z-10 border border-line bg-panel2">{matches.map((item) => <button key={item.symbol} onClick={() => add(item.symbol)} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-line">{item.label}<span className="ml-2 font-mono text-dim">{item.symbol}</span></button>)}</div>}</div>
    </section>
  </div>;
}
