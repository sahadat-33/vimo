'use client';
import { useEffect, useRef, useState } from 'react';
import { FileVideo, RefreshCw, Upload, X } from 'lucide-react';
import type { StageProps } from '@/lib/types';

const EXT: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo' };
const typeOf = (f: File) => f.type || EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || '';
const fmt = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`);
const Bar = ({ pct }: { pct: number }) => <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-surface2"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>;

/** One person uploads the video to shared storage; every participant's player loads the same file and stays in sync through the room playback state. */
export default function StageLocalFile({ socket, playback, emitPlayback, onDrift, interacted, file }: StageProps) {
  const vid = useRef<HTMLVideoElement>(null), xhr = useRef<XMLHttpRequest | null>(null), lastFile = useRef<File | null>(null);
  const until = useRef(0), aborted = useRef(false), retried = useRef(false), forcedMute = useRef(false);
  const pbRef = useRef(playback); pbRef.current = playback;
  const inter = useRef(interacted); inter.current = interacted;
  const emit = useRef(emitPlayback); emit.current = emitPlayback;
  const driftRef = useRef(onDrift); driftRef.current = onDrift;
  const [up, setUp] = useState<{ pct: number; loaded: number; total: number } | null>(null);
  const [others, setOthers] = useState<{ name: string; pct: number } | null>(null);
  const [msg, setMsg] = useState(''), [unset, setUnset] = useState(false);
  const [localUrl, setLocalUrl] = useState(''), [fresh, setFresh] = useState('');
  const src = fresh || file?.url || localUrl;

  const expected = () => { const p = pbRef.current; return p.time + (p.playing ? ((Date.now() - p.at) / 1000) * p.rate : 0); };
  const remote = () => Date.now() < until.current;
  const act = (fn: () => void) => { until.current = Date.now() + 900; try { fn(); } catch {} };
  const apply = () => { // bring the <video> in line with the room: position, speed, play or pause
    const v = vid.current, pb = pbRef.current; if (!v || !v.src || v.readyState < 1) return;
    if (pb.playing && !inter.current && !v.muted) { v.muted = true; forcedMute.current = true; } // muted autoplay is always allowed
    const t = expected();
    if (Math.abs(v.currentTime - t) > 0.8) act(() => { v.currentTime = t; });
    if (v.playbackRate !== pb.rate) act(() => { v.playbackRate = pb.rate; });
    if (pb.playing && v.paused) act(() => { v.play().catch(() => {}); });
    else if (!pb.playing && !v.paused) act(() => v.pause());
  };
  const snap = () => { const v = vid.current; if (v && !remote()) emit.current({ playing: !v.paused, time: v.currentTime, rate: v.playbackRate }); };

  useEffect(() => { apply(); }, [playback]); // eslint-disable-line
  useEffect(() => { // first tap: restore sound
    if (interacted && forcedMute.current && vid.current) { vid.current.muted = false; forcedMute.current = false; }
    apply();
  }, [interacted]); // eslint-disable-line
  useEffect(() => { setFresh(''); retried.current = false; setOthers(null); if (file) setMsg(''); }, [file?.name, file?.size]); // eslint-disable-line
  useEffect(() => { // progress of someone else's upload
    let t: ReturnType<typeof setTimeout>;
    const f = (d: { name: string; pct: number }) => { clearTimeout(t); if (d.pct < 0) return setOthers(null); setOthers({ name: d.name, pct: d.pct }); t = setTimeout(() => setOthers(null), 30000); };
    socket.on('file:uploading', f); return () => { clearTimeout(t); socket.off('file:uploading', f); };
  }, [socket]);
  useEffect(() => { // verify drift every second (feeds the Sync chip), correct every 3 seconds, retry a play that the browser blocked
    let n = 0;
    const t = setInterval(() => {
      const v = vid.current; if (!v || !v.src || v.readyState < 1) return; n++;
      driftRef.current?.(Math.abs(v.currentTime - expected()));
      if (remote()) return;
      if (pbRef.current.playing && v.paused && inter.current) return apply();
      if (n % 3 === 0 && pbRef.current.playing && Math.abs(v.currentTime - expected()) > 0.8) act(() => { v.currentTime = expected(); });
    }, 1000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line
  useEffect(() => { // do not let a tab close silently kill an upload
    if (!up) return; const f = (e: BeforeUnloadEvent) => { e.preventDefault(); }; addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f);
  }, [!!up]); // eslint-disable-line
  useEffect(() => () => { xhr.current?.abort(); }, []);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  async function upload(f: File) {
    lastFile.current = f; aborted.current = false; setMsg(''); setUnset(false);
    const type = typeOf(f);
    if (!type.startsWith('video/')) return setMsg('Please choose a video file. MP4 works best.');
    const prep = await new Promise<{ error?: string; uploadUrl?: string; key?: string }>((res) => socket.emit('file:prepare', { name: f.name, type, size: f.size }, res));
    if (prep.error === 'not_configured') return setUnset(true);
    if (prep.error || !prep.uploadUrl || !prep.key) return setMsg(prep.error || 'Could not start the upload.');
    setUp({ pct: 0, loaded: 0, total: f.size });
    let last = -10;
    const sent = await new Promise<boolean>((res) => {
      const x = new XMLHttpRequest(); xhr.current = x;
      x.open('PUT', prep.uploadUrl!); x.setRequestHeader('Content-Type', type);
      x.upload.onprogress = (e) => {
        if (!e.lengthComputable) return; const pct = Math.round((e.loaded / e.total) * 100); setUp({ pct, loaded: e.loaded, total: e.total });
        if (pct - last >= 2 || pct === 100) { last = pct; socket.emit('file:progress', pct); }
      };
      x.onload = () => res(x.status >= 200 && x.status < 300); x.onerror = () => res(false); x.onabort = () => res(false); x.send(f);
    });
    xhr.current = null;
    if (!sent) { socket.emit('file:progress', -1); setUp(null); if (!aborted.current) setMsg('The upload failed. Check your connection and retry. If it keeps failing, the storage bucket’s CORS rule is probably missing.'); return; }
    const done = await new Promise<{ ok?: boolean; error?: string }>((res) => socket.emit('file:ready', prep.key!, res));
    socket.emit('file:progress', -1); setUp(null);
    if (!done.ok) setMsg(done.error || 'The server could not confirm the upload.');
  }
  const cancel = () => { aborted.current = true; xhr.current?.abort(); };
  const openLocal = (f: File) => { setLocalUrl(URL.createObjectURL(f)); setUnset(false); };
  const onErr = () => { // an expired link gets one refresh; otherwise the browser simply cannot decode this file
    if (file && !retried.current) { retried.current = true; socket.emit('file:refresh', (r) => { if (r.file) setFresh(r.file.url); }); return; }
    setMsg('This browser can’t play this video. MP4 (H.264 video + AAC audio) works everywhere; MKV and AVI often don’t.');
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>, local?: boolean) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) (local ? openLocal(f) : upload(f)); };
  const btn = 'cursor-pointer rounded-full bg-primary px-5 py-2.5 font-semibold text-white shadow-glow';

  return <div className="relative h-full w-full bg-black">
    <video ref={vid} src={src || undefined} className="h-full w-full object-contain" playsInline preload="auto" controls={!!src}
      onLoadedMetadata={apply} onCanPlay={apply} onPlay={snap} onPause={snap} onSeeked={snap} onRateChange={snap} onError={src ? onErr : undefined} />
    {!src && <div className="absolute inset-0 grid place-items-center overflow-y-auto p-5 text-center"><div className="flex max-w-sm flex-col items-center gap-3 text-muted">
      <FileVideo size={36} className="text-secondary" />
      {up ? null : others ? <><p><span className="font-semibold text-ink">{others.name}</span> is uploading a video…</p><Bar pct={others.pct} /><p className="text-xs">{others.pct}%. It will start for everyone automatically.</p></>
        : <><p className="text-base font-semibold text-ink">Share a video with everyone</p>
          <p className="text-sm">Pick a video once. It uploads to the room and plays for everyone automatically. Nobody else needs the file. MP4 works best.</p>
          <label className={btn}>Choose video<input type="file" accept="video/*" className="sr-only" onChange={pick} /></label></>}
      {unset && <div role="alert" className="space-y-2 rounded-xl bg-surface p-3 text-left text-sm"><p className="text-accent">Shared upload isn’t set up on this server yet.</p>
        <p>The host needs to add the storage settings (see the setup notes). Until then you can watch together if everyone opens the same file on their own device.</p>
        <label className="inline-block cursor-pointer rounded-full bg-surface2 px-4 py-2 font-semibold text-ink">Open a file from this device<input type="file" accept="video/*" className="sr-only" onChange={(e) => pick(e, true)} /></label></div>}
      {msg && <p role="alert" className="text-sm text-accent">{msg}</p>}
      {msg && lastFile.current && !up && <button onClick={() => upload(lastFile.current!)} className="inline-flex items-center gap-2 rounded-full bg-surface2 px-4 py-2 text-sm font-semibold text-ink"><RefreshCw size={14} /> Retry upload</button>}
    </div></div>}
    {up && <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 bg-black/80 p-4 text-center text-sm">
      <p className="font-semibold text-ink">Uploading for everyone · {up.pct}%</p><Bar pct={up.pct} />
      <p className="text-xs text-muted">{fmt(up.loaded)} of {fmt(up.total)}. Keep this tab open until it finishes.</p>
      <button onClick={cancel} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-3 py-1 text-xs font-semibold"><X size={12} /> Cancel</button></div>}
    {src && !up && <label className="absolute left-2 top-2 z-20 flex cursor-pointer items-center gap-1 rounded-lg bg-black/50 px-2.5 py-1.5 text-xs opacity-70 transition hover:opacity-100"><Upload size={14} /> Change video
      <input type="file" accept="video/*" className="sr-only" onChange={pick} /></label>}
    {src && msg && !up && <p role="alert" className="absolute inset-x-2 bottom-12 z-20 rounded-lg bg-black/80 p-2 text-center text-xs text-accent">{msg}</p>}
  </div>;
}
