'use client';
import { useEffect, useRef, useState } from 'react';
import type { DailyParticipant } from '@daily-co/daily-js';
import { MicOff, WifiOff } from 'lucide-react';
import type { Member } from '@/lib/types';
import type { CallState } from '@/lib/useCall';
import { Skeleton, cx } from './ui';

const sidOf = (p: DailyParticipant) => (p.userData as { sid?: string } | undefined)?.sid;
const find = (parts: DailyParticipant[], id: string) => parts.find((p) => sidOf(p) === id);

function AudioEl({ track }: { track?: MediaStreamTrack }) {
  const a = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (a.current) a.current.srcObject = track ? new MediaStream([track]) : null; }, [track]);
  return <audio ref={a} autoPlay />;
}
/** Plays remote voices exactly once, regardless of which tiles are on screen. */
export function CallAudio({ parts }: { parts: DailyParticipant[] }) {
  return <>{parts.filter((p) => !p.local).map((p) => <AudioEl key={p.session_id} track={p.tracks.audio.persistentTrack} />)}</>;
}

export function Tile({ member, p, isSelf, round, callState }: { member: Member; p?: DailyParticipant; isSelf: boolean; round?: boolean; callState: CallState }) {
  const v = useRef<HTMLVideoElement>(null);
  const vt = p?.tracks.video.persistentTrack, vs = p?.tracks.video.state;
  const live = !!vt && vs === 'playable';
  useEffect(() => { if (v.current) v.current.srcObject = live && vt ? new MediaStream([vt]) : null; }, [vt, live]);
  const as = p?.tracks.audio.state;
  const micOff = !!p && (as === 'off' || as === 'blocked');
  const status = !p ? (callState === 'joining' ? 'Joining call…' : 'Not in call') : vs === 'off' ? 'Camera off' : vs === 'blocked' ? 'Camera blocked' : vs === 'loading' ? 'Connecting…' : vs === 'interrupted' ? 'Feed interrupted' : '';
  return <div className={cx('relative aspect-video overflow-hidden bg-surface2', round ? 'aspect-square rounded-full' : 'rounded-xl', !p && 'opacity-70')}>
    <video ref={v} autoPlay playsInline muted className={cx('h-full w-full object-cover', isSelf && '-scale-x-100', !live && 'invisible')} />
    {!live && <div style={{ background: member.color + '33' }} className="absolute inset-0 grid place-items-center text-center">
      <div><span className="text-3xl">{member.avatar}</span>{!round && status && <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted">{!p && callState !== 'joining' && <WifiOff size={12} />}{status}</p>}</div></div>}
    {!round && <span className="absolute bottom-1 left-1 max-w-[80%] truncate rounded bg-black/60 px-1.5 text-xs">{member.name}{isSelf ? ' (you)' : ''}</span>}
    {micOff && <span className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-accent" aria-label="Microphone off"><MicOff size={12} /></span>}
  </div>;
}

export function FeedGrid({ members, parts, selfId, callState }: { members: Member[]; parts: DailyParticipant[]; selfId: string; callState: CallState }) {
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
export function FloatingFeeds({ members, parts, selfId, callState }: { members: Member[]; parts: DailyParticipant[]; selfId: string; callState: CallState }) {
  const sorted = [...members].sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0)).slice(0, 4);
  return <>{sorted.map((m, i) => <Floating key={m.id} index={i}><Tile member={m} p={find(parts, m.id)} isSelf={m.id === selfId} callState={callState} round /></Floating>)}</>;
}
