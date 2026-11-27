'use client';
import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, Play, Settings, Volume2, VolumeX } from 'lucide-react';
import { SPEEDS, formatTime } from '@/lib/driveSync';
import { cx } from './ui';

/**
 * VIMO's own playback bar for the Drive video (playback, not the room). Row 1: time, progress, duration.
 * Row 2: play, volume | settings, fullscreen. Play, seek and speed belong to the person in control; volume and fullscreen are each viewer's own.
 */
export default function DriveControls({ visible, playing, time, duration, muted, fs, canControl, speed, onToggle, onSeek, onMute, onFs, onSpeed }: {
  visible: boolean; playing: boolean; time: number; duration: number; muted: boolean; fs: boolean; canControl: boolean; speed: number;
  onToggle: () => void; onSeek: (t: number) => void; onMute: () => void; onFs: () => void; onSpeed: (r: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null); // dragging: show the thumb's position, seek when released
  const [open, setOpen] = useState(false);
  const gear = useRef<HTMLDivElement>(null);
  useEffect(() => { // close the settings popup on any tap outside it
    if (!open) return;
    const f = (e: PointerEvent) => { if (!gear.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', f); return () => document.removeEventListener('pointerdown', f);
  }, [open]);
  const shown = drag ?? time, max = duration > 0 ? duration : 0;
  const commit = () => { if (drag !== null) { onSeek(drag); setDrag(null); } };
  const btn = 'press grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 active:scale-95 disabled:opacity-40 sm:h-11 sm:w-11';
  return <div data-ui className={cx('absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-1.5 pt-12 transition-opacity duration-300', visible ? 'opacity-100' : 'pointer-events-none opacity-0')}>
    <div className="flex items-center gap-2.5 text-xs tabular-nums text-white/90">
      <span className="w-11 shrink-0 text-right">{formatTime(shown)}</span>
      <input type="range" aria-label="Progress" min={0} max={max || 1} step={0.5} value={Math.min(shown, max || 1)} disabled={!canControl || !max}
        title={canControl ? 'Seek' : 'The host controls seeking'} onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit}
        className="h-2 min-w-0 flex-1 cursor-pointer accent-[#A76DCA] disabled:cursor-default" />
      <span className="w-14 shrink-0">{formatTime(max)}</span>
    </div>
    <div className="mt-0.5 flex items-center gap-1 text-white">
      <button className={btn} disabled={!canControl} aria-label={playing ? 'Pause' : 'Play'} title={canControl ? undefined : 'The host controls playback'} onClick={onToggle}>
        {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
      <button className={btn} aria-label={muted ? 'Unmute' : 'Mute'} onClick={onMute}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
      <span className="flex-1" />
      <div ref={gear} className="relative">
        <button className={btn} aria-label="Settings" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><Settings size={20} /></button>
        {open && <div role="dialog" aria-label="Playback settings" className="absolute bottom-full right-0 mb-2 w-56 rounded-2xl border border-white/[.08] bg-[#171717]/95 p-3 text-sm text-ink shadow-[0_18px_40px_-16px_rgba(0,0,0,.95)] backdrop-blur-md animate-[riseIn_.22s_ease-out]">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Speed</p>
          <div className="grid grid-cols-3 gap-1.5">
            {SPEEDS.map((s) => <button key={s} disabled={!canControl} aria-pressed={s === speed} onClick={() => { onSpeed(s); setOpen(false); }}
              className={cx('min-h-[36px] rounded-lg text-sm font-medium transition disabled:opacity-40', s === speed ? 'bg-primary text-white' : 'bg-surface hover:bg-surface')}>
              {s === 1 ? 'Normal' : `${s}×`}{s === speed ? ' ✓' : ''}</button>)}</div>
          {!canControl && <p className="mt-2 text-xs text-muted">The host controls speed.</p>}
          <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Quality</p>
          <p className="rounded-lg bg-surface px-2.5 py-1.5 text-xs">Original ✓ <span className="text-muted">(the only quality this source has)</span></p>
        </div>}
      </div>
      <button className={btn} aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'} onClick={onFs}>{fs ? <Minimize size={20} /> : <Maximize size={20} />}</button>
    </div></div>;
}
