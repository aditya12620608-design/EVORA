/**
 * QuantDeck backtest worker (classic worker — Pyodide via importScripts CDN).
 *
 * Plain JS on purpose: keeping this file out of the Next bundler sidesteps
 * worker-bundling issues with Pyodide. The message protocol is typed on the
 * main-thread side in lib/worker-protocol.ts — keep both in sync.
 */

const PYODIDE_VERSION = "0.26.4";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const CHUNK_BARS = 4000;

let pyodide = null;
let initStarted = false;
let cancelRequested = false;
let interruptBuffer = null;
let suppressRunLogs = false;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "INIT":
        if (!initStarted) {
          initStarted = true;
          await init();
        }
        break;
      case "EXTRACT_PARAMS":
        extractParams(msg);
        break;
      case "RUN_BACKTEST":
        await runBacktest(msg);
        break;
      case "OPTIMIZE":
        await runOptimization(msg);
        break;
      case "CANCEL":
        cancelRequested = true;
        if (interruptBuffer) interruptBuffer[0] = 2; // SIGINT inside Python
        break;
    }
  } catch (err) {
    post({ type: "FATAL", message: String(err && err.message ? err.message : err) });
  }
};

async function init() {
  post({ type: "INIT_PROGRESS", stage: "Loading Python runtime…", pct: 5 });
  importScripts(CDN + "pyodide.js");
  pyodide = await loadPyodide({
    indexURL: CDN,
    stdout: (msg) => { if (!suppressRunLogs) post({ type: "LOG", level: "info", msg }); },
    stderr: (msg) => { if (!suppressRunLogs) post({ type: "LOG", level: "error", msg }); },
  });
  post({ type: "INIT_PROGRESS", stage: "Loading numpy + pandas… (~12.4 MB)", pct: 35 });
  await pyodide.loadPackage(["numpy", "pandas"], {
    messageCallback: (m) => post({ type: "LOG", level: "info", msg: "[pyodide] " + m }),
  });
  post({ type: "INIT_PROGRESS", stage: "Loading backtest engine…", pct: 85 });
  const src = await (await fetch("/py/engine.py")).text();
  pyodide.FS.writeFile("/home/pyodide/engine.py", src);
  pyodide.runPython("import json, numpy as np\nimport engine");

  // Cooperative interrupt needs SharedArrayBuffer (cross-origin isolation).
  // Without it we still cancel between chunks.
  if (typeof SharedArrayBuffer !== "undefined" && self.crossOriginIsolated) {
    interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    pyodide.setInterruptBuffer(interruptBuffer);
  }
  post({ type: "READY", pyodideVersion: PYODIDE_VERSION, interruptible: !!interruptBuffer });
}

/** Parse a Python traceback for the user's strategy line ('File "<strategy>", line N'). */
function parseStrategyLine(traceback) {
  const matches = [...traceback.matchAll(/File "<strategy>", line (\d+)/g)];
  return matches.length ? parseInt(matches[matches.length - 1][1], 10) : null;
}

function pyError(id, err) {
  const tb = String(err && err.message ? err.message : err);
  const lines = tb.trim().split("\n");
  post({
    type: "PY_ERROR",
    id,
    message: lines[lines.length - 1] || "Python error",
    traceback: tb,
    lineNumber: parseStrategyLine(tb),
  });
}

function extractParams(msg) {
  if (!pyodide) return pyError(msg.id, new Error("Python runtime not ready"));
  try {
    pyodide.globals.set("_qd_code", msg.code);
    const json = pyodide.runPython("engine.extract_params(_qd_code)");
    post({ type: "PARAMS", id: msg.id, params: JSON.parse(json) });
  } catch (err) {
    pyError(msg.id, err);
  }
}

/** Copy a contiguous float64 numpy array out of the WASM heap. */
function takeF64(pyExpr) {
  const proxy = pyodide.runPython(pyExpr);
  const buf = proxy.getBuffer("f64");
  const out = new Float64Array(buf.data.length);
  out.set(buf.data);
  buf.release();
  proxy.destroy();
  return out;
}

async function runBacktest(msg) {
  if (!pyodide) return pyError(msg.id, new Error("Python runtime not ready"));
  cancelRequested = false;
  if (interruptBuffer) interruptBuffer[0] = 0;
  const t0 = performance.now();
  const { buffers } = msg;

  try {
    pyodide.globals.set("_qd_code", msg.strategyCode);
    pyodide.globals.set("_qd_config", JSON.stringify(msg.config));
    pyodide.globals.set("_qd_params", JSON.stringify(msg.params || {}));
    for (const k of ["ts", "open", "high", "low", "close", "volume"]) {
      pyodide.globals.set("_qd_" + k, buffers[k]);
    }
    pyodide.runPython(`
_qd_cls = engine.build_strategy_class(_qd_code)
_qd_bt = engine.Backtest(
    _qd_cls,
    np.asarray(_qd_ts.to_py()), np.asarray(_qd_open.to_py()),
    np.asarray(_qd_high.to_py()), np.asarray(_qd_low.to_py()),
    np.asarray(_qd_close.to_py()), np.asarray(_qd_volume.to_py()),
    json.loads(_qd_config), json.loads(_qd_params))
`);
  } catch (err) {
    return pyError(msg.id, err);
  }

  // Chunked run loop: yields to the event loop between chunks so CANCEL works
  // even without SharedArrayBuffer.
  let finished = false;
  let lastProgress = 0;
  while (!finished) {
    if (cancelRequested) {
      cleanupRun();
      return post({ type: "CANCELLED", id: msg.id });
    }
    let r;
    try {
      r = pyodide.runPython(`_qd_bt.run_chunk(${CHUNK_BARS})`).toJs();
    } catch (err) {
      cleanupRun();
      if (cancelRequested) return post({ type: "CANCELLED", id: msg.id });
      return pyError(msg.id, err);
    }
    const [done, total, fin] = r;
    finished = fin;
    const now = performance.now();
    if (now - lastProgress > 100 || finished) {
      lastProgress = now;
      post({ type: "PROGRESS", id: msg.id, pct: (done / total) * 100, barIndex: done, totalBars: total });
    }
    await new Promise((res) => setTimeout(res, 0));
  }

  try {
    const result = JSON.parse(pyodide.runPython("json.dumps(_qd_bt.finalize())"));
    const ts = takeF64("_qd_bt._ts");
    const equity = takeF64("_qd_bt.equity");
    const closedEquity = takeF64("_qd_bt.closed_equity");
    const drawdown = takeF64("_qd_bt.drawdown");
    const buyHold = takeF64("_qd_bt.bh");
    const indicators = result.indicators.map((meta, i) => ({
      ...meta,
      values: takeF64(`_qd_bt.indicators[${i}]["values"]`),
    }));
    cleanupRun();
    const transfer = [ts, equity, closedEquity, drawdown, buyHold, ...indicators.map((d) => d.values)]
      .map((a) => a.buffer);
    post(
      {
        type: "RESULT",
        id: msg.id,
        metrics: result.metrics,
        trades: result.trades,
        monthly: result.monthly,
        warnings: result.warnings,
        lastSignal: result.lastSignal,
        ts, equity, closedEquity, drawdown, buyHold, indicators,
        elapsedMs: performance.now() - t0,
      },
      transfer
    );
  } catch (err) {
    cleanupRun();
    pyError(msg.id, err);
  }
}

function expandGrid(grid) {
  let rows = [{}];
  for (const dimension of grid) {
    const next = [];
    for (const row of rows) {
      for (const value of dimension.values) next.push({ ...row, [dimension.key]: value });
    }
    rows = next;
    if (rows.length > 500) throw new Error("Optimization is limited to 500 combinations.");
  }
  return rows;
}

async function runOptimization(msg) {
  if (!pyodide) return pyError(msg.id, new Error("Python runtime not ready"));
  cancelRequested = false;
  suppressRunLogs = true;
  if (interruptBuffer) interruptBuffer[0] = 0;
  const t0 = performance.now();
  try {
    const combinations = expandGrid(msg.grid);
    if (!combinations.length) throw new Error("Choose at least one numeric parameter to optimize.");
    const rows = [];
    const { buffers } = msg;
    pyodide.globals.set("_qd_code", msg.strategyCode);
    pyodide.globals.set("_qd_config", JSON.stringify(msg.config));
    for (const k of ["ts", "open", "high", "low", "close", "volume"]) {
      pyodide.globals.set("_qd_" + k, buffers[k]);
    }

    for (let index = 0; index < combinations.length; index++) {
      if (cancelRequested) {
        cleanupRun();
        return post({ type: "CANCELLED", id: msg.id });
      }
      const params = { ...(msg.params || {}), ...combinations[index] };
      pyodide.globals.set("_qd_params", JSON.stringify(params));
      pyodide.runPython(`
_qd_cls = engine.build_strategy_class(_qd_code)
_qd_bt = engine.Backtest(
    _qd_cls,
    np.asarray(_qd_ts.to_py()), np.asarray(_qd_open.to_py()),
    np.asarray(_qd_high.to_py()), np.asarray(_qd_low.to_py()),
    np.asarray(_qd_close.to_py()), np.asarray(_qd_volume.to_py()),
    json.loads(_qd_config), json.loads(_qd_params))
`);

      let finished = false;
      let barIndex = 0;
      while (!finished) {
        if (cancelRequested) {
          cleanupRun();
          suppressRunLogs = false;
          return post({ type: "CANCELLED", id: msg.id });
        }
        let chunkResult;
        try {
          chunkResult = pyodide.runPython(`_qd_bt.run_chunk(${CHUNK_BARS})`).toJs();
        } catch (err) {
          if (cancelRequested) {
            cleanupRun();
            suppressRunLogs = false;
            return post({ type: "CANCELLED", id: msg.id });
          }
          throw err;
        }
        const [done, total, fin] = chunkResult;
        barIndex = done;
        finished = fin;
        post({ type: "OPTIMIZE_PROGRESS", id: msg.id, completed: index, total: combinations.length, barIndex, totalBars: total });
        await new Promise((res) => setTimeout(res, 0));
      }

      const metrics = JSON.parse(pyodide.runPython("json.dumps(_qd_bt.finalize()['metrics'])"));
      const objectiveValue = Number(metrics[msg.objective]);
      rows.push({ params: combinations[index], metrics, objectiveValue: Number.isFinite(objectiveValue) ? objectiveValue : null });
      cleanupRun();
      post({ type: "OPTIMIZE_PROGRESS", id: msg.id, completed: index + 1, total: combinations.length, barIndex: 0, totalBars: buffers.close.length });
      await new Promise((res) => setTimeout(res, 0));
    }
    suppressRunLogs = false;
    post({ type: "OPTIMIZATION_RESULT", id: msg.id, rows, elapsedMs: performance.now() - t0 });
  } catch (err) {
    cleanupRun();
    suppressRunLogs = false;
    pyError(msg.id, err);
  }
}

function cleanupRun() {
  try {
    pyodide.runPython("_qd_bt = None; _qd_cls = None");
  } catch {
    /* runtime may be unusable after a fatal error; the client restarts us */
  }
}
