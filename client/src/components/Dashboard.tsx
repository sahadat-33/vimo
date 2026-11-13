'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, HardDrive, Home, Info, Lock, Settings, Users, Youtube } from 'lucide-react';
import { SERVER, type Mode, type Profile, clearPass } from '@/lib/types';
import { Button, Card, Logo, ModeCard, StatusPill, TextField, cx } from './ui';

type View = 'home' | 'settings' | 'about';
const NAV: { id: View; label: string; Icon: typeof Home }[] = [{ id: 'home', label: 'Home', Icon: Home }, { id: 'settings', label: 'Settings', Icon: Settings }, { id: 'about', label: 'About', Icon: Info }];
const rid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => (value % 36).toString(36)).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 32);
};

export default function Dashboard({ onLock }: { onLock: () => void }) {
  const router = useRouter();
  const [view, setView] = useState<View>('home');
  const [health, setHealth] = useState<{ people: number } | false | null>(null);
  const [code, setCode] = useState(''), [name, setName] = useState(''), [saved, setSaved] = useState(false);

  useEffect(() => {
    let dead = false;
    const ping = () => fetch(`${SERVER}/health`).then((r) => r.json()).then((d) => !dead && setHealth({ people: d.people ?? 0 })).catch(() => !dead && setHealth(false));
    ping(); const t = setInterval(ping, 15000);
    try { setName((JSON.parse(localStorage.getItem('profile') || '{}') as Profile).name || ''); } catch {}
    return () => { dead = true; clearInterval(t); };
  }, []);

  const start = (m: Mode) => router.push(`/room/${encodeURIComponent(rid())}?mode=${m}`);
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = code.trim();
    if (!raw) return;
    let id = raw;
    try {
      const parsed = new URL(raw, window.location.origin);
      const match = parsed.pathname.match(/\/room\/([^/]+)\/?$/);
      if (match) id = decodeURIComponent(match[1]);
      else if (parsed.origin === window.location.origin) id = parsed.pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      id = raw.split(/[?#]/, 1)[0].split('/').filter(Boolean).pop() || '';
    }
    if (/^[A-Za-z0-9_-]{1,32}$/.test(id)) router.push(`/room/${encodeURIComponent(id)}`);
  };
  function saveName(e: React.FormEvent) {
    e.preventDefault(); let p: Profile = { name: '', avatar: '🐻', color: '#A78BFA' };
    try { p = { ...p, ...JSON.parse(localStorage.getItem('profile') || '{}') }; } catch {}
    localStorage.setItem('profile', JSON.stringify({ ...p, name: name.trim().slice(0, 20) || 'Guest' })); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  const nav = (row: boolean) => <nav aria-label="Main" className={row ? 'flex gap-1' : 'flex flex-col gap-1'}>
    {NAV.map(({ id, label, Icon }) => <button key={id} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}
      className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', view === id ? 'bg-primary/20 text-secondary' : 'text-muted hover:bg-surface2 hover:text-ink')}><Icon size={18} />{label}</button>)}</nav>;
  const online = health === null ? null : !!health;

  return <div className="bg-cinema min-h-[100dvh] lg:flex">
    <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-white/5 bg-bg/60 p-6 lg:flex"><Logo />{nav(false)}
      <p className="mt-auto text-xs text-muted">Better together.</p></aside>
    <header className="flex items-center justify-between gap-3 border-b border-white/5 p-4 lg:hidden"><Logo size={32} text={false} />{nav(true)}</header>
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 p-5 md:p-8 lg:p-12">
      {view === 'home' && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-3xl font-bold tracking-tight md:text-4xl">Welcome back!</h1><p className="mt-1 text-muted">Pick how you want to watch tonight.</p></div>
          <div className="flex flex-wrap gap-2"><StatusPill online={online} label={online === null ? 'Checking server…' : online ? 'Server online' : 'Server waking up'} />
            <StatusPill online={online ? true : null} label={`${health ? health.people : 0} connected`} /></div></div>
        <div className="grid gap-4 md:grid-cols-3">
          <ModeCard icon={<Youtube />} title="YouTube Watch Party" desc="Paste links, build a queue and watch in perfect sync." tag="Synced playback" onClick={() => start('youtube')} />
          <ModeCard icon={<HardDrive />} title="Share a Video File" desc="One person picks a video, it uploads once, and everyone watches in sync." tag="Upload once" onClick={() => start('file')} />
          <ModeCard icon={<Globe />} title="Shared Cloud Browser" desc="Browse Netflix, Prime or Disney+ together in one window." tag="Netflix and more" onClick={() => start('browser')} /></div>
        <Card><form onSubmit={join} className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1"><TextField label="Have an invite? Enter a room code or link" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc123" /></div>
          <Button variant="ghost" className="sm:w-40"><Users size={18} /> Join room</Button></form></Card></>}
      {view === 'settings' && <><h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <Card className="max-w-md space-y-4"><form onSubmit={saveName} className="space-y-4"><TextField label="Nickname" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <Button>{saved ? 'Saved' : 'Save nickname'}</Button></form>
          <Button variant="ghost" onClick={() => { clearPass(); onLock(); }}><Lock size={18} /> Lock this device</Button></Card></>}
      {view === 'about' && <><h1 className="text-3xl font-bold tracking-tight">About</h1>
        <Card className="max-w-xl space-y-3 text-muted"><p>Vimo is a private watch room for up to 10 people, with live camera and voice built in.</p>
          <p>Your passcode is checked on the server and kept only for this browser session. Videos you share are stored in the room’s private storage and removed when the room closes.</p></Card></>}
    </main></div>;
}
