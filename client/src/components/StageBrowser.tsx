'use client';
import { useEffect, useRef, useState } from 'react';
import { Hand, Power } from 'lucide-react';
import Hyperbeam from '@hyperbeam/web';
import type { HbInfo, Member, StageProps } from '@/lib/types';

/** Control is decided by the server. Only the current controller's socket receives the Hyperbeam admin token. */
export default function StageBrowser({ socket, selfId, members, initial: info, controller: ctl }: StageProps & { members: Member[]; initial: HbInfo | null; controller: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const hb = useRef<any>(null);
  const [admin, setAdmin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [txt, setTxt] = useState('');
  const mine = ctl === selfId, myAdmin = mine ? admin : null;

  useEffect(() => { const f = (d: { adminToken: string | null }) => setAdmin(d.adminToken); socket.on('hb:admin', f); return () => { socket.off('hb:admin', f); }; }, [socket]);
  useEffect(() => { if (!info) setAdmin(null); }, [info]);

  useEffect(() => { // re-embed when the viewer gains or loses admin rights
    if (!info || !box.current) return;
    let dead = false;
    (async () => { try {
      const h = await Hyperbeam(box.current!, info.embedUrl, myAdmin ? { adminToken: myAdmin } : {});
      if (dead) return h.destroy(); hb.current = h;
      if (myAdmin) h.updateControlDisabled?.(h.userId, false);
      setErr('');
    } catch { setErr('Could not open the virtual browser.'); } })();
    return () => { dead = true; hb.current?.destroy(); hb.current = null; };
  }, [info?.embedUrl, myAdmin]); // eslint-disable-line

  const key = (k: string) => { const h = hb.current; h?.sendEvent?.({ type: 'keydown', key: k }); h?.sendEvent?.({ type: 'keyup', key: k }); };
  const typeIt = (e: React.FormEvent) => { e.preventDefault(); [...txt].forEach(key); key('Enter'); setTxt(''); };
  const start = () => { setBusy(true); setErr(''); socket.emit('browser:start', (r) => { setBusy(false); if (r?.error) setErr(r.error); }); };
  const holder = members.find((m) => m.id === ctl);

  if (!info) return <div className="grid h-full place-items-center p-6 text-center">
    <div className="space-y-3"><p className="text-muted">Open a shared browser to watch Netflix, Prime Video or Disney+ together.</p>
      <button disabled={busy} onClick={start} className="rounded-full bg-primary px-5 py-2.5 font-semibold text-white shadow-glow disabled:opacity-50">{busy ? 'Starting…' : 'Start shared browser'}</button>
      {err && <p role="alert" className="text-sm text-accent">{err}</p>}</div></div>;
  return <div className="relative h-full w-full">
    <div ref={box} className="h-full w-full" />
    {mine && <form onSubmit={typeIt} className="absolute right-2 top-2 z-20 flex gap-1 sm:hidden">
      <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Type or paste, then Send" className="w-44 rounded-full bg-black/70 px-3 py-1.5 text-sm" />
      <button className="rounded-full bg-primary px-3 text-sm font-semibold text-white">Send</button></form>}
    <div className="absolute bottom-2 right-2 z-20 flex flex-wrap justify-end gap-2">
      {ctl === null && <button onClick={() => socket.emit('browser:control', { action: 'take' })} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-white"><Hand size={14} /> Take control</button>}
      {mine && <button onClick={() => socket.emit('browser:control', { action: 'release' })} className="flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-sm"><Hand size={14} /> Pass control</button>}
      {ctl !== null && !mine && <span className="rounded-full bg-black/70 px-3 py-1.5 text-sm">{holder ? holder.name : 'Someone'} is in control</span>}
      <button onClick={() => socket.emit('browser:stop')} className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-bg"><Power size={14} /> Stop (save minutes)</button></div>
    {err && <p role="alert" className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-accent">{err}</p>}</div>;
}
