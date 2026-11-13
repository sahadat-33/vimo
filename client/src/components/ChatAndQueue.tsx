'use client';
import { useEffect, useRef, useState } from 'react';
import { ListVideo, MessageCircle, Send, X } from 'lucide-react';
import { ytId } from '@/lib/socket';
import type { AppSocket, ChatMessage, QueueItem } from '@/lib/types';

const beep = () => { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
  o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.12); } catch {} };
const REACTIONS = ['❤️', '😂', '😱', '🔥', '😭', '🍿'];
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatAndQueue({ socket, selfId, chat, queue, current, view }: { view?: 'chat' | 'queue'; socket: AppSocket; selfId: string; chat: ChatMessage[]; queue: QueueItem[]; current: QueueItem | null }) {
  const [itab, setTab] = useState<'chat' | 'queue'>('chat'); const tab = view ?? itab;
  const [msgs, setMsgs] = useState(chat), [text, setText] = useState(''), [url, setUrl] = useState(''), [err, setErr] = useState('');
  const [unread, setUnread] = useState(0);
  const end = useRef<HTMLDivElement>(null); const tabRef = useRef(tab); tabRef.current = tab;
  useEffect(() => { const f = (m: ChatMessage) => { setMsgs((x) => [...x, m]);
      if (!m.system && m.from !== selfId) { beep(); if (tabRef.current !== 'chat') setUnread((n) => n + 1); } };
    socket.on('chat:message', f); return () => { socket.off('chat:message', f); }; }, [socket, selfId]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [msgs, tab]);
  useEffect(() => { if (tab === 'chat') setUnread(0); }, [tab]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); const id = ytId(url.trim());
    if (!id) return setErr('That doesn’t look like a YouTube link.'); setErr('');
    let title = id; try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); title = (await r.json()).title || id; } catch {}
    socket.emit('queue:add', { id, title, addedBy: selfId }); setUrl('');
  }
  const tabBtn = (t: 'chat' | 'queue', Icon: typeof ListVideo, label: string, badge = 0) =>
    <button onClick={() => setTab(t)} aria-pressed={tab === t} className={`relative flex flex-1 items-center justify-center gap-1 py-2 text-sm font-semibold ${tab === t ? 'border-b-2 border-blush' : 'text-cream/60'}`}>
      <Icon size={16} />{label}{badge > 0 && <span className="ml-1 rounded-full bg-ember px-1.5 text-xs text-night">{badge}</span>}</button>;
  const input = 'min-w-0 flex-1 rounded-xl bg-dusk border border-plum px-3 py-2';

  return <div className="flex h-full flex-col">
    {!view && <div className="flex">{tabBtn('chat', MessageCircle, 'Chat', unread)}{tabBtn('queue', ListVideo, `Queue (${queue.length})`)}</div>}
    {tab === 'chat' ? <>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {msgs.map((m) => m.system
          ? <p key={m.id} className="mx-auto w-fit rounded-full bg-dusk px-3 py-0.5 text-center text-xs text-cream/60">{m.text}</p>
          : <div key={m.id} className={`flex items-end gap-2 ${m.from === selfId ? 'flex-row-reverse' : ''}`}>
              <span style={{ background: m.color }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg">{m.avatar}</span>
              <div className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-sm ${m.from === selfId ? 'bg-blush text-night' : 'bg-plum'}`}>
                <p className="text-xs opacity-70">{m.name} · {hm(m.at)}</p><p className="break-words">{m.text}</p></div></div>)}
        <div ref={end} /></div>
      <div className="flex justify-center gap-1 px-2" aria-label="Reactions">
        {REACTIONS.map((e) => <button key={e} aria-label={`React ${e}`} onClick={() => socket.emit('reaction', e)} className="rounded-full bg-dusk px-2 py-1 text-xl active:scale-90">{e}</button>)}</div>
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
