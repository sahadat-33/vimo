'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Plus, DoorOpen } from 'lucide-react';
import { SERVER } from '@/lib/types';

export default function Landing() {
  const r = useRouter();
  const [pass, setPass] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  async function unlock(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const res = await fetch(`${SERVER}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: pass }) });
      if (!res.ok) throw new Error();
      sessionStorage.setItem('passcode', pass); setUnlocked(true);
    } catch { setErr('That passcode didn’t work. The server may also be waking up, so try again in a few seconds.'); }
  }
  const create = () => r.push(`/room/${Math.random().toString(36).slice(2, 8)}`);
  const field = 'w-full rounded-xl bg-dusk border border-plum px-4 py-3 text-lg placeholder:text-cream/40';
  const btn = 'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold';
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 p-6">
      <h1 className="text-5xl font-extrabold leading-none tracking-tight">Couch<br />Cinema</h1>
      <p className="text-cream/70">A private room for two. Same movie, same moment, even when you’re miles apart.</p>
      {!unlocked ? (
        <form onSubmit={unlock} className="space-y-3">
          <input className={field} type="password" placeholder="Room passcode" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          <button className={`${btn} bg-blush text-night`}><Lock size={18} /> Unlock</button>
          {err && <p role="alert" className="text-ember text-sm">{err}</p>}
        </form>
      ) : (
        <div className="space-y-3">
          <button onClick={create} className={`${btn} bg-blush text-night`}><Plus size={18} /> Create a room</button>
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) r.push(`/room/${code.trim()}`); }} className="flex gap-2">
            <input className={field} placeholder="Room code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="rounded-xl bg-plum px-4" aria-label="Join room"><DoorOpen /></button>
          </form>
        </div>
      )}
    </main>
  );
}
