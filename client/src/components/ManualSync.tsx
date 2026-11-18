'use client';
import { useEffect, useState } from 'react';
import type { AppSocket } from '@/lib/types';

const beep = (hz: number) => { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
  o.frequency.value = hz; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.12); } catch {} };

/**
 * Manual Sync Mode. Some players cannot be controlled from outside the page (Google Drive's own player when the file cannot be streamed here).
 * Everyone presses play themselves; whoever may control playback starts a shared 3-2-1 so they do it at the same moment.
 * Rendered inside the stage, so it stays inside the fullscreen container and the cinema layout.
 */
export default function ManualSync({ socket, canControl }: { socket: AppSocket; canControl: boolean }) {
  const [n, setN] = useState<number | null>(null), [by, setBy] = useState('');
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | undefined, hide: ReturnType<typeof setTimeout> | undefined;
    const onCount = (d: { by: string; seconds: number }) => {
      clearInterval(iv); clearTimeout(hide);
      let k = Math.max(1, Math.min(5, Math.round(d.seconds))); setBy(d.by); setN(k); beep(660);
      iv = setInterval(() => {
        k -= 1; setN(k);
        if (k > 0) { beep(660); return; }
        beep(990); try { navigator.vibrate?.(80); } catch {}
        clearInterval(iv); hide = setTimeout(() => setN(null), 1000);
      }, 1000);
    };
    socket.on('countdown', onCount);
    return () => { socket.off('countdown', onCount); clearInterval(iv); clearTimeout(hide); };
  }, [socket]);
  return <>
    <div className="pointer-events-none absolute left-2 top-2 z-[12] flex items-center gap-2">
      <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-muted">Manual Sync Mode</span>
      {canControl && <button onClick={() => socket.emit('countdown')} aria-label="Start a 3-2-1 countdown for everyone" className="pointer-events-auto rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">3-2-1</button>}</div>
    {n !== null && <div role="status" aria-live="assertive" className="pointer-events-none absolute inset-0 z-[18] grid place-items-center bg-black/55 text-center">
      <div><p className="text-7xl font-extrabold">{n > 0 ? n : 'Play!'}</p><p className="mt-1 text-sm text-muted">{by} started the countdown. Press play now.</p></div></div>}
  </>;
}
