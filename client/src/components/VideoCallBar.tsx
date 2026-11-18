'use client';
import { useEffect, useRef, useState } from 'react';
import { MicOff, WifiOff } from 'lucide-react';
import type { Member } from '@/lib/types';
import type { CallParticipant, CallState } from '@/lib/useCall';
import { Skeleton, cx } from './ui';

// Keep the existing component props and layout contract; media is supplied by native WebRTC.
const find = (parts: CallParticipant[], id: string) => parts.find((p) => p.memberId === id);

function AudioEl({ track }: { track?: MediaStreamTrack }) {
  const a = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = a.current;
    if (!el) return;
    el.srcObject = track && track.readyState === 'live' ? new MediaStream([track]) : null;
    if (track) void el.play().catch(() => { /* Mobile browsers may require a user gesture for remote audio. */ });
    return () => { if (el) el.srcObject = null; };
  }, [track]);
  return <audio ref={a} autoPlay playsInline />;
}
/** Plays each remote audio track once, independently of visible video tiles. */
export function CallAudio({ parts }: { parts: CallParticipant[] }) {
  return <>{parts.filter((p) => !p.local && p.audioTrack && p.mic).map((p) => <AudioEl key={p.socketId} track={p.audioTrack} />)}</>;
}

export function Tile({ member, p, isSelf, round, callState }: { member: Member; p?: CallParticipant; isSelf: boolean; round?: boolean; callState: CallState }) {
  const v = useRef<HTMLVideoElement>(null);
  const vt = p?.videoTrack, live = !!vt && vt.readyState === 'live' && !!p?.cam;
  useEffect(() => {
    if (v.current) v.current.srcObject = live && vt ? new MediaStream([vt]) : null;
    return () => { if (v.current) v.current.srcObject = null; };
  }, [vt, live]);
  const micOff = !!p && !p.mic;
  const status = !p ? (callState === 'joining' ? 'Joining call…' : 'Not in call') : !p.cam ? 'Camera off' : !live ? 'Connecting video…' : '';
  return <div className={cx('relative aspect-video overflow-hidden bg-surface2', round ? 'aspect-square rounded-full' : 'rounded-xl', !p && 'opacity-70')}>
    <video ref={v} autoPlay playsInline muted className={cx('h-full w-full object-cover', isSelf && '-scale-x-100', !live && 'invisible')} />
    {!live && <div style={{ background: member.color + '33' }} className="absolute inset-0 grid place-items-center text-center">
      <div><span className="text-3xl">{member.avatar}</span>{!round && status && <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted">{!p && callState !== 'joining' && <WifiOff size={12} />}{status}</p>}</div></div>}
    {!round && <span className="absolute bottom-1 left-1 max-w-[80%] truncate rounded bg-black/60 px-1.5 text-xs">{member.name}{isSelf ? ' (you)' : ''}</span>}
    {micOff && <span className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-accent" aria-label="Microphone off"><MicOff size={12} /></span>}
  </div>;
}

export function FeedGrid({ members, parts, selfId, callState }: { members: Member[]; parts: CallParticipant[]; selfId: string; callState: CallState }) {
  const sorted = [...members].sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0));
  if (callState === 'joining' && parts.length === 0) return <div className="grid grid-cols-2 gap-2 p-2">{sorted.map((m) => <Skeleton key={m.id} className="aspect-video" />)}</div>;
  return <div className="grid grid-cols-2 gap-2 p-2">{sorted.map((m) => <Tile key={m.id} member={m} p={find(parts, m.id)} isSelf={m.id === selfId} callState={callState} />)}</div>;
}

function Floating({ children, index }: { children: React.ReactNode; index: number }) {
  const [pos, setPos] = useState({ x: 12, y: 64 + index * 88 }); const d = useRef<{ dx: number; dy: number } | null>(null);
  return <div className="fixed z-40 w-20 touch-none" style={{ left: pos.x, top: pos.y }}
    onPointerDown={(e) => { d.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => d.current && setPos({ x: Math.max(0, Math.min(innerWidth - 80, e.clientX - d.current.dx)), y: Math.max(0, Math.min(innerHeight - 80, e.clientY - d.current.dy)) })}
    onPointerUp={() => (d.current = null)}>{children}</div>;
}
/** Landscape cinema mode: draggable round bubbles (first 4 people; everyone is in the People tab). */
export function FloatingFeeds({ members, parts, selfId, callState }: { members: Member[]; parts: CallParticipant[]; selfId: string; callState: CallState }) {
  const sorted = [...members].sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0)).slice(0, 4);
  return <>{sorted.map((m, i) => <Floating key={m.id} index={i}><Tile member={m} p={find(parts, m.id)} isSelf={m.id === selfId} callState={callState} round /></Floating>)}</>;
}
