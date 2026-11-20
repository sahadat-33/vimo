'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { Info, Maximize2 } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import type { AppSocket, LocalPlayback, Member, Mode, Playback, Profile, RoomState } from '@/lib/types';
import type { SyncState } from '@/components/RoomHeader';
import { getCid, getPass } from '@/lib/types';
import { recordParty } from '@/lib/history';
import { useCall } from '@/lib/useCall';
import { useCinema } from '@/lib/useCinema';
import StageYouTube from '@/components/StageYouTube';
import StageLocalFile from '@/components/StageLocalFile';
import StageGoogleDrive from '@/components/StageGoogleDrive';
import StageBrowser from '@/components/StageBrowser';
import { CallAudio, FeedGrid } from '@/components/VideoCallBar';
import ChatPanel from '@/components/ChatPanel';
import ChatToasts from '@/components/ChatToasts';
import QueuePanel from '@/components/QueuePanel';
import RoomHeader from '@/components/RoomHeader';
import UpNextOverlay from '@/components/UpNextOverlay';
import JoinGate from '@/components/JoinGate';
import RoomControls from '@/components/RoomControls';
import { Button, Sheet, Skeleton, cx } from '@/components/ui';

type Layout = 'desktop' | 'portrait' | 'landscape';
function useLayout(): Layout {
  const [l, setL] = useState<Layout>('portrait');
  useEffect(() => {
    // Use the layout viewport's orientation, not visualViewport dimensions: the
    // soft keyboard changes the visual viewport and must never trigger cinema mode.
    // Re-sample after Android's rotation/fullscreen transition has settled.
    const mq = matchMedia('(orientation: landscape)');
    const getLayout = (): Layout => innerWidth >= 1024 ? 'desktop' : mq.matches ? 'landscape' : 'portrait';
    let timers: ReturnType<typeof setTimeout>[] = [];
    const apply = () => setL(getLayout());
    const settle = () => {
      timers.forEach(clearTimeout);
      apply();
      timers = [120, 350, 700, 1400].map((ms) => setTimeout(apply, ms));
    };
    apply();
    addEventListener('resize', apply);
    addEventListener('orientationchange', settle);
    mq.addEventListener?.('change', settle);
    const so = (screen as Screen & { orientation?: EventTarget }).orientation;
    so?.addEventListener('change', settle);
    document.addEventListener('fullscreenchange', settle);
    document.addEventListener('webkitfullscreenchange', settle);
    addEventListener('pageshow', settle); document.addEventListener('visibilitychange', settle);
    const watchdog = setInterval(apply, 1000); // a missed event can never leave the layout stale
    return () => {
      timers.forEach(clearTimeout); clearInterval(watchdog);
      removeEventListener('pageshow', settle); document.removeEventListener('visibilitychange', settle);
      removeEventListener('resize', apply);
      removeEventListener('orientationchange', settle);
      mq.removeEventListener?.('change', settle);
      so?.removeEventListener('change', settle);
      document.removeEventListener('fullscreenchange', settle);
      document.removeEventListener('webkitfullscreenchange', settle);
    };
  }, []);
  return l;
}
/** True while a text box has focus. Nothing may take the page away from someone who is typing (no landscape view, no hiding the chat). */
function useTyping(): boolean {
  const [t, setT] = useState(false);
  useEffect(() => {
    const isField = (e: EventTarget | null) => e instanceof HTMLElement && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA');
    let off: ReturnType<typeof setTimeout> | undefined;
    const on = (e: FocusEvent) => { if (isField(e.target)) { clearTimeout(off); setT(true); } };
    const out = (e: FocusEvent) => { if (isField(e.target)) { clearTimeout(off); off = setTimeout(() => setT(false), 400); } };
    document.addEventListener('focusin', on); document.addEventListener('focusout', out);
    return () => { clearTimeout(off); document.removeEventListener('focusin', on); document.removeEventListener('focusout', out); };
  }, []);
  return t;
}

/** Phones shrink the VISUAL viewport, not the layout viewport, for the soft keyboard. While the keyboard is open the room takes its height
 *  from visualViewport (published as --vvh) and steps aside; otherwise the room simply uses 100dvh, which the browser keeps correct.
 *  A keyboard can only be open while a text box has focus, so a smaller viewport on its own (rotation, fullscreen, browser bars) is never
 *  mistaken for one. That guess used to leave the header and controls hidden after fullscreen. */
function useViewportHeight(typing: boolean): boolean {
  const [kb, setKb] = useState(false);
  const tallest = useRef(0), width = useRef(0); // survive effect re-runs
  useEffect(() => {
    const vv = window.visualViewport;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const apply = () => {
      const w = vv ? vv.width : innerWidth, h = Math.round(vv ? vv.height : innerHeight);
      if (Math.abs(w - width.current) > 1) { width.current = w; tallest.current = h; } // turned or zoomed: the old keyboard-free height is void
      if (h > tallest.current) tallest.current = h;
      const open = typing && tallest.current - h > 130;
      if (open) document.documentElement.style.setProperty('--vvh', `${h}px`); else document.documentElement.style.removeProperty('--vvh');
      setKb(open);
      if (open && window.scrollY) window.scrollTo(0, 0); // the room page must never scroll
    };
    const settle = () => { timers.forEach(clearTimeout); apply(); timers = [150, 500].map((ms) => setTimeout(apply, ms)); };
    apply();
    vv?.addEventListener('resize', apply); vv?.addEventListener('scroll', apply);
    addEventListener('resize', apply); addEventListener('orientationchange', settle);
    document.addEventListener('fullscreenchange', settle); document.addEventListener('webkitfullscreenchange', settle);
    return () => {
      timers.forEach(clearTimeout);
      vv?.removeEventListener('resize', apply); vv?.removeEventListener('scroll', apply);
      removeEventListener('resize', apply); removeEventListener('orientationchange', settle);
      document.removeEventListener('fullscreenchange', settle); document.removeEventListener('webkitfullscreenchange', settle);
      document.documentElement.style.removeProperty('--vvh');
    };
  }, [typing]);
  return kb;
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
  const [resync, setResync] = useState(0); const bumpResync = useCallback(() => setResync((n) => n + 1), []); // every resync request reaches the stages
  const socketRef = useRef<AppSocket | null>(null);
  // Leaving the room page by any route (Back, a link) is an intentional leave: the seat is released at once.
  useEffect(() => () => { const cur = socketRef.current; if (cur && cur.connected) cur.emit('room:leave'); }, []);

  useEffect(() => {
    const s = getSocket(roomId); socketRef.current = s; setSocket(s); setOnline(s.connected);
    const join = () => s.emit('room:join', roomId, { ...profile, cid: getCid() }, (r) => {
      if (r.error || !r.state) return setErr(r.error || 'Could not join');
      const wanted = new URLSearchParams(location.search).get('mode');
      if (!modeApplied.current && wanted && ['youtube', 'file', 'browser'].includes(wanted) && r.state.members.length <= 1 && r.state.mode !== wanted) s.emit('mode:set', wanted as Mode);
      modeApplied.current = true;
      recordParty(roomId, { mode: r.state.mode, title: r.state.current?.title, wasHost: !!r.isHost }); // Party History: the server decides host status, so a reclaimed host is remembered as host
      setErr(''); setSelfId(r.selfId!); setResync((n) => n + 1); setIsHost(!!r.isHost); setState(r.state); setPb({ ...r.state.playback, at: Date.now() });
    });
    s.on('connect', () => { setOnline(true); join(); }); s.on('disconnect', () => setOnline(false));
    if (s.connected) join();
    // The app going to the background starts the grace period (away); coming back cancels it and confirms the seat.
    const onVis = () => {
      if (document.visibilityState === 'hidden') { s.emit('presence', { away: true }); return; }
      s.emit('presence', { away: false });
      if (s.connected) join(); else s.connect(); // idempotent: the same person, the same seat
    };
    document.addEventListener('visibilitychange', onVis);
    s.on('connect_error', (e) => { setOnline(false); if (e?.message === 'no_room') setErr('This party has ended, or the link is wrong. Ask your host for a new link.'); });
    s.on('up-next', (d) => setState((x) => x && { ...x, upNext: d }));
    s.on('drive:mode', (d) => setState((x) => x && { ...x, driveMode: d }));
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
    return () => { document.removeEventListener('visibilitychange', onVis); ['drive:mode', 'up-next', 'connect', 'disconnect', 'connect_error', 'mode:changed', 'playback', 'queue:updated', 'file:updated', 'peer:joined', 'peer:left', 'chat:message', 'hb:started', 'hb:stopped', 'browser:controller', 'room:settings']
      .forEach((e) => s.off(e as never)); };
  }, [roomId, profile]);

  const curTitle = state?.current?.title, curMode = state?.mode;
  useEffect(() => { if (curMode) recordParty(roomId, { mode: curMode, title: curTitle }); }, [roomId, curMode, curTitle]); // keep the history title in step with what is playing

  const emitPlayback = useCallback((p: Playback) => { setPb({ ...p, at: Date.now() }); socket?.emit('playback', p); }, [socket]);

  if (err) return <div className="bg-cinema grid min-h-[100dvh] place-items-center p-6 text-center"><div className="space-y-3"><p role="alert" className="text-accent">{err}</p><a href="/" className="inline-block rounded-xl bg-surface2 px-4 py-2 text-sm font-semibold">Back to home</a></div></div>;
  if (!socket || !state) return <RoomSkeleton />;
  return <RoomView {...{ roomId, profile, socket, selfId, isHost, state, pb, emitPlayback, online, resync, bumpResync }} />;
}


function RoomView({ roomId, profile, socket, selfId, isHost, state, pb, emitPlayback, online, resync, bumpResync }: {
  roomId: string; profile: Profile; socket: AppSocket; selfId: string; isHost: boolean; state: RoomState; pb: LocalPlayback; emitPlayback: (p: Playback) => void; online: boolean; resync: number; bumpResync: () => void }) {
  const [peopleOpen, setPeopleOpen] = useState(false), [queueOpen, setQueueOpen] = useState(false), [leaveOpen, setLeaveOpen] = useState(false);
  // While a sheet is open the sheet handles the keyboard, and the room keeps its layout still (no video jump while typing a link).
  const sheetOpen = peopleOpen || queueOpen || leaveOpen;
  const router = useRouter(); const rawLayout = useLayout(); const typing = useTyping() && !sheetOpen;
  const layout: Layout = typing && rawLayout === 'landscape' ? 'portrait' : rawLayout; // someone typing is never in landscape
  const kb = useViewportHeight(typing); // true while the soft keyboard is open (a text box has focus and the viewport shrank)
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [manual, setManual] = useState(false); // the stage is in Manual Sync Mode (an embed that cannot be controlled from outside)
  const [smartMic, setSmartMic] = useState(true), [touched, setTouched] = useState(false), [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const c = matchMedia('(pointer: coarse)').matches; setCoarse(c); if (c) return;
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) { setTouched(true); return; }
    const f = () => setTouched(true), evs = ['pointerup', 'keydown'];
    evs.forEach((e) => addEventListener(e, f, { passive: true })); return () => evs.forEach((e) => removeEventListener(e, f));
  }, []);
  const [floaters, setFloaters] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [sync, setSync] = useState<SyncState>('unknown'); const lastReport = useRef(0);
  const call = useCall({ roomId, userName: profile.name, sid: selfId, playing: pb.playing, smartMic });

  // ---- Cinema (landscape) mode, phones and tablets only ----
  // Only the video, plus floating chat and reactions. Entered by turning the phone sideways or by the player's OWN fullscreen button
  // (see useCinema). There are no custom rotate or fullscreen buttons on phones.
  const wrapRef = useRef<HTMLDivElement>(null);
  const mobile = coarse && layout !== 'desktop';
  const { fs } = useCinema(wrapRef, mobile, layout === 'landscape'); // fs: the player (its own fullscreen button) is fullscreen
  const cinema = mobile && (layout === 'landscape' || fs);
  useEffect(() => { if (cinema && !typing) (document.activeElement as HTMLElement | null)?.blur?.(); }, [cinema]); // eslint-disable-line // never leave the keyboard open over the video

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

  // Add ?debug=1 to the room address to see a live log of focus, keyboard and layout events (for finding what closes the keyboard).
  const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  const [dbg, setDbg] = useState<string[]>([]);
  const note = useCallback((m: string) => setDbg((d) => [...d.slice(-13), `${(performance.now() / 1000).toFixed(1)} ${m}`]), []);
  useEffect(() => {
    if (!debug) return;
    const tag = (t: EventTarget | null) => (t instanceof HTMLElement ? t.tagName : '?');
    const f = (e: Event) => note(`${e.type} ${tag(e.target)}${(e as FocusEvent).relatedTarget ? '>' + tag((e as FocusEvent).relatedTarget) : ''}`);
    const vv = window.visualViewport, v = () => note(`vv h=${Math.round(vv?.height ?? 0)} top=${Math.round(vv?.offsetTop ?? 0)} inner=${innerWidth}x${innerHeight}`);
    const o = () => note('orientationchange'), vis = () => note(`visibility ${document.visibilityState}`);
    document.addEventListener('focusin', f); document.addEventListener('focusout', f); document.addEventListener('fullscreenchange', f); vv?.addEventListener('resize', v); addEventListener('orientationchange', o); document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('focusin', f); document.removeEventListener('focusout', f); document.removeEventListener('fullscreenchange', f); vv?.removeEventListener('resize', v); removeEventListener('orientationchange', o); document.removeEventListener('visibilitychange', vis); };
  }, [debug, note]);
  useEffect(() => { if (debug) note(`state layout=${layout} raw=${rawLayout} cinema=${cinema} fs=${fs} kb=${kb} typing=${typing} screen=${(screen.orientation as unknown as { type?: string } | undefined)?.type ?? '?'}`); }, [debug, layout, rawLayout, cinema, fs, kb, typing, note]);

  const canControl = !state.hostOnly || selfId === state.hostId; // 'only I have control': guests watch, the host drives
  const emitPb = canControl ? emitPlayback : () => {};
  const sp = { socket, selfId, roomId, playback: pb, current: state.current, emitPlayback: emitPb, onDrift, onManual: setManual, driveMode: state.driveMode,
    setDriveMode: (m: 'auto' | 'manual', done: (err?: string) => void) => socket.emit('drive:mode', { id: state.current?.id ?? '', mode: m }, (r) => done(r?.error)),
    interacted: touched, file: state.file, isHost, canControl, resync };
  const stageInner = state.mode === 'youtube'
    ? (state.current?.kind === 'gdrive' ? <StageGoogleDrive {...sp} /> : <StageYouTube {...sp} />)
    : state.mode === 'file' ? <StageLocalFile {...sp} /> : <StageBrowser {...sp} members={state.members} initial={state.hb} controller={state.controller} />;
  const btn = 'absolute right-2 top-2 z-20 grid h-9 w-9 place-items-center rounded-lg bg-black/50 opacity-80 transition hover:opacity-100 touch-land:hidden';
  const stage = (
    <div className="relative h-full w-full" onPointerDown={() => setTouched(true)}>
      {stageInner}
      {state.upNext && <UpNextOverlay item={state.upNext.item} inMs={state.upNext.inMs} canControl={canControl} onCancel={() => socket.emit('up-next:cancel')} />}
      {!canControl && state.mode !== 'browser' && !manual && state.current?.kind !== 'gdrive' && <div className="absolute inset-0 z-[5]" aria-hidden />}
      {!canControl && state.mode !== 'browser' && !manual && !cinema && <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-black/60 px-2.5 py-1 text-xs text-muted touch-land:hidden">🔒 Host controls playback</span>}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {floaters.map((f) => <span key={f.id} className="float-emoji" style={{ left: `${f.x}%` }}>{f.emoji}</span>)}</div>
      {!mobile && typeof document !== 'undefined' && document.fullscreenEnabled && <button onClick={fullscreen} aria-label="Toggle fullscreen" title="Fullscreen" className={btn}><Maximize2 size={16} /></button>}
      {coarse && !touched && pb.playing && state.mode !== 'browser' &&
        <button onClick={() => setTouched(true)} className="absolute inset-0 z-20 grid place-items-center bg-black/60 text-lg font-semibold">
          <span className="rounded-full bg-primary px-5 py-3 text-white shadow-glow">Tap to sync &amp; unmute</span></button>}
    </div>);

  const netText = call.state === 'error' ? 'Unavailable' : call.state === 'joining' ? 'Connecting…' : call.net === 'good' ? 'Good' : call.net === 'low' ? 'Weak' : call.net === 'very-low' ? 'Poor' : 'Measuring…';
  const header = <RoomHeader members={state.members} selfId={selfId} onPeople={() => setPeopleOpen(true)} sync={sync} showSync={state.mode !== 'browser' && !manual} onLeave={() => setLeaveOpen(true)} onResync={bumpResync} />;
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
    : null;

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
    // `touch-land:` hides everything the instant the browser reports landscape on a touch device; `cinema` also covers real fullscreen entered with the player's own button.
    // While typing, the header and the control bar step aside and the stage becomes a short preview strip, so the
    // composer, the message feed AND the video all stay above the keyboard at the same time.
    const tight = kb && !cinema;
    // Drive every visibility/position change from the same React cinema state.
    // CSS orientation-only hiding used to outlive iframe fullscreen transitions,
    // leaving the header and controls hidden after returning to portrait.
    const hide = cx(cinema && 'hidden');
    const hideChrome = cx((cinema || tight) && 'hidden');
    const outer = cinema
      ? 'fixed inset-0 z-50 h-dvh w-screen overflow-hidden bg-black'
      : cx(tight ? 'h-[38%] max-h-[56.25vw] w-full shrink-0' : 'aspect-video w-full shrink-0', 'relative bg-black');
    body = (
      <div className="room-shell bg-cinema flex flex-col overflow-hidden">
        <div className={hideChrome}>{banner}{header}{shareBanner}</div>
        <div ref={wrapRef} className={outer}>
          <div className="relative h-full w-full">{stage}</div>
          <ChatToasts socket={socket} selfId={selfId} active={cinema || fs} /></div>
        <div className={cx('px-3 pt-3', hideChrome)}>{controls()}</div>
        <div className={hideChrome}>{callErr}</div>
        <div className={cx('min-h-0 flex-1 pt-1', hide)}>{chat}</div>{sheets}</div>);
  }
  return <>{debug && <pre aria-hidden className="pointer-events-none fixed left-1 top-1 z-[2147483647] max-w-[96vw] whitespace-pre-wrap rounded bg-black/85 p-1.5 text-[10px] leading-tight text-lime-300">{dbg.join('\n')}</pre>}<CallAudio parts={call.parts} />{body}</>;
}
