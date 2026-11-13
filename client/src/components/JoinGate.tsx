'use client';
import { useState } from 'react';
import { SERVER, setPass, type Profile } from '@/lib/types';

const AVATARS = ['🐻', '🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🦉', '🐧', '🐰', '🦁', '🐨'];
const COLORS = ['#f0a3b5', '#ff7a59', '#ffd166', '#7bdff2', '#b2f7ef', '#c3b1e1'];

export default function JoinGate({ needPass, initial, onDone }: { needPass: boolean; initial: Profile | null; onDone: (p: Profile) => void }) {
  const [pass, setPass] = useState(''), [name, setName] = useState(initial?.name ?? '');
  const [avatar, setAvatar] = useState(initial?.avatar ?? AVATARS[0]), [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (needPass) {
        const r = await fetch(`${SERVER}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: pass }) });
        if (!r.ok) throw new Error();
        setPass(pass);
      }
      const p = { name: name.trim().slice(0, 20) || 'Guest', avatar, color };
      localStorage.setItem('profile', JSON.stringify(p)); onDone(p);
    } catch { setErr('That passcode didn’t work, or the server is waking up. Try again in a few seconds.'); }
    setBusy(false);
  }
  const field = 'w-full rounded-xl bg-dusk border border-plum px-4 py-3 text-lg';
  return <form onSubmit={go} className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4 p-6">
    <h1 className="text-3xl font-extrabold">Join the room</h1>
    {needPass && <input className={field} type="password" placeholder="Room passcode" value={pass} onChange={(e) => setPass(e.target.value)} />}
    <input className={field} placeholder="Your nickname" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
    <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Avatar">
      {AVATARS.map((a) => <button type="button" key={a} role="radio" aria-checked={avatar === a} onClick={() => setAvatar(a)}
        className={`rounded-xl py-2 text-2xl ${avatar === a ? 'bg-plum ring-2 ring-blush' : 'bg-dusk'}`}>{a}</button>)}</div>
    <div className="flex gap-2" role="radiogroup" aria-label="Color">
      {COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
        style={{ background: c }} className={`h-9 w-9 rounded-full ${color === c ? 'ring-2 ring-cream ring-offset-2 ring-offset-night' : ''}`} />)}</div>
    <button disabled={busy} className="rounded-xl bg-blush px-4 py-3 font-semibold text-night disabled:opacity-50">{busy ? 'Joining…' : 'Join'}</button>
    {err && <p role="alert" className="text-sm text-ember">{err}</p>}
  </form>;
}
