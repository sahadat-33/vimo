'use client';
import { useEffect, useRef } from 'react';
import type { StageProps } from '@/lib/types';

declare global { interface Window { YT: any; onYouTubeIframeAPIReady?: () => void } }
const loadYT = () => new Promise<void>((res) => {
  if (window.YT?.Player) return res();
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
  if (!document.getElementById('yt-api')) { const s = document.createElement('script'); s.id = 'yt-api'; s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s); }
});

export default function StageYouTube({ playback, current, emitPlayback }: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const remote = useRef(false);            // isRemoteUpdate mutex
  const pbRef = useRef(playback); pbRef.current = playback;
  const lastT = useRef(0);
  const emit = useRef(emitPlayback); emit.current = emitPlayback;

  const expected = () => { const p = pbRef.current; return p.time + (p.playing ? ((Date.now() - p.at) / 1000) * p.rate : 0); };
  const withRemote = (fn: () => void) => { remote.current = true; fn(); setTimeout(() => (remote.current = false), 700); };
  const snapshot = (playing: boolean) => ({ playing, time: player.current?.getCurrentTime?.() ?? 0, rate: player.current?.getPlaybackRate?.() ?? 1 });

  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setInterval>, n = 0;
    loadYT().then(() => {
      if (dead || !host.current) return;
      const el = document.createElement('div'); host.current.replaceChildren(el);
      player.current = new window.YT.Player(el, { width: '100%', height: '100%', videoId: current?.id,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => withRemote(() => { player.current.seekTo(expected(), true); if (pbRef.current.playing) player.current.playVideo(); }),
          onStateChange: (e: any) => {
            if (remote.current) return;
            if (e.data === 1) emit.current(snapshot(true));
            if (e.data === 2) emit.current(snapshot(false));
          },
          onPlaybackRateChange: () => { if (!remote.current) emit.current(snapshot(player.current.getPlayerState() === 1)); },
        } });
      timer = setInterval(() => {
        const p = player.current; if (!p?.getCurrentTime) return;
        const t = p.getCurrentTime(); n++;
        if (!remote.current && Math.abs(t - lastT.current) > 1.6 && pbRef.current.playing) emit.current(snapshot(true)); // local seek
        else if (n % 3 === 0 && !remote.current && Math.abs(t - expected()) > 0.8) withRemote(() => p.seekTo(expected(), true)); // drift heartbeat
        lastT.current = t;
      }, 1000);
    });
    return () => { dead = true; clearInterval(timer); player.current?.destroy?.(); player.current = null; };
  }, []); // eslint-disable-line

  useEffect(() => { // apply remote state
    const p = player.current; if (!p?.getPlayerState) return;
    withRemote(() => {
      if (current && p.getVideoData?.().video_id !== current.id) p.loadVideoById(current.id, expected());
      else if (Math.abs(p.getCurrentTime() - expected()) > 0.8) p.seekTo(expected(), true);
      if (p.getPlaybackRate() !== playback.rate) p.setPlaybackRate(playback.rate);
      const st = p.getPlayerState();
      if (playback.playing && st !== 1) p.playVideo(); else if (!playback.playing && st === 1) p.pauseVideo();
    });
  }, [playback, current?.id]); // eslint-disable-line

  return <div className="relative h-full w-full">
    <div ref={host} className="h-full w-full [&_iframe]:h-full [&_iframe]:w-full" />
    {!current && <p className="absolute inset-0 grid place-items-center p-6 text-center text-cream/70">Paste a YouTube link in the Queue tab to start.</p>}
  </div>;
}
