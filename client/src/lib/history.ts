import { SERVER, type Mode, type PartyHistoryEntry, type RoomStatusResponse } from './types';

const KEY = 'partyHistory', MAX = 5, ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MODES: Mode[] = ['youtube', 'file', 'browser'];
export const MODE_TITLE: Record<Mode, string> = { youtube: 'Online watch party', file: 'Shared video file', browser: 'Shared cloud browser' };

const valid = (e: unknown): e is PartyHistoryEntry => {
  const x = e as Partial<PartyHistoryEntry> | null;
  return !!x && typeof x.roomId === 'string' && ID_RE.test(x.roomId) && typeof x.title === 'string' && MODES.includes(x.mode as Mode)
    && typeof x.lastVisited === 'number' && typeof x.wasHost === 'boolean';
};

/** Up to 5 most recent parties, newest first. Bad or tampered storage is ignored. */
export function readHistory(): PartyHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(valid).slice(0, MAX) : [];
  } catch { return []; }
}

/** Adds or refreshes a party: newest first, one entry per roomId, at most 5. Missing fields keep what was stored before. */
export function recordParty(roomId: string, patch: { title?: string; mode?: Mode; wasHost?: boolean }): void {
  if (typeof window === 'undefined' || !ID_RE.test(roomId)) return;
  try {
    const all = readHistory(), old = all.find((e) => e.roomId === roomId);
    const mode = patch.mode ?? old?.mode ?? 'youtube';
    const entry: PartyHistoryEntry = {
      roomId, mode, lastVisited: Date.now(),
      title: (patch.title || old?.title || MODE_TITLE[mode]).slice(0, 120),
      wasHost: patch.wasHost ?? old?.wasHost ?? false,
    };
    localStorage.setItem(KEY, JSON.stringify([entry, ...all.filter((e) => e.roomId !== roomId)].slice(0, MAX)));
  } catch {}
}

export function removeParty(roomId: string): PartyHistoryEntry[] {
  try { localStorage.setItem(KEY, JSON.stringify(readHistory().filter((e) => e.roomId !== roomId))); } catch {}
  return readHistory();
}

/** Asks the server which of these rooms are still running. Throws if the server cannot be reached. */
export async function fetchLive(ids: string[]): Promise<Record<string, boolean>> {
  if (!ids.length) return {};
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(`${SERVER}/api/rooms/status?ids=${ids.map(encodeURIComponent).join(',')}`, { signal: ac.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('status');
    return ((await r.json()) as RoomStatusResponse).live ?? {};
  } finally { clearTimeout(t); }
}

export function timeAgo(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
