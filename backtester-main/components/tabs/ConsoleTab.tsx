"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";

const TONE = { info: "text-ink", warn: "text-amber", error: "text-down" } as const;

export default function ConsoleTab() {
  const lines = useStore((s) => s.consoleLines);
  const clearConsole = useStore((s) => s.clearConsole);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[11px] text-faint">Python output, engine warnings and errors</span>
        <button
          onClick={clearConsole}
          className="h-6 border border-line px-2.5 text-[11px] text-dim hover:text-ink"
        >
          Clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 && <span className="text-faint">Nothing printed yet. print() output from your strategy appears here.</span>}
        {lines.map((l, i) => (
          <div key={i} className={`whitespace-pre-wrap ${TONE[l.level]}`}>
            <span className="select-none text-faint">
              {new Date(l.ts).toLocaleTimeString("en-IN", { hour12: false })}{" "}
            </span>
            {l.msg}
            {l.lineNumber != null && (
              <span className="text-cyan"> (line {l.lineNumber}, highlighted in the editor)</span>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
