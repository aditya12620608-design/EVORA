"use client";

import dynamic from "next/dynamic";

// The whole workspace is client-only (Pyodide worker, Monaco, IndexedDB).
const Workspace = dynamic(() => import("@/components/Workspace"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-canvas text-dim">
      <span className="cursor-blink text-[15px] font-semibold text-ink">QuantDeck</span>
    </div>
  ),
});

export default function Home() {
  return <Workspace />;
}
