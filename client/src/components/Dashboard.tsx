'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, HardDrive, History as HistoryIcon, KeyRound, Home, Info, Lock, Settings, Users, Youtube } from 'lucide-react';
import { SERVER, type Mode, type Profile, clearPass } from '@/lib/types';
import { createRoom } from '@/lib/party';
import PartyHistory from './PartyHistory';
import { Button, Card, Logo, ModeCard, StatusPill, TextField, cx } from './ui';

type View = 'home' | 'settings' | 'about' | 'history';
const NAV: { id: View; label: string; Icon: typeof Home }[] = [{ id: 'home', label: 'Home', Icon: Home }, { id: 'settings', label: 'Settings', Icon: Settings }, { id: 'about', label: 'About', Icon: Info }, { id: 'history', label: 'Party history', Icon: HistoryIcon }];
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

  const [err, setErr] = useState('');
  const start = async (m: Mode) => { // YouTube and file parties get a setup page; the shared browser starts straight away
    if (m !== 'browser') return router.push(`/party/new?mode=${m}`);
    setErr('');
    try { router.push(`/room/${await createRoom({ mode: 'browser', hostOnly: false })}`); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not start the browser party.'); }
  };
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
  // Top bar: icon-only navigation on phones and tablets (named for screen readers and tooltips). Sidebar on desktop: icons with labels.
  const nav = (row: boolean) => <nav aria-label="Main" className={row ? 'ml-auto flex gap-1' : 'flex flex-col gap-1.5'}>
    {NAV.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined} aria-label={label} title={label}
      className={cx('press flex items-center rounded-xl text-sm font-medium', row ? 'h-10 w-10 justify-center' : 'gap-3 px-3 py-2.5', view === id ? 'bg-white/[.08] text-ink ring-1 ring-white/[.08]' : 'text-muted hover:bg-white/[.05] hover:text-ink')}><Icon size={row ? 20 : 18} />{!row && label}</button>)}</nav>;
  const online = health === null ? null : !!health;
  const joinCard = <form onSubmit={join} className="group flex min-w-0 flex-col gap-4 rounded-[22px] border border-white/[.07] bg-[#171717] p-5 shadow-card transition duration-300 hover:border-secondary/30">
    <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/[.05] text-secondary"><KeyRound size={22} /></span>
    <span className="space-y-1"><span className="block text-lg font-semibold">Have a code?</span><span className="block text-sm leading-relaxed text-muted">Paste an invite link or room code to join a party.</span></span>
    <div className="mt-auto flex gap-2"><input aria-label="Room code or invite link" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste link or code"
      className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/10 bg-[#121212] px-3 text-sm placeholder:text-muted/60 transition focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20" />
      <Button className="!w-auto px-4" aria-label="Join room"><Users size={18} /></Button></div></form>;

  return <div className="min-h-[100dvh] bg-[#121212] text-ink lg:flex" style={{ backgroundImage: 'radial-gradient(900px 480px at 85% -10%, rgba(138,63,187,.14), transparent 60%)' }}>
    <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-white/[.06] bg-[#141414]/80 p-6 backdrop-blur-xl lg:flex"><Logo />{nav(false)}
      <p className="mt-auto text-xs text-muted">Better together.</p></aside>
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/[.06] bg-[#121212]/85 px-4 py-3 backdrop-blur-xl lg:hidden"><Logo size={32} text={false} />{nav(true)}</header>
    <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 space-y-10 p-5 md:p-10 lg:p-12">
      {view === 'home' && <>
        <section className="animate-[riseIn_.6s_ease-out] space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-secondary">Vimo · private watch rooms</p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">Welcome back!</h1>
            <div className="flex flex-wrap gap-2"><StatusPill online={online} label={online === null ? 'Checking server…' : online ? 'Server online' : 'Server waking up'} />
              <StatusPill online={online ? true : null} label={`${health ? health.people : 0} connected`} /></div></div>
          <p className="max-w-xl text-muted">Pick how you want to watch tonight.</p>
        </section>
        {err && <p role="alert" className="text-sm text-accent">{err}</p>}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <ModeCard icon={<Youtube />} title="Online Watch Party" desc="Paste links, build a queue and watch in perfect sync." tag="Synced playback" onClick={() => start('youtube')} />
          <ModeCard icon={<HardDrive />} title="Share a Video File" desc="One person picks a video, it uploads once, and everyone watches in sync." tag="Upload once" onClick={() => start('file')} />
          <ModeCard icon={<Globe />} title="Shared Cloud Browser" desc="Browse Netflix, Prime or Disney+ together in one window." tag="Netflix and more" onClick={() => start('browser')} />
          {joinCard}</div>
      </>}
      {view === 'settings' && <section className="animate-[riseIn_.5s_ease-out] space-y-6"><h1 className="text-4xl font-semibold tracking-tight">Settings</h1>
        <Card className="max-w-md space-y-4 rounded-[22px] border-white/[.07] bg-[#171717]"><form onSubmit={saveName} className="space-y-4"><TextField label="Nickname" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <Button>{saved ? 'Saved' : 'Save nickname'}</Button></form>
          <Button variant="ghost" onClick={() => { clearPass(); onLock(); }}><Lock size={18} /> Lock this device</Button></Card></section>}
      {view === 'history' && <PartyHistory onOpen={(id) => router.push(`/room/${encodeURIComponent(id)}`)} />}
      {view === 'about' && <section className="animate-[riseIn_.5s_ease-out] space-y-6"><h1 className="text-4xl font-semibold tracking-tight">About</h1>
        <Card className="max-w-xl space-y-3 rounded-[22px] border-white/[.07] bg-[#171717] text-muted"><p>Vimo is a private watch room for up to 10 people, with live camera and voice built in.</p>
          <p>Your passcode is checked on the server and kept only for this browser session. Videos you share are stored in the room’s private storage and removed when the room closes.</p></Card></section>}
    </main></div>;
}
