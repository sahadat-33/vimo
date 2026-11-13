'use client';
import { useEffect, useRef, useState } from 'react';
import { FileVideo } from 'lucide-react';
import type { StageProps } from '@/lib/types';

// Everyone opens the same file on their own device. Play, pause, seek and drift are synced through Socket.io.
export default function StageLocalFile({ playback, emitPlayback, onDrift }: StageProps) {
  const driftRef = useRef(onDrift); driftRef.current = onDrift;
  const vid = useRef<HTMLVideoElement>(null);
  const remote = useRef(false);
  const [name, setName] = useState('');
  const pbRef = useRef(playback); pbRef.current = playback;
  const emit = useRef(emitPlayback); emit.current = emitPlayback;
  const expected = () => { const p = pbRef.current; return p.time + (p.playing ? ((Date.now() - p.at) / 1000) * p.rate : 0); };
  const withRemote = (fn: () => void) => { remote.current = true; fn(); setTimeout(() => (remote.current = false), 700); };

  useEffect(() => {
    const v = vid.current; if (!v || !name) return;
    withRemote(() => {
      if (Math.abs(v.currentTime - expected()) > 0.8) v.currentTime = expected();
      v.playbackRate = playback.rate;
      if (playback.playing && v.paused) v.play().catch(() => {}); else if (!playback.playing && !v.paused) v.pause();
    });
  }, [playback, name]);

  useEffect(() => { // verify drift every 1s (feeds the Sync indicator), correct every 3s
    let n = 0;
    const t = setInterval(() => {
      const v = vid.current; if (!v || !v.src) return; n++;
      driftRef.current?.(Math.abs(v.currentTime - expected()));
      if (remote.current || !pbRef.current.playing) return;
      if (n % 3 === 0 && Math.abs(v.currentTime - expected()) > 0.8) withRemote(() => { v.currentTime = expected(); });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const snap = () => { const v = vid.current!; if (!remote.current) emit.current({ playing: !v.paused, time: v.currentTime, rate: v.playbackRate }); };
  function pick(f?: File) { if (!f || !vid.current) return; vid.current.src = URL.createObjectURL(f); setName(f.name); }

  return <div className="relative h-full w-full bg-black">
    <video ref={vid} className="h-full w-full object-contain" playsInline controls={!!name}
      onPlay={snap} onPause={snap} onSeeked={snap} onRateChange={snap} />
    {!name && <label className="absolute inset-0 grid cursor-pointer place-items-center p-6 text-center">
      <span className="flex max-w-xs flex-col items-center gap-3 text-cream/80"><FileVideo size={36} />
        Everyone picks the same video file on their own device. Playback stays in sync, and nothing is uploaded.
        <span className="rounded-full bg-blush px-4 py-2 font-semibold text-night">Choose video file</span></span>
      <input type="file" accept="video/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} /></label>}
  </div>;
}
