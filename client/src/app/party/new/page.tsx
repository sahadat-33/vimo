'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileVideo } from 'lucide-react';
import { getPass } from '@/lib/types';
import { BAD_LINK, createRoom, parseVideoLink, resolveVideo, setPendingFile } from '@/lib/party';
import { Button, Card, Logo, cx } from '@/components/ui';
import { Avatar, ProfileEditor, saveProfile, useProfileDraft } from '@/components/ProfileEditor';

const fmt = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 1.07e10 ? 0 : 1)} MB` : `${Math.ceil(b / 1024)} KB`);

/** The host's setup page: pick the video, a name and a picture, decide who controls playback, then start the party. */
export default function NewParty() {
  const router = useRouter();
  const [mode, setMode] = useState<'youtube' | 'file' | null>(null);
  const [link, setLink] = useState(''), [file, setFile] = useState<File | null>(null), [hostOnly, setHostOnly] = useState(true);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const draft = useProfileDraft('Host'), picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!getPass()) { router.replace('/'); return; } // starting a party needs the passcode
    setMode(new URLSearchParams(location.search).get('mode') === 'file' ? 'file' : 'youtube');
  }, [router]);
  if (!mode) return <div className="bg-cinema min-h-[100dvh]" />;

  async function start(e: React.FormEvent) {
    e.preventDefault(); if (busy || !mode) return; setErr('');
    if (mode === 'youtube' && !parseVideoLink(link)) return setErr(BAD_LINK);
    if (mode === 'file' && !file) return setErr('Choose a video from your device first.');
    setBusy(true);
    try {
      let video;
      if (mode === 'youtube') { const v = await resolveVideo(link); if ('error' in v) { setBusy(false); return setErr(v.error); } video = { id: v.id, title: v.title, kind: v.kind }; }
      const roomId = await createRoom({ mode, hostOnly, video });
      saveProfile(draft.profile()); if (mode === 'file') setPendingFile(file);
      router.push(`/room/${roomId}`);
    } catch (x) { setErr(x instanceof Error ? x.message : 'Could not start the party.'); setBusy(false); }
  }
  const field = 'min-h-[52px] w-full rounded-2xl border border-white/[.08] bg-[#171717] px-4 text-ink placeholder:text-muted/60 transition focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20';
  return <main className="min-h-[100dvh] bg-[#121212] px-4 py-8 md:py-12" style={{ backgroundImage: 'radial-gradient(800px 420px at 15% -10%, rgba(138,63,187,.14), transparent 60%)' }}><div className="mx-auto w-full max-w-4xl space-y-8">
    <div className="flex items-center justify-between animate-[riseIn_.5s_ease-out]"><Logo size={32} /><button onClick={() => router.push('/')} className="press flex items-center gap-1.5 rounded-full border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={16} /> Back</button></div>
    <div className="animate-[riseIn_.6s_ease-out] space-y-2"><p className="text-xs font-semibold uppercase tracking-[.2em] text-secondary">{mode === 'youtube' ? 'Online party' : 'Video file party'}</p>
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{mode === 'youtube' ? 'Start an online party' : 'Start a video file party'}</h1>
      <p className="max-w-xl text-muted">You’ll get a link to share. Friends join with just a name and a picture.</p></div>
    <ProfileEditor draft={draft}>
      <Card className="space-y-5 rounded-[22px] border-white/[.07] bg-[#171717] p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,.9)]"><form onSubmit={start} className="space-y-5">
        <div className="flex items-center gap-3 border-b border-white/[.06] pb-4"><Avatar avatar={draft.avatar} color={draft.color} /><span className="truncate text-lg font-semibold">{draft.name.trim() || draft.defaultName}</span></div>
        <h2 className="text-lg font-semibold">Create a party</h2>
        {mode === 'youtube'
          ? <input aria-label="Video link" className={field} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a video link" inputMode="url" autoCapitalize="off" autoCorrect="off" />
          : <><input ref={picker} type="file" accept="video/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => picker.current?.click()} className={cx(field, 'press flex items-center gap-3 text-left hover:border-secondary/40')}><FileVideo size={20} className="shrink-0 text-secondary" />
                <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Choose a video from this device'}</span>{file && <span className="shrink-0 text-xs text-muted">{fmt(file.size)}</span>}</button></>}
        <div className="flex items-center justify-between gap-3"><span id="ho" className="text-muted">Only I have control</span>
          <button type="button" role="switch" aria-checked={hostOnly} aria-labelledby="ho" onClick={() => setHostOnly(!hostOnly)} className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300', hostOnly ? 'bg-primary' : 'bg-white/10')}>
            <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-300', hostOnly ? 'left-[22px]' : 'left-0.5')} /></button></div>
        {err && <p role="alert" className="text-sm text-accent">{err}</p>}
        <Button loading={busy} className="bg-gradient-to-r from-primary to-secondary shadow-glow">{busy ? 'Starting…' : 'Start the party'}</Button></form></Card>
    </ProfileEditor></div></main>;
}
