'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPass, setPass } from '@/lib/types';
import { createRoom, resolveVideo } from '@/lib/party';
import { Button, Card, Logo } from '@/components/ui';

const LINK = /https?:\/\/[^\s]+/i;
const PENDING = 'vimoPendingShare'; // a shared link kept until the passcode is entered

/**
 * Android sends a link shared from another app here (manifest share_target). Without the passcode the link waits and the gate
 * asks for it; with it, a room opens straight away with that video (host, "Only I have control" on).
 */
export default function Share() {
  const router = useRouter();
  const [msg, setMsg] = useState('Opening your party…'), [err, setErr] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    const q = new URLSearchParams(location.search);
    const found = [q.get('url'), q.get('text'), q.get('title')].map((v) => v?.match(LINK)?.[0] ?? null).find(Boolean) ?? null;
    let link = found; try { link = found ?? sessionStorage.getItem(PENDING); } catch {}
    if (!link) { router.replace('/'); return; }
    if (!getPass()) { try { sessionStorage.setItem(PENDING, link); } catch {} router.replace('/'); return; }
    try { sessionStorage.removeItem(PENDING); } catch {}
    void (async () => {
      setMsg('Checking the video…');
      const v = await resolveVideo(link);
      if ('error' in v) { setErr(v.error); return; }
      setMsg('Starting the party…');
      try { router.replace(`/room/${await createRoom({ mode: 'youtube', hostOnly: true, video: { id: v.id, title: v.title, kind: v.kind } })}`); }
      catch (e) { setErr(e instanceof Error ? e.message : 'Could not start the party.'); }
    })();
  }, [router]);
  return <main className="bg-cinema grid min-h-[100dvh] place-items-center p-5">
    <Card className="w-full max-w-md space-y-5 p-8 text-center">
      <div className="flex justify-center"><Logo size={48} text={false} /></div>
      {err ? <><p role="alert" className="text-sm text-accent">{err}</p><Button onClick={() => router.replace('/')}>Back to start</Button></> : <p className="text-muted">{msg}</p>}
    </Card></main>;
}
