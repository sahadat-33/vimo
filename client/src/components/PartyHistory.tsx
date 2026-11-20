'use client';
import { useCallback, useEffect, useState } from 'react';
import { Crown, Globe, HardDrive, RefreshCw, Users, X, Youtube } from 'lucide-react';
import type { Mode, PartyHistoryEntry } from '@/lib/types';
import { MODE_TITLE, fetchLive, readHistory, removeParty, timeAgo } from '@/lib/history';
import { cx } from './ui';

const ICON: Record<Mode, typeof Youtube> = { youtube: Youtube, file: HardDrive, browser: Globe };

/** Up to 5 recent parties as a list. Only rooms the server reports as running can be opened. */
export default function PartyHistory({ onOpen }: { onOpen: (roomId: string) => void }) {
  const [items, setItems] = useState<PartyHistoryEntry[]>([]);
  const [live, setLive] = useState<Record<string, boolean> | null>(null); // null = not known yet
  const [failed, setFailed] = useState(false);

  const check = useCallback(async (list: PartyHistoryEntry[]) => {
    try { setLive(await fetchLive(list.map((e) => e.roomId))); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => {
    let dead = false;
    const list = readHistory(); setItems(list);
    const run = () => { if (!dead) void check(list); };
    run(); const t = setInterval(run, 15000);
    return () => { dead = true; clearInterval(t); };
  }, [check]);

  const forget = (id: string) => setItems(removeParty(id));

  return <section aria-label="Party history" className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">Party history</h1>
      {items.length > 0 && <button onClick={() => { setLive(null); void check(items); }} aria-label="Refresh party status" title="Refresh"
        className="grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-surface2 hover:text-ink"><RefreshCw size={18} /></button>}
    </div>
    {items.length === 0 && <p className="text-muted">Parties you start or join will show up here, so you can hop back in while they are still running.</p>}
    {failed && items.length > 0 && <p role="status" className="text-sm text-accent">Can’t reach the server right now. It may be waking up; status will refresh on its own.</p>}
    <ul className="divide-y divide-white/5 overflow-hidden rounded-card border border-white/5 bg-surface shadow-card">
      {items.map((e) => {
        const Icon = ICON[e.mode], known = live !== null && e.roomId in live, running = known && live![e.roomId];
        const badge = !known ? { text: failed ? 'Unknown' : 'Checking…', cls: 'bg-white/5 text-muted' }
          : running ? { text: 'Live', cls: 'bg-emerald-500/15 text-emerald-300' } : { text: 'Ended', cls: 'bg-white/5 text-muted' };
        return <li key={e.roomId} className="flex items-center gap-1 pr-2">
          <button disabled={!running} onClick={() => onOpen(e.roomId)} aria-label={running ? `Rejoin ${e.title}` : `${e.title} (${badge.text.toLowerCase()})`}
            className={cx('flex min-w-0 flex-1 items-center gap-3 p-4 text-left transition', running ? 'hover:bg-surface2' : 'cursor-not-allowed opacity-60')}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/20 text-secondary"><Icon size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{e.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span>{MODE_TITLE[e.mode]}</span><span aria-hidden>·</span><span>{timeAgo(e.lastVisited)}</span><span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">{e.wasHost ? <><Crown size={12} /> Host</> : <><Users size={12} /> Guest</>}</span>
              </span>
            </span>
            <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', badge.cls)}>{badge.text}</span>
          </button>
          <button onClick={() => forget(e.roomId)} aria-label={`Remove ${e.title} from history`} title="Remove"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface2 hover:text-ink"><X size={16} /></button>
        </li>;
      })}
    </ul>
  </section>;
}
