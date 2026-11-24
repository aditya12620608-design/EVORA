"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { CHARGES_PRESETS } from "@/lib/charges-presets";
import type { ChargeRow } from "@/lib/worker-protocol";

const TYPE_LABEL: Record<ChargeRow["type"], string> = {
  percent: "% of turnover",
  flat_per_order: "₹ flat / order",
  per_crore: "₹ / crore",
  percent_of: "% of other charges",
};

export default function ChargesEditor() {
  const active = useStore((s) => s.active());
  const customProfiles = useStore((s) => s.customProfiles);
  const applyChargesProfile = useStore((s) => s.applyChargesProfile);
  const updateRunConfig = useStore((s) => s.updateRunConfig);
  const saveCustomProfile = useStore((s) => s.saveCustomProfile);
  const deleteCustomProfile = useStore((s) => s.deleteCustomProfile);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState(false);

  if (!active) return null;
  const cfg = active.runConfig;
  const rows = cfg.charges;
  const enabled = cfg.chargesEnabled !== false;
  const allProfiles = [...CHARGES_PRESETS, ...customProfiles];
  const currentId = cfg.chargesProfileId ?? "custom";
  const isCustomized = !allProfiles.some(
    (p) => p.id === currentId && JSON.stringify(p.rows) === JSON.stringify(rows)
  );

  const setRows = (next: ChargeRow[]) =>
    updateRunConfig({ charges: next, chargesProfileId: undefined });

  const updateRow = (i: number, patch: Partial<ChargeRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => updateRunConfig({ chargesEnabled: e.target.checked })}
          className="accent-[#d9a441]"
        />
        <span className={`text-[11px] ${enabled ? "text-ink" : "text-dim"}`}>
          Apply charges to this run
        </span>
        {!enabled && <span className="font-mono text-[10px] text-amber">Off: results before costs</span>}
      </label>

      <div className={enabled ? "space-y-2" : "pointer-events-none space-y-2 opacity-40"}>
      <select
        value={isCustomized ? "custom" : currentId}
        onChange={(e) => {
          if (e.target.value !== "custom") applyChargesProfile(e.target.value);
        }}
        className="h-6 w-full border border-line bg-panel2 px-1 font-mono text-[11px]"
      >
        {allProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.builtin ? "" : " (custom)"}
          </option>
        ))}
        {isCustomized && <option value="custom">— customized —</option>}
      </select>

      <div className="text-[10px] leading-snug text-faint">
        Defaults as of 2026 — verify with your broker. Charged per trade leg on turnover.
      </div>

      <button
        onClick={() => setEditing(!editing)}
        className="h-6 w-full border border-line font-mono text-[10px] text-dim hover:border-faint hover:text-ink"
      >
        {editing ? "▴ COLLAPSE EDITOR" : `▾ EDIT ${rows.length} CHARGE ROWS`}
      </button>

      {editing && (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="space-y-1.5 rounded-md bg-panel2/60 p-2">
              <div className="flex items-center justify-between gap-1">
                <input
                  value={r.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  className="h-5 w-full border border-line bg-panel2 px-1 text-[10px]"
                />
                <button
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="px-1 text-[10px] text-dim hover:text-down"
                  title="Remove row"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <select
                  value={r.basis}
                  onChange={(e) => updateRow(i, { basis: e.target.value as ChargeRow["basis"] })}
                  className="h-5 border border-line bg-panel2 px-0.5 font-mono text-[10px]"
                >
                  <option value="buy">buy</option>
                  <option value="sell">sell</option>
                  <option value="both">both</option>
                </select>
                <select
                  value={r.type}
                  onChange={(e) => updateRow(i, { type: e.target.value as ChargeRow["type"] })}
                  className="h-5 border border-line bg-panel2 px-0.5 font-mono text-[10px]"
                >
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={r.value}
                  step={0.001}
                  onChange={(e) => updateRow(i, { value: Number(e.target.value) || 0 })}
                  className="h-5 border border-line bg-panel2 px-1 text-right font-mono text-[10px]"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-faint">cap ₹</span>
                <input
                  type="number"
                  value={r.cap ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    updateRow(i, { cap: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="h-5 w-14 border border-line bg-panel2 px-1 text-right font-mono text-[10px]"
                />
                {r.type === "percent_of" && (
                  <input
                    value={(r.of ?? []).join(", ")}
                    onChange={(e) =>
                      updateRow(i, { of: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })
                    }
                    placeholder="on: Brokerage, Exchange Txn…"
                    className="h-5 flex-1 border border-line bg-panel2 px-1 text-[10px]"
                    title="Names of charge rows this percentage applies to"
                  />
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-1">
            <button
              onClick={() =>
                setRows([...rows, { name: "New charge", basis: "both", type: "percent", value: 0 }])
              }
              className="h-6 flex-1 border border-line font-mono text-[10px] text-accent hover:border-accent"
            >
              + ROW
            </button>
            <button
              onClick={() => {
                const name = prompt("Save as custom profile:", "My broker");
                if (!name) return;
                const id = `custom-${Date.now().toString(36)}`;
                saveCustomProfile({ id, name, builtin: false, rows: structuredClone(rows) });
                updateRunConfig({ chargesProfileId: id });
                toast("success", `Saved charges profile '${name}'`);
              }}
              className="h-6 flex-1 border border-line font-mono text-[10px] text-cyan hover:border-cyan"
            >
              SAVE AS…
            </button>
            {!CHARGES_PRESETS.some((p) => p.id === currentId) && currentId !== "custom" && (
              <button
                onClick={() => {
                  deleteCustomProfile(currentId);
                  applyChargesProfile("zero");
                }}
                className="h-6 border border-line px-2 font-mono text-[10px] text-dim hover:border-down hover:text-down"
                title="Delete this custom profile"
              >
                DEL
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
