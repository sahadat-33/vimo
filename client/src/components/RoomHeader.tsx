'use client';
import { LogOut } from 'lucide-react';
import type { Member } from '@/lib/types';
import { Avatar } from './ProfileEditor';
import { cx } from './ui';

export type SyncState = 'synced' | 'resyncing' | 'unknown';
const SYNC = {
  synced: { t: 'In sync', tip: 'Playback is in sync', dot: 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,.65)]' },
  resyncing: { t: 'Resyncing', tip: 'Correcting playback drift', dot: 'bg-accent shadow-[0_0_8px_2px_rgba(249,115,22,.55)]' },
  unknown: { t: 'Waiting', tip: 'Waiting for the player to report', dot: 'bg-muted' },
} as const;

/** Top bar: people capsule (opens the participant list) on the left, real sync status and Leave on the right. */
export default function RoomHeader({ members, selfId, onPeople, sync, showSync, onLeave }: {
  members: Member[]; selfId: string; onPeople: () => void; sync: SyncState; showSync: boolean; onLeave: () => void }) {
  const shown = [...members].sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0)).slice(0, Math.min(3, members.length)), s = SYNC[sync]; // 1 person: 1 avatar, 2: 2, 3 or more: 3
  return <header className="flex items-center justify-between gap-2 px-3 py-2.5">
    <button onClick={onPeople} aria-haspopup="dialog" aria-label={`Show people, ${members.length} in the room`}
      className="flex items-center gap-2 rounded-full bg-surface2/80 py-1.5 pl-1.5 pr-4 transition hover:bg-surface2 active:scale-95">
      <span className="flex -space-x-3">{shown.map((m) => <span key={m.id} className="rounded-full ring-2 ring-surface2"><Avatar avatar={m.avatar} color={m.color} size={36} /></span>)}</span>
      <span className="text-xl font-medium tabular-nums">{members.length}</span></button>
    <div className="flex items-center gap-2">
      {showSync && <span title={s.tip} className="flex items-center gap-2 whitespace-nowrap rounded-full bg-surface2/80 px-3.5 py-2 text-sm"><span className={cx('h-2.5 w-2.5 rounded-full', s.dot)} aria-hidden />{s.t}</span>}
      <button onClick={onLeave} aria-label="Leave room" title="Leave room" className="grid h-11 w-11 place-items-center rounded-2xl bg-accent/15 text-accent ring-1 ring-accent/30 transition hover:bg-accent/25 active:scale-95"><LogOut size={20} /></button></div>
  </header>;
}
