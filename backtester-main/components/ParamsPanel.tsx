"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { ParamSpec, SizingMode } from "@/lib/worker-protocol";
import ChargesEditor from "./ChargesEditor";

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line/60 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between rounded-none px-3 text-[12px] font-medium text-ink hover:bg-panel2/50"
      >
        {title}
        <span className={`text-faint transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && <div className="space-y-2.5 px-3 pb-4">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-dim">{label}</span>
      {children}
    </div>
  );
}

const inputCls =
  "h-6 w-24 border border-line bg-panel2 px-1 text-right font-mono text-[11px] text-ink";
const selectCls = "h-6 border border-line bg-panel2 px-1 font-mono text-[11px] text-ink";

function ParamControl({ spec }: { spec: ParamSpec }) {
  const active = useStore((s) => s.active());
  const setParamOverride = useStore((s) => s.setParamOverride);
  const resetParam = useStore((s) => s.resetParam);
  if (!active) return null;

  const overridden = spec.key in active.paramOverrides;
  const value = overridden ? active.paramOverrides[spec.key] : spec.default;

  const label = (
    <span className="flex items-center gap-1 text-[11px] text-dim" title={spec.key}>
      {overridden && (
        <button
          onClick={() => resetParam(spec.key)}
          title={`Modified from default (${String(spec.default)}) — click to reset`}
          className="h-2 w-2 shrink-0 rounded-full bg-amber hover:bg-down"
        />
      )}
      {spec.label}
    </span>
  );

  if (spec.type === "bool") {
    return (
      <div className="flex items-center justify-between gap-2">
        {label}
        <button
          onClick={() => setParamOverride(spec.key, !value)}
          role="switch"
          aria-checked={!!value}
          className={`h-4 w-8 rounded-full border ${value ? "border-accent bg-accent/30" : "border-line bg-panel2"}`}
        >
          <span
            className={`block h-3 w-3 rounded-full transition-transform ${
              value ? "translate-x-4 bg-accent" : "translate-x-0.5 bg-faint"
            }`}
          />
        </button>
      </div>
    );
  }

  if (spec.type === "choice") {
    return (
      <div className="flex items-center justify-between gap-2">
        {label}
        <select
          value={String(value)}
          onChange={(e) => setParamOverride(spec.key, e.target.value)}
          className={selectCls}
        >
          {(spec.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // int / float
  const numeric = Number(value);
  const hasRange = spec.min != null && spec.max != null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        {label}
        <input
          type="number"
          value={numeric}
          min={spec.min ?? undefined}
          max={spec.max ?? undefined}
          step={spec.step ?? (spec.type === "int" ? 1 : 0.1)}
          onChange={(e) => {
            const v = spec.type === "int" ? parseInt(e.target.value) : parseFloat(e.target.value);
            if (!Number.isNaN(v)) setParamOverride(spec.key, v);
          }}
          className="h-6 w-20 border border-line bg-panel2 px-1 text-right font-mono text-[11px]"
        />
      </div>
      {hasRange && (
        <input
          type="range"
          value={numeric}
          min={spec.min!}
          max={spec.max!}
          step={spec.step ?? (spec.type === "int" ? 1 : 0.1)}
          onChange={(e) => {
            const v = spec.type === "int" ? parseInt(e.target.value) : parseFloat(e.target.value);
            setParamOverride(spec.key, v);
          }}
          className="w-full"
        />
      )}
    </div>
  );
}

export default function ParamsPanel() {
  const active = useStore((s) => s.active());
  const paramSpecs = useStore((s) => s.paramSpecs);
  const paramError = useStore((s) => s.paramError);
  const updateRunConfig = useStore((s) => s.updateRunConfig);

  if (!active) return null;
  const cfg = active.runConfig;
  const sizing = cfg.sizing;

  const setSizing = (patch: Partial<typeof sizing>) =>
    updateRunConfig({ sizing: { ...sizing, ...patch } });

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-lg border border-line bg-panel">
      <Section title="Strategy parameters">
        {paramError && (
          <div className="rounded-md border border-down/40 bg-down/10 p-2 font-mono text-[10px] text-down">
            {paramError}
          </div>
        )}
        {paramSpecs.length === 0 && !paramError && (
          <div className="text-[11px] text-faint">
            No <span className="font-mono">params</span> dict detected — declare{" "}
            <span className="font-mono">Param(...)</span> entries to get controls here.
          </div>
        )}
        {paramSpecs.map((spec) => (
          <ParamControl key={spec.key} spec={spec} />
        ))}
      </Section>

      <Section title="Execution">
        <Row label="Fill timing">
          <select
            value={cfg.execution}
            onChange={(e) => updateRunConfig({ execution: e.target.value as "next_open" | "same_close" })}
            className={selectCls}
          >
            <option value="next_open">next bar open</option>
            <option value="same_close">same bar close</option>
          </select>
        </Row>
        <Row label="Slippage / side">
          <span className="flex gap-1">
            <input
              type="number"
              value={cfg.slippage_value}
              min={0}
              step={0.01}
              onChange={(e) => updateRunConfig({ slippage_value: Number(e.target.value) || 0 })}
              className="h-6 w-16 border border-line bg-panel2 px-1 text-right font-mono text-[11px]"
            />
            <select
              value={cfg.slippage_type}
              onChange={(e) => updateRunConfig({ slippage_type: e.target.value as "pct" | "abs" })}
              className={selectCls}
            >
              <option value="pct">%</option>
              <option value="abs">₹</option>
            </select>
          </span>
        </Row>
        <Row label="Risk-free rate %">
          <input
            type="number"
            value={cfg.risk_free * 100}
            step={0.1}
            onChange={(e) => updateRunConfig({ risk_free: (Number(e.target.value) || 0) / 100 })}
            className={inputCls}
          />
        </Row>
        <Row label="Square-off (intraday)">
          <span className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={cfg.squareoff.enabled}
              onChange={(e) =>
                updateRunConfig({ squareoff: { ...cfg.squareoff, enabled: e.target.checked } })
              }
              className="accent-[#d9a441]"
            />
            <input
              type="time"
              value={cfg.squareoff.time}
              disabled={!cfg.squareoff.enabled}
              onChange={(e) =>
                updateRunConfig({ squareoff: { ...cfg.squareoff, time: e.target.value } })
              }
              className="h-6 border border-line bg-panel2 px-1 font-mono text-[11px] disabled:opacity-40"
            />
          </span>
        </Row>
      </Section>

      <Section title="Position sizing">
        <Row label="Mode">
          <select
            value={sizing.mode}
            onChange={(e) => setSizing({ mode: e.target.value as SizingMode })}
            className={selectCls}
          >
            <option value="fixed_qty">fixed quantity</option>
            <option value="fixed_value">fixed ₹ / trade</option>
            <option value="pct_equity">% of equity</option>
            <option value="risk_pct">% risk of capital (requires stop)</option>
            <option value="lots">F&O lots</option>
          </select>
        </Row>
        {sizing.mode === "fixed_qty" && (
          <Row label="Quantity">
            <input
              type="number"
              value={sizing.qty ?? 1}
              min={1}
              onChange={(e) => setSizing({ qty: Number(e.target.value) || 1 })}
              className={inputCls}
            />
          </Row>
        )}
        {sizing.mode === "fixed_value" && (
          <Row label="₹ per trade">
            <input
              type="number"
              value={sizing.value ?? 100000}
              min={100}
              step={1000}
              onChange={(e) => setSizing({ value: Number(e.target.value) || 0 })}
              className={inputCls}
            />
          </Row>
        )}
        {sizing.mode === "pct_equity" && (
          <Row label="% of equity">
            <input
              type="number"
              value={sizing.pct ?? 100}
              min={1}
              max={100}
              onChange={(e) => setSizing({ pct: Number(e.target.value) || 1 })}
              className={inputCls}
            />
          </Row>
        )}
        {sizing.mode === "risk_pct" && (
          <Row label="Capital at risk %">
            <input type="number" value={sizing.risk_pct ?? 1} min={0.01} max={100} step={0.1}
              onChange={(e) => setSizing({ risk_pct: Number(e.target.value) || 1 })} className={inputCls} />
          </Row>
        )}
        {sizing.mode === "lots" && (
          <>
            <Row label="Lots">
              <input
                type="number"
                value={sizing.lots ?? 1}
                min={1}
                onChange={(e) => setSizing({ lots: Number(e.target.value) || 1 })}
                className={inputCls}
              />
            </Row>
            <Row label="Lot size">
              <input
                type="number"
                value={sizing.lot_size ?? 75}
                min={1}
                onChange={(e) => setSizing({ lot_size: Number(e.target.value) || 1 })}
                className={inputCls}
                title="NIFTY 75, BANKNIFTY 35 (verify — these change)"
              />
            </Row>
          </>
        )}
        <Row label="Margin multiplier">
          <input
            type="number"
            value={cfg.margin_multiplier}
            min={1}
            step={0.5}
            onChange={(e) => updateRunConfig({ margin_multiplier: Number(e.target.value) || 1 })}
            className={inputCls}
            title="Leverage for the cash check — e.g. 5x futures-style"
          />
        </Row>
      </Section>

      <Section title="Charges and taxes">
        <ChargesEditor />
      </Section>
    </div>
  );
}
