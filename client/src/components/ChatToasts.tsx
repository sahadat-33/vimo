'use client';
import { useEffect, useRef, useState } from 'react';
import type { AppSocket, ChatMessage } from '@/lib/types';

/** Landscape cinema mode: incoming messages slide in over the video and fade after about 3 seconds. There is no input here; typing happens in portrait. */
export default function ChatToasts({ socket, selfId, active }: { socket: AppSocket; selfId: string; active: boolean }) {
  const [toasts, setToasts] = useState<ChatMessage[]>([]);
  const on = useRef(active); on.current = active;
  useEffect(() => {
    const onMsg = (m: ChatMessage) => {
      if (m.system || m.from === selfId || !on.current) return;
      setToasts((t) => [...t.slice(-2), m]); // at most 3 on screen
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== m.id)), 2800);
    };
    socket.on('chat:message', onMsg); return () => { socket.off('chat:message', onMsg); };
  }, [socket, selfId]);
  useEffect(() => { if (!active) setToasts([]); }, [active]);
  return <div aria-live="polite" aria-label="New messages" className="pointer-events-none absolute right-3 top-3 z-30 flex w-[min(60%,22rem)] flex-col items-end gap-2">
    {toasts.map((m) => <div key={m.id} className="flex max-w-full animate-[toastLife_2.8s_ease-in-out_forwards] items-start gap-2 rounded-2xl bg-black/65 px-3 py-2 text-sm shadow-card">
      <span style={{ background: m.color }} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-base leading-none">{m.avatar}</span>
      <span className="min-w-0"><span className="block text-xs font-semibold text-secondary">{m.name}</span><span className="break-words">{m.text}</span></span></div>)}
  </div>;
}
