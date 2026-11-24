"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { fINR, pnlClass } from "@/lib/format";
import type { StrategyRecord } from "@/lib/db";
import TemplateGallery from "./TemplateGallery";

/** Export = strategy .py code + JSON sidecar (params/config) in one file. */
function exportStrategy(s: StrategyRecord) {
  const meta = {
    name: s.name,
    paramOverrides: s.paramOverrides,
    runConfig: s.runConfig,
    dataConfig: s.dataConfig,
  };
  const body = `${s.code}\n\n# === QUANTDECK-META (do not edit) ===\n# ${JSON.stringify(meta)}\n`;
  const blob = new Blob([body], { type: "text/x-python" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${s.name.replace(/[^\w.-]+/g, "_")}.py`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function StrategyRail() {
  const strategies = useStore((s) => s.strategies);
  const activeId = useStore((s) => s.activeId);
  const selectStrategy = useStore((s) => s.selectStrategy);
  const createStrategy = useStore((s) => s.createStrategy);
  const duplicateStrategy = useStore((s) => s.duplicateStrategy);
  const renameStrategy = useStore((s) => s.renameStrategy);
  const deleteStrategy = useStore((s) => s.deleteStrategy);
  const toast = useStore((s) => s.toast);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    const m = text.match(/# === QUANTDECK-META.*\n# (\{.*\})/);
    let name = file.name.replace(/\.py$/, "");
    let code = text;
    if (m) {
      try {
        const meta = JSON.parse(m[1]);
        name = meta.name ?? name;
        code = text.slice(0, text.indexOf("\n\n# === QUANTDECK-META"));
        createStrategy(name, code);
        const st = useStore.getState();
        const created = st.active();
        if (created) {
          st.updateRunConfig(meta.runConfig ?? {});
          if (meta.dataConfig) st.updateDataConfig(meta.dataConfig);
          for (const [k, v] of Object.entries(meta.paramOverrides ?? {})) {
            st.setParamOverride(k, v as number | string | boolean);
          }
        }
        toast("success", `Imported '${name}' with config`);
        return;
      } catch {
        /* fall through to plain import */
      }
    }
    createStrategy(name, code);
    toast("success", `Imported '${name}'`);
  };

  return (
    <div className="flex h-full w-56 shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex h-11 items-center justify-between px-3">
        <span className="text-[12px] font-medium text-dim">Strategies</span>
        <div className="relative">
          <button
            onClick={() => setNewMenu(!newMenu)}
            className="flex h-6 items-center gap-1 border border-line px-2 text-[11px] text-accent hover:border-accent"
            title="New strategy"
          >
            + New
          </button>
          {newMenu && (
            <div className="absolute right-0 top-8 z-50 w-52 overflow-hidden rounded-lg border border-line bg-panel2 py-1 shadow-[0_12px_40px_rgba(5,8,14,0.55)]">
              <button
                className="block w-full rounded-none px-3 py-1.5 text-left text-[12px] hover:bg-line/60"
                onClick={() => {
                  setGalleryOpen(true);
                  setNewMenu(false);
                }}
              >
                Browse strategy templates…
              </button>
              <button
                className="mt-1 block w-full rounded-none border-t border-line px-3 py-1.5 text-left text-[12px] text-cyan hover:bg-line/60"
                onClick={() => {
                  fileRef.current?.click();
                  setNewMenu(false);
                }}
              >
                Import a .py file…
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5">
        {strategies.map((s) => {
          const isActive = s.id === activeId;
          const pnl = s.lastResult?.metrics.net_pnl;
          return (
            <div
              key={s.id}
              className={`group relative cursor-pointer rounded-md px-2.5 py-2 ${
                isActive ? "bg-panel2 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent" : "hover:bg-panel2/60"
              }`}
              onClick={() => selectStrategy(s.id)}
              onDoubleClick={() => setRenaming(s.id)}
            >
              {renaming === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  onBlur={(e) => {
                    renameStrategy(s.id, e.target.value.trim() || s.name);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-full border border-line bg-bg px-1 text-[12px]"
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`truncate text-[12px] ${isActive ? "font-medium text-ink" : "text-ink/85"}`}>{s.name}</span>
                    <span className="hidden gap-1 group-hover:flex">
                      <button
                        title="Duplicate"
                        className="text-[10px] text-dim hover:text-ink"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateStrategy(s.id);
                        }}
                      >
                        ⧉
                      </button>
                      <button
                        title="Export .py"
                        className="text-[10px] text-dim hover:text-cyan"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportStrategy(s);
                        }}
                      >
                        ↓
                      </button>
                      <button
                        title="Delete"
                        className="text-[10px] text-dim hover:text-down"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete strategy '${s.name}'?`)) deleteStrategy(s.id);
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  <div className="mt-0.5 flex justify-between font-mono text-[10px] text-dim">
                    <span>
                      {s.dataConfig.symbol} {s.dataConfig.interval}
                    </span>
                    {pnl != null && <span className={pnlClass(pnl)}>{fINR(pnl)}</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".py"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
      <div className="px-3 py-2.5 text-[10px] leading-relaxed text-faint">
        Double-click a name to rename it. Changes save automatically in this browser.
      </div>
      {galleryOpen && (
        <TemplateGallery
          onClose={() => setGalleryOpen(false)}
          onSelect={(template) => {
            createStrategy(template.name, template.code);
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}
