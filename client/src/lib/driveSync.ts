/** Pure helpers for the Google Drive player. No React or DOM here, so they can be tested in Node. */

export interface PlaybackClock { playing: boolean; time: number; rate: number; at: number }

/** Where the room's video should be right now, from the last shared state and the local clock. */
export function expectedTime(pb: PlaybackClock, now: number): number {
  return pb.time + (pb.playing ? ((now - pb.at) / 1000) * pb.rate : 0);
}

export const DRIFT_TOLERANCE_S = 0.8;

/** True when a viewer should jump to the room's position. Never while that viewer's stream is stalled: seeking then only causes more stalling. */
export function needsCorrection(current: number, expected: number, buffering: boolean, tolerance = DRIFT_TOLERANCE_S): boolean {
  return !buffering && Number.isFinite(expected) && Math.abs(current - expected) > tolerance;
}

/**
 * Media addresses for a Drive file, best first.
 * 1. Google's documented Drive API (needs the API key; the browser asks for byte ranges, so seeking works).
 * 2. The address Drive's own download page uses. It is NOT documented and may stop working at any time; it is only a second try.
 */
export function driveSources(id: string, apiKey: string): string[] {
  if (!id) return [];
  const enc = encodeURIComponent(id), out: string[] = [];
  if (apiKey) out.push(`https://www.googleapis.com/drive/v3/files/${enc}?alt=media&key=${encodeURIComponent(apiKey)}`);
  out.push(`https://drive.usercontent.google.com/download?id=${enc}&export=download&confirm=t`);
  return out;
}

/** Google's own player page for the file. Used only when direct streaming has failed. */
export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;

/** m:ss, or h:mm:ss for films. */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
