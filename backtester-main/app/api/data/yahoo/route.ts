import { NextRequest, NextResponse } from "next/server";

/**
 * Yahoo Finance chart proxy — avoids CORS, normalizes the payload, drops null
 * candles. GET /api/data/yahoo?symbol=^NSEI&interval=1d&range=5y
 * or with explicit period1/period2 (unix seconds).
 */

const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com/v8/finance/chart/",
  "https://query2.finance.yahoo.com/v8/finance/chart/",
];
// Yahoo 429s full browser UAs without cookies; the bare token passes.
const UA = "Mozilla/5.0";

const VALID_INTERVALS = new Set(["1m", "5m", "15m", "1h", "1d"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol");
  const interval = sp.get("interval") ?? "1d";
  if (!symbol) {
    return NextResponse.json({ error: "Missing 'symbol' parameter" }, { status: 400 });
  }
  if (!VALID_INTERVALS.has(interval)) {
    return NextResponse.json(
      { error: `Invalid interval '${interval}' (use 1m, 5m, 15m, 1h, 1d)` },
      { status: 400 }
    );
  }

  const qs = new URLSearchParams({ interval, includePrePost: "false", events: "div,splits" });
  const period1 = sp.get("period1");
  const period2 = sp.get("period2");
  if (period1 && period2) {
    qs.set("period1", period1);
    qs.set("period2", period2);
  } else {
    qs.set("range", sp.get("range") ?? "1y");
  }

  let upstream: Response | null = null;
  for (const host of YAHOO_HOSTS) {
    try {
      upstream = await fetch(`${host}${encodeURIComponent(symbol)}?${qs}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      upstream = null;
      continue;
    }
    if (upstream.status !== 429) break; // try the mirror host on rate limit
  }
  if (!upstream) {
    return NextResponse.json({ error: "Upstream Yahoo Finance request failed" }, { status: 502 });
  }
  if (upstream.status === 429) {
    return NextResponse.json(
      { error: "Yahoo Finance rate limit hit — wait a minute and retry" },
      { status: 429 }
    );
  }

  let body: YahooChartResponse;
  try {
    body = (await upstream.json()) as YahooChartResponse;
  } catch {
    return NextResponse.json({ error: "Yahoo returned a non-JSON response" }, { status: 502 });
  }

  const err = body?.chart?.error;
  if (err || !upstream.ok) {
    const desc = err?.description ?? `Yahoo error (HTTP ${upstream.status})`;
    const notFound = err?.code === "Not Found" || upstream.status === 404;
    return NextResponse.json(
      { error: notFound ? `Symbol '${symbol}' not found on Yahoo Finance` : desc },
      { status: notFound ? 404 : 502 }
    );
  }

  const result = body?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp?.length || !quote) {
    return NextResponse.json(
      { error: `No data returned for '${symbol}' (${interval}) in the requested range` },
      { status: 404 }
    );
  }

  const out = {
    symbol,
    interval,
    currency: result.meta?.currency ?? null,
    timestamps: [] as number[],
    open: [] as number[],
    high: [] as number[],
    low: [] as number[],
    close: [] as number[],
    volume: [] as number[],
  };
  for (let i = 0; i < result.timestamp.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (o == null || h == null || l == null || c == null) continue; // drop null candles
    out.timestamps.push(result.timestamp[i]);
    out.open.push(o);
    out.high.push(h);
    out.low.push(l);
    out.close.push(c);
    out.volume.push(quote.volume?.[i] ?? 0);
  }

  return NextResponse.json(out, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}

interface YahooChartResponse {
  chart?: {
    error?: { code?: string; description?: string } | null;
    result?: Array<{
      meta?: { currency?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
  };
}
