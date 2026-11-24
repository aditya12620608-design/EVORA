"use client";

import { useStore } from "@/lib/store";
import { fINR } from "@/lib/format";

export default function ScannerTab() {
  const scan = useStore((s) => s.scanWatchlist);
  const cancel = useStore((s) => s.cancelScan);
  const state = useStore((s) => s.scanState);
  const progress = useStore((s) => s.scanProgress);
  const results = useStore((s) => s.scanResults);
  const active = useStore((s) => s.active());
  return <div className="h-full overflow-auto p-4 text-xs">
    <div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold">Strategy scanner</h2><p className="mt-1 max-w-2xl text-dim">Evaluates the active strategy across symbols in your saved watchlists and reports entry signals on the latest bar. This is a historical scan; it does not place orders.</p></div>
      {state === "running" ? <button onClick={cancel} className="border border-down/50 px-3 py-1.5 text-down">Cancel scan</button> : <button onClick={() => void scan()} disabled={!active} className="bg-accent px-3 py-1.5 font-semibold text-canvas disabled:opacity-50">Scan watchlists</button>}</div>
    {progress && <div className="mt-4"><div className="mb-1 flex justify-between text-dim"><span>{progress.done}/{progress.total} symbols · {progress.symbol}</span><span>Can cancel while running</span></div><div className="h-1.5 bg-line"><div className="h-full bg-accent" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div></div>}
    <div className="mt-5 rounded border border-line"><div className="grid grid-cols-[1fr_100px_130px_1fr] border-b border-line bg-panel px-3 py-2 text-dim"><span>Symbol</span><span>Signal</span><span>Latest close</span><span>Tag</span></div>
      {results.map((item) => <div key={`${item.symbol}-${item.action}`} className="grid grid-cols-[1fr_100px_130px_1fr] border-b border-line/70 px-3 py-2"><span className="font-mono">{item.symbol}</span><span className={item.action === "buy" ? "text-up" : "text-down"}>{item.action.toUpperCase()}</span><span className="num">{fINR(item.price)}</span><span className="truncate text-dim">{item.tag || "—"}</span></div>)}
      {!results.length && <div className="p-5 text-center text-dim">{state === "running" ? "Scanning…" : "No signals yet. Run a scan to evaluate the latest bar."}</div>}
    </div>
  </div>;
}
