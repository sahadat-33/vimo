import type { Socket } from 'socket.io-client';
export type Mode = 'youtube' | 'file' | 'browser';
export interface Playback { playing: boolean; time: number; rate: number }
export interface LocalPlayback extends Playback { at: number } // at = Date.now() when received
export type VideoKind = 'youtube' | 'gdrive';
export interface QueueItem { id: string; title: string; addedBy: string; kind?: VideoKind } // kind is missing on old items = YouTube
export interface Profile { name: string; avatar: string; color: string }
export interface Member extends Profile { id: string }
export interface ChatMessage { id: string; from: string; name: string; avatar: string; color: string; text: string; at: number; system?: boolean }
export interface HbInfo { embedUrl: string }
export interface RoomFile { name: string; size: number; type: string; by: string; url: string } // url is a short-lived signed link to the shared video
export interface JoinProfile extends Profile { cid: string }
export interface RoomState { upNext: { item: QueueItem; inMs: number } | null; driveMode: { id: string; mode: 'auto' | 'manual' } | null; mode: Mode; queue: QueueItem[]; current: QueueItem | null; playback: Playback;
  chat: ChatMessage[]; hb: HbInfo | null; controller: string | null; members: Member[]; file: RoomFile | null; hostOnly: boolean; hostId: string }
export type FileSignal =
  | { kind: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'ready' } | { kind: 'ctrl'; playing: boolean; time: number };

export interface ServerToClient {
  'peer:joined': (m: Member) => void; reaction: (r: { id: string; emoji: string; from: string }) => void; 'peer:left': (id: string) => void;
  'up-next': (d: { item: QueueItem; inMs: number } | null) => void;
  'drive:mode': (d: { id: string; mode: 'auto' | 'manual' }) => void;
  'mode:changed': (d: { mode: Mode; playback: Playback }) => void;
  playback: (d: Playback & { from: string }) => void;
  'queue:updated': (d: { queue: QueueItem[]; current: QueueItem | null; playback?: Playback }) => void;
  'file:updated': (d: { file: RoomFile | null; playback: Playback }) => void;
  'file:uploading': (d: { by: string; name: string; pct: number }) => void;
  'chat:message': (m: ChatMessage) => void;
  'browser:controller': (id: string | null) => void;
  'hb:started': (i: HbInfo) => void; 'hb:stopped': () => void; 'hb:admin': (d: { adminToken: string | null }) => void; typing: (t: { id: string; name: string }) => void; 'room:settings': (s: { hostOnly: boolean }) => void; countdown: (d: { by: string; seconds: number }) => void;
  'call-peer-joined': (p: { socketId: string; memberId: string; name: string; mic: boolean; cam: boolean }) => void;
  'call-peer-left': (p: { socketId: string }) => void;
  'webrtc-offer': (p: { from: string; data: RTCSessionDescriptionInit }) => void;
  'webrtc-answer': (p: { from: string; data: RTCSessionDescriptionInit }) => void;
  'webrtc-ice-candidate': (p: { from: string; data: RTCIceCandidateInit }) => void;
}
export interface ClientToServer {
  'room:join': (roomId: string, profile: JoinProfile, cb: (r: { error?: string; state?: RoomState; selfId?: string; isHost?: boolean }) => void) => void;
  'room:create': (o: { cid: string; mode: Mode; hostOnly: boolean; video?: { id: string; title: string; kind?: VideoKind } }, cb: (r: { roomId?: string; error?: string }) => void) => void;
  'room:settings': (s: { hostOnly: boolean }) => void; typing: () => void; countdown: () => void;
  'drive:mode': (p: { id: string; mode: 'auto' | 'manual' }, cb?: (r: { ok?: boolean; error?: string }) => void) => void;
  'up-next:cancel': () => void;
  presence: (p: { away: boolean }) => void;
  'playback-hold': (p: { on: boolean }, cb?: (r: { ok?: boolean; error?: string }) => void) => void; 'call:url': (cb: (r: { url?: string; error?: string; status?: number }) => void) => void;
  'mode:set': (m: Mode) => void; reaction: (emoji: string) => void; playback: (p: Playback) => void;
  'queue:add': (i: { id: string; title: string; kind: VideoKind }, cb?: (r: { ok?: boolean; error?: string }) => void) => void; 'queue:remove': (id: string) => void; 'video:change': (i: QueueItem) => void;
  'chat:send': (t: string) => void; 'room:leave': () => void; 'browser:stop': () => void; 'video:ended': (id: string) => void;
  'file:prepare': (m: { name: string; type: string; size: number }, cb: (r: { error?: string; uploadUrl?: string; key?: string; maxBytes?: number }) => void) => void;
  'file:progress': (pct: number) => void; 'file:remove': () => void;
  'file:ready': (key: string, cb: (r: { ok?: boolean; error?: string }) => void) => void;
  'file:refresh': (cb: (r: { file: RoomFile | null }) => void) => void;
  'browser:start': (cb: (r: { ok?: boolean; error?: string }) => void) => void;
  'browser:control': (c: { action: 'take' | 'release' | 'pass'; to?: string }, cb?: (r: { error?: string }) => void) => void;
  'call-join': (status: { mic: boolean; cam: boolean }, cb: (r: { ok?: boolean; error?: string; peers?: Array<{ socketId: string; memberId: string; name: string; mic: boolean; cam: boolean }> }) => void) => void;
  'call-leave': () => void;
  'webrtc-offer': (p: { target: string; data: RTCSessionDescriptionInit }) => void;
  'webrtc-answer': (p: { target: string; data: RTCSessionDescriptionInit }) => void;
  'webrtc-ice-candidate': (p: { target: string; data: RTCIceCandidateInit }) => void;
}
export type AppSocket = Socket<ServerToClient, ClientToServer>;
export interface StageProps {
  socket: AppSocket; selfId: string; roomId: string; playback: LocalPlayback; current: QueueItem | null;
  emitPlayback: (p: Playback) => void; onDrift?: (driftSeconds: number) => void;
  isHost: boolean; canControl: boolean; // canControl is false for guests while the host keeps control
  interacted: boolean; // true once the user has tapped or typed on this page (browsers refuse sound before that)
  resync?: number; // changes when the room should jump to the live position
  driveMode?: { id: string; mode: 'auto' | 'manual' } | null;
  setDriveMode?: (m: 'auto' | 'manual', done: (err?: string) => void) => void;
  onManual?: (manual: boolean) => void; // a stage that cannot be synced automatically (embed fallback) reports it, so the room does not claim a sync status
  file: RoomFile | null;
}
export const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';
let memPass = '', memCid = ''; // fallback when a browser blocks sessionStorage
export const setPass = (p: string) => { memPass = p; try { sessionStorage.setItem('passcode', p); } catch {} };
export const clearPass = () => { memPass = ''; try { sessionStorage.removeItem('passcode'); } catch {} };
export const getPass = () => { if (typeof window === 'undefined') return ''; try { return sessionStorage.getItem('passcode') || memPass; } catch { return memPass; } };
export function getCid(): string { // stable per browser: every tab of one browser is the same participant, and reopening an invitation resumes the same seat
  if (typeof window === 'undefined') return '';
  const valid = (value: string | null): value is string => !!value && /^[A-Za-z0-9_-]{8,64}$/.test(value);
  let c: string | null = null; try { c = localStorage.getItem('cid'); } catch {}
  if (!valid(c) && valid(memCid)) c = memCid;
  if (!valid(c)) {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, '')
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    c = random.slice(0, 64);
    if (!valid(c)) c = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 64);
    memCid = c; try { localStorage.setItem('cid', c); } catch {}
  }
  return c;
}
