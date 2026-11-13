'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SERVER, getPass } from '@/lib/types';
import { Button, Card, Logo, PasswordField } from '@/components/ui';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  const [ready, setReady] = useState(false), [unlocked, setUnlocked] = useState(false);
  const [pass, setPass] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setUnlocked(!!getPass()); setReady(true); }, []);
  if (!ready) return <div className="bg-cinema min-h-[100dvh]" />;
  if (unlocked) return <Dashboard onLock={() => { setPass(''); setUnlocked(false); }} />;

  async function unlock(e: React.FormEvent) {
    e.preventDefault(); if (!pass || busy) return; setErr(''); setBusy(true);
    try {
      const res = await fetch(`${SERVER}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: pass }) });
      if (res.status === 429) setErr('Too many attempts. Wait a few minutes and try again.');
      else if (!res.ok) setErr('That passcode isn’t right. Check it and try again.');
      else { sessionStorage.setItem('passcode', pass); setUnlocked(true); }
    } catch { setErr('Can’t reach the server. It may be waking up, so try again in a few seconds.'); }
    setBusy(false);
  }
  return <main className="bg-cinema grid min-h-[100dvh] place-items-center p-5">
    <Card className="w-full max-w-md space-y-6 p-8">
      <div className="space-y-3 text-center"><div className="flex justify-center"><Logo size={48} text={false} /></div>
        <h1 className="text-2xl font-bold tracking-tight">CouchCinema</h1><p className="text-muted">Your private cinema. Together, anywhere.</p></div>
      <form onSubmit={unlock} className="space-y-4">
        <PasswordField label="Room passcode" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Enter passcode" error={err} disabled={busy} autoFocus />
        <Button loading={busy} disabled={!pass}>{busy ? 'Checking…' : 'Join Private Room'}</Button></form>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-secondary" aria-hidden />
        Only people with the passcode can enter. It’s verified on our server and never stored beyond this browser session.</p>
    </Card></main>;
}
