'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StageProps } from '@/lib/types';
import { DRIVE_KEY } from '@/lib/party';
import { drivePreviewUrl, driveSources, expectedTime, needsCorrection } from '@/lib/driveSync';
import DriveControls from './DriveControls';
import ManualSync from './ManualSync';

const START_LIMIT_MS = 20000; // no first frame in this time: try the next source
const RESUME_RETRIES = 2;     // a dropped connection resumes at the same place this many times per source
const STALL_PAUSE_MS = 1500;  // the host's stream stalled this long: pause the room so everyone waits, then carry on
const HIDE_UI_MS = 2500;      // the controls fade while playing and come back on any touch or movement

/**
 * Automatic sync (default): a plain <video> on the Drive file. The host's play, pause and seek are shared; guests follow.
 * Manual Sync Mode: only after every direct source has failed. Google's own player is then shown, which cannot be controlled
 * from outside, so the indicator and the 3-2-1 helper appear here and nowhere else.
 */
export default function StageGoogleDrive({ socket, playback, current, emitPlayback, onDrift, onManual, interacted, canControl }: StageProps) {
  const id = current?.id ?? '';
  const sources = useMemo(() => driveSources(id, DRIVE_KEY), [id]);
  const vid = useRef<HTMLVideoElement>(null), root = useRef<HTMLDivElement>(null);
  const [srcIdx, setSrcIdx] = useState(0), [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState(false), [ready, setReady] = useState(false), [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false), [fs, setFs] = useState(false), [showUI, setShowUI] = useState(true), [reason, setReason] = useState('');

  const pbRef = useRef(playback); pbRef.current = playback;
  const inter = useRef(interacted); inter.current = interacted;
  const emit = useRef(emitPlayback); emit.current = emitPlayback;
  const driftRef = useRef(onDrift); driftRef.current = onDrift;
  const canRef = useRef(canControl); canRef.current = canControl;
  const bufRef = useRef(false); bufRef.current = buffering;
  const lastPlayCmd = useRef(0), until = useRef(0), forcedMute = useRef(false), autoPaused = useRef(false);
  const resumeAt = useRef(0), retries = useRef(0), lastT = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expected = () => expectedTime(pbRef.current, Date.now());
  const remote = () => Date.now() < until.current;
  const act = (fn: () => void, ms = 1500) => { until.current = Date.now() + ms; try { fn(); } catch {} };

  useEffect(() => { // a new video starts fresh
    setSrcIdx(0); setAttempt(0); setManual(false); setReady(false); setBuffering(false); setPlaying(false); setTime(0); setDuration(0); setReason('');
    retries.current = 0; resumeAt.current = 0; lastT.current = 0; autoPaused.current = false;
    clearTimeout(retryTimer.current); clearTimeout(stallTimer.current);
  }, [id]);
  useEffect(() => () => { clearTimeout(retryTimer.current); clearTimeout(stallTimer.current); clearTimeout(hideTimer.current); }, []);
  useEffect(() => { onManual?.(manual && !!id); return () => onManual?.(false); }, [manual, id]); // eslint-disable-line

  function giveUp(why: string) {
    setReason(`${DRIVE_KEY ? '' : 'Google Drive’s API key isn’t set on this site. '}${why} Using Google’s own player.`);
    setManual(true);
  }
  function nextSource(why: string) {
    if (srcIdx + 1 < sources.length) { retries.current = 0; resumeAt.current = 0; setSrcIdx(srcIdx + 1); setAttempt((a) => a + 1); setReady(false); setBuffering(true); return; }
    giveUp(why);
  }
  useEffect(() => { // no first frame in time: try the next source
    if (manual || !id || ready) return;
    const t = setTimeout(() => nextSource('The video didn’t start in time.'), START_LIMIT_MS);
    return () => clearTimeout(t);
  }, [manual, id, ready, srcIdx, attempt]); // eslint-disable-line

  const apply = () => { // bring this viewer to the room's shared state
    const v = vid.current; if (!v || !ready || manual) return;
    const pb = pbRef.current;
    if (pb.playing && !inter.current && !v.muted) { v.muted = true; forcedMute.current = true; setMuted(true); } // muted autoplay until the first tap
    if (needsCorrection(v.currentTime, expected(), bufRef.current)) act(() => { v.currentTime = expected(); });
    if (v.playbackRate !== pb.rate) act(() => { v.playbackRate = pb.rate; });
    if (pb.playing && v.paused) { lastPlayCmd.current = Date.now(); act(() => { void v.play().catch(() => {}); }); }
    else if (!pb.playing && !v.paused) act(() => v.pause());
  };
  useEffect(() => { apply(); }, [playback, ready, manual]); // eslint-disable-line
  useEffect(() => { // the first tap on this page unmutes
    if (interacted && forcedMute.current && vid.current) { forcedMute.current = false; vid.current.muted = false; setMuted(false); }
  }, [interacted]);
  useEffect(() => { // every second: report drift for the Sync indicator; correct every 3 seconds, never while buffering
    let n = 0;
    const t = setInterval(() => {
      const v = vid.current; if (!v || !ready || manual) return; n++;
      const exp = expected();
      driftRef.current?.(Math.abs(v.currentTime - exp));
      if (remote() || bufRef.current) return;
      if (pbRef.current.playing && v.paused && inter.current && Date.now() - lastPlayCmd.current > 4000) apply(); // a refused play: retry
      else if (n % 3 === 0 && needsCorrection(v.currentTime, exp, false)) act(() => { v.currentTime = exp; });
    }, 1000);
    return () => clearInterval(t);
  }, [ready, manual]); // eslint-disable-line

  const snap = () => { // only the controller's real actions are shared; echoes of commands we applied are not
    const v = vid.current; if (!v || remote() || !ready || !canRef.current) return;
    const isPlaying = !v.paused, room = pbRef.current, recent = Date.now() - lastPlayCmd.current < 8000;
    if (isPlaying === room.playing && v.playbackRate === room.rate && (recent || Math.abs(v.currentTime - expected()) < 1.5)) return;
    if (!isPlaying && room.playing && !inter.current && recent) return;
    emit.current({ playing: isPlaying, time: v.currentTime, rate: v.playbackRate });
  };

  const onLoaded = () => {
    setReady(true); setBuffering(false);
    const v = vid.current; if (!v) return;
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    if (resumeAt.current > 0) { v.currentTime = resumeAt.current; resumeAt.current = 0; }
  };
  const onTime = () => { const v = vid.current; if (v) { lastT.current = v.currentTime; setTime(v.currentTime); } };
  const onWaiting = () => {
    setBuffering(true); clearTimeout(stallTimer.current);
    if (!canRef.current) return;
    stallTimer.current = setTimeout(() => { // the host's stream is stuck: pause the room so everyone waits
      const v = vid.current; if (!v || v.paused || !bufRef.current) return;
      autoPaused.current = true; emit.current({ playing: false, time: v.currentTime, rate: v.playbackRate });
    }, STALL_PAUSE_MS);
  };
  const onPlaying = () => {
    setBuffering(false); setPlaying(true); clearTimeout(stallTimer.current);
    const v = vid.current;
    if (autoPaused.current && canRef.current && v) { autoPaused.current = false; emit.current({ playing: true, time: v.currentTime, rate: v.playbackRate }); }
    else snap();
  };
  const onPause = () => {
    setPlaying(false); clearTimeout(stallTimer.current);
    if (autoPaused.current) return; // our own stall pause: the room is already paused
    snap();
  };
  const onError = () => {
    const code = vid.current?.error?.code; // 2 network, 3 decode, 4 source: unsupported format, or Google refused the file
    if (code === 2 && retries.current < RESUME_RETRIES) { // dropped connection: resume at the same place
      retries.current += 1; resumeAt.current = lastT.current; setReady(false); setBuffering(true);
      clearTimeout(retryTimer.current); retryTimer.current = setTimeout(() => setAttempt((n) => n + 1), 1500); return;
    }
    if (code === 3) return giveUp('This browser can’t decode this video’s format.');
    nextSource(code === 2 ? 'The connection to Google Drive keeps failing.' : 'Google Drive won’t stream this file (unsupported format, a download limit, or the file isn’t shared publicly).');
  };

  const togglePlay = () => { const v = vid.current; if (!v || !canRef.current) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); };
  const seekTo = (t: number) => { const v = vid.current; if (!v || !canRef.current) return; v.currentTime = t; setTime(t); }; // 'seeked' shares it
  const toggleMute = () => { const v = vid.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };
  useEffect(() => { const f = () => setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    const r = root.current;
    if (r && r.requestFullscreen) { r.requestFullscreen().catch(() => iosFullscreen()); return; } // our whole stage, so the chat bubbles stay visible
    iosFullscreen();
  };
  const iosFullscreen = () => { (vid.current as unknown as { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.(); }; // iPhone: the video alone, with Apple's controls
  const bump = () => { setShowUI(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowUI(false), HIDE_UI_MS); };

  if (!id) return <div className="grid h-full w-full place-items-center bg-black p-6 text-center text-muted">Paste a video link in the Queue to start.</div>;
  return <div ref={root} className="group relative h-full w-full overflow-hidden bg-black" onPointerMove={bump} onPointerDown={bump}>
    {manual
      ? <iframe key={`embed-${id}`} title="Google Drive video" src={drivePreviewUrl(id)} className="h-full w-full border-0" allow="autoplay; fullscreen; encrypted-media" allowFullScreen />
      : <video key={`${id}-${srcIdx}-${attempt}`} ref={vid} src={sources[srcIdx]} className="h-full w-full bg-black object-contain" playsInline preload="auto"
          onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onWaiting={onWaiting} onPlaying={onPlaying} onCanPlay={() => setBuffering(false)}
          onPause={onPause} onSeeked={() => snap()} onRateChange={() => snap()} onError={onError} onEnded={() => socket.emit('video:ended', id)} />}
    {!manual && <DriveControls visible={!playing || showUI} playing={playing} time={time} duration={duration} canControl={canControl} muted={muted} fs={fs}
      onToggle={togglePlay} onSeek={seekTo} onMute={toggleMute} onFs={toggleFs} />}
    {!manual && (!ready || buffering) && <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-muted">{ready ? 'Buffering…' : 'Loading video…'}</span></div>}
    {manual && <ManualSync socket={socket} canControl={canControl} />}
    {manual && reason && <span className="pointer-events-none absolute bottom-3 left-1/2 z-[12] w-[92%] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-center text-xs text-muted">{reason}</span>}
  </div>;
}
