'use client';
import { useEffect, useState } from 'react';
import type { QueueItem } from '@/lib/types';

/** A subtle countdown over the video before the next queued item starts. The server runs the timer; this only shows it, and Cancel asks the server to stop it. */
export default function UpNextOverlay({ item, inMs, canControl, onCancel }: { item: QueueItem; inMs: number; canControl: boolean; onCancel: () => void }) {
  const [left, setLeft] = useState(inMs);
  useEffect(() => {
    const end = Date.now() + inMs;
    setLeft(inMs);
    const t = setInterval(() => setLeft(Math.max(0, end - Date.now())), 250);
    return () => clearInterval(t);
  }, [inMs, item.id]);
  const pct = inMs > 0 ? Math.max(0, Math.min(100, (left / inMs) * 100)) : 0; // the bar drains as the countdown runs
  return <div role="status" className="absolute bottom-3 left-3 right-3 z-[15] flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[.08] bg-[#121212]/95 px-3.5 py-2.5 text-sm shadow-[0_18px_40px_-16px_rgba(0,0,0,.95)] animate-[riseIn_.4s_ease-out]">
    <div className="min-w-0 flex-1"><p className="text-xs font-semibold tracking-wide text-secondary">Up next in {Math.ceil(left / 1000)}s</p><p className="truncate font-medium">{item.title}</p></div>
    {canControl && <button onClick={onCancel} className="press shrink-0 rounded-full border border-white/10 bg-white/[.06] px-3.5 py-1.5 text-xs font-semibold hover:bg-white/[.12]">Cancel</button>}
    <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-primary to-secondary transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
  </div>;
}
