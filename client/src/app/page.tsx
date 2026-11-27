'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { SERVER, getPass, setPass as savePass } from '@/lib/types';
import { Button, Card, Logo, PasswordField } from '@/components/ui';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  const [ready, setReady] = useState(false), [unlocked, setUnlocked] = useState(false);
  const [pass, setPass] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [remember, setRemember] = useState(false);
  const router = useRouter();
  // A link shared from another app waits for the passcode, then opens its room (see app/share).
  const pendingShare = () => { try { return !!sessionStorage.getItem('vimoPendingShare'); } catch { return false; } };
  useEffect(() => { const ok = !!getPass(); setUnlocked(ok); setReady(true); if (ok && pendingShare()) router.replace('/share'); }, [router]); // eslint-disable-line
  if (!ready) return <div className="bg-cinema min-h-[100dvh]" />;
  if (unlocked) return <Dashboard onLock={() => { setPass(''); setUnlocked(false); }} />;

  async function unlock(e: React.FormEvent) {
    e.preventDefault(); if (!pass || busy) return; setErr(''); setBusy(true);
    try {
      const res = await fetch(`${SERVER}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: pass }) });
      if (res.status === 429) setErr('Too many attempts. Wait a few minutes and try again.');
      else if (!res.ok) setErr('That passcode isn’t right. Check it and try again.');
      else { savePass(pass, remember); setUnlocked(true); if (pendingShare()) router.replace('/share'); } // store it for the next pages (not the form's own setPass)
    } catch { setErr('Can’t reach the server. It may be waking up, so try again in a few seconds.'); }
    setBusy(false);
  }
  return <main className="bg-cinema grid min-h-[100dvh] place-items-center p-5">
    <Card className="w-full max-w-md space-y-6 p-8">
      <div className="space-y-3 text-center"><h1 className="flex justify-center"><span className="sr-only">Vimo</span><Logo size={56} /></h1><p className="text-muted">Better together.</p></div>
      <form onSubmit={unlock} className="space-y-4">
        <PasswordField label="Room passcode" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Enter passcode" error={err} disabled={busy} autoFocus />
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[#8A3FBB]" /> Remember me for 7 days</label>
        <Button loading={busy} disabled={!pass}>{busy ? 'Checking…' : 'Join Private Room'}</Button></form>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-secondary" aria-hidden />
        Only people with the passcode can enter. It’s verified on our server. It is kept only for this browser session, or on this device for 7 days if you tick Remember me.</p>
    </Card></main>;
}
