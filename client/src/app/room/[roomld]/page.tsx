'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Youtube, FileVideo, Globe, Copy, MessageCircle, X } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import type { AppSocket, LocalPlayback, Member, Mode, Playback, Profile, RoomState } from '@/lib/types';
import { getPass } from '@/lib/types';
import StageYouTube from '@/components/StageYouTube';
import StageLocalFile from '@/components/StageLocalFile';
import StageBrowser from '@/components/StageBrowser';
import VideoCallBar from '@/components/VideoCallBar';
import ChatAndQueue from '@/components/ChatAndQueue';
import JoinGate from '@/components/JoinGate';

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
  const [ready, setReady] = useState(false), [hasPass, setHasPass] = useState(false), [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    try { const p = localStorage.getItem('profile'); if (p) setProfile(JSON.parse(p)); } catch {}
    setHasPass(!!getPass()); setReady(true);
  }, []);
  if (!ready) return null;
  if (!profile || !hasPass) return <JoinGate needPass={!hasPass} initial={profile} onDone={(p) => { setProfile(p); setHasPass(true); }} />;
  return <RoomInner roomId={roomId} profile={profile} />;
}

function RoomInner({ roomId, profile }: { roomId: string; profile: Profile }) {
  const layout = useLayout();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [selfId, setSelfId] = useState(''), [isHost, setIsHost] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const [pb, setPb] = useState<LocalPlayback>({ playing: false, time: 0, rate: 1, at: Date.now() });
  const [err, setErr] = useState(''), [smartMic, setSmartMic] = useState(true);
  const [touched, setTouched] = useState(false);
  const [drawer, setDrawer] = useState(false), [unread, setUnread] = useState(0);
  const [floaters, setFloaters] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const drawerRef = useRef(drawer); drawerRef.current = drawer;

  useEffect(() => {
    const s = getSocket(); setSocket(s);
    const join = () => s.emit('room:join', roomId, profile, (r) => {
      if (r.error || !r.state) return setErr(r.error || 'Could not join');
      setSelfId(r.selfId!); setIsHost(!!r.isHost); setState(r.state); setPb({ ...r.state.playback, at: Date.now() });
    });
    s.on('connect', join); if (s.connected) join();
    s.on('connect_error', () => setErr('Can’t reach the server. It may be waking up. Retrying…'));
    s.on('mode:changed', ({ mode, playback }) => { setState((x) => x && { ...x, mode }); setPb({ ...playback, at: Date.now() }); });
    s.on('playback', (p) => setPb({ playing: p.playing, time: p.time, rate: p.rate, at: Date.now() }));
    s.on('queue:updated', (q) => setState((x) => x && { ...x, ...q }));
    s.on('peer:joined', (m: Member) => setState((x) => x && { ...x, members: [...x.members.filter((y) => y.id !== m.id), m] }));
    s.on('peer:left', (id) => setState((x) => x && { ...x, members: x.members.filter((y) => y.id !== id) }));
    s.on('chat:message', (m) => { if (!m.system && !drawerRef.current) setUnread((n) => n + 1); });
    s.on('reaction', (r) => {
      setFloaters((f) => [...f, { id: r.id, emoji: r.emoji, x: 10 + Math.random() * 80 }]);
      setTimeout(() => setFloaters((f) => f.filter((y) => y.id !== r.id)), 3000);
    });
    return () => { ['connect', 'connect_error', 'mode:changed', 'playback', 'queue:updated', 'peer:joined', 'peer:left', 'chat:message', 'reaction']
      .forEach((e) => s.off(e as never)); };
  }, [roomId, profile]);

  const emitPlayback = useCallback((p: Playback) => { setPb({ ...p, at: Date.now() }); socket?.emit('playback', p); }, [socket]);

  if (err) return <p role="alert" className="p-6 text-ember">{err}</p>;
  if (!socket || !state) return <p className="p-6 text-cream/70">Joining room…</p>;

  const sp = { socket, selfId, roomId, playback: pb, current: state.current, emitPlayback };
  const next = state.queue[0];
  const stageInner = state.mode === 'youtube' ? <StageYouTube {...sp} onEnded={() => { if (isHost && next) socket.emit('video:change', next); }} />
    : state.mode === 'file' ? <StageLocalFile {...sp} /> : <StageBrowser {...sp} initial={state.hb} controller={state.controller} />;
  const stage = (
    <div className="relative h-full w-full" onPointerDown={() => setTouched(true)}>
      {stageInner}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {floaters.map((f) => <span key={f.id} className="float-emoji" style={{ left: `${f.x}%` }}>{f.emoji}</span>)}</div>
      {!touched && pb.playing && state.mode !== 'browser' && layout !== 'desktop' &&
        <button onClick={() => { setTouched(true); setPb((p) => ({ ...p, at: Date.now() })); }}
          className="absolute inset-0 z-20 grid place-items-center bg-black/60 text-lg font-semibold">
          <span className="rounded-full bg-blush px-5 py-3 text-night">Tap to sync &amp; unmute</span></button>}
    </div>);
  const call = <VideoCallBar userName={profile.name} roomId={roomId} layout={layout} playing={pb.playing} smartMic={smartMic} setSmartMic={setSmartMic} />;
  const switcher = (
    <nav className="flex items-center gap-1 p-2" aria-label="Watch mode">
      {MODES.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => socket.emit('mode:set', id)} aria-pressed={state.mode === id}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${state.mode === id ? 'bg-blush text-night' : 'bg-dusk text-cream/80'}`}>
          <Icon size={16} /> {label}
        </button>))}
      <button onClick={() => navigator.clipboard?.writeText(`${location.origin}/room/${roomId}`)} className="ml-auto flex items-center gap-1 rounded-full bg-dusk px-3 py-1.5 text-xs text-cream/80" aria-label="Copy invite link">
        <Copy size={14} /> Invite · {state.members.length}/10</button>
    </nav>
  );
  const side = <ChatAndQueue socket={socket} selfId={selfId} chat={state.chat} queue={state.queue} current={state.current} />;

  if (layout === 'landscape') return (
    <div className="fixed inset-0 h-[100dvh] w-screen bg-black">
      <div className="absolute inset-0">{stage}</div>
      <div className="absolute left-0 top-0 z-30 opacity-70 hover:opacity-100">{switcher}</div>
      {call}
      <button onClick={() => { setDrawer(true); setUnread(0); }} aria-label="Open chat" className="fixed bottom-2 right-2 z-40 rounded-full bg-black/70 p-3">
        <MessageCircle size={20} />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-ember px-1.5 text-xs text-night">{unread}</span>}</button>
      <aside className={`fixed right-0 top-0 z-50 h-[100dvh] w-[320px] max-w-[85vw] bg-night/85 backdrop-blur transition-transform ${drawer ? '' : 'translate-x-full'}`} aria-hidden={!drawer}>
        <button onClick={() => setDrawer(false)} aria-label="Close chat" className="absolute right-2 top-2 z-10 rounded-full bg-plum p-1"><X size={16} /></button>
        <div className="h-full pt-8">{side}</div></aside>
    </div>);
  if (layout === 'desktop') return (
    <div className="grid h-[100dvh] grid-cols-[1fr_340px] grid-rows-[auto_1fr]">
      <div>{switcher}</div><div className="row-span-2 flex min-h-0 flex-col border-l border-plum">{call}<div className="min-h-0 flex-1">{side}</div></div>
      <div className="min-h-0 px-2 pb-2"><div className="h-full overflow-hidden rounded-2xl bg-black">{stage}</div></div>
    </div>);
  return (
    <div className="flex h-[100dvh] flex-col">
      {switcher}<div className="aspect-video w-full shrink-0 bg-black">{stage}</div>{call}<div className="min-h-0 flex-1">{side}</div>
    </div>);
}
