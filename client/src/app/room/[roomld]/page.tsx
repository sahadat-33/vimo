'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Youtube, FileVideo, Globe, Copy } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import type { AppSocket, LocalPlayback, Mode, Playback, RoomState } from '@/lib/types';
import { getPass } from '@/lib/types';
import StageYouTube from '@/components/StageYouTube';
import StageLocalFile from '@/components/StageLocalFile';
import StageBrowser from '@/components/StageBrowser';
import VideoCallBar from '@/components/VideoCallBar';
import ChatAndQueue from '@/components/ChatAndQueue';

type Layout = 'desktop' | 'portrait' | 'landscape';
function useLayout(): Layout {
  const [l, setL] = useState<Layout>('portrait');
  useEffect(() => {
    const f = () => setL(innerWidth >= 1024 ? 'desktop' : innerWidth > innerHeight ? 'landscape' : 'portrait');
    f(); addEventListener('resize', f); return () => removeEventListener('resize', f);
  }, []);
  return l;
}
const MODES: { id: Mode; label: string; Icon: typeof Youtube }[] = [
  { id: 'youtube', label: 'YouTube', Icon: Youtube }, { id: 'file', label: 'File', Icon: FileVideo }, { id: 'browser', label: 'Browser', Icon: Globe }];

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const layout = useLayout();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [selfId, setSelfId] = useState('');
  const [state, setState] = useState<RoomState | null>(null);
  const [pb, setPb] = useState<LocalPlayback>({ playing: false, time: 0, rate: 1, at: Date.now() });
  const [err, setErr] = useState('');
  const [smartMic, setSmartMic] = useState(true);

  useEffect(() => {
    if (!getPass()) { router.replace('/'); return; }
    const s = getSocket(); setSocket(s);
    const join = () => s.emit('room:join', roomId, (r) => {
      if (r.error || !r.state) return setErr(r.error || 'Could not join');
      setSelfId(r.selfId!); setState(r.state); setPb({ ...r.state.playback, at: Date.now() });
    });
    s.on('connect', join); if (s.connected) join();
    s.on('connect_error', () => setErr('Can’t reach the server. It may be waking up. Retrying…'));
    s.on('mode:changed', ({ mode, playback }) => { setState((x) => x && { ...x, mode }); setPb({ ...playback, at: Date.now() }); });
    s.on('playback', (p) => setPb({ playing: p.playing, time: p.time, rate: p.rate, at: Date.now() }));
    s.on('queue:updated', (q) => setState((x) => x && { ...x, ...q }));
    return () => { s.off('connect', join); s.off('mode:changed'); s.off('playback'); s.off('queue:updated'); s.off('connect_error'); };
  }, [roomId, router]);

  const emitPlayback = useCallback((p: Playback) => { setPb({ ...p, at: Date.now() }); socket?.emit('playback', p); }, [socket]);

  if (err) return <p role="alert" className="p-6 text-ember">{err}</p>;
  if (!socket || !state) return <p className="p-6 text-cream/70">Joining room…</p>;
  const sp = { socket, selfId, roomId, playback: pb, current: state.current, emitPlayback };
  const stage = state.mode === 'youtube' ? <StageYouTube {...sp} /> : state.mode === 'file' ? <StageLocalFile {...sp} /> : <StageBrowser {...sp} initial={state.hb} controller={state.controller} />;
  const call = <VideoCallBar roomId={roomId} layout={layout} playing={pb.playing} smartMic={smartMic} setSmartMic={setSmartMic} />;
  const switcher = (
    <nav className="flex items-center gap-1 p-2" aria-label="Watch mode">
      {MODES.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => socket.emit('mode:set', id)} aria-pressed={state.mode === id}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${state.mode === id ? 'bg-blush text-night' : 'bg-dusk text-cream/80'}`}>
          <Icon size={16} /> {label}
        </button>))}
      <button onClick={() => navigator.clipboard?.writeText(roomId)} className="ml-auto flex items-center gap-1 text-xs text-cream/60"><Copy size={14} /> {roomId}</button>
    </nav>
  );
  const side = <ChatAndQueue socket={socket} selfId={selfId} chat={state.chat} queue={state.queue} current={state.current} />;

  if (layout === 'landscape') return (
    <div className="fixed inset-0 bg-black">
      <div className="absolute inset-0">{stage}</div>
      <div className="absolute left-0 top-0 z-30 opacity-70 hover:opacity-100">{switcher}</div>
      {call}
    </div>);
  if (layout === 'desktop') return (
    <div className="grid h-screen grid-cols-[1fr_340px] grid-rows-[auto_1fr]">
      <div className="col-span-1">{switcher}</div><div className="row-span-2 flex flex-col border-l border-plum">{call}<div className="min-h-0 flex-1">{side}</div></div>
      <div className="min-h-0 px-2 pb-2"><div className="h-full overflow-hidden rounded-2xl bg-black">{stage}</div></div>
    </div>);
  return (
    <div className="flex h-screen flex-col">
      {switcher}<div className="aspect-video w-full bg-black">{stage}</div>{call}<div className="min-h-0 flex-1">{side}</div>
    </div>);
}
