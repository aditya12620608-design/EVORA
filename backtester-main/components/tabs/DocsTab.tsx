"use client";

import { useState } from "react";
import Markdown from "../Markdown";
import { DOCS_MARKDOWN } from "@/lib/docs";
import { EXAMPLES } from "@/lib/example-strategies";
import { useStore } from "@/lib/store";

export default function DocsTab() {
  const createStrategy = useStore((s) => s.createStrategy);
  const toast = useStore((s) => s.toast);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <Markdown source={DOCS_MARKDOWN} />
      </div>
      <div className="w-60 shrink-0 overflow-y-auto border-l border-line bg-panel p-2.5">
        <div className="mb-2 px-1 text-[12px] font-medium text-dim">Example strategies</div>
        {EXAMPLES.map((ex) => (
          <div key={ex.name} className="mb-2 rounded-md bg-panel2/60 p-2.5">
            <div className="mb-2 text-[12px]">{ex.name}</div>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(ex.code);
                  setCopied(ex.name);
                  setTimeout(() => setCopied(null), 1500);
                }}
                className="h-6 flex-1 border border-line text-[11px] text-dim hover:text-ink"
              >
                {copied === ex.name ? "Copied" : "Copy code"}
              </button>
              <button
                onClick={() => {
                  createStrategy(ex.name, ex.code);
                  toast("success", `Created '${ex.name}'`);
                }}
                className="h-6 flex-1 border border-line text-[11px] text-accent hover:border-accent"
              >
                Use as new
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
