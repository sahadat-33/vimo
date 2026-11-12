'use client';
import { useEffect, useRef, useState } from 'react';
import DailyIframe, { DailyCall, DailyParticipant } from '@daily-co/daily-js';
import { Mic, MicOff, Video, VideoOff, Zap } from 'lucide-react';
import { api } from '@/lib/socket';

function Tile({ p, round, style }: { p: DailyParticipant; round?: boolean; style?: React.CSSProperties }) {
  const v = useRef<HTMLVideoElement>(null);
  const vt = p.tracks.video.persistentTrack, at = p.tracks.audio.persistentTrack;
  useEffect(() => { if (v.current) v.current.srcObject = new MediaStream([vt, !p.local && at].filter(Boolean) as MediaStreamTrack[]); }, [vt, at, p.local]);
  return <div style={style} className={`relative overflow-hidden bg-dusk ${round ? 'rounded-full' : 'rounded-xl'} aspect-square sm:aspect-video`}>
    <video ref={v} autoPlay playsInline muted={p.local} className={`h-full w-full object-cover ${p.local ? '-scale-x-100' : ''}`} />
    {p.tracks.audio.state === 'off' ? <MicOff size={14} className="absolute bottom-1 right-1 text-ember" /> : null}
  </div>;
}

function Floating({ children }: { children: React.ReactNode }) {
  const [pos, setPos] = useState({ x: 12, y: 56 }); const d = useRef<{ dx: number; dy: number } | null>(null);
  return <div className="fixed z-40 touch-none" style={{ left: pos.x, top: pos.y, width: 96 }}
    onPointerDown={(e) => { d.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => d.current && setPos({ x: Math.max(0, Math.min(innerWidth - 96, e.clientX - d.current.dx)), y: Math.max(0, Math.min(innerHeight - 96, e.clientY - d.current.dy)) })}
    onPointerUp={() => (d.current = null)}>{children}</div>;
}

export default function VideoCallBar({ roomId, layout, playing, smartMic, setSmartMic }: {
  roomId: string; layout: 'desktop' | 'portrait' | 'landscape'; playing: boolean; smartMic: boolean; setSmartMic: (b: boolean) => void }) {
  const call = useRef<DailyCall | null>(null);
  const [parts, setParts] = useState<DailyParticipant[]>([]);
  const [mic, setMic] = useState(true), [cam, setCam] = useState(true), [err, setErr] = useState('');

  useEffect(() => {
    let dead = false; const c = DailyIframe.createCallObject({ audioSource: true, videoSource: true }); call.current = c;
    const upd = () => setParts(Object.values(c.participants()));
    c.on('participant-joined', upd).on('participant-updated', upd).on('participant-left', upd).on('joined-meeting', upd)
      .on('error', () => setErr('Call connection lost.'));
    (async () => {
      const r = await api(`/api/daily/${roomId}`); if (!r.ok) return setErr('Could not start the call. Check your Daily key.');
      const { url } = await r.json(); if (!dead) await c.join({ url }).catch(() => setErr('Camera or mic permission is needed to join the call.'));
    })();
    return () => { dead = true; c.destroy(); };
  }, [roomId]);

  // Smart Mic: playing = both muted, paused = both unmuted (each client applies the same rule to itself)
  useEffect(() => { if (smartMic && call.current) { call.current.setLocalAudio(!playing); setMic(!playing); } }, [playing, smartMic]);

  const tiles = parts.map((p) => <Tile key={p.session_id} p={p} round={layout === 'landscape'} />);
  const controls = <div className="flex items-center gap-2 p-2">
    <button aria-label={mic ? 'Mute mic' : 'Unmute mic'} onClick={() => { call.current?.setLocalAudio(!mic); setMic(!mic); }} className="rounded-full bg-plum p-2">{mic ? <Mic size={18} /> : <MicOff size={18} />}</button>
    <button aria-label={cam ? 'Camera off' : 'Camera on'} onClick={() => { call.current?.setLocalVideo(!cam); setCam(!cam); }} className="rounded-full bg-plum p-2">{cam ? <Video size={18} /> : <VideoOff size={18} />}</button>
    <button aria-pressed={smartMic} onClick={() => setSmartMic(!smartMic)} className={`flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold ${smartMic ? 'bg-blush text-night' : 'bg-plum'}`}>
      <Zap size={14} /> Smart Mic: {smartMic ? 'ON' : 'OFF'}</button>
    {err && <span role="alert" className="text-xs text-ember">{err}</span>}</div>;

  if (layout === 'landscape') return <>{parts.map((p, i) => <Floating key={p.session_id}><div style={{ marginTop: i * 0 }}><Tile p={p} round /></div></Floating>)}
    <div className="fixed bottom-2 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/60">{controls}</div></>;
  return <div className={layout === 'desktop' ? 'p-2' : 'px-2'}>
    <div className={`grid gap-2 ${layout === 'desktop' ? 'grid-cols-1' : 'grid-cols-2'}`}>{tiles}</div>{controls}</div>;
}
