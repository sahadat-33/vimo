import type { Socket } from 'socket.io-client';
export type Mode = 'youtube' | 'file' | 'browser';
export interface Playback { playing: boolean; time: number; rate: number }
export interface LocalPlayback extends Playback { at: number } // at = Date.now() when received
export interface QueueItem { id: string; title: string; addedBy: string }
export interface Profile { name: string; avatar: string; color: string }
export interface Member extends Profile { id: string }
export interface ChatMessage { id: string; from: string; name: string; avatar: string; color: string; text: string; at: number; system?: boolean }
export interface HbInfo { embedUrl: string }
export interface RoomFile { name: string; size: number; type: string; by: string; url: string } // url is a short-lived signed link to the shared video
export interface JoinProfile extends Profile { cid: string }
export interface RoomState { mode: Mode; queue: QueueItem[]; current: QueueItem | null; playback: Playback;
  chat: ChatMessage[]; hb: HbInfo | null; controller: string | null; members: Member[]; file: RoomFile | null }
export type FileSignal =
  | { kind: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'ready' } | { kind: 'ctrl'; playing: boolean; time: number };

export interface ServerToClient {
  'peer:joined': (m: Member) => void; reaction: (r: { id: string; emoji: string; from: string }) => void; 'peer:left': (id: string) => void;
  'mode:changed': (d: { mode: Mode; playback: Playback }) => void;
  playback: (d: Playback & { from: string }) => void;
  'queue:updated': (d: { queue: QueueItem[]; current: QueueItem | null; playback?: Playback }) => void;
  'file:updated': (d: { file: RoomFile | null; playback: Playback }) => void;
  'file:uploading': (d: { by: string; name: string; pct: number }) => void;
  'chat:message': (m: ChatMessage) => void;
  'browser:controller': (id: string | null) => void;
  'hb:started': (i: HbInfo) => void; 'hb:stopped': () => void; 'hb:admin': (d: { adminToken: string | null }) => void;
}
export interface ClientToServer {
  'room:join': (roomId: string, profile: JoinProfile, cb: (r: { error?: string; state?: RoomState; selfId?: string; isHost?: boolean }) => void) => void;
  'mode:set': (m: Mode) => void; reaction: (emoji: string) => void; playback: (p: Playback) => void;
  'queue:add': (i: QueueItem) => void; 'queue:remove': (id: string) => void; 'video:change': (i: QueueItem) => void;
  'chat:send': (t: string) => void; 'room:leave': () => void; 'browser:stop': () => void; 'video:ended': (id: string) => void;
  'file:prepare': (m: { name: string; type: string; size: number }, cb: (r: { error?: string; uploadUrl?: string; key?: string; maxBytes?: number }) => void) => void;
  'file:progress': (pct: number) => void; 'file:remove': () => void;
  'file:ready': (key: string, cb: (r: { ok?: boolean; error?: string }) => void) => void;
  'file:refresh': (cb: (r: { file: RoomFile | null }) => void) => void;
  'browser:start': (cb: (r: { ok?: boolean; error?: string }) => void) => void;
  'browser:control': (c: { action: 'take' | 'release' | 'pass'; to?: string }, cb?: (r: { error?: string }) => void) => void;
}
export type AppSocket = Socket<ServerToClient, ClientToServer>;
export interface StageProps {
  socket: AppSocket; selfId: string; roomId: string; playback: LocalPlayback; current: QueueItem | null;
  emitPlayback: (p: Playback) => void; onDrift?: (driftSeconds: number) => void;
  interacted: boolean; // true once the user has tapped or typed on this page (browsers refuse sound before that)
  file: RoomFile | null;
}
export const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';
export const getPass = () => (typeof window === 'undefined' ? '' : sessionStorage.getItem('passcode') || '');
export function getCid(): string { // stable per-tab id so reconnects never create a second participant
  if (typeof window === 'undefined') return '';
  const valid = (value: string | null): value is string => !!value && /^[A-Za-z0-9_-]{8,64}$/.test(value);
  let c = sessionStorage.getItem('cid');
  if (!valid(c)) {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, '')
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    c = random.slice(0, 64);
    if (!valid(c)) c = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 64);
    sessionStorage.setItem('cid', c);
  }
  return c;
}
