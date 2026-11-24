/** Number formatting — Indian grouping for ₹, terminal-density defaults. */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fINR(v: number, decimals = 0): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  return `${sign}₹${decimals ? inr2.format(a) : inr.format(a)}`;
}

export function fNum(v: number, decimals = 2): string {
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fPct(v: number, decimals = 2, signed = false): string {
  const s = signed && v > 0 ? "+" : "";
  return `${s}${fNum(v, decimals)}%`;
}

export function fDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function fDateTime(unixSec: number, intraday: boolean): string {
  const d = new Date(unixSec * 1000);
  if (!intraday) return fDate(unixSec);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

export function fDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/** green / red / neutral class for a signed value */
export function pnlClass(v: number, neutralBand = 0): string {
  if (v > neutralBand) return "text-up";
  if (v < -neutralBand) return "text-down";
  return "text-dim";
}
