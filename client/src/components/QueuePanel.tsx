'use client';
import { memo, useState } from 'react';
import { X } from 'lucide-react';
import { resolveVideo } from '@/lib/party';
import type { AppSocket, QueueItem } from '@/lib/types';
import { Button } from './ui';

/** The playlist: what is playing, what is next, and (for whoever may control the room) adding and removing videos. */
function QueuePanel({ socket, selfId, queue, current, canControl }: { socket: AppSocket; selfId: string; queue: QueueItem[]; current: QueueItem | null; canControl: boolean }) {
  const [url, setUrl] = useState(''), [err, setErr] = useState('');
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const v = await resolveVideo(url); // YouTube or Google Drive, detected from the link
    if ('error' in v) return setErr(v.error);
    socket.emit('queue:add', { id: v.id, title: v.title, kind: v.kind }, (r) => { if (r?.error) setErr(r.error); else setUrl(''); });
  }
  return <div className="space-y-2 px-4">
    {current && <p className="animate-[riseIn_.35s_ease-out] rounded-xl bg-gradient-to-r from-primary/30 to-secondary/10 px-3 py-2.5 text-sm ring-1 ring-secondary/20"><span className="block text-xs text-secondary">Now playing</span>{current.title}</p>}
    {queue.length === 0 && <p className="py-2 text-sm text-muted">Nothing queued. {canControl ? 'Paste a link below.' : ''}</p>}
    {queue.map((q) => <div key={q.id} className="animate-[riseIn_.35s_ease-out] flex items-center gap-2 rounded-xl border border-white/[.05] bg-[#171717] px-3 py-2.5 text-sm transition-colors hover:border-secondary/25 hover:bg-[#1c1c1c]">
      <button className="press min-w-0 flex-1 truncate text-left" disabled={!canControl} onClick={() => socket.emit('video:change', q)}>{q.title}</button>
      {canControl && <button aria-label={`Remove ${q.title}`} onClick={() => socket.emit('queue:remove', q.id)} className="press text-muted hover:text-ink"><X size={16} /></button>}</div>)}
    {canControl ? <form onSubmit={add} className="space-y-2 pt-2">
        <div className="flex gap-2"><input aria-label="Video link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a video link" inputMode="url"
          className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/10 bg-[#171717] px-3 text-sm transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20" />
          <Button className="!w-auto px-4">Add</Button></div>
        {err && <p role="alert" className="text-xs text-accent">{err}</p>}</form>
      : <p className="pt-2 text-center text-xs text-muted">Only the host can change the queue.</p>}
  </div>;
}

// Memoized: typing in the link box must not re-render the queue when chat or playback updates the room.
export default memo(QueuePanel);
