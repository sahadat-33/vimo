'use client';
import { useState } from 'react';
import { Link2, Mic, MicOff, Settings, UserPlus, Video, VideoOff } from 'lucide-react';
import { IconButton, cx } from './ui';

export interface RoomControlsProps {
  mic: boolean; cam: boolean; onMic: () => void; onCam: () => void; callReady: boolean;
  onInvite: () => Promise<boolean>; onQueue: () => void; queueCount: number;
  smartMic: boolean; setSmartMic: (b: boolean) => void; netText: string;
  isHost?: boolean; hostOnly?: boolean; onHostOnly?: (v: boolean) => void; compact?: boolean;
}
const Switch = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) =>
  <button role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={cx('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-primary' : 'bg-surface')}>
    <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', on ? 'left-[22px]' : 'left-0.5')} /></button>;

/** Room controls only. Playback controls (play, seek, volume, captions) stay in the native player. */
export default function RoomControls(p: RoomControlsProps) {
  const [open, setOpen] = useState(false), [note, setNote] = useState('');
  const invite = async () => { setNote((await p.onInvite()) ? 'Invite link copied' : 'Copy failed. Share the page URL instead.'); setTimeout(() => setNote(''), 2500); };
  const round = '!rounded-full';
  return <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
    {open && <button aria-label="Close settings" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />}
    {open && <div role="dialog" aria-label="Room settings" className="absolute bottom-full right-0 z-50 mb-2 w-72 space-y-3 rounded-2xl border border-white/10 bg-surface2 p-4 text-sm shadow-card">
      <div className="flex items-center justify-between gap-3"><span>Smart Mic<span className="block text-xs text-muted">Mutes your mic while the video plays</span></span><Switch on={p.smartMic} label="Smart Mic" onClick={() => p.setSmartMic(!p.smartMic)} /></div>
      {p.isHost && p.onHostOnly && <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3"><span>Only I have control<span className="block text-xs text-muted">Friends can’t pause, seek or change the video</span></span>
        <Switch on={!!p.hostOnly} label="Only I have control" onClick={() => p.onHostOnly!(!p.hostOnly)} /></div>}
      <p className="flex items-center justify-between border-t border-white/10 pt-3 text-muted"><span>Call quality</span><span className="text-ink">{p.netText}</span></p></div>}
    <div className={cx('flex items-center justify-between gap-2 rounded-2xl border border-white/5 p-2 shadow-card', p.compact ? 'bg-black/60' : 'bg-surface/90')}>
      <div className="flex items-center gap-2">
        <IconButton className={round} label={p.mic ? 'Turn microphone off' : 'Turn microphone on'} active={p.mic} disabled onClick={undefined}>{p.mic ? <Mic size={20} /> : <MicOff size={20} />}</IconButton>
        <IconButton className={round} label={p.cam ? 'Turn camera off' : 'Turn camera on'} active={p.cam} disabled onClick={undefined}>{p.cam ? <Video size={20} /> : <VideoOff size={20} />}</IconButton>
        <IconButton className={round} label="Invite friends" onClick={invite}><UserPlus size={20} /></IconButton></div>
      <div className="flex items-center gap-2">
        <IconButton className={round} label="Settings" active={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}><Settings size={20} /></IconButton>
        <IconButton className={round} label={`Queue${p.queueCount ? `, ${p.queueCount} waiting` : ''}`} badge={p.queueCount} onClick={p.onQueue}><Link2 size={20} /></IconButton></div></div>
    <p role="status" aria-live="polite" className={cx('pointer-events-none absolute -top-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface2 px-3 py-1 text-xs transition-opacity', note ? 'opacity-100' : 'opacity-0')}>{note}</p>
  </div>;
}
