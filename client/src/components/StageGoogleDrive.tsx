'use client';
import { useEffect, useRef, useState } from 'react';
import type { StageProps } from '@/lib/types';
import { DRIVE_KEY } from '@/lib/party';
import ManualSync from './ManualSync';

// Streamed by each viewer's own browser, straight from Google. Our server never sees the video.
// The browser asks Google for byte ranges as needed, so seeking into a long film is quick.
const mediaUrl = (id: string) => `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(DRIVE_KEY)}`;
const previewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
const START_LIMIT_MS = 20000; // no first frame in this time: slow link or Google refusing: use the embed instead
const RETRIES = 2;           // dropped connections are resumed at the same place this many times

/**
 * Synced mode: a plain <video> on the Drive file, kept in sync like the other players (play, pause, seek, position).
 * Manual Sync Mode: if Google will not stream the file (unsupported codec, a download limit, not shared, or no API key),
 * we show Google's own player instead. That player cannot be controlled from outside, so the host gets a 3-2-1 countdown.
 */
export default function StageGoogleDrive({ socket, playback, current, emitPlayback, onDrift, onManual, interacted, canControl }: StageProps) {
  const id = current?.id ?? '';
  const vid = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState(!DRIVE_KEY), [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0);
  const [buffering, setBuffering] = useState(false), [reason, setReason] = useState('');
  const lastT = useRef(0), resumeAt = useRef(0), retries = useRef(0), retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pbRef = useRef(playback); pbRef.current = playback;
  const inter = useRef(interacted); inter.current = interacted;
  const emit = useRef(emitPlayback); emit.current = emitPlayback;
  const driftRef = useRef(onDrift); driftRef.current = onDrift;
  const lastPlayCmd = useRef(0), until = useRef(0), forcedMute = useRef(false);
  const expected = () => { const p = pbRef.current; return p.time + (p.playing ? ((Date.now() - p.at) / 1000) * p.rate : 0); };
  const remote = () => Date.now() < until.current;
  const act = (fn: () => void, ms = 1500) => { until.current = Date.now() + ms; try { fn(); } catch {} };

  useEffect(() => { // a new video starts fresh
    setManual(!DRIVE_KEY); setReady(false); setAttempt(0); setBuffering(false); setReason('');
    retries.current = 0; resumeAt.current = 0; lastT.current = 0; clearTimeout(retryTimer.current);
  }, [id]);
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  useEffect(() => { onManual?.(manual && !!id); return () => onManual?.(false); }, [manual, id]); // eslint-disable-line
  useEffect(() => { // no first frame in time: switch to Google's player rather than spin forever
    if (manual || !id || ready) return;
    const t = setTimeout(() => { setReason('The video didn’t start in time. Check the connection.'); setManual(true); }, START_LIMIT_MS);
    return () => clearTimeout(t);
  }, [manual, id, ready, attempt]); // eslint-disable-line

  const apply = () => {
    const v = vid.current; if (!v || !ready || manual) return;
    const pb = pbRef.current;
    if (pb.playing && !inter.current && !v.muted) { v.muted = true; forcedMute.current = true; } // browsers only allow muted autoplay until the first tap
    if (Math.abs(v.currentTime - expected()) > 0.8) act(() => { v.currentTime = expected(); });
    if (v.playbackRate !== pb.rate) act(() => { v.playbackRate = pb.rate; });
    if (pb.playing && v.paused) { lastPlayCmd.current = Date.now(); act(() => { void v.play().catch(() => {}); }); }
    else if (!pb.playing && !v.paused) act(() => v.pause());
  };
  useEffect(() => { apply(); }, [playback, ready, manual]); // eslint-disable-line
  useEffect(() => { // the first tap on this page unmutes
    if (interacted && forcedMute.current && vid.current) { forcedMute.current = false; vid.current.muted = false; }
  }, [interacted]);
  useEffect(() => { // verify drift every second (feeds the Sync indicator), correct every 3 seconds
    let n = 0;
    const t = setInterval(() => {
      const v = vid.current; if (!v || !ready || manual) return; n++;
      driftRef.current?.(Math.abs(v.currentTime - expected()));
      if (remote()) return;
      if (pbRef.current.playing && v.paused && inter.current && Date.now() - lastPlayCmd.current > 4000) apply(); // a play that was refused earlier: retry
      else if (n % 3 === 0 && pbRef.current.playing && Math.abs(v.currentTime - expected()) > 0.8) act(() => { v.currentTime = expected(); });
    }, 1000);
    return () => clearInterval(t);
  }, [ready, manual]); // eslint-disable-line

  const snap = () => { // only a real user action is broadcast; echoes of a command we applied (or a refused autoplay) are not
    const v = vid.current; if (!v || remote() || !ready) return;
    const playing = !v.paused, room = pbRef.current, recent = Date.now() - lastPlayCmd.current < 8000;
    if (playing === room.playing && v.playbackRate === room.rate && (recent || Math.abs(v.currentTime - expected()) < 1.5)) return;
    if (!playing && room.playing && !inter.current && recent) return;
    emit.current({ playing, time: v.currentTime, rate: v.playbackRate });
  };

  const onLoaded = () => {
    setReady(true);
    const v = vid.current; if (v && resumeAt.current > 0) { v.currentTime = resumeAt.current; resumeAt.current = 0; }
  };
  const onError = () => {
    const code = vid.current?.error?.code; // 2 network, 3 decode, 4 source: unsupported format, or Google refused the file
    if (code === 2 && retries.current < RETRIES) { // dropped connection: resume at the same place
      retries.current += 1; resumeAt.current = lastT.current; setReady(false); setBuffering(true);
      clearTimeout(retryTimer.current); retryTimer.current = setTimeout(() => setAttempt((n) => n + 1), 1500); return;
    }
    setReason(code === 3 ? 'This browser can’t decode this video’s format.'
      : code === 2 ? 'The connection to Google Drive keeps failing.'
      : 'Google Drive won’t stream this file (unsupported format, a download limit, or the file isn’t shared publicly).');
    setManual(true);
  };

  if (!id) return <div className="grid h-full w-full place-items-center bg-black p-6 text-center text-muted">Paste a video link in the Queue to start.</div>;
  return <div className="relative h-full w-full bg-black">
    {manual
      ? <iframe key={`embed-${id}`} title="Google Drive video" src={previewUrl(id)} className="h-full w-full border-0" allow="autoplay; fullscreen; encrypted-media" allowFullScreen />
      : <video key={`${id}-${attempt}`} ref={vid} src={mediaUrl(id)} className="h-full w-full bg-black object-contain" playsInline preload="auto" controls={canControl}
          onLoadedMetadata={onLoaded} onTimeUpdate={() => { if (vid.current) lastT.current = vid.current.currentTime; }}
          onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onCanPlay={() => setBuffering(false)}
          onError={onError} onPlay={snap} onPause={snap} onSeeked={snap} onRateChange={snap} onEnded={() => socket.emit('video:ended', id)} />}
    {!manual && (!ready || buffering) && <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-muted">{ready ? 'Buffering…' : 'Loading video…'}</span>}
    {manual && <ManualSync socket={socket} canControl={canControl} />}
    {manual && reason && <span className="pointer-events-none absolute bottom-3 left-1/2 z-[12] w-[90%] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-center text-xs text-muted">{reason}</span>}
  </div>;
}
