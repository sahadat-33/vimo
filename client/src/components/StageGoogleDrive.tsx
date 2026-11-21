'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StageProps } from '@/lib/types';
import { DRIVE_KEY } from '@/lib/party';
import { MAX_ATTEMPTS, START_LIMIT_MS, drivePreviewUrl, driveSources, driftAction, expectedTime, nudgedRate, probeDrive, reducePlayer, retryDelay, sourceForAttempt, type PlayerSnapshot, type Verdict } from '@/lib/driveSync';
import DriveControls from './DriveControls';
import ManualSync from './ManualSync';
import { cx } from './ui';

const STALL_PAUSE_MS = 1500;  // the host's stream stalled this long: pause the room so everyone waits
const HIDE_UI_MS = 2500;      // controls fade while playing; any touch brings them back
const HOLD_MS = 350;          // press and hold this long for the temporary 2x
const TAP_MS = 300, TAP_PX = 60, MOVE_PX = 12;
const SEEK_STEP_S = 10;

type Phase = 'probe' | 'loading' | 'ready' | 'failed';
type Failure = { message: string; permanent: boolean } | null;

/**
 * Plays the Drive file in VIMO's own player: a plain <video>, shared through the room's playback events.
 * Several attempts for slow or temporary failures ("Trying to load (n/3)"). A permanent problem (private file, format, key) stops at once.
 * Google's own player is used only when the room chooses it, and then for everyone: the choice is shared through the server.
 */
export default function StageGoogleDrive({ overlay, socket, playback, current, emitPlayback, onDrift, onManual, interacted, canControl, driveMode, setDriveMode, resync }: StageProps) {
  const id = current?.id ?? '';
  const roomManual = !!driveMode && driveMode.id === id && driveMode.mode === 'manual';
  const sources = useMemo(() => driveSources(id, DRIVE_KEY), [id]);
  const vid = useRef<HTMLVideoElement>(null), root = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('probe'), [attemptNo, setAttemptNo] = useState(1);
  const [src, setSrc] = useState<string | undefined>(undefined), [vkey, setVkey] = useState('0');
  const [ready, setReady] = useState(false), [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false), [fs, setFs] = useState(false), [showUI, setShowUI] = useState(true);
  const [failure, setFailure] = useState<Failure>(null), [holding, setHolding] = useState(false);
  const [flash, setFlash] = useState<{ side: 'l' | 'r'; n: number } | null>(null);
  const [pending, setPending] = useState(''), [note, setNote] = useState('');

  // Latest values for timers and listeners, so nothing runs with a stale closure.
  const pbRef = useRef(playback); pbRef.current = playback;
  const inter = useRef(interacted); inter.current = interacted;
  const emit = useRef(emitPlayback); emit.current = emitPlayback;
  const driftRef = useRef(onDrift); driftRef.current = onDrift;
  const canRef = useRef(canControl); canRef.current = canControl;
  const bufRef = useRef(false); bufRef.current = buffering;
  const playingRef = useRef(false); playingRef.current = playing;
  const phaseRef = useRef<Phase>('probe'); phaseRef.current = phase;
  const idRef = useRef(id); idRef.current = id;
  const sourcesRef = useRef(sources); sourcesRef.current = sources;
  const attemptRef = useRef(1), runRef = useRef(0);
  const startTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPlayCmd = useRef(0), until = useRef(0), forcedMute = useRef(false), autoPaused = useRef(false);
  const resumeAt = useRef(0), lastT = useRef(0), holdRef = useRef(false), alive = useRef(true);
  const down = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const setPh = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const setBuf = (b: boolean) => { bufRef.current = b; setBuffering(b); };
  const setPly = (p: boolean) => { playingRef.current = p; setPlaying(p); };
  const curSnap = (): PlayerSnapshot => ({ phase: phaseRef.current, buffering: bufRef.current, playing: playingRef.current, attempt: attemptRef.current });
  const expected = () => expectedTime(pbRef.current, Date.now());
  const remote = () => Date.now() < until.current;
  const act = (fn: () => void, ms = 1500) => { until.current = Date.now() + ms; try { fn(); } catch {} };
  const clearTimers = () => { clearTimeout(startTimer.current); clearTimeout(retryTimer.current); clearTimeout(stallTimer.current); };

  useEffect(() => () => { alive.current = false; clearTimers(); clearTimeout(hideTimer.current); clearTimeout(flashTimer.current); clearTimeout(holdTimer.current); }, []); // eslint-disable-line

  // --- attempts ---
  const beginAttempt = (n: number) => {
    if (!sourcesRef.current.length) return;
    attemptRef.current = n; setAttemptNo(n); setPh('loading');
    setSrc(sourceForAttempt(sourcesRef.current, n)); setVkey(`${idRef.current}-${n}-${Date.now()}`);
    setReady(false); setBuf(true); setFailure(null);
    clearTimeout(startTimer.current);
    startTimer.current = setTimeout(() => onAttemptFailed(false, 'The video is taking a long time to start.'), START_LIMIT_MS);
  };
  const onAttemptFailed = (permanent: boolean, message: string) => {
    clearTimeout(startTimer.current); setReady(false);
    if (permanent || attemptRef.current >= MAX_ATTEMPTS) { setPh('failed'); setFailure({ message, permanent }); setBuf(false); return; }
    const next = attemptRef.current + 1, run = runRef.current;
    setAttemptNo(next); setPh('loading'); setBuf(true);
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => { if (run === runRef.current && alive.current) beginAttempt(next); }, retryDelay(next));
  };
  const startFlow = () => {
    runRef.current += 1; const run = runRef.current;
    clearTimers(); attemptRef.current = 1; setFailure(null); setPh('probe'); resumeAt.current = 0; lastT.current = 0; autoPaused.current = false;
    if (!DRIVE_KEY) { beginAttempt(1); return; }
    void probeDrive(idRef.current, DRIVE_KEY).then((v: Verdict) => {
      if (run !== runRef.current || !alive.current) return;
      if (v.kind === 'permanent') onAttemptFailed(true, v.message); else beginAttempt(1); // a temporary probe failure is left to the attempts
    });
  };
  useEffect(() => { // (re)start for this video, unless the room has chosen Google's player
    if (!id) return;
    setPly(false); setTime(0); setDuration(0); setReady(false);
    if (roomManual) { runRef.current += 1; clearTimers(); return; }
    startFlow();
    return () => { runRef.current += 1; clearTimers(); };
  }, [id, roomManual]); // eslint-disable-line
  useEffect(() => { onManual?.(roomManual && !!id); return () => onManual?.(false); }, [roomManual, id]); // eslint-disable-line

  // --- sharing ---
  const apply = () => { // bring this viewer to the room's shared state
    const v = vid.current; if (!v || !ready) return;
    const pb = pbRef.current;
    if (pb.playing && !inter.current && !v.muted) { v.muted = true; forcedMute.current = true; setMuted(true); } // muted autoplay until the first tap
    if (driftAction(v.currentTime - expected(), pb.playing, bufRef.current) === 'seek') act(() => { v.currentTime = expected(); });
    if (!holdRef.current && Math.abs(v.playbackRate - pb.rate) > 1e-6) act(() => { v.playbackRate = pb.rate; });
    if (pb.playing && v.paused) { lastPlayCmd.current = Date.now(); act(() => { void v.play().catch(() => {}); }); }
    else if (!pb.playing && !v.paused) act(() => v.pause());
  };
  useEffect(() => { apply(); }, [playback, ready]); // eslint-disable-line
  const seenResync = useRef(resync ?? 0);
  useEffect(() => { // resync asked for: jump to the live position, then match play/pause and speed
    if ((resync ?? 0) === seenResync.current) return; seenResync.current = resync ?? 0;
    const v = vid.current; if (!v || !ready || phaseRef.current !== 'ready' || roomManual) return;
    const pb = pbRef.current;
    act(() => { v.currentTime = expected(); if (!holdRef.current) v.playbackRate = pb.rate; }, 2000);
    if (pb.playing && v.paused) { lastPlayCmd.current = Date.now(); act(() => { void v.play().catch(() => {}); }); }
    else if (!pb.playing && !v.paused) act(() => v.pause());
  }, [resync]); // eslint-disable-line
  useEffect(() => { // the first tap on this page unmutes
    if (interacted && forcedMute.current && vid.current) { forcedMute.current = false; vid.current.muted = false; setMuted(false); }
  }, [interacted]);
  useEffect(() => { // every second: report drift, and keep small differences absorbed by a slight speed change
    if (!ready) return;
    const t = setInterval(() => {
      const v = vid.current; if (!v || phaseRef.current !== 'ready') return;
      const exp = expected(), diff = v.currentTime - exp;
      driftRef.current?.(Math.abs(diff));
      if (remote() || bufRef.current || holdRef.current) return;
      if (pbRef.current.playing && v.paused && inter.current && Date.now() - lastPlayCmd.current > 4000) { apply(); return; } // a refused play: retry
      const a = driftAction(diff, pbRef.current.playing && !v.paused, false);
      if (a === 'seek') act(() => { v.currentTime = exp; });
      else { const want = nudgedRate(pbRef.current.rate, a); if (Math.abs(v.playbackRate - want) > 1e-6) act(() => { v.playbackRate = want; }); }
    }, 1000);
    return () => clearInterval(t);
  }, [ready]); // eslint-disable-line

  const snap = () => { // only the person in control shares actions; echoes of commands we applied are not sent
    const v = vid.current; if (!v || remote() || !ready || !canRef.current || holdRef.current) return;
    const isPlaying = !v.paused, room = pbRef.current, recent = Date.now() - lastPlayCmd.current < 8000;
    if (isPlaying === room.playing && Math.abs(v.playbackRate - room.rate) < 1e-6 && (recent || Math.abs(v.currentTime - expected()) < 1.5)) return;
    if (!isPlaying && room.playing && !inter.current && recent) return;
    emit.current({ playing: isPlaying, time: v.currentTime, rate: v.playbackRate });
  };

  // --- media events ---
  const onLoaded = () => { // ends loading whether or not the room is playing: a paused room shows the controls, ready to use
    const v = vid.current; if (!v) return;
    clearTimeout(startTimer.current); setReady(true); setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const next = reducePlayer(curSnap(), { type: 'metadata', paused: v.paused });
    setPh(next.phase); setBuf(next.buffering); setPly(next.playing); attemptRef.current = next.attempt; setAttemptNo(next.attempt);
    if (resumeAt.current > 0) { v.currentTime = resumeAt.current; resumeAt.current = 0; }
  };
  const onTime = () => { const v = vid.current; if (v) { lastT.current = v.currentTime; setTime(v.currentTime); } };
  const onWaiting = () => {
    setBuf(reducePlayer(curSnap(), { type: 'waiting' }).buffering); clearTimeout(stallTimer.current);
    if (!canRef.current) return;
    stallTimer.current = setTimeout(() => { // the host's stream is stuck: pause the room so everyone waits
      const v = vid.current; if (!v || v.paused || !bufRef.current) return;
      autoPaused.current = true; emit.current({ playing: false, time: v.currentTime, rate: v.playbackRate });
    }, STALL_PAUSE_MS);
  };
  const onPlaying = () => {
    const next = reducePlayer(curSnap(), { type: 'play' });
    setPh(next.phase); setBuf(next.buffering); setPly(next.playing); clearTimeout(stallTimer.current);
    const v = vid.current;
    if (autoPaused.current && canRef.current && v) { autoPaused.current = false; emit.current({ playing: true, time: v.currentTime, rate: v.playbackRate }); }
    else snap();
  };
  const onPause = () => {
    setPly(reducePlayer(curSnap(), { type: 'pause' }).playing); clearTimeout(stallTimer.current);
    if (holdRef.current) endHold();
    if (autoPaused.current) return; // our own stall pause: the room is already paused
    snap();
  };
  const onError = () => {
    const code = vid.current?.error?.code; // 2 network, 3 decode, 4 source: a format this browser can't play, or Google refusing the file
    if (code === 2) { if (phaseRef.current === 'ready') resumeAt.current = lastT.current; return onAttemptFailed(false, 'The connection dropped.'); }
    if (code === 3) return onAttemptFailed(true, 'This browser can’t play this video’s format.');
    onAttemptFailed(false, 'Google Drive didn’t stream the file. It may be a download limit, or a format this browser can’t play.');
  };

  // --- controls (only the person in control shares them) ---
  const togglePlay = () => { const v = vid.current; if (!v || !canRef.current) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); };
  const seekTo = (t: number) => { const v = vid.current; if (!v || !canRef.current) return; v.currentTime = t; setTime(t); }; // 'seeked' shares it
  const toggleMute = () => { const v = vid.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); }; // your own volume, not shared
  const setSpeed = (r: number) => { const v = vid.current; if (!v || !canRef.current) return; act(() => { v.playbackRate = r; }); emit.current({ playing: !v.paused, time: v.currentTime, rate: r }); };
  const startHold = () => {
    const v = vid.current; if (!v || holdRef.current || !canRef.current || !ready) return;
    holdRef.current = true; setHolding(true); socket.emit('playback-hold', { on: true }); act(() => { v.playbackRate = 2; }, 60000);
  };
  const endHold = () => {
    if (!holdRef.current) return;
    holdRef.current = false; setHolding(false); socket.emit('playback-hold', { on: false });
    const v = vid.current; if (v) act(() => { v.playbackRate = pbRef.current.rate; });
  };
  const flashSide = (side: 'l' | 'r') => { setFlash({ side, n: Date.now() }); clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlash(null), 700); };
  const seekBy = (d: number, side: 'l' | 'r') => {
    const v = vid.current; if (!v || !canRef.current) return;
    seekTo(Math.max(0, Math.min(Number.isFinite(v.duration) ? v.duration : Infinity, v.currentTime + d))); flashSide(side);
  };

  // --- fullscreen ---
  useEffect(() => { const f = () => setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const iosFullscreen = () => { (vid.current as unknown as { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.(); }; // iPhone: the video alone
  const toggleFs = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    const r = root.current;
    if (r && r.requestFullscreen) { r.requestFullscreen().catch(iosFullscreen); return; } // our whole stage, so the chat bubbles stay visible
    iosFullscreen();
  };

  // --- gestures on the picture (ignored over the controls) ---
  const bump = () => { setShowUI(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowUI(false), HIDE_UI_MS); };
  const onUi = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-ui]');
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    bump(); if (onUi(e.target)) return;
    down.current = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
    clearTimeout(holdTimer.current);
    if (canRef.current) holdTimer.current = setTimeout(() => { if (down.current && !down.current.moved) startHold(); }, HOLD_MS);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = down.current; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > MOVE_PX) { d.moved = true; clearTimeout(holdTimer.current); }
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    clearTimeout(holdTimer.current); const d = down.current; down.current = null;
    if (holdRef.current) { endHold(); return; }
    if (!d || d.moved || onUi(e.target)) return;
    const rect = root.current?.getBoundingClientRect(); if (!rect) return;
    const x = e.clientX - rect.left, now = Date.now(), last = lastTap.current;
    if (last && now - last.t < TAP_MS && Math.abs(x - last.x) < TAP_PX) { lastTap.current = null; const left = x < rect.width / 2; seekBy(left ? -SEEK_STEP_S : SEEK_STEP_S, left ? 'l' : 'r'); return; }
    lastTap.current = { t: now, x };
  };
  const onCancel = () => { clearTimeout(holdTimer.current); down.current = null; if (holdRef.current) endHold(); };

  // --- the room's Google-player choice ---
  const requestMode = (m: 'auto' | 'manual') => {
    if (!setDriveMode) return;
    setPending(m); setNote('');
    setDriveMode(m, (err) => { if (alive.current) { setPending(''); if (err) setNote(err); } });
  };

  if (!id) return <div className="grid h-full w-full place-items-center bg-black p-6 text-center text-muted">Paste a video link in the Queue to start.</div>;
  if (roomManual) return <div className="relative h-full w-full bg-black">
    <iframe key={`embed-${id}`} title="Google Drive video" src={drivePreviewUrl(id)} className="h-full w-full border-0" allow="autoplay; fullscreen; encrypted-media" allowFullScreen />
    <ManualSync socket={socket} canControl={canControl} onBack={() => requestMode('auto')} />
    {overlay}
    {note && <span role="alert" className="pointer-events-none absolute bottom-3 left-1/2 z-[12] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-accent">{note}</span>}
  </div>;

  return <div ref={root} className="group relative h-full w-full select-none overflow-hidden bg-black"
    style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onPointerLeave={onCancel}
    onContextMenu={(e) => e.preventDefault()}>
    {(phase === 'loading' || phase === 'ready') && src && <video key={vkey} ref={vid} src={src} className="h-full w-full bg-black object-contain" playsInline preload="auto"
      onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onWaiting={onWaiting} onPlaying={onPlaying} onCanPlay={() => setBuf(reducePlayer(curSnap(), { type: 'canplay' }).buffering)}
      onPause={onPause} onSeeked={() => snap()} onRateChange={() => snap()} onError={onError} onEnded={() => socket.emit('video:ended', id)} />}

    {phase === 'probe' && <div className="grid h-full w-full place-items-center"><span className="rounded-full bg-black/60 px-3 py-1 text-xs text-muted">Checking the file…</span></div>}
    {phase === 'loading' && <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="rounded-full bg-black/60 px-3 py-1 text-xs text-muted">Trying to load ({attemptNo}/{MAX_ATTEMPTS})</span></div>}
    {phase === 'ready' && buffering && <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="rounded-full bg-black/60 px-3 py-1 text-xs text-muted">Buffering…</span></div>}

    {holding && <span className="pointer-events-none absolute left-1/2 top-3 z-[12] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold">2× while held</span>}
    {flash && <div key={flash.n} className={cx('pointer-events-none absolute inset-y-0 z-[12] grid w-1/2 place-items-center animate-[driveFlash_.7s_ease-out_forwards]', flash.side === 'l' ? 'left-0' : 'right-0')}>
      <span className="rounded-full bg-black/60 px-4 py-2 text-sm font-semibold">{flash.side === 'l' ? '« 10 s' : '10 s »'}</span></div>}

    {phase === 'ready' && <DriveControls visible={!playing || showUI} playing={playing} time={time} duration={duration} muted={muted} fs={fs}
      canControl={canControl} speed={playback.rate} onToggle={togglePlay} onSeek={seekTo} onMute={toggleMute} onFs={toggleFs} onSpeed={setSpeed} />}

    {phase === 'failed' && failure && <div data-ui className="absolute inset-0 z-[14] grid place-items-center bg-black/80 p-5 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-base font-semibold">This video couldn’t be played</p>
        <p className="text-sm text-muted">{failure.message}</p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {!failure.permanent && <button onClick={startFlow} className="min-h-[40px] rounded-full bg-primary px-4 text-sm font-semibold text-white">Try again</button>}
          {setDriveMode && (canControl
            ? <button onClick={() => requestMode('manual')} disabled={!!pending} className="min-h-[40px] rounded-full bg-surface2 px-4 text-sm font-semibold disabled:opacity-50">{pending ? 'Switching…' : 'Use Google’s player for the room'}</button>
            : <p className="text-xs text-muted">Ask the host to switch the room to Google’s player.</p>)}
        </div>
        {note && <p role="alert" className="text-xs text-accent">{note}</p>}
      </div></div>}
  {overlay}
  </div>;
}
