'use client';
import { useState } from 'react';
import { LogOut, MessageCircle, Mic, MicOff, Settings, Smile, UserPlus, Users, Video, VideoOff } from 'lucide-react';
import { IconButton, cx } from './ui';

const REACTIONS = ['❤️', '😂', '😱', '🔥', '😭', '🍿'];
type Pop = null | 'react' | 'settings';
export interface RoomControlsProps {
  mic: boolean; cam: boolean; onMic: () => void; onCam: () => void; callReady: boolean;
  panelOpen: boolean; panelTab: string; onToggleTab: (t: 'people' | 'chat') => void; unread: number;
  onReact: (e: string) => void; onInvite: () => Promise<boolean>; smartMic: boolean; setSmartMic: (b: boolean) => void; onLeave: () => void; compact?: boolean;
}
/** Room controls only. Playback controls (play, seek, volume, captions) stay in the native player. Reactions live on the Chat button. */
export default function RoomControls(p: RoomControlsProps) {
  const [pop, setPop] = useState<Pop>(null), [note, setNote] = useState('');
  const toggle = (k: Pop) => setPop(pop === k ? null : k);
  const invite = async () => { setNote((await p.onInvite()) ? 'Invite link copied' : 'Copy failed. Share the page URL instead.'); setTimeout(() => setNote(''), 2500); };
  const dir = p.compact ? 'top-full mt-2' : 'bottom-full mb-2';
  const chatOn = p.panelOpen && p.panelTab === 'chat', peopleOn = p.panelOpen && p.panelTab === 'people';
  return <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setPop(null)}>
    {pop && <button aria-label="Close menu" tabIndex={-1} onClick={() => setPop(null)} className="fixed inset-0 z-40 cursor-default" />}
    {pop === 'react' && <div role="menu" aria-label="Reactions" className={cx('absolute left-1/2 z-50 flex -translate-x-1/2 gap-0.5 rounded-2xl border border-white/10 bg-surface2 p-1.5 shadow-card', dir)}>
      {REACTIONS.map((e) => <button key={e} role="menuitem" aria-label={`React ${e}`} onClick={() => p.onReact(e)} className="rounded-xl px-1.5 py-1 text-2xl transition hover:bg-surface active:scale-90">{e}</button>)}</div>}
    {pop === 'settings' && <div role="dialog" aria-label="Room settings" className={cx('absolute right-0 z-50 w-64 rounded-2xl border border-white/10 bg-surface2 p-4 shadow-card', dir)}>
      <div className="flex items-center justify-between gap-3 text-sm"><span>Smart Mic<span className="block text-xs text-muted">Mutes your mic while the video plays</span></span>
        <button role="switch" aria-checked={p.smartMic} aria-label="Smart Mic" onClick={() => p.setSmartMic(!p.smartMic)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition', p.smartMic ? 'bg-primary' : 'bg-surface')}>
          <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', p.smartMic ? 'left-[22px]' : 'left-0.5')} /></button></div></div>}
    <div className={cx('flex items-center justify-between gap-0.5 rounded-2xl border border-white/5 p-1.5 shadow-card min-[380px]:gap-1', p.compact ? 'bg-black/60' : 'bg-surface/90')}>
      <IconButton label={p.mic ? 'Turn microphone off' : 'Turn microphone on'} active={p.mic} disabled={!p.callReady} onClick={p.onMic}>{p.mic ? <Mic size={18} /> : <MicOff size={18} />}</IconButton>
      <IconButton label={p.cam ? 'Turn camera off' : 'Turn camera on'} active={p.cam} disabled={!p.callReady} onClick={p.onCam}>{p.cam ? <Video size={18} /> : <VideoOff size={18} />}</IconButton>
      <IconButton label="Participants" active={peopleOn} onClick={() => p.onToggleTab('people')}><Users size={18} /></IconButton>
      <div className="flex shrink-0 overflow-hidden rounded-xl">
        <IconButton label="Chat" active={chatOn} badge={chatOn ? 0 : p.unread} className="!rounded-r-none" onClick={() => p.onToggleTab('chat')}><MessageCircle size={18} /></IconButton>
        <button aria-label="Send a reaction" aria-haspopup="menu" aria-expanded={pop === 'react'} onClick={() => toggle('react')}
          className={cx('grid w-6 place-items-center border-l border-black/30 transition active:scale-95', pop === 'react' ? 'bg-primary text-white' : chatOn ? 'bg-primary/80 text-white' : 'bg-surface2 text-secondary hover:bg-[#2a2a33]')}><Smile size={15} /></button></div>
      <IconButton label="Invite" onClick={invite}><UserPlus size={18} /></IconButton>
      <IconButton label="Settings" active={pop === 'settings'} aria-haspopup="dialog" onClick={() => toggle('settings')}><Settings size={18} /></IconButton>
      <IconButton label="Leave room" danger onClick={p.onLeave}><LogOut size={18} /></IconButton></div>
    <p role="status" aria-live="polite" className={cx(p.compact ? '-bottom-8' : '-top-8', 'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface2 px-3 py-1 text-xs transition-opacity', note ? 'opacity-100' : 'opacity-0')}>{note}</p>
  </div>;
}
