'use client';
import { useState } from 'react';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { formatTime } from '@/lib/driveSync';
import { cx } from './ui';

/**
 * VIMO's own playback bar for the Drive video. It is part of the video, not the room: room controls (mic, camera, chat...) stay separate.
 * Play and seek are the host's when "Only I have control" is on; mute and fullscreen are every viewer's own.
 */
export default function DriveControls({ visible, playing, time, duration, canControl, muted, fs, onToggle, onSeek, onMute, onFs }: {
  visible: boolean; playing: boolean; time: number; duration: number; canControl: boolean; muted: boolean; fs: boolean;
  onToggle: () => void; onSeek: (t: number) => void; onMute: () => void; onFs: () => void;
}) {
  const [drag, setDrag] = useState<number | null>(null); // the bar is being dragged: show where it is, seek only when released
  const shown = drag ?? time, max = duration > 0 ? duration : 0;
  const commit = () => { if (drag !== null) { onSeek(drag); setDrag(null); } };
  const btn = 'grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/15 active:scale-95 disabled:opacity-40';
  return <div className={cx('absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-1.5 pt-12 transition-opacity duration-300', visible ? 'opacity-100' : 'pointer-events-none opacity-0')}>
    <input type="range" aria-label="Seek" min={0} max={max || 1} step={0.5} value={Math.min(shown, max || 1)} disabled={!canControl || !max}
      title={canControl ? 'Seek' : 'The host controls seeking'} onChange={(e) => setDrag(Number(e.target.value))}
      onPointerUp={commit} onKeyUp={commit} onBlur={commit}
      className="h-2 w-full cursor-pointer accent-[#A76DCA] disabled:cursor-default" />
    <div className="mt-0.5 flex items-center gap-1 text-white">
      <button className={btn} disabled={!canControl} aria-label={playing ? 'Pause' : 'Play'} title={canControl ? undefined : 'The host controls playback'} onClick={onToggle}>
        {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
      <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-white/90">{formatTime(shown)} / {formatTime(max)}</span>
      <span className="flex-1" />
      <button className={btn} aria-label={muted ? 'Unmute' : 'Mute'} onClick={onMute}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
      <button className={btn} aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'} onClick={onFs}>{fs ? <Minimize size={20} /> : <Maximize size={20} />}</button>
    </div></div>;
}
