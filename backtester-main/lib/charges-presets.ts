/**
 * Indian market charge profiles. Values are broker/exchange defaults as of
 * 2026 — surfaced in the UI with a "verify with your broker" note. All rows
 * are computed per trade leg on turnover (see engine.compute_leg_charges).
 */

import type { ChargeRow } from "./worker-protocol";
import type { ChargesProfileRecord } from "./db";

const GST: ChargeRow = {
  name: "GST",
  basis: "both",
  type: "percent_of",
  value: 18,
  of: ["Brokerage", "Exchange Txn", "SEBI"],
};

export const CHARGES_PRESETS: ChargesProfileRecord[] = [
  {
    id: "equity-delivery",
    name: "Equity Delivery (Zerodha-style)",
    builtin: true,
    rows: [
      { name: "Brokerage", basis: "both", type: "percent", value: 0 },
      { name: "STT", basis: "both", type: "percent", value: 0.1 },
      { name: "Exchange Txn", basis: "both", type: "percent", value: 0.00297 },
      { name: "SEBI", basis: "both", type: "per_crore", value: 10 },
      GST,
      { name: "Stamp Duty", basis: "buy", type: "percent", value: 0.015 },
      { name: "DP Charge", basis: "sell", type: "flat_per_order", value: 15.34 },
    ],
  },
  {
    id: "equity-intraday",
    name: "Equity Intraday",
    builtin: true,
    rows: [
      { name: "Brokerage", basis: "both", type: "percent", value: 0.03, cap: 20 },
      { name: "STT", basis: "sell", type: "percent", value: 0.025 },
      { name: "Exchange Txn", basis: "both", type: "percent", value: 0.00297 },
      { name: "SEBI", basis: "both", type: "per_crore", value: 10 },
      GST,
      { name: "Stamp Duty", basis: "buy", type: "percent", value: 0.003 },
    ],
  },
  {
    id: "futures",
    name: "Futures",
    builtin: true,
    rows: [
      { name: "Brokerage", basis: "both", type: "percent", value: 0.03, cap: 20 },
      { name: "STT", basis: "sell", type: "percent", value: 0.02 },
      { name: "Exchange Txn", basis: "both", type: "percent", value: 0.00173 },
      { name: "SEBI", basis: "both", type: "per_crore", value: 10 },
      GST,
      { name: "Stamp Duty", basis: "buy", type: "percent", value: 0.002 },
    ],
  },
  {
    id: "options",
    name: "Options (on premium)",
    builtin: true,
    rows: [
      { name: "Brokerage", basis: "both", type: "flat_per_order", value: 20 },
      { name: "STT", basis: "sell", type: "percent", value: 0.1 },
      { name: "Exchange Txn", basis: "both", type: "percent", value: 0.03503 },
      { name: "SEBI", basis: "both", type: "per_crore", value: 10 },
      GST,
      { name: "Stamp Duty", basis: "buy", type: "percent", value: 0.003 },
    ],
  },
  {
    id: "zero",
    name: "Zero charges (raw edge)",
    builtin: true,
    rows: [],
  },
];

/** F&O lot sizes — editable in the UI since the exchange revises these. */
export const LOT_SIZE_PRESETS: Record<string, number> = {
  NIFTY: 75,
  BANKNIFTY: 35,
  FINNIFTY: 65,
};
