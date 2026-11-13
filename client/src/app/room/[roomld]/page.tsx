'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { Info, Maximize2, Users } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import type { AppSocket, LocalPlayback, Member, Mode, Playback, Profile, RoomState } from '@/lib/types';
import { getCid, getPass } from '@/lib/types';
import { useCall } from '@/lib/useCall';
import StageYouTube from '@/components/StageYouTube';
import StageLocalFile from '@/components/StageLocalFile';
import StageBrowser from '@/components/StageBrowser';
import { CallAudio, FeedGrid, FloatingFeeds } from '@/components/VideoCallBar';
import ChatAndQueue from '@/components/ChatAndQueue';
import JoinGate from '@/components/JoinGate';
import RoomControls from '@/components/RoomControls';
import RoomPanel, { type PanelTab } from '@/components/RoomPanel';
import { Skeleton, StatusPill, cx } from '@/components/ui';

type Layout = 'desktop' | 'portrait' | 'landscape';
const PANEL_W = 'min(340px, 88vw)';
function useLayout(): Layout {
  const [l, setL] = useState<Layout>('portrait');
  useEffect(() => {
    const f = () => setL(innerWidth >= 1024 ? 'desktop' : innerWidth > innerHeight ? 'landscape' : 'portrait');
    const later = () => { f(); setTimeout(f, 150); setTimeout(f, 450); }; // Android reports the new size a moment after rotating
    f(); addEventListener('resize', f); addEventListener('orientationchange', later);
    const mq = matchMedia('(orientation: landscape)'); mq.addEventListener?.('change', later);
    const so = (screen as Screen & { orientation?: EventTarget }).orientation; so?.addEventListener('change', later);
    window.visualViewport?.addEventListener('resize', f);
    return () => { removeEventListener('resize', f); removeEventListener('orientationchange', later); mq.removeEventListener?.('change', later); so?.removeEventListener('change', later); window.visualViewport?.removeEventListener('resize', f); };
  }, []);
  return l;
}
export default function Room() {
  // Resolve the room ID from the route parameter, with a pathname fallback
  // so shared invite URLs still work if the route parameter key is mismatched.
  const params = useParams<Record<string, string | string[]>>();
  const pathname = usePathname();
  const paramValue = params?.roomId ?? Object.values(params ?? {}).find((value) => typeof value === 'string' || Array.isArray(value));
  const candidate = Array.isArray(paramValue) ? paramValue[0] : paramValue;
  const pathMatch = pathname.match(/^\/room\/([^/]+)/i);
  let roomId = String(candidate || pathMatch?.[1] || '').trim();
  try { roomId = decodeURIComponent(roomId); } catch { roomId = ''; }

  const [ready, setReady] = useState(false), [hasPass, setHasPass] = useState(false), [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    try { const p = localStorage.getItem('profile'); if (p) setProfile(JSON.parse(p)); } catch {}
    setHasPass(!!getPass()); setReady(true);
  }, []);
  if (!ready) return <RoomSkeleton />;
  if (!profile || !hasPass) return <JoinGate needPass={!hasPass} initial={profile} onDone={(p) => { setProfile(p); setHasPass(true); }} />;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(roomId)) return <div className="bg-cinema grid min-h-[100dvh] place-items-center p-6 text-center"><p role="alert" className="text-accent">This invite link is missing a valid room code. Ask the host to create a new room and share its invite link.</p></div>;
  return <RoomInner roomId={roomId} profile={profile} />;
}

function RoomSkeleton() {
  return <div className="bg-cinema flex h-[100dvh] flex-col gap-3 p-3" role="status" aria-label="Joining room">
    <Skeleton className="h-10 w-2/3" /><Skeleton className="min-h-0 flex-1" /><Skeleton className="h-14" /></div>;
}

function RoomInner({ roomId, profile }: { roomId: string; profile: Profile }) {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [selfId, setSelfId] = useState(''), [isHost, setIsHost] = useState(false), [online, setOnline] = useState(true);
  const [state, setState] = useState<RoomState | null>(null);
  const [pb, setPb] = useState<LocalPlayback>({ playing: false, time: 0, rate: 1, at: Date.now() });
  const [err, setErr] = useState('');
  const modeApplied = useRef(false);

  useEffect(() => {
    const s = getSocket(); setSocket(s); setOnline(s.connected);
    const join = () => s.emit('room:join', roomId, { ...profile, cid: getCid() }, (r) => {
      if (r.error || !r.state) return setErr(r.error || 'Could not join');
      const wanted = new URLSearchParams(location.search).get('mode');
      if (!modeApplied.current && wanted && ['youtube', 'file', 'browser'].includes(wanted) && r.state.members.length <= 1 && r.state.mode !== wanted) s.emit('mode:set', wanted as Mode);
      modeApplied.current = true;
      setErr(''); setSelfId(r.selfId!); setIsHost(!!r.isHost); setState(r.state); setPb({ ...r.state.playback, at: Date.now() });
    });
    s.on('connect', () => { setOnline(true); join(); }); s.on('disconnect', () => setOnline(false));
    if (s.connected) join();
    s.on('connect_error', () => setOnline(false));
    s.on('mode:changed', ({ mode, playback }) => { setState((x) => x && { ...x, mode }); setPb({ ...playback, at: Date.now() }); });
    s.on('playback', (p) => setPb({ playing: p.playing, time: p.time, rate: p.rate, at: Date.now() }));
    s.on('queue:updated', (q) => { setState((x) => x && { ...x, queue: q.queue, current: q.current }); if (q.playback) setPb({ ...q.playback, at: Date.now() }); });
    s.on('file:updated', (d) => { setState((x) => x && { ...x, file: d.file }); setPb({ ...d.playback, at: Date.now() }); });
    s.on('peer:joined', (m: Member) => setState((x) => x && { ...x, members: [...x.members.filter((y) => y.id !== m.id), m] }));
    s.on('peer:left', (id) => setState((x) => x && { ...x, members: x.members.filter((y) => y.id !== id) }));
    s.on('chat:message', (m) => setState((x) => x && { ...x, chat: [...x.chat, m] }));
    s.on('hb:started', (i) => setState((x) => x && { ...x, hb: i })); s.on('hb:stopped', () => setState((x) => x && { ...x, hb: null }));
    s.on('browser:controller', (id) => setState((x) => x && { ...x, controller: id }));
    return () => { ['connect', 'disconnect', 'connect_error', 'mode:changed', 'playback', 'queue:updated', 'file:updated', 'peer:joined', 'peer:left', 'chat:message', 'hb:started', 'hb:stopped', 'browser:controller']
      .forEach((e) => s.off(e as never)); };
  }, [roomId, profile]);

  const emitPlayback = useCallback((p: Playback) => { setPb({ ...p, at: Date.now() }); socket?.emit('playback', p); }, [socket]);

  if (err) return <div className="bg-cinema grid min-h-[100dvh] place-items-center p-6 text-center"><div className="space-y-3"><p role="alert" className="text-accent">{err}</p><a href="/" className="inline-block rounded-xl bg-surface2 px-4 py-2 text-sm font-semibold">Back to home</a></div></div>;
  if (!socket || !state) return <RoomSkeleton />;
  return <RoomView {...{ roomId, profile, socket, selfId, isHost, state, pb, emitPlayback, online }} />;
}

function RoomView({ roomId, profile, socket, selfId, isHost, state, pb, emitPlayback, online }: {
  roomId: string; profile: Profile; socket: AppSocket; selfId: string; isHost: boolean; state: RoomState; pb: LocalPlayback; emitPlayback: (p: Playback) => void; online: boolean }) {
  const router = useRouter(); const layout = useLayout();
  const [smartMic, setSmartMic] = useState(true), [touched, setTouched] = useState(false), [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const c = matchMedia('(pointer: coarse)').matches; setCoarse(c); if (c) return;
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) { setTouched(true); return; }
    const f = () => setTouched(true), evs = ['pointerup', 'keydown'];
    evs.forEach((e) => addEventListener(e, f, { passive: true })); return () => evs.forEach((e) => removeEventListener(e, f));
  }, []);
  const [open, setOpen] = useState(true), [tab, setTab] = useState<PanelTab>('chat'), [unread, setUnread] = useState(0);
  const [floaters, setFloaters] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [sync, setSync] = useState<'synced' | 'resyncing' | 'unknown'>('unknown'); const lastReport = useRef(0);
  const call = useCall({ roomId, userName: profile.name, sid: selfId, playing: pb.playing, smartMic });

  useEffect(() => { setOpen(layout !== 'landscape'); }, [layout]);
  const chatVisible = useRef(false); chatVisible.current = open && tab === 'chat';
  useEffect(() => { if (open && tab === 'chat') setUnread(0); }, [open, tab]);
  useEffect(() => {
    const onMsg = (m: { system?: boolean; from: string }) => { if (!m.system && m.from !== selfId && !chatVisible.current) setUnread((n) => n + 1); };
    const onReact = (r: { id: string; emoji: string }) => {
      setFloaters((f) => [...f.slice(-20), { id: r.id, emoji: r.emoji, x: 10 + Math.random() * 80 }]);
      setTimeout(() => setFloaters((f) => f.filter((y) => y.id !== r.id)), 3000);
    };
    socket.on('chat:message', onMsg); socket.on('reaction', onReact);
    return () => { socket.off('chat:message', onMsg); socket.off('reaction', onReact); };
  }, [socket, selfId]);

  // Sync status is only "synced" when a stage has measured real drift within the last 6 seconds.
  const onDrift = useCallback((d: number) => { lastReport.current = Date.now(); setSync(d <= 0.8 ? 'synced' : 'resyncing'); }, []);
  useEffect(() => { const t = setInterval(() => { if (Date.now() - lastReport.current > 6000) setSync('unknown'); }, 2000); return () => clearInterval(t); }, []);
  useEffect(() => { lastReport.current = 0; setSync('unknown'); }, [state.mode]);

  const toggleTab = (t: 'people' | 'chat') => { if (open && tab === t) setOpen(false); else { setTab(t); setOpen(true); } };
  const invite = async () => { try { await navigator.clipboard.writeText(`${location.origin}/room/${roomId}`); return true; } catch { return false; } };
  const leave = () => { socket.emit('room:leave'); setTimeout(() => socket.disconnect(), 200); router.push('/'); };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); };

  const sp = { socket, selfId, roomId, playback: pb, current: state.current, emitPlayback, onDrift, interacted: touched, file: state.file };
  const stageInner = state.mode === 'youtube' ? <StageYouTube {...sp} />
    : state.mode === 'file' ? <StageLocalFile {...sp} /> : <StageBrowser {...sp} members={state.members} initial={state.hb} controller={state.controller} />;
  const stage = (
    <div className="relative h-full w-full" onPointerDown={() => setTouched(true)}>
      {stageInner}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {floaters.map((f) => <span key={f.id} className="float-emoji" style={{ left: `${f.x}%` }}>{f.emoji}</span>)}</div>
      {typeof document !== 'undefined' && document.fullscreenEnabled &&
        <button onClick={fullscreen} aria-label="Toggle fullscreen" title="Fullscreen" className={cx('absolute right-2 z-20 grid h-9 w-9 place-items-center rounded-lg bg-black/50 opacity-70 transition hover:opacity-100', layout === 'landscape' ? 'top-12' : 'top-2')}><Maximize2 size={16} /></button>}
      {coarse && !touched && pb.playing && state.mode !== 'browser' &&
        <button onClick={() => { setTouched(true); }} className="absolute inset-0 z-20 grid place-items-center bg-black/60 text-lg font-semibold">
          <span className="rounded-full bg-primary px-5 py-3 text-white shadow-glow">Tap to sync &amp; unmute</span></button>}
    </div>);

  const netChip = call.state === 'error' ? { ok: false as boolean | null, t: 'Call off', tip: 'Call unavailable' }
    : call.state === 'joining' ? { ok: null, t: 'Connecting', tip: 'Connecting to the call' }
    : call.net === 'good' ? { ok: true, t: 'Good', tip: 'Network quality: good' } : call.net === 'low' ? { ok: false, t: 'Weak', tip: 'Network quality: weak' }
    : call.net === 'very-low' ? { ok: false, t: 'Poor', tip: 'Network quality: poor' } : { ok: null, t: 'Checking', tip: 'Measuring network quality' };
  const syncChip = sync === 'synced' ? { ok: true as boolean | null, t: 'In sync', tip: 'Playback is in sync' }
    : sync === 'resyncing' ? { ok: false, t: 'Resyncing', tip: 'Correcting playback drift' } : { ok: null, t: 'Waiting', tip: 'Waiting for the player to report' };
  const topBar = (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold"><span className="truncate">Room {roomId}</span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface2 px-2 py-0.5 text-xs font-medium text-muted"><Users size={12} />{state.members.length}/10</span></span>
      <div className="ml-auto flex items-center gap-1.5" aria-label="Connection status">
        <StatusPill compact online={online} label={online ? 'Online' : 'Offline'} title={online ? 'Server connected' : 'Reconnecting to the server'} />
        <StatusPill compact online={netChip.ok} label={netChip.t} title={netChip.tip} />
        {state.mode !== 'browser' && <StatusPill compact online={syncChip.ok} label={syncChip.t} title={syncChip.tip} />}</div></div>);
  const controls = (compact?: boolean) => (
    <RoomControls compact={compact} mic={call.mic} cam={call.cam} onMic={call.toggleMic} onCam={call.toggleCam} callReady={call.state === 'joined'}
      panelOpen={open} panelTab={tab} onToggleTab={toggleTab} unread={unread} onReact={(e) => socket.emit('reaction', e)} onInvite={invite}
      smartMic={smartMic} setSmartMic={setSmartMic} onLeave={leave} />);
  const panel = (showPeople: boolean) => (
    <RoomPanel tab={tab} onTab={setTab} unread={unread} queueCount={state.queue.length} peopleCount={state.members.length}
      people={showPeople ? <FeedGrid members={state.members} parts={call.parts} selfId={selfId} callState={call.state} /> : null}
      chat={<ChatAndQueue view={tab === 'queue' ? 'queue' : 'chat'} socket={socket} selfId={selfId} chat={state.chat} queue={state.queue} current={state.current} />} />);
  const banner = !online && <p role="status" className="bg-accent px-3 py-1 text-center text-sm font-medium text-bg">Reconnecting to the server…</p>;
  const callErr = call.state === 'error'
    ? <div role="alert" className="mx-2 mt-2 flex items-center justify-between gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent"><span>{call.error}</span>
        <button onClick={call.retry} className="shrink-0 rounded-lg bg-accent/20 px-2.5 py-1 font-semibold">Retry</button></div>
    : call.mediaNote ? <p role="status" className="mx-2 mt-2 flex items-start gap-1.5 px-2 text-xs text-muted"><Info size={14} className="mt-px shrink-0 text-accent" />{call.mediaNote}</p>
    : call.state === 'joined' && !call.mic && !call.cam ? <p className="mx-2 mt-2 px-2 text-xs text-muted">Listening only. Tap the mic or camera to join with audio or video.</p> : null;

  let body: React.ReactNode;
  if (layout === 'landscape') body = (
    <div className="fixed inset-0 h-[100dvh] w-screen overflow-hidden bg-black">
      <div className="absolute inset-y-0 left-0 transition-[right] duration-300" style={{ right: open ? PANEL_W : 0 }}>
        <div className="absolute inset-0">{stage}</div>
        <div className="absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/70 to-transparent">{topBar}{banner}</div>
        <div className="pointer-events-none absolute inset-x-0 top-11 z-40 flex justify-center"><div className="pointer-events-auto">{controls(true)}</div></div></div>
      {!open && <FloatingFeeds members={state.members} parts={call.parts} selfId={selfId} callState={call.state} />}
      <aside aria-label="Room panel" aria-hidden={!open} {...({ inert: open ? undefined : '' } as Record<string, unknown>)}
        style={{ width: PANEL_W }} className={cx('fixed right-0 top-0 z-50 h-[100dvh] border-l border-white/10 bg-bg/90 backdrop-blur transition-transform duration-300', open ? 'translate-x-0' : 'translate-x-full')}>
        {panel(open)}</aside>
    </div>);
  else if (layout === 'desktop') body = (
    <div className="bg-cinema flex h-[100dvh] flex-col">{banner}{topBar}{callErr}
      <div className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ease-out"
        style={{ gridTemplateColumns: open ? 'minmax(0,7fr) minmax(0,3fr)' : 'minmax(0,1fr) minmax(0,0fr)' }}>
        <div className="flex min-h-0 min-w-0 flex-col gap-2 px-2 pb-2">
          <div className="min-h-0 flex-1 overflow-hidden rounded-card bg-black shadow-card">{stage}</div>{controls()}</div>
        <aside aria-label="Room panel" aria-hidden={!open} {...({ inert: open ? undefined : '' } as Record<string, unknown>)} className="min-w-0 overflow-hidden border-l border-white/5">{panel(true)}</aside></div></div>);
  else body = (
    <div className="bg-cinema flex h-[100dvh] flex-col overflow-hidden">{banner}{topBar}
      <div className="aspect-video w-full shrink-0 bg-black">{stage}</div>
      <div className="px-2 pt-3">{controls()}</div>{callErr}
      <div aria-hidden={!open} {...({ inert: open ? undefined : '' } as Record<string, unknown>)}
        className={cx('min-h-0 overflow-hidden transition-opacity duration-300', open ? 'mt-2 flex-1 opacity-100' : 'h-0 flex-none opacity-0')}>{panel(true)}</div></div>);
  return <><CallAudio parts={call.parts} />{body}</>;
}
