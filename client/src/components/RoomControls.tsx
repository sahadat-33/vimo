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
/** Room controls only. Playback controls (play, seek, volume, captions) stay in the native player. */
export default function RoomControls(p: RoomControlsProps) {
  const [pop, setPop] = useState<Pop>(null), [note, setNote] = useState('');
  const toggle = (k: Pop) => setPop(pop === k ? null : k);
  const invite = async () => { setNote((await p.onInvite()) ? 'Invite link copied' : 'Copy failed. Share the page URL instead.'); setTimeout(() => setNote(''), 2500); };
  const sz = p.compact ? '!h-10 !w-10' : '';
  const here = (t: 'people' | 'chat') => p.panelOpen && p.panelTab === t;
  return <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setPop(null)}>
    {pop === 'react' && <div role="menu" aria-label="Reactions" className="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 gap-1 rounded-2xl border border-white/10 bg-surface2 p-2 shadow-card">
      {REACTIONS.map((e) => <button key={e} role="menuitem" aria-label={`React ${e}`} onClick={() => p.onReact(e)} className="rounded-xl px-2 py-1 text-2xl transition hover:bg-surface active:scale-90">{e}</button>)}</div>}
    {pop === 'settings' && <div role="dialog" aria-label="Room settings" className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded-2xl border border-white/10 bg-surface2 p-4 shadow-card">
      <div className="flex items-center justify-between gap-3 text-sm"><span>Smart Mic<span className="block text-xs text-muted">Mutes mics while the video plays</span></span>
        <button role="switch" aria-checked={p.smartMic} aria-label="Smart Mic" onClick={() => p.setSmartMic(!p.smartMic)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition', p.smartMic ? 'bg-primary' : 'bg-surface')}>
          <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', p.smartMic ? 'left-[22px]' : 'left-0.5')} /></button></div></div>}
    <div className={cx('flex items-center justify-center gap-1.5 rounded-2xl border border-white/5 bg-surface/90 p-1.5 shadow-card', p.compact && 'bg-black/60')}>
      <IconButton className={sz} label={p.mic ? 'Mute microphone' : 'Unmute microphone'} active={!p.mic} danger={!p.mic} disabled={!p.callReady} onClick={p.onMic}>{p.mic ? <Mic size={18} /> : <MicOff size={18} />}</IconButton>
      <IconButton className={sz} label={p.cam ? 'Turn camera off' : 'Turn camera on'} danger={!p.cam} disabled={!p.callReady} onClick={p.onCam}>{p.cam ? <Video size={18} /> : <VideoOff size={18} />}</IconButton>
      <IconButton className={sz} label="Participants" active={here('people')} onClick={() => p.onToggleTab('people')}><Users size={18} /></IconButton>
      <IconButton className={sz} label="Chat" active={here('chat')} badge={here('chat') ? 0 : p.unread} onClick={() => p.onToggleTab('chat')}><MessageCircle size={18} /></IconButton>
      <IconButton className={sz} label="Reactions" active={pop === 'react'} aria-haspopup="menu" onClick={() => toggle('react')}><Smile size={18} /></IconButton>
      <IconButton className={sz} label="Invite" onClick={invite}><UserPlus size={18} /></IconButton>
      <IconButton className={sz} label="Settings" active={pop === 'settings'} aria-haspopup="dialog" onClick={() => toggle('settings')}><Settings size={18} /></IconButton>
      <IconButton className={sz} label="Leave room" danger onClick={p.onLeave}><LogOut size={18} /></IconButton></div>
    <p role="status" aria-live="polite" className={cx('absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface2 px-3 py-1 text-xs transition-opacity', note ? 'opacity-100' : 'opacity-0')}>{note}</p>
  </div>;
}
