"use client";

import { useStore } from "@/lib/store";

const TONE = {
  info: "border-line border-l-cyan",
  error: "border-line border-l-down",
  success: "border-line border-l-up",
} as const;

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto rounded-lg border border-l-4 bg-panel2 px-3 py-2.5 text-left text-[12px] text-ink shadow-[0_12px_40px_rgba(5,8,14,0.55)] ${TONE[t.kind]}`}
        >
          {t.msg}
        </button>
      ))}
    </div>
  );
}
