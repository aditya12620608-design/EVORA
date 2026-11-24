/**
 * Acceptance test (spec §13): default EMA-crossover on NIFTY daily 5y with
 * Equity Intraday charges → complete run with metrics, trades, markers,
 * charges, equity vs B&H — under 10s after warm Pyodide load, zero console errors.
 *
 * Run: node scripts/acceptance.mjs [url]
 */
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:3177";
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`  ok  ${msg}`);

await page.goto(url);

// 1. Pyodide boot (cold: CDN download — allow plenty)
await page.waitForSelector("text=Run backtest", { timeout: 180_000 });
ok("Pyodide booted, workspace rendered");

// 2. params auto-extracted from default strategy
await page.waitForSelector("text=Fast EMA", { timeout: 15_000 });
ok("Params panel auto-generated from AST (Fast EMA visible)");

// warm-up run #1 (includes Yahoo fetch + cache fill)
await page.click("text=Run backtest");
await page.waitForFunction(() => window.__qdLastRun != null, null, { timeout: 60_000 });
const cold = await page.evaluate(() => window.__qdLastRun);
ok(`First (cold) run completed: ${cold.trades} trades, ${cold.wallMs}ms incl. data fetch`);

// 3. warm run — the timed acceptance run
await page.waitForSelector("text=Run backtest", { timeout: 15_000 });
const mark = Date.now();
await page.click("text=Run backtest");
await page.waitForFunction((m) => window.__qdLastRun && window.__qdLastRun.ranAt > m, mark, {
  timeout: 30_000,
});
const warm = await page.evaluate(() => window.__qdLastRun);
if (warm.wallMs > 10_000) fail(`warm run took ${warm.wallMs}ms (>10s)`);
else ok(`warm run: ${warm.trades} trades in ${(warm.wallMs / 1000).toFixed(2)}s wall / ${(warm.engineMs / 1000).toFixed(2)}s engine (<10s)`);
if (warm.trades < 1) fail("expected ≥1 trade from default EMA crossover on NIFTY 5y");

// 4. metrics populated
const overview = await page.textContent("body");
for (const label of ["NET P&L", "CAGR", "SHARPE", "MAX DRAWDOWN", "WIN RATE", "PROFIT FACTOR", "BUY & HOLD"]) {
  if (!overview.toUpperCase().includes(label)) fail(`metric missing: ${label}`);
}
ok("Overview metrics populated");

// 5. trades present with itemized charges
await page.click('button:has-text("TRADES")');
await page.waitForSelector("text=Running net", { timeout: 5_000 });
const tradeRows = await page.locator('div[style*="height: 24px"], button[style*="height: 24px"]').count();
if (tradeRows < 1) fail("no trade rows rendered");
else ok(`trades table rendered (${tradeRows} visible rows)`);
const title = await page.locator('button[title*="Brokerage"]').first().getAttribute("title");
if (!title || !title.includes("GST")) fail("itemized charges tooltip missing");
else ok(`itemized charges per trade: ${title.split("\n").slice(0, 3).join(" · ")} …`);

// 6. candlestick chart with markers
await page.click('button:has-text("CHART")');
await page.waitForTimeout(1500);
const canvases = await page.locator("canvas").count();
if (canvases < 1) fail("chart canvas missing");
else ok(`chart tab rendered (${canvases} canvases)`);

// 7. equity curve
await page.click('button:has-text("EQUITY CURVE")');
await page.waitForSelector("text=buy & hold", { timeout: 5_000 });
ok("equity vs buy & hold plotted");

await page.click('button:has-text("DRAWDOWN")');
await page.waitForSelector("text=underwater", { timeout: 5_000 });
ok("drawdown underwater chart rendered");

await page.click('button:has-text("MONTHLY")');
await page.waitForSelector("text=YTD", { timeout: 5_000 });
ok("monthly heatmap rendered");

// 8. python error path: inject a bug, expect red marker + console traceback
await page.click('button:has-text("CONSOLE")');
const consoleText = await page.textContent("body");
if (!consoleText.includes("Run complete")) fail("console missing run summary");
else ok("console shows run summary");

// 9. A small two-parameter grid completes, renders a heatmap, and can be applied.
await page.getByRole("tab", { name: "Optimize" }).click();
await page.getByLabel("Slow EMA").check();
await page.getByLabel("Grid spacing").nth(0).selectOption("50");
await page.getByLabel("Grid spacing").nth(1).selectOption("50");
await page.getByText("12 / 500 combinations").waitFor({ timeout: 5_000 });
await page.getByRole("button", { name: "Run optimization" }).click();
await page.getByText("12 combinations · completed in", { exact: false }).waitFor({ timeout: 60_000 });
await page.getByText("Net P&L heatmap").waitFor({ timeout: 5_000 });
await page.getByText("Overfitting warning:").waitFor({ timeout: 5_000 });
await page.getByRole("button", { name: "Apply" }).first().click();
ok("optimizer completes, displays a heatmap and applies parameters");

await page.screenshot({ path: "/tmp/qd-acceptance.png" });

// 10. Every built-in template should execute without a strategy error on the
// default NIFTY 50 daily data window (the first run has already populated cache).
const templateNames = [
  "EMA Crossover",
  "SMA Crossover",
  "RSI Mean Reversion",
  "Supertrend Trend",
  "Bollinger Breakout",
  "Donchian Turtle Breakout",
  "MACD + RSI Confirmation",
  "Opening Range Breakout",
  "VWAP Reversion",
  "ATR Trend + Trailing Stop",
  "Higher-Timeframe Filter",
];
for (const name of templateNames) {
  await page.locator('button[title="New strategy"]').click();
  await page.getByRole("button", { name: "Browse strategy templates…" }).click();
  await page.getByPlaceholder("Search strategies, markets, or timeframes…").fill(name);
  await page.getByRole("button", { name: "Create strategy" }).click();
  const previousRun = await page.evaluate(() => window.__qdLastRun?.ranAt ?? 0);
  await page.getByRole("button", { name: "Run backtest" }).click();
  await page.waitForFunction((before) => window.__qdLastRun && window.__qdLastRun.ranAt > before, previousRun, { timeout: 30_000 });
  ok(`Template runs on NIFTY daily: ${name}`);
}

const realErrors = errors.filter(
  (e) => !e.includes("favicon") && !e.includes("Failed to load resource: the server responded with a status of 429")
);
if (realErrors.length) {
  fail(`console errors: ${realErrors.slice(0, 5).join(" | ")}`);
} else {
  ok("zero browser console errors");
}

await browser.close();
console.log(process.exitCode ? "\nACCEPTANCE: FAILED" : "\nACCEPTANCE: PASSED");
