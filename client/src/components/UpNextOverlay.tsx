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
  return <div role="status" className="absolute bottom-3 left-3 right-3 z-[15] flex items-center gap-3 rounded-2xl bg-black/75 px-3 py-2 text-sm shadow-card">
    <div className="min-w-0 flex-1"><p className="text-xs text-secondary">Up next in {Math.ceil(left / 1000)}s</p><p className="truncate">{item.title}</p></div>
    {canControl && <button onClick={onCancel} className="shrink-0 rounded-full bg-surface2 px-3 py-1.5 text-xs font-semibold">Cancel</button>}
  </div>;
}
