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
  const field = 'min-h-[48px] w-full rounded-xl border border-white/10 bg-surface2 px-4 text-ink placeholder:text-muted/60 focus:border-secondary';
  return <main className="bg-cinema min-h-[100dvh] px-4 py-8"><div className="mx-auto w-full max-w-4xl space-y-6">
    <div className="flex items-center justify-between"><Logo size={32} /><button onClick={() => router.push('/')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={16} /> Back</button></div>
    <div><h1 className="text-3xl font-bold tracking-tight">{mode === 'youtube' ? 'Start an online party' : 'Start a video file party'}</h1>
      <p className="mt-1 text-muted">You’ll get a link to share. Friends join with just a name and a picture.</p></div>
    <ProfileEditor draft={draft}>
      <Card className="space-y-4 p-5"><form onSubmit={start} className="space-y-4">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4"><Avatar avatar={draft.avatar} color={draft.color} /><span className="truncate text-lg font-semibold">{draft.name.trim() || draft.defaultName}</span></div>
        <h2 className="text-lg font-semibold">Create a party</h2>
        {mode === 'youtube'
          ? <input aria-label="Video link" className={field} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a video link" inputMode="url" autoCapitalize="off" autoCorrect="off" />
          : <><input ref={picker} type="file" accept="video/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => picker.current?.click()} className={cx(field, 'flex items-center gap-3 text-left')}><FileVideo size={20} className="shrink-0 text-secondary" />
                <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Choose a video from this device'}</span>{file && <span className="shrink-0 text-xs text-muted">{fmt(file.size)}</span>}</button></>}
        <div className="flex items-center justify-between gap-3"><span id="ho" className="text-muted">Only I have control</span>
          <button type="button" role="switch" aria-checked={hostOnly} aria-labelledby="ho" onClick={() => setHostOnly(!hostOnly)} className={cx('relative h-7 w-12 shrink-0 rounded-full transition', hostOnly ? 'bg-primary' : 'bg-surface2')}>
            <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all', hostOnly ? 'left-[22px]' : 'left-0.5')} /></button></div>
        {err && <p role="alert" className="text-sm text-accent">{err}</p>}
        <Button loading={busy} className="bg-gradient-to-r from-primary to-secondary">{busy ? 'Starting…' : 'Start the party'}</Button></form></Card>
    </ProfileEditor></div></main>;
}
