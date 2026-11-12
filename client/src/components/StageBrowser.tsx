'use client';
import { useEffect, useRef, useState } from 'react';
import { Hand, Power } from 'lucide-react';
import Hyperbeam from '@hyperbeam/web';
import { api } from '@/lib/socket';
import type { HbInfo, StageProps } from '@/lib/types';

export default function StageBrowser({ socket, selfId, roomId, initial, controller }: StageProps & { initial: HbInfo | null; controller: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const hb = useRef<any>(null);
  const [info, setInfo] = useState<HbInfo | null>(initial);
  const [ctl, setCtl] = useState<string | null>(controller);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const a = (i: HbInfo) => setInfo(i), b = () => setInfo(null), c = (id: string | null) => setCtl(id);
    socket.on('hb:started', a); socket.on('hb:stopped', b); socket.on('browser:controller', c);
    return () => { socket.off('hb:started', a); socket.off('hb:stopped', b); socket.off('browser:controller', c); };
  }, [socket]);

  useEffect(() => {
    if (!info || !box.current) return;
    let dead = false;
    (async () => { try {
      const h = await Hyperbeam(box.current!, info.embedUrl, { adminToken: info.adminToken });
      if (dead) return h.destroy(); hb.current = h;
    } catch { setErr('Could not open the virtual browser.'); } })();
    return () => { dead = true; hb.current?.destroy(); hb.current = null; };
  }, [info]);

  useEffect(() => { // only the controller may click/type; admin token lets us toggle our own control
    if (hb.current && ctl) hb.current.updateControlDisabled?.(hb.current.userId, ctl !== selfId);
  }, [ctl, selfId, info]);

  async function start() { setBusy(true); setErr('');
    const r = await api('/api/hyperbeam/start', { roomId }); setBusy(false);
    if (!r.ok) setErr('Could not start the browser. Check your Hyperbeam key and free minutes.'); }
  async function stop() { await api('/api/hyperbeam/stop', { roomId }); }

  if (!info) return <div className="grid h-full place-items-center p-6 text-center">
    <div className="space-y-3"><p className="text-cream/70">Open a shared browser to watch Netflix, Prime Video or Disney+ together.</p>
      <button disabled={busy} onClick={start} className="rounded-full bg-blush px-5 py-2 font-semibold text-night disabled:opacity-50">{busy ? 'Starting…' : 'Start virtual browser'}</button>
      {err && <p role="alert" className="text-sm text-ember">{err}</p>}</div></div>;
  return <div className="relative h-full w-full">
    <div ref={box} className="h-full w-full" />
    <div className="absolute bottom-2 right-2 z-20 flex gap-2">
      <button onClick={() => socket.emit('browser:control', ctl === selfId ? null : selfId)} className="flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-sm">
        <Hand size={14} /> {ctl === selfId ? 'Pass control' : 'Take control'}</button>
      <button onClick={stop} className="flex items-center gap-1 rounded-full bg-ember px-3 py-1.5 text-sm font-semibold text-night"><Power size={14} /> Stop browser</button>
    </div>{err && <p role="alert" className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-ember">{err}</p>}</div>;
}
