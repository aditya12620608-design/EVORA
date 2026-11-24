"use client";

export default function EmptyState({ msg, hint }: { msg: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
      <div className="text-[14px] font-medium text-ink">{msg}</div>
      {hint && <div className="max-w-sm text-[12px] text-dim">{hint}</div>}
    </div>
  );
}
