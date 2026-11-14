'use client';
import { useEffect, useRef, useState } from 'react';
import { Send, Smile } from 'lucide-react';
import type { AppSocket, ChatMessage } from '@/lib/types';
import { cx } from './ui';

const beep = () => { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
  o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.12); } catch {} };
const REACTIONS = ['❤️', '😂', '😱', '🔥', '😭', '🍿'];

/** The always-visible chat: history, "is typing…", and the input bar. The emoji button sends floating reactions to the whole room. */
export default function ChatPanel({ socket, selfId, chat }: { socket: AppSocket; selfId: string; chat: ChatMessage[] }) {
  const [text, setText] = useState(''), [emoji, setEmoji] = useState(false);
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  const feed = useRef<HTMLDivElement>(null), lastTyping = useRef(0);

  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [chat.length]);
  useEffect(() => {
    const onType = (t: { id: string; name: string }) => { if (t.id !== selfId) setTypers((x) => ({ ...x, [t.id]: { name: t.name, until: Date.now() + 3500 } })); };
    const onMsg = (m: ChatMessage) => {
      if (m.system) return;
      setTypers((x) => { if (!x[m.from]) return x; const { [m.from]: _gone, ...rest } = x; return rest; }); // they sent it, so they are done typing
      if (m.from !== selfId) beep();
    };
    socket.on('typing', onType); socket.on('chat:message', onMsg);
    const t = setInterval(() => setTypers((x) => { const now = Date.now(), k = Object.keys(x).filter((i) => x[i].until > now); return k.length === Object.keys(x).length ? x : Object.fromEntries(k.map((i) => [i, x[i]])); }), 1000);
    return () => { socket.off('typing', onType); socket.off('chat:message', onMsg); clearInterval(t); };
  }, [socket, selfId]);

  const names = Object.values(typers).map((t) => t.name);
  const typingText = names.length === 0 ? '' : names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : `${names.length} people are typing…`;
  const onChange = (v: string) => { setText(v); if (v.trim() && Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); socket.emit('typing'); } };
  const send = (e: React.FormEvent) => { e.preventDefault(); const t = text.trim(); if (!t) return; socket.emit('chat:send', t); setText(''); lastTyping.current = 0; };

  return <div className="flex h-full min-h-0 flex-col">
    <div ref={feed} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Chat">
      {chat.length === 0 && <p className="pt-6 text-center text-sm text-muted">No messages yet. Say hi!</p>}
      {chat.map((m) => m.system
        ? <p key={m.id} className="mx-auto w-fit max-w-full rounded-full bg-surface2/70 px-3 py-0.5 text-center text-xs text-muted">{m.text}</p>
        : <div key={m.id} className="flex items-start gap-3">
            <span style={{ background: m.color }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl leading-none">{m.avatar}</span>
            <div className="min-w-0"><p className="font-semibold">{m.name}</p>
              <p className={cx('mt-1 w-fit max-w-full break-words rounded-2xl px-4 py-2.5 text-[15px] leading-snug', m.from === selfId ? 'bg-primary/30' : 'bg-white/[.06]')}>{m.text}</p></div></div>)}
    </div>
    <div className="h-6 shrink-0 px-5" aria-live="polite">{typingText &&
      <p className="flex items-center gap-2 text-sm text-muted"><span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} style={{ animationDelay: `${i * 150}ms` }} className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />)}</span>{typingText}</p>}</div>
    <div className="relative shrink-0 px-3 pb-3">
      {emoji && <><button aria-label="Close reactions" tabIndex={-1} onClick={() => setEmoji(false)} className="fixed inset-0 z-40 cursor-default" />
        <div role="menu" aria-label="Reactions" className="absolute bottom-full left-3 z-50 mb-2 flex gap-0.5 rounded-2xl border border-white/10 bg-surface2 p-1.5 shadow-card">
          {REACTIONS.map((e) => <button key={e} role="menuitem" aria-label={`React ${e}`} onClick={() => socket.emit('reaction', e)} className="rounded-xl px-1.5 py-1 text-2xl transition hover:bg-surface active:scale-90">{e}</button>)}</div></>}
      <form onSubmit={send} className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-full border border-white/10 bg-surface2 pl-1.5 focus-within:border-secondary">
          <button type="button" aria-label="Send a reaction" aria-haspopup="menu" aria-expanded={emoji} onClick={() => setEmoji(!emoji)}
            className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full transition', emoji ? 'bg-primary text-white' : 'text-muted hover:text-ink')}><Smile size={22} /></button>
          <input value={text} onChange={(e) => onChange(e.target.value)} maxLength={500} aria-label="Message" placeholder="Say something…" enterKeyHint="send" autoComplete="off"
            className="min-h-[48px] min-w-0 flex-1 bg-transparent px-2 text-ink outline-none placeholder:text-muted/70" /></div>
        <button aria-label="Send message" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-white shadow-glow transition active:scale-95"><Send size={20} className="-ml-0.5" /></button></form>
    </div></div>;
}
