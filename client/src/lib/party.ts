import { getSocket } from './socket';
import { getCid, type Mode } from './types';

/** Asks the server to start a party. Only works for someone who entered the passcode. Resolves with the room id. */
export function createRoom(o: { mode: Mode; hostOnly: boolean; video?: { id: string; title: string } }): Promise<string> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Can’t reach the server. It may be waking up, so try again in a few seconds.')), 12000);
    getSocket().emit('room:create', { cid: getCid(), ...o }, (r) => { clearTimeout(t); if (r?.roomId) res(r.roomId); else rej(new Error(r?.error || 'Could not start the party.')); });
  });
}

/** Best-effort video title from YouTube; falls back to the id. */
export async function ytTitle(id: string): Promise<string> {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 3500);
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`, { signal: ac.signal }); return String((await r.json()).title || id).slice(0, 120); }
  catch { return id; } finally { clearTimeout(t); }
}

// The video the host picked on the setup page, handed to the room screen in memory (a File cannot travel in a URL).
let pending: File | null = null;
export const setPendingFile = (f: File | null) => { pending = f; };
export const takePendingFile = () => { const f = pending; pending = null; return f; };
