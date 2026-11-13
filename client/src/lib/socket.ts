import { io } from 'socket.io-client';
import { AppSocket, SERVER, getPass } from './types';
let s: AppSocket | null = null;
export const getSocket = (): AppSocket => {
  s ??= io(SERVER, { auth: { passcode: getPass() }, transports: ['websocket'] }) as AppSocket;
  if (!s.connected && !s.active) s.connect(); // re-open after the user left a room
  return s;
};
export const api = (path: string, body?: object) =>
  fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-passcode': getPass() }, body: JSON.stringify(body ?? {}) });
export function ytId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([\w-]{11})/);
  return m ? m[1] : null;
}
