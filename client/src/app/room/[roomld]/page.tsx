'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { Info, Maximize2, RotateCw, X } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import type { AppSocket, LocalPlayback, Member, Mode, Playback, Profile, RoomState } from '@/lib/types';
import type { SyncState } from '@/components/RoomHeader';
import { getCid, getPass } from '@/lib/types';
import { useCall } from '@/lib/useCall';
import StageYouTube from '@/components/StageYouTube';
import StageLocalFile from '@/components/StageLocalFile';
import StageBrowser from '@/components/StageBrowser';
import { CallAudio, FeedGrid } from '@/components/VideoCallBar';
import ChatPanel from '@/components/ChatPanel';
import ChatToasts from '@/components/ChatToasts';
import QueuePanel from '@/components/QueuePanel';
import RoomHeader from '@/components/RoomHeader';
import JoinGate from '@/components/JoinGate';
import RoomControls from '@/components/RoomControls';
import { Button, Sheet, Skeleton, cx } from '@/components/ui';

type Layout = 'desktop' | 'portrait' | 'landscape';
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

  const [ready, setReady] = useState(false), [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    try { const p = localStorage.getItem('profile'); if (p) setProfile(JSON.parse(p)); } catch {}
    setReady(true);
  }, []);
  if (!ready) return <RoomSkeleton />;
  if (!profile) return <JoinGate initial={profile} onDone={(p) => setProfile(p)} />; // friends need only a name and a picture
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
    const s = getSocket(roomId); setSocket(s); setOnline(s.connected);
    const join = () => s.emit('room:join', roomId, { ...profile, cid: getCid() }, (r) => {
      if (r.error || !r.state) return setErr(r.error || 'Could not join');
      const wanted = new URLSearchParams(location.search).get('mode');
      if (!modeApplied.current && wanted && ['youtube', 'file', 'browser'].includes(wanted) && r.state.members.length <= 1 && r.state.mode !== wanted) s.emit('mode:set', wanted as Mode);
      modeApplied.current = true;
      setErr(''); setSelfId(r.selfId!); setIsHost(!!r.isHost); setState(r.state); setPb({ ...r.state.playback, at: Date.now() });
    });
    s.on('connect', () => { setOnline(true); join(); }); s.on('disconnect', () => setOnline(false));
    if (s.connected) join();
    s.on('connect_error', (e) => { setOnline(false); if (e?.message === 'no_room') setErr('This party has ended, or the link is wrong. Ask your host for a new link.'); });
    s.on('mode:changed', ({ mode, playback }) => { setState((x) => x && { ...x, mode }); setPb({ ...playback, at: Date.now() }); });
    s.on('playback', (p) => setPb({ playing: p.playing, time: p.time, rate: p.rate, at: Date.now() }));
    s.on('queue:updated', (q) => { setState((x) => x && { ...x, queue: q.queue, current: q.current }); if (q.playback) setPb({ ...q.playback, at: Date.now() }); });
    s.on('file:updated', (d) => { setState((x) => x && { ...x, file: d.file }); setPb({ ...d.playback, at: Date.now() }); });
    s.on('peer:joined', (m: Member) => setState((x) => x && { ...x, members: [...x.members.filter((y) => y.id !== m.id), m] }));
    s.on('peer:left', (id) => setState((x) => x && { ...x, members: x.members.filter((y) => y.id !== id) }));
    s.on('chat:message', (m) => setState((x) => x && { ...x, chat: [...x.chat, m] }));
    s.on('hb:started', (i) => setState((x) => x && { ...x, hb: i })); s.on('hb:stopped', () => setState((x) => x && { ...x, hb: null }));
    s.on('browser:controller', (id) => setState((x) => x && { ...x, controller: id }));
    s.on('room:settings', (d) => setState((x) => x && { ...x, hostOnly: d.hostOnly }));
    return () => { ['connect', 'disconnect', 'connect_error', 'mode:changed', 'playback', 'queue:updated', 'file:updated', 'peer:joined', 'peer:left', 'chat:message', 'hb:started', 'hb:stopped', 'browser:controller', 'room:settings']
      .forEach((e) => s.off(e as never)); };
  }, [roomId, profile]);

  const emitPlayback = useCallback((p: Playback) => { setPb({ ...p, at: Date.now() }); socket?.emit('playback', p); }, [socket]);

  if (err) return <div className="bg-cinema grid min-h-[100dvh] place-items-center p-6 text-center"><div className="space-y-3"><p role="alert" className="text-accent">{err}</p><a href="/" className="inline-block rounded-xl bg-surface2 px-4 py-2 text-sm font-semibold">Back to home</a></div></div>;
  if (!socket || !state) return <RoomSkeleton />;
  return <RoomView {...{ roomId, profile, socket, selfId, isHost, state, pb, emitPlayback, online }} />;
}

type Orient = { lock?: (o: string) => Promise<void>; unlock?: () => void };
const orientation = () => (typeof screen === 'undefined' ? undefined : (screen.orientation as unknown as Orient | undefined));

function RoomView({ roomId, profile, socket, selfId, isHost, state, pb, emitPlayback, online }: {
  roomId: string; profile: Profile; socket: AppSocket; selfId: string; isHost: boolean; state: RoomState; pb: LocalPlayback; emitPlayback: (p: Playback) => void; online: boolean }) {
  const router = useRouter(); const layout = useLayout();
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [smartMic, setSmartMic] = useState(true), [touched, setTouched] = useState(false), [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const c = matchMedia('(pointer: coarse)').matches; setCoarse(c); if (c) return;
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) { setTouched(true); return; }
    const f = () => setTouched(true), evs = ['pointerup', 'keydown'];
    evs.forEach((e) => addEventListener(e, f, { passive: true })); return () => evs.forEach((e) => removeEventListener(e, f));
  }, []);
  const [peopleOpen, setPeopleOpen] = useState(false), [queueOpen, setQueueOpen] = useState(false), [leaveOpen, setLeaveOpen] = useState(false);
  const [floaters, setFloaters] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [sync, setSync] = useState<SyncState>('unknown'); const lastReport = useRef(0);
  const call = useCall({ roomId, userName: profile.name, sid: selfId, playing: pb.playing, smartMic });

  // ---- Cinema (landscape) mode, phones and tablets only ----
  // cinema: the phone is held sideways, or the viewer pressed the rotate button. Only the video is shown, plus floating chat toasts and reactions.
  // forced: rotate button pressed. fs: real fullscreen is on. lockFailed: the browser refused to lock the orientation (iPhone Safari), so we turn the picture ourselves.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [forced, setForced] = useState(false), [fs, setFs] = useState(false), [lockFailed, setLockFailed] = useState(false);
  const mobile = coarse && layout !== 'desktop';
  const cinema = mobile && (layout === 'landscape' || forced);
  const pseudo = mobile && forced && layout === 'portrait' && (!fs || lockFailed); // portrait phone showing a sideways picture
  useEffect(() => {
    const onFs = () => {
      const on = !!document.fullscreenElement; setFs(on);
      if (!on) { setForced(false); setLockFailed(false); try { orientation()?.unlock?.(); } catch {} } // leaving fullscreen hands rotation back to the phone
    };
    document.addEventListener('fullscreenchange', onFs); return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  useEffect(() => { if (forced && layout === 'landscape') setForced(false); }, [forced, layout]); // the phone really turned: from here the sensor decides
  useEffect(() => { if (cinema) (document.activeElement as HTMLElement | null)?.blur?.(); }, [cinema]); // never leave the keyboard open over the video
  async function enterFullscreen(lock: boolean) {
    try { await wrapRef.current?.requestFullscreen({ navigationUI: 'hide' }); } catch {} // not available on iPhone Safari
    if (!lock) return;
    try { const o = orientation(); if (!o?.lock) throw new Error('no lock'); await o.lock('landscape'); } catch { setLockFailed(true); }
  }
  const rotate = () => { setForced(true); setLockFailed(false); void enterFullscreen(true); };
  const exitCinema = () => { setForced(false); setLockFailed(false); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); try { orientation()?.unlock?.(); } catch {} };

  useEffect(() => {
    const onReact = (r: { id: string; emoji: string }) => {
      setFloaters((f) => [...f.slice(-20), { id: r.id, emoji: r.emoji, x: 10 + Math.random() * 80 }]);
      setTimeout(() => setFloaters((f) => f.filter((y) => y.id !== r.id)), 3000);
    };
    socket.on('reaction', onReact); return () => { socket.off('reaction', onReact); };
  }, [socket]);

  // Sync status is only "synced" when a stage has measured real drift within the last 6 seconds.
  const onDrift = useCallback((d: number) => { lastReport.current = Date.now(); setSync(d <= 0.8 ? 'synced' : 'resyncing'); }, []);
  useEffect(() => { const t = setInterval(() => { if (Date.now() - lastReport.current > 6000) setSync('unknown'); }, 2000); return () => clearInterval(t); }, []);
  useEffect(() => { lastReport.current = 0; setSync('unknown'); }, [state.mode]);

  const invite = async () => { try { await navigator.clipboard.writeText(`${location.origin}/room/${roomId}`); return true; } catch { return false; } };
  const leave = () => { socket.emit('room:leave'); setTimeout(() => socket.disconnect(), 200); router.push('/'); };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); };

  const canControl = !state.hostOnly || selfId === state.hostId; // 'only I have control': guests watch, the host drives
  const emitPb = canControl ? emitPlayback : () => {};
  const sp = { socket, selfId, roomId, playback: pb, current: state.current, emitPlayback: emitPb, onDrift, interacted: touched, file: state.file, isHost, canControl };
  const stageInner = state.mode === 'youtube' ? <StageYouTube {...sp} />
    : state.mode === 'file' ? <StageLocalFile {...sp} /> : <StageBrowser {...sp} members={state.members} initial={state.hb} controller={state.controller} />;
  const btn = 'absolute right-2 top-2 z-20 grid h-9 w-9 place-items-center rounded-lg bg-black/50 opacity-80 transition hover:opacity-100 touch-land:hidden';
  const stage = (
    <div className="relative h-full w-full" onPointerDown={() => setTouched(true)}>
      {stageInner}
      {!canControl && state.mode !== 'browser' && <div className="absolute inset-0 z-[5]" aria-hidden />}
      {!canControl && state.mode !== 'browser' && !cinema && <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-black/60 px-2.5 py-1 text-xs text-muted touch-land:hidden">🔒 Host controls playback</span>}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {floaters.map((f) => <span key={f.id} className="float-emoji" style={{ left: `${f.x}%` }}>{f.emoji}</span>)}</div>
      {!cinema && (mobile
        ? layout === 'portrait' && <button onClick={rotate} aria-label="Watch in landscape" title="Watch in landscape" className={btn}><RotateCw size={16} /></button>
        : typeof document !== 'undefined' && document.fullscreenEnabled && <button onClick={fullscreen} aria-label="Toggle fullscreen" title="Fullscreen" className={btn}><Maximize2 size={16} /></button>)}
      {coarse && !touched && pb.playing && state.mode !== 'browser' &&
        <button onClick={() => { setTouched(true); if (cinema && !document.fullscreenElement) void enterFullscreen(false); }} className="absolute inset-0 z-20 grid place-items-center bg-black/60 text-lg font-semibold">
          <span className="rounded-full bg-primary px-5 py-3 text-white shadow-glow">Tap to sync &amp; unmute</span></button>}
    </div>);

  const netText = call.state === 'error' ? 'Unavailable' : call.state === 'joining' ? 'Connecting…' : call.net === 'good' ? 'Good' : call.net === 'low' ? 'Weak' : call.net === 'very-low' ? 'Poor' : 'Measuring…';
  const header = <RoomHeader members={state.members} selfId={selfId} onPeople={() => setPeopleOpen(true)} sync={sync} showSync={state.mode !== 'browser'} onLeave={() => setLeaveOpen(true)} />;
  const controls = () => (
    <RoomControls mic={call.mic} cam={call.cam} onMic={call.toggleMic} onCam={call.toggleCam} callReady={call.state === 'joined'}
      onInvite={invite} onQueue={() => setQueueOpen(true)} queueCount={state.queue.length} smartMic={smartMic} setSmartMic={setSmartMic} netText={netText}
      isHost={isHost} hostOnly={state.hostOnly} onHostOnly={(v) => socket.emit('room:settings', { hostOnly: v })} />);
  const chat = <ChatPanel socket={socket} selfId={selfId} chat={state.chat} />;
  const inviteLink = `${location.origin}/room/${roomId}`, canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const shareBanner = isHost && !inviteDismissed && state.members.length <= 1 ? (
    <div role="region" aria-label="Invite friends" className="mx-3 mb-2 space-y-2 rounded-xl border border-white/10 bg-surface p-3 text-sm">
      <div className="flex items-start justify-between gap-2"><p className="font-semibold">Share this link with your friends</p><button aria-label="Dismiss" onClick={() => setInviteDismissed(true)} className="px-1 text-muted">✕</button></div>
      <p className="break-all rounded-lg bg-surface2 px-2.5 py-1.5 text-xs text-muted">{inviteLink}</p>
      <div className="flex gap-2"><button onClick={() => { void invite(); }} className="flex-1 rounded-lg bg-primary py-2 font-semibold text-white">Copy link</button>
        {canShare && <button onClick={() => { navigator.share({ title: 'Join my Vimo party', url: inviteLink }).catch(() => {}); }} className="flex-1 rounded-lg bg-surface2 py-2 font-semibold">Share…</button>}</div></div>) : null;
  const banner = !online && <p role="status" className="bg-accent px-3 py-1 text-center text-sm font-medium text-bg">Reconnecting to the server…</p>;
  const callErr = call.state === 'error'
    ? <div role="alert" className="mx-3 mt-2 flex items-center justify-between gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent"><span>{call.error}</span>
        <button onClick={call.retry} className="shrink-0 rounded-lg bg-accent/20 px-2.5 py-1 font-semibold">Retry</button></div>
    : call.mediaNote ? <p role="status" className="mx-3 mt-2 flex items-start gap-1.5 px-2 text-xs text-muted"><Info size={14} className="mt-px shrink-0 text-accent" />{call.mediaNote}</p>
    : call.state === 'joined' && !call.mic && !call.cam ? <p className="mx-3 mt-2 px-2 text-xs text-muted">Listening only. Tap the mic or camera to join with audio or video.</p> : null;

  const sheets = <>
    <Sheet open={peopleOpen} onClose={() => setPeopleOpen(false)} title={`People (${state.members.length})`}>
      <FeedGrid members={state.members} parts={call.parts} selfId={selfId} callState={call.state} /></Sheet>
    <Sheet open={queueOpen} onClose={() => setQueueOpen(false)} title={`Queue (${state.queue.length})`}>
      <QueuePanel socket={socket} selfId={selfId} queue={state.queue} current={state.current} canControl={canControl} /></Sheet>
    <Sheet open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave the party?">
      <div className="space-y-3 px-5"><p className="text-sm text-muted">{isHost ? 'You started this party. Friends can stay, but nobody else will be able to control playback if “Only I have control” is on.' : 'You can rejoin any time with the same link.'}</p>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => setLeaveOpen(false)}>Stay</Button><Button onClick={leave} className="bg-accent text-bg shadow-none hover:bg-accent/90">Leave</Button></div></div></Sheet></>;

  let body: React.ReactNode;
  if (layout === 'desktop') body = (
    <div className="bg-cinema grid h-dvh grid-cols-[minmax(0,1fr)_380px] grid-rows-[auto_minmax(0,1fr)]">
      <div className="col-start-1 row-start-1">{banner}{header}{shareBanner}</div>
      <div className="col-start-1 row-start-2 flex min-h-0 flex-col gap-3 px-3 pb-3">
        <div className="min-h-0 flex-1 overflow-hidden rounded-card bg-black shadow-card">{stage}</div>{controls()}{callErr}</div>
      <aside aria-label="Chat" className="col-start-2 row-span-2 row-start-1 min-h-0 border-l border-white/5 bg-surface/40 pt-3">{chat}</aside>
      {sheets}</div>);
  else {
    // Phones and small tablets, portrait and landscape share ONE tree, so the player is never rebuilt when the phone turns (no restart, no lost fullscreen).
    // `touch-land:` hides everything the instant the browser reports landscape on a touch device; `cinema` does the same for the rotate button.
    const hide = cx(cinema && 'hidden', 'touch-land:hidden');
    const outer = cinema || pseudo
      ? 'fixed inset-0 z-50 h-dvh w-screen overflow-hidden bg-black'
      : 'relative aspect-video w-full shrink-0 bg-black touch-land:fixed touch-land:inset-0 touch-land:z-50 touch-land:aspect-auto touch-land:h-dvh touch-land:w-screen';
    const inner = pseudo ? 'absolute left-full top-0 h-[100dvw] w-[100dvh] origin-top-left rotate-90' : 'relative h-full w-full';
    body = (
      <div className="bg-cinema flex h-dvh flex-col overflow-hidden">
        <div className={hide}>{banner}{header}{shareBanner}</div>
        <div ref={wrapRef} className={outer}>
          <div className={inner}>{stage}<ChatToasts socket={socket} selfId={selfId} active={cinema} />
            {pseudo && <button onClick={exitCinema} aria-label="Exit landscape" className="absolute left-3 top-3 z-40 grid h-10 w-10 place-items-center rounded-full bg-black/60"><X size={18} /></button>}</div></div>
        <div className={cx('px-3 pt-3', hide)}>{controls()}</div>
        <div className={hide}>{callErr}</div>
        <div className={cx('min-h-0 flex-1 pt-1', hide)}>{chat}</div>{sheets}</div>);
  }
  return <><CallAudio parts={call.parts} />{body}</>;
}
