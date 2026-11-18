'use client';
import { useEffect, useRef, useState } from 'react';
import type { AppSocket, ChatMessage } from '@/lib/types';

/**
 * Floating chat for landscape and fullscreen: incoming messages slide in over the video and fade after about 3 seconds.
 * This must be rendered INSIDE the element that goes fullscreen (the page does that: it is a direct child of the player container).
 * In browser fullscreen only that element and its descendants are drawn, in the "top layer", so a z-index on anything outside it, however
 * high, is simply not shown. The huge z-index here only keeps the bubbles above everything inside the container.
 */
export default function ChatToasts({ socket, selfId, active }: { socket: AppSocket; selfId: string; active: boolean }) {
  const [toasts, setToasts] = useState<ChatMessage[]>([]);
  const on = useRef(active); on.current = active;
  useEffect(() => {
    const onMsg = (m: ChatMessage) => {
      if (m.system || m.from === selfId) return;
      if (!on.current && !document.fullscreenElement) return; // only while the video is immersive or fullscreen
      setToasts((t) => [...t.slice(-2), m]); // at most 3 on screen
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== m.id)), 2800);
    };
    socket.on('chat:message', onMsg); return () => { socket.off('chat:message', onMsg); };
  }, [socket, selfId]);
  useEffect(() => { if (!active && !document.fullscreenElement) setToasts([]); }, [active]);
  return <div aria-live="polite" aria-label="New messages"
    className="pointer-events-none absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-[999999] flex w-[min(60%,22rem)] flex-col items-end gap-2">
    {toasts.map((m) => <div key={m.id} className="flex max-w-full animate-[toastLife_2.8s_ease-in-out_forwards] items-start gap-2 rounded-2xl bg-black/70 px-3 py-2 text-sm text-white shadow-card">
      <span style={{ background: m.color }} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-base leading-none">{m.avatar}</span>
      <span className="min-w-0"><span className="block text-xs font-semibold text-secondary">{m.name}</span><span className="break-words">{m.text}</span></span></div>)}
  </div>;
}
