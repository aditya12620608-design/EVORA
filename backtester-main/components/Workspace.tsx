"use client";

import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useStore } from "@/lib/store";
import LoadingScreen from "./LoadingScreen";
import TopBar from "./TopBar";
import StrategyRail from "./StrategyRail";
import EditorPane from "./EditorPane";
import ParamsPanel from "./ParamsPanel";
import BottomPanel from "./BottomPanel";
import Toasts from "./Toasts";

export default function Workspace() {
  const phase = useStore((s) => s.pyodide.phase);
  const leftRailOpen = useStore((s) => s.leftRailOpen);
  const initApp = useStore((s) => s.initApp);
  const runBacktest = useStore((s) => s.runBacktest);
  const cancelRun = useStore((s) => s.cancelRun);
  const runState = useStore((s) => s.runState);

  useEffect(() => {
    initApp();
  }, [initApp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (runState === "idle") runBacktest();
      }
      if (e.key === "Escape" && runState === "running") cancelRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runBacktest, cancelRun, runState]);

  if (phase === "idle" || phase === "loading" || phase === "error") {
    return <LoadingScreen />;
  }

  return (
    <div className="flex h-screen flex-col gap-1.5 overflow-hidden bg-canvas p-1.5 text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-1.5">
        {leftRailOpen && <StrategyRail />}
        <PanelGroup direction="vertical" autoSaveId="qd-v2">
          <Panel defaultSize={60} minSize={25}>
            <PanelGroup direction="horizontal" autoSaveId="qd-h2">
              <Panel defaultSize={72} minSize={40}>
                <div className="h-full overflow-hidden rounded-lg border border-line bg-bg">
                  <EditorPane />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1.5" />
              <Panel defaultSize={28} minSize={16} maxSize={45}>
                <ParamsPanel />
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="h-1.5" />
          <Panel defaultSize={40} minSize={15}>
            <BottomPanel />
          </Panel>
        </PanelGroup>
      </div>
      <Toasts />
    </div>
  );
}
