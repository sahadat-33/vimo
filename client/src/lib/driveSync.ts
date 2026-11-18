/** Pure helpers for the Google Drive player. No React or DOM here, so they are tested in Node. */

export interface PlaybackClock { playing: boolean; time: number; rate: number; at: number }

/** Where the room's video should be right now, from the last shared state and the local clock. */
export function expectedTime(pb: PlaybackClock, now: number): number {
  return pb.time + (pb.playing ? ((now - pb.at) / 1000) * pb.rate : 0);
}

export const MAX_ATTEMPTS = 3;
export const START_LIMIT_MS = 15000;
/** Pause before attempt n (n = 1, 2, 3). */
export function retryDelay(attempt: number): number { return attempt <= 1 ? 0 : attempt === 2 ? 1500 : 3000; }

/** Drift handling. Small differences are absorbed by a slight speed change; only large ones cause a seek. */
export const NUDGE_FROM_S = 0.8, SEEK_FROM_S = 3, NUDGE = 0.05;
export type DriftAction = 'none' | 'slow' | 'fast' | 'seek';
/** diff = this viewer's position minus the room's expected position (positive = ahead). Nothing happens while buffering or paused. */
export function driftAction(diff: number, playing: boolean, buffering: boolean): DriftAction {
  if (buffering || !playing || !Number.isFinite(diff)) return 'none';
  const a = Math.abs(diff);
  if (a > SEEK_FROM_S) return 'seek';
  if (a > NUDGE_FROM_S) return diff > 0 ? 'slow' : 'fast';
  return 'none';
}
export function nudgedRate(base: number, action: DriftAction): number {
  return action === 'slow' ? base * (1 - NUDGE) : action === 'fast' ? base * (1 + NUDGE) : base;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * Media addresses for a Drive file, best first.
 * 1. Google's documented Drive API (needs the API key; the browser asks for byte ranges, so seeking works).
 * 2. The address Drive's own download page uses. NOT documented; may stop working. It is only a second route.
 */
export function driveSources(id: string, apiKey: string): string[] {
  if (!id) return [];
  const enc = encodeURIComponent(id), out: string[] = [];
  if (apiKey) out.push(`https://www.googleapis.com/drive/v3/files/${enc}?alt=media&key=${encodeURIComponent(apiKey)}`);
  out.push(`https://drive.usercontent.google.com/download?id=${enc}&export=download&confirm=t`);
  return out;
}
/** Attempts alternate between the sources: 1st API, 2nd second route, 3rd API again (when there are two). */
export function sourceForAttempt(sources: string[], attempt: number): string | undefined {
  return sources.length ? sources[(attempt - 1) % sources.length] : undefined;
}

/** Google's own player page for the file. Used only when the room has chosen it. */
export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;

/** m:ss, or h:mm:ss for films. */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Whether a failure can be fixed by trying again. */
export type Verdict = { kind: 'ok' } | { kind: 'temporary'; message: string } | { kind: 'permanent'; message: string };
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|ts|mpg|mpeg|3gp|wmv|flv)$/i;

/** Classifies Google's answer to a metadata request. Only permanent problems stop the retries. */
export function classifyDriveResponse(status: number, reason: string, message: string, mime: string, name: string): Verdict {
  if (status === 400 || status === 401 || /accessNotConfigured|keyInvalid|ipRefererBlocked/.test(reason) || /referer|API key/i.test(message))
    return { kind: 'permanent', message: 'Google Drive’s API key is rejected for this site. The site owner needs to check it.' };
  if (status === 404) return { kind: 'permanent', message: 'This file isn’t available. Check the link, and set sharing to “Anyone with the link”.' };
  if (status === 403 && /insufficientFilePermissions|appNotAuthorizedToFile|forbidden/.test(reason))
    return { kind: 'permanent', message: 'This file is private. Set sharing to “Anyone with the link”, then try again.' };
  if (status === 429 || status >= 500 || /rateLimit|userRateLimit|dailyLimit|quota|backend/i.test(reason))
    return { kind: 'temporary', message: 'Google Drive is busy right now.' };
  if (status < 200 || status >= 300) return { kind: 'temporary', message: 'Google Drive didn’t answer as expected.' };
  if (mime.startsWith('application/vnd.google-apps.')) return { kind: 'permanent', message: 'That’s a Google Doc, Sheet, Slide or folder, not a video.' };
  if (!(mime.startsWith('video/') || mime === 'application/octet-stream' || VIDEO_EXT.test(name)))
    return { kind: 'permanent', message: 'This doesn’t look like a video file.' };
  return { kind: 'ok' };
}

/** Asks Drive about the file before playing. Without an API key there is nothing to ask, so it is 'ok'. */
export async function probeDrive(id: string, apiKey: string): Promise<Verdict> {
  if (!apiKey || !id) return { kind: 'ok' };
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,mimeType&supportsAllDrives=true&key=${encodeURIComponent(apiKey)}`, { signal: ac.signal });
    const body = (await r.json().catch(() => ({}))) as { name?: string; mimeType?: string; error?: { message?: string; errors?: { reason?: string }[] } };
    return classifyDriveResponse(r.status, String(body.error?.errors?.[0]?.reason || ''), String(body.error?.message || ''), String(body.mimeType || ''), String(body.name || ''));
  } catch { return { kind: 'temporary', message: 'Couldn’t reach Google Drive.' }; }
  finally { clearTimeout(timer); }
}
