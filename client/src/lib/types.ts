import type { Socket } from 'socket.io-client';
export type Mode = 'youtube' | 'file' | 'browser';
export interface Playback { playing: boolean; time: number; rate: number }
export interface LocalPlayback extends Playback { at: number } // at = Date.now() when received
export interface QueueItem { id: string; title: string; addedBy: string }
export interface Profile { name: string; avatar: string; color: string }
export interface Member extends Profile { id: string }
export interface ChatMessage { id: string; from: string; name: string; avatar: string; color: string; text: string; at: number; system?: boolean }
export interface HbInfo { embedUrl: string; adminToken: string }
export interface RoomState { mode: Mode; queue: QueueItem[]; current: QueueItem | null; playback: Playback;
  chat: ChatMessage[]; hb: HbInfo | null; controller: string | null; members: Member[] }
export type FileSignal =
  | { kind: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'ready' } | { kind: 'ctrl'; playing: boolean; time: number };

export interface ServerToClient {
  'peer:joined': (m: Member) => void; reaction: (r: { id: string; emoji: string; from: string }) => void; 'peer:left': (id: string) => void;
  'mode:changed': (d: { mode: Mode; playback: Playback }) => void;
  playback: (d: Playback & { from: string }) => void;
  'queue:updated': (d: { queue: QueueItem[]; current: QueueItem | null }) => void;
  'chat:message': (m: ChatMessage) => void;
  'file:signal': (s: FileSignal) => void;
  'browser:controller': (id: string | null) => void;
  'hb:started': (i: HbInfo) => void; 'hb:stopped': () => void;
}
export interface ClientToServer {
  'room:join': (roomId: string, profile: Profile, cb: (r: { error?: string; state?: RoomState; selfId?: string; isHost?: boolean }) => void) => void;
  'mode:set': (m: Mode) => void; reaction: (emoji: string) => void; playback: (p: Playback) => void;
  'queue:add': (i: QueueItem) => void; 'queue:remove': (id: string) => void; 'video:change': (i: QueueItem) => void;
  'chat:send': (t: string) => void; 'file:signal': (s: FileSignal) => void; 'browser:control': (id: string | null) => void;
}
export type AppSocket = Socket<ServerToClient, ClientToServer>;
export interface StageProps {
  socket: AppSocket; selfId: string; roomId: string; playback: LocalPlayback; current: QueueItem | null;
  emitPlayback: (p: Playback) => void; onDrift?: (driftSeconds: number) => void;
}
export const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';
export const getPass = () => (typeof window === 'undefined' ? '' : sessionStorage.getItem('passcode') || '');
