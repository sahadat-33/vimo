import { io } from 'socket.io-client';
import { AppSocket, SERVER, getPass } from './types';
let s: AppSocket | null = null;
export const getSocket = (roomId?: string): AppSocket => {
  const auth = { passcode: getPass(), room: roomId || '' };
  s ??= io(SERVER, { auth, transports: ['websocket'] }) as AppSocket;
  s.auth = auth; // read on every (re)connect: the host uses the passcode, friends use the invite link
  if (!s.connected && !s.active) s.connect();
  return s;
};
export const api = (path: string, body?: object) =>
  fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-passcode': getPass() }, body: JSON.stringify(body ?? {}) });
/** Accepts watch, youtu.be, shorts, live, embed and music.youtube links, or a bare 11-character video id. */
export function ytId(input: string): string | null {
  const raw = input.trim(), ID = /^[\w-]{11}$/;
  if (ID.test(raw)) return raw;
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') { const id = u.pathname.split('/')[1] ?? ''; return ID.test(id) ? id : null; }
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const v = u.searchParams.get('v'); if (v && ID.test(v)) return v;
  const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}
