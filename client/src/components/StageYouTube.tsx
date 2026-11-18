'use client';
import { useEffect, useRef, useState } from 'react';
import { SkipForward } from 'lucide-react';
import type { StageProps } from '@/lib/types';

declare global { interface Window { YT: any; onYouTubeIframeAPIReady?: () => void } }
const loadYT = () => new Promise<void>((res, rej) => {
  if (window.YT?.Player) return res();
  const prev = window.onYouTubeIframeAPIReady, timer = setTimeout(() => rej(new Error('timeout')), 20000);
  window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); prev?.(); res(); };
  if (!document.getElementById('yt-api')) {
    const s = document.createElement('script'); s.id = 'yt-api'; s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(timer); s.remove(); rej(new Error('blocked')); }; document.head.appendChild(s);
  }
});
const OWNER = 'The owner doesn’t allow this video to be played outside YouTube.';
const YT_ERR: Record<number, string> = { 2: 'That YouTube link isn’t valid.', 5: 'Your browser couldn’t play this video. Reload the page and try again.',
  100: 'This video was removed or is private.', 101: OWNER, 150: OWNER, 153: 'YouTube refused to load the player here. Reload the page and try again.' };

export default function StageYouTube({ socket, playback, current, emitPlayback, onDrift, interacted }: StageProps) {
  const host = useRef<HTMLDivElement>(null), player = useRef<any>(null), ready = useRef(false);
  const until = useRef(0);                       // isRemoteUpdate mutex: local player events are ignored until this time
  const lastTick = useRef({ t: 0, at: 0 });
  const lastPlayCmd = useRef(0), pauseT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); // when WE last told the player to play; pending 'is this pause real?' check
  const forcedMute = useRef(false);              // we muted the player only because the browser blocks sound before a tap
  const pbRef = useRef(playback); pbRef.current = playback;
  const curRef = useRef(current); curRef.current = current;
  const inter = useRef(interacted); inter.current = interacted;
  const emit = useRef(emitPlayback); emit.current = emitPlayback;
  const driftRef = useRef(onDrift); driftRef.current = onDrift;
  const [err, setErr] = useState(''), [loadFail, setLoadFail] = useState(false), [attempt, setAttempt] = useState(0);

  const expected = () => { const p = pbRef.current; return p.time + (p.playing ? ((Date.now() - p.at) / 1000) * p.rate : 0); };
  const remote = () => Date.now() < until.current;
  const act = (fn: () => void, ms = 1500) => { until.current = Date.now() + ms; lastTick.current = { t: 0, at: 0 }; try { fn(); } catch {} };
  const snapshot = (playing: boolean) => ({ playing, time: player.current?.getCurrentTime?.() ?? 0, rate: player.current?.getPlaybackRate?.() ?? 1 });

  /** Bring the player in line with the room state. Safe to call at any time; it only touches the player when something differs. */
  const apply = () => {
    const p = player.current; if (!ready.current || !p) return;
    const cur = curRef.current, pb = pbRef.current;
    if (!cur) { if (p.getPlayerState?.() === 1) act(() => p.pauseVideo()); return; }
    if (pb.playing && !inter.current && !p.isMuted?.()) { p.mute(); forcedMute.current = true; } // muted autoplay is always allowed
    if (p.getVideoData?.().video_id !== cur.id) {
      setErr(''); if (pb.playing) lastPlayCmd.current = Date.now(); act(() => (pb.playing ? p.loadVideoById(cur.id, expected()) : p.cueVideoById(cur.id, expected())), 4000); return;
    }
    if (Math.abs(p.getCurrentTime() - expected()) > 0.8) act(() => p.seekTo(expected(), true));
    if (p.getPlaybackRate() !== pb.rate) act(() => p.setPlaybackRate(pb.rate));
    const st = p.getPlayerState();
    if (pb.playing && st !== 1 && st !== 3 && st !== 0) { lastPlayCmd.current = Date.now(); act(() => p.playVideo()); }
    else if (!pb.playing && (st === 1 || st === 3)) act(() => p.pauseVideo());
  };

  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setInterval> | undefined, n = 0;
    setErr(''); setLoadFail(false);
    loadYT().then(() => {
      if (dead || !host.current) return;
      try {
      const el = document.createElement('div'); host.current.innerHTML = ''; host.current.appendChild(el);
      player.current = new window.YT.Player(el, { width: '100%', height: '100%', videoId: curRef.current?.id,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: () => { ready.current = true; apply(); },
          onStateChange: (e: any) => {
            if (e.data === 0 && curRef.current) socket.emit('video:ended', curRef.current.id); // the server ignores duplicates, so every client can report it
            if (e.data !== 1 && e.data !== 2) { clearTimeout(pauseT.current); return; } // buffering etc. cancels a pending pause
            if (remote()) return;
            clearTimeout(pauseT.current);
            // Only a real user action may reach the other people. Echoes of a command we just applied, and a browser refusing
            // to autoplay, must never be broadcast, or every device keeps stopping and starting the others.
            const playing = e.data === 1, room = pbRef.current, t = player.current?.getCurrentTime?.() ?? 0;
            if (playing === room.playing && (Date.now() - lastPlayCmd.current < 8000 || Math.abs(t - expected()) < 1.5)) return;
            if (playing) { emit.current(snapshot(true)); return; }
            if (!room.playing) return;
            pauseT.current = setTimeout(() => { // wait a moment: seeking and buffering cause brief pauses that nobody pressed
              const q = player.current; if (!q || q.getPlayerState?.() !== 2 || remote()) return;
              if (!inter.current && Date.now() - lastPlayCmd.current < 8000) return; // autoplay was refused on this device
              emit.current(snapshot(false));
            }, 400);
          },
          onPlaybackRateChange: () => { const q = player.current; if (!remote() && q && q.getPlaybackRate() !== pbRef.current.rate) emit.current(snapshot(q.getPlayerState() === 1)); },
          onError: (e: any) => setErr(YT_ERR[e.data as number] ?? `YouTube couldn’t play this video (error ${e.data}).`),
        } });
      timer = setInterval(() => {
        const p = player.current; if (!ready.current || !p?.getCurrentTime) return;
        const now = Date.now(), t = p.getCurrentTime(), st = p.getPlayerState(), last = lastTick.current; n++;
        lastTick.current = { t, at: now };
        if (!curRef.current || p.getVideoData?.().video_id !== curRef.current.id) return;
        driftRef.current?.(Math.abs(t - expected())); // measured drift feeds the Sync indicator
        if (remote() || st === 3) return;
        const adv = st === 1 ? ((now - last.at) / 1000) * (p.getPlaybackRate?.() ?? 1) : 0;
        if (last.at && Math.abs(t - last.t - adv) > 1.5) emit.current(snapshot(st === 1));       // this user scrubbed (playing or paused): tell everyone
        else if (n % 3 === 0 && Math.abs(t - expected()) > 0.8) act(() => p.seekTo(expected(), true)); // drift heartbeat
      }, 1000);
      } catch (e) { setLoadFail(true); setErr(`The YouTube player couldn’t start (${e instanceof Error ? e.message : 'unknown error'}). Tap Retry.`); }
    }, (e: Error) => {
      if (dead) return; setLoadFail(true);
      setErr(e.message === 'timeout' ? 'YouTube took too long to load. Check your connection, then tap Retry.'
        : 'YouTube’s player script was blocked. An ad blocker, private DNS or browser shield may be stopping youtube.com. Allow it for this site, then tap Retry.');
    });
    return () => { dead = true; ready.current = false; clearInterval(timer); clearTimeout(pauseT.current); player.current?.destroy?.(); player.current = null; };
  }, [attempt]); // eslint-disable-line

  useEffect(() => { apply(); }, [playback, current?.id]); // eslint-disable-line
  useEffect(() => { // first tap: restore sound that was muted only to satisfy the autoplay rule
    if (interacted && forcedMute.current) { forcedMute.current = false; try { player.current?.unMute?.(); } catch {} }
    apply();
  }, [interacted]); // eslint-disable-line

  return <div className="relative h-full w-full">
    <div ref={host} className="h-full w-full [&_iframe]:h-full [&_iframe]:w-full" />
    {!current && !err && <p className="absolute inset-0 grid place-items-center p-6 text-center text-cream/70">Paste a video link in the Queue to start.</p>}
    {err && <div className="absolute inset-0 z-10 grid place-items-center bg-black/85 p-6 text-center"><div className="max-w-sm space-y-3">
      <p role="alert" className="text-sm">{err}</p>
      {loadFail && <button onClick={() => { document.getElementById('yt-api')?.remove(); setAttempt((n) => n + 1); }} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white">Retry</button>}
      {current && !loadFail && <button onClick={() => socket.emit('video:ended', current.id)} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white"><SkipForward size={16} /> Skip this video</button>}</div></div>}
  </div>;
}
