'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import { ytId } from '@/lib/socket';
import type { AppSocket, QueueItem } from '@/lib/types';
import { Button } from './ui';

/** The playlist: what is playing, what is next, and (for whoever may control the room) adding and removing videos. */
export default function QueuePanel({ socket, selfId, queue, current, canControl }: { socket: AppSocket; selfId: string; queue: QueueItem[]; current: QueueItem | null; canControl: boolean }) {
  const [url, setUrl] = useState(''), [err, setErr] = useState('');
  async function add(e: React.FormEvent) {
    e.preventDefault(); const id = ytId(url.trim());
    if (!id) return setErr('That doesn’t look like a YouTube link.'); setErr('');
    let title = id;
    try { // oEmbed tells us up front whether the video exists and may be embedded
      const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`);
      if (r.status === 404) return setErr('That video wasn’t found, or it is private.');
      if (r.status === 401 || r.status === 403) return setErr('The owner doesn’t allow this video to be embedded, so it can’t play here.');
      if (r.ok) title = (await r.json()).title || id;
    } catch {}
    socket.emit('queue:add', { id, title, addedBy: selfId }); setUrl('');
  }
  return <div className="space-y-2 px-4">
    {current && <p className="rounded-xl bg-primary/20 px-3 py-2.5 text-sm"><span className="block text-xs text-secondary">Now playing</span>{current.title}</p>}
    {queue.length === 0 && <p className="py-2 text-sm text-muted">Nothing queued. {canControl ? 'Paste a link below.' : ''}</p>}
    {queue.map((q) => <div key={q.id} className="flex items-center gap-2 rounded-xl bg-surface2 px-3 py-2.5 text-sm">
      <button className="min-w-0 flex-1 truncate text-left" disabled={!canControl} onClick={() => socket.emit('video:change', q)}>{q.title}</button>
      {canControl && <button aria-label={`Remove ${q.title}`} onClick={() => socket.emit('queue:remove', q.id)} className="text-muted hover:text-ink"><X size={16} /></button>}</div>)}
    {canControl ? <form onSubmit={add} className="space-y-2 pt-2">
        <div className="flex gap-2"><input aria-label="YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube link" inputMode="url"
          className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/10 bg-surface2 px-3 text-sm placeholder:text-muted/60 focus:border-secondary" />
          <Button className="!w-auto px-4">Add</Button></div>
        {err && <p role="alert" className="text-xs text-accent">{err}</p>}</form>
      : <p className="pt-2 text-center text-xs text-muted">Only the host can change the queue.</p>}
  </div>;
}
