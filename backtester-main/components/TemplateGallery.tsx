"use client";

import { useEffect, useMemo, useState } from "react";
import { TEMPLATES, type StrategyTemplate } from "@/lib/example-strategies";

export default function TemplateGallery({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (template: StrategyTemplate) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TEMPLATES;
    return TEMPLATES.filter((template) =>
      [template.name, template.description, template.markets, template.timeframes, template.difficulty]
        .some((value) => value.toLowerCase().includes(q))
    );
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-gallery-title"
        className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 id="template-gallery-title" className="text-[16px] font-semibold text-ink">New from template</h2>
            <p className="mt-1 text-[11px] text-dim">Start with an editable strategy and adjust its parameters to explore the rules.</p>
          </div>
          <button onClick={onClose} className="px-2 text-lg text-dim hover:text-ink" aria-label="Close template gallery">×</button>
        </header>
        <div className="border-b border-line p-3">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search strategies, markets, or timeframes…"
            className="h-9 w-full border border-line bg-panel2 px-3 text-[12px] text-ink outline-none focus:border-accent"
          />
        </div>
        <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
          {filtered.map((template) => (
            <article key={template.name} className="flex flex-col rounded-lg border border-line bg-panel2/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-medium text-ink">{template.name}</h3>
                <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-dim">{template.difficulty}</span>
              </div>
              <p className="mt-2 flex-1 text-[11px] leading-relaxed text-dim">{template.description}</p>
              <div className="mt-3 space-y-1 text-[10px] text-faint">
                <div><span className="text-dim">Markets:</span> {template.markets}</div>
                <div><span className="text-dim">Timeframes:</span> {template.timeframes}</div>
              </div>
              <button
                onClick={() => onSelect(template)}
                className="mt-3 h-7 border border-accent/60 text-[11px] font-medium text-accent hover:bg-accent/10"
              >
                Create strategy
              </button>
            </article>
          ))}
          {!filtered.length && <div className="col-span-2 py-12 text-center text-[12px] text-dim">No templates match “{query}”.</div>}
        </div>
        <footer className="border-t border-line px-4 py-2 text-[10px] text-faint">{filtered.length} of {TEMPLATES.length} templates</footer>
      </section>
    </div>
  );
}
