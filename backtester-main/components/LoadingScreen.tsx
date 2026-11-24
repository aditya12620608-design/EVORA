"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

// mirrors the INIT_PROGRESS pct values posted by public/workers/backtest.worker.js
const STEPS = [
  { pct: 5, label: "Python runtime", size: "~10 MB" },
  { pct: 35, label: "numpy + pandas", size: "~12 MB" },
  { pct: 85, label: "Backtest engine", size: "" },
];
const SLOW_AFTER_S = 25;

export default function LoadingScreen() {
  const { phase, stage, pct } = useStore((s) => s.pyodide);
  const [elapsed, setElapsed] = useState(0);
  const failed = phase === "error";

  useEffect(() => {
    if (failed) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [failed]);

  const current = STEPS.findLastIndex((s) => pct >= s.pct);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-canvas px-4">
      <div className="text-[28px] font-semibold tracking-tight text-ink">
        Quant<span className="font-normal text-dim">Deck</span>
      </div>
      <div className="w-full max-w-96 rounded-lg border border-line bg-panel p-5">
        <div className="mb-3 flex justify-between text-[11px] text-dim">
          <span className="text-[12px] font-medium text-ink">{failed ? "Python failed to start" : "Starting Python in your browser"}</span>
          <span className="num">
            {Math.round(pct)}% · {elapsed}s
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-1 transition-all duration-300 ${failed ? "bg-down" : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <ol className="mt-4 space-y-1.5 text-[11px]">
          {STEPS.map((s, i) => {
            const done = i < current;
            const now = i === current;
            return (
              <li key={s.label} className="flex items-center gap-2">
                <span className={`w-3 ${done ? "text-up" : now ? (failed ? "text-down" : "text-amber") : "text-faint"}`}>
                  {done ? "✓" : now ? (failed ? "✕" : "›") : "·"}
                </span>
                <span className={done ? "text-dim" : now ? "text-ink" : "text-faint"}>{s.label}</span>
                <span className="num ml-auto text-[10px] text-faint">{s.size}</span>
              </li>
            );
          })}
        </ol>

        <div className={`mt-4 border-t border-line pt-3 text-[11px] ${failed ? "text-down" : "text-dim"}`}>
          {failed ? (
            <>
              {stage}
              <button
                className="mt-3 block bg-accent px-3 py-1.5 text-[12px] font-semibold text-canvas hover:brightness-110"
                onClick={() => location.reload()}
              >
                Reload
              </button>
            </>
          ) : (
            <span className="cursor-blink">{stage}</span>
          )}
        </div>

        {!failed && elapsed >= SLOW_AFTER_S && (
          <div className="mt-3 rounded-md border border-amber/40 bg-amber/5 p-2.5 text-[11px] leading-relaxed text-amber">
            Taking longer than usual. The runtime downloads once from cdn.jsdelivr.net — check your
            connection, VPN or ad blocker (DevTools → Network), then reload.
          </div>
        )}
      </div>
      <div className="max-w-md text-center text-[11px] text-faint">
        Backtests run on this computer. Your strategies and results never leave the browser.
      </div>
    </div>
  );
}
