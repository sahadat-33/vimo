'use client';
import type { Profile } from '@/lib/types';
import { Button, Card, Logo } from './ui';
import { Avatar, ProfileEditor, saveProfile, useProfileDraft } from './ProfileEditor';

/** What a friend sees after opening an invite link: no passcode, just a name and a picture. */
export default function JoinGate({ initial, onDone }: { initial: Profile | null; onDone: (p: Profile) => void }) {
  const draft = useProfileDraft('Guest', initial);
  const go = (e: React.FormEvent) => { e.preventDefault(); const p = draft.profile(); saveProfile(p); onDone(p); };
  return <main className="bg-cinema min-h-[100dvh] px-4 py-8"><div className="mx-auto w-full max-w-4xl space-y-6">
    <Logo /><div><h1 className="text-3xl font-bold tracking-tight">You’re invited to a party</h1><p className="mt-1 text-muted">Pick a name and a picture, then jump in. No passcode needed.</p></div>
    <ProfileEditor draft={draft}>
      <Card className="space-y-4 p-5"><form onSubmit={go} className="space-y-4">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4"><Avatar avatar={draft.avatar} color={draft.color} /><span className="truncate text-lg font-semibold">{draft.name.trim() || draft.defaultName}</span></div>
        <Button className="bg-gradient-to-r from-primary to-secondary">Join the party</Button></form></Card>
    </ProfileEditor></div></main>;
}
