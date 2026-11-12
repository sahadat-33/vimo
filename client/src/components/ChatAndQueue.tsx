'use client';
import { useEffect, useRef, useState } from 'react';
import { ListVideo, MessageCircle, Send, X } from 'lucide-react';
import { ytId } from '@/lib/socket';
import type { AppSocket, ChatMessage, QueueItem } from '@/lib/types';

const beep = () => { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
  o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.12); } catch {} };

export default function ChatAndQueue({ socket, selfId, chat, queue, current }: { socket: AppSocket; selfId: string; chat: ChatMessage[]; queue: QueueItem[]; current: QueueItem | null }) {
  const [tab, setTab] = useState<'chat' | 'queue'>('chat');
  const [msgs, setMsgs] = useState(chat), [text, setText] = useState(''), [url, setUrl] = useState(''), [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { const f = (m: ChatMessage) => { setMsgs((x) => [...x, m]); if (m.from !== selfId) beep(); };
    socket.on('chat:message', f); return () => { socket.off('chat:message', f); }; }, [socket, selfId]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [msgs, tab]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); const id = ytId(url.trim());
    if (!id) return setErr('That doesn’t look like a YouTube link.'); setErr('');
    let title = id; try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); title = (await r.json()).title || id; } catch {}
    socket.emit('queue:add', { id, title, addedBy: selfId }); setUrl('');
  }
  const tabBtn = (t: 'chat' | 'queue', Icon: typeof ListVideo, label: string) =>
    <button onClick={() => setTab(t)} aria-pressed={tab === t} className={`flex flex-1 items-center justify-center gap-1 py-2 text-sm font-semibold ${tab === t ? 'border-b-2 border-blush' : 'text-cream/60'}`}><Icon size={16} />{label}</button>;
  const input = 'min-w-0 flex-1 rounded-xl bg-dusk border border-plum px-3 py-2';

  return <div className="flex h-full flex-col">
    <div className="flex">{tabBtn('chat', MessageCircle, 'Chat')}{tabBtn('queue', ListVideo, `Queue (${queue.length})`)}</div>
    {tab === 'chat' ? <>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {msgs.map((m) => <p key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${m.from === selfId ? 'ml-auto bg-blush text-night' : 'bg-plum'}`}>{m.text}</p>)}<div ref={end} /></div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { socket.emit('chat:send', text.trim()); setText(''); } }} className="flex gap-2 p-2">
        <input className={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something" />
        <button aria-label="Send" className="rounded-xl bg-blush p-2 text-night"><Send size={18} /></button></form>
    </> : <>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {current && <p className="rounded-xl bg-plum px-3 py-2 text-sm">Now playing: {current.title}</p>}
        {queue.length === 0 && <p className="p-2 text-sm text-cream/60">Nothing queued. Paste a link below.</p>}
        {queue.map((q) => <div key={q.id} className="flex items-center gap-2 rounded-xl bg-dusk px-3 py-2 text-sm">
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => socket.emit('video:change', q)}>{q.title}</button>
          <button aria-label="Remove" onClick={() => socket.emit('queue:remove', q.id)}><X size={16} /></button></div>)}</div>
      <form onSubmit={add} className="space-y-1 p-2"><div className="flex gap-2">
        <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste YouTube link" />
        <button className="rounded-xl bg-blush px-3 font-semibold text-night">Add</button></div>{err && <p role="alert" className="text-xs text-ember">{err}</p>}</form></>}
  </div>;
}
