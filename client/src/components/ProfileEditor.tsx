'use client';
import { useEffect, useState } from 'react';
import { AVATARS } from '@/lib/avatars';
import type { Profile } from '@/lib/types';
import { Card, cx } from './ui';

export function loadProfile(): Profile | null {
  try { const p = JSON.parse(localStorage.getItem('profile') || 'null'); return p && typeof p.name === 'string' ? p : null; } catch { return null; }
}
export function saveProfile(p: Profile) { try { localStorage.setItem('profile', JSON.stringify(p)); } catch {} }

export function useProfileDraft(defaultName: string, initial?: Profile | null) {
  const [name, setName] = useState(initial?.name ?? ''), [avatar, setAvatar] = useState(initial?.avatar ?? AVATARS[0].e);
  useEffect(() => { if (initial) return; const p = loadProfile(); if (p) { setName(p.name); setAvatar(p.avatar); } }, []); // eslint-disable-line
  const color = (AVATARS.find((a) => a.e === avatar) ?? AVATARS[0]).c;
  return { name, setName, avatar, setAvatar, color, defaultName, profile: (): Profile => ({ name: name.trim().slice(0, 20) || defaultName, avatar, color }) };
}
export type ProfileDraft = ReturnType<typeof useProfileDraft>;

export function Avatar({ avatar, color, size = 48 }: { avatar: string; color: string; size?: number }) {
  return <span style={{ width: size, height: size, background: color, fontSize: size * 0.5 }} className="grid shrink-0 place-items-center rounded-full leading-none">{avatar}</span>;
}

/** Nickname + profile picture, shared by the host's setup page and the friends' join page. `children` is the card under the nickname. */
export function ProfileEditor({ draft, children }: { draft: ProfileDraft; children: React.ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
    <Card className="order-2 space-y-3 p-5 lg:col-start-1 lg:row-start-1">
      <h2 className="border-b border-white/10 pb-3 text-lg font-semibold">Set a nickname</h2>
      <input aria-label="Nickname" value={draft.name} maxLength={20} onChange={(e) => draft.setName(e.target.value)} placeholder={`My name is ${draft.defaultName}`}
        className="min-h-[48px] w-full rounded-xl border border-white/10 bg-surface2 px-4 text-ink placeholder:text-muted/60 focus:border-secondary" /></Card>
    <Card className="order-3 p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
      <h2 className="border-b border-white/10 pb-3 text-lg font-semibold">Choose a profile picture</h2>
      <div role="radiogroup" aria-label="Profile picture" className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-5">
        {AVATARS.map((a) => <button type="button" key={a.e} role="radio" aria-checked={draft.avatar === a.e} aria-label={`Picture ${a.e}`} onClick={() => draft.setAvatar(a.e)}
          style={{ background: a.c }} className={cx('grid aspect-square place-items-center rounded-full text-3xl transition active:scale-95', draft.avatar === a.e ? 'ring-4 ring-white ring-offset-2 ring-offset-surface' : 'opacity-90 hover:opacity-100')}>{a.e}</button>)}</div></Card>
    <div className="order-1 lg:col-start-1 lg:row-start-2">{children}</div></div>;
}
