import { getSocket, ytId } from './socket';
import { getCid, type Mode, type VideoKind } from './types';

/** Asks the server to start a party. Only works for someone who entered the passcode. Resolves with the room id. */
export function createRoom(o: { mode: Mode; hostOnly: boolean; video?: { id: string; title: string; kind?: VideoKind } }): Promise<string> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Can’t reach the server. It may be waking up, so try again in a few seconds.')), 12000);
    getSocket().emit('room:create', { cid: getCid(), ...o }, (r) => { clearTimeout(t); if (r?.roomId) res(r.roomId); else rej(new Error(r?.error || 'Could not start the party.')); });
  });
}

// The video the host picked on the setup page, handed to the room screen in memory (a File cannot travel in a URL).
let pending: File | null = null;
export const setPendingFile = (f: File | null) => { pending = f; };
export const takePendingFile = () => { const f = pending; pending = null; return f; };

export type { VideoKind };
export interface ParsedVideo { kind: VideoKind; id: string }
export const BAD_LINK = 'Paste a video link: YouTube or Google Drive.';

/**
 * Public Google Drive API key. It runs in the browser, so anyone can see it: restrict it in Google Cloud to
 * (1) the Google Drive API only and (2) HTTP referrers https://vimo1.vercel.app/* (and your preview domains).
 * Without it, Drive videos are not checked and play through Google's own player (Manual Sync Mode).
 */
export const DRIVE_KEY = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY || '';

/** Recognises YouTube and Google Drive video links. Returns null for anything else. */
export function parseVideoLink(input: string): ParsedVideo | null {
  const raw = input.trim(); if (!raw) return null;
  const yt = ytId(raw); if (yt) return { kind: 'youtube', id: yt };
  let u: URL; try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.hostname.toLowerCase() !== 'drive.google.com') return null; // Docs, Sheets, Photos etc. are not video links
  // Accepted: /file/d/<id>/view, /file/u/0/d/<id>/preview, /open?id=<id>, /uc?id=<id>
  const m = u.pathname.match(/\/d\/([\w-]{10,80})(?:\/|$)/), id = m ? m[1] : u.searchParams.get('id');
  return id && /^[\w-]{10,80}$/.test(id) ? { kind: 'gdrive', id } : null;
}

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|ts|mpg|mpeg|3gp|wmv|flv)$/i;
type DriveCheck = { error: string } | { name: string | null };
const NOT_SHARED = 'That Google Drive file isn’t available to this site. In Drive, set sharing to “Anyone with the link”, then try again.';

/**
 * Checks a Drive file before it goes in the queue: it must be a video, shared as "Anyone with the link", and not a folder or a Doc.
 * Shortcuts are followed once. Quota or rate limits, and any temporary failure, let the file through: the player then decides, and
 * falls back to Google's own player if it cannot stream the file.
 */
async function checkDrive(id: string, depth = 0): Promise<DriveCheck> {
  if (!DRIVE_KEY) return { name: null }; // no key: nothing to check, the player will try
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,mimeType,shortcutDetails&supportsAllDrives=true&key=${encodeURIComponent(DRIVE_KEY)}`, { signal: ac.signal });
    const body = (await r.json().catch(() => ({}))) as { name?: string; mimeType?: string; shortcutDetails?: { targetId?: string }; error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = String(body.error?.errors?.[0]?.reason || ''), msg = String(body.error?.message || '');
    if (r.status === 400 || r.status === 401 || /accessNotConfigured|keyInvalid|ipRefererBlocked/.test(reason) || /referer|API key/i.test(msg))
      return { error: 'Google Drive isn’t set up for this site yet (the API key is rejected or restricted). The site owner needs to check the Drive API key settings.' };
    if (r.status === 404) return { error: NOT_SHARED };
    if (r.status === 403 && /insufficientFilePermissions|appNotAuthorizedToFile|forbidden/.test(reason)) return { error: NOT_SHARED };
    if (!r.ok) return { name: null }; // rate limited, quota or temporary: let the player try
    const f = body, mime = String(f.mimeType || ''), name = String(f.name || '').trim();
    if (mime === 'application/vnd.google-apps.shortcut') {
      const target = f.shortcutDetails?.targetId;
      if (!target || depth > 0) return { error: 'That Google Drive shortcut doesn’t lead to a video file.' };
      return checkDrive(target, depth + 1);
    }
    if (mime === 'application/vnd.google-apps.folder') return { error: 'That’s a Google Drive folder, not a video. Paste the link to the video file itself.' };
    if (mime.startsWith('application/vnd.google-apps.')) return { error: 'That’s a Google Doc, Sheet or Slide, not a video file.' };
    const isVideo = mime.startsWith('video/') || mime === 'application/octet-stream' || VIDEO_EXT.test(name);
    if (!isVideo) return { error: 'That Google Drive file doesn’t look like a video.' };
    return { name: name ? name.slice(0, 120) : null };
  } catch { return { name: null }; } // offline or slow: accept, the player will tell the story
  finally { clearTimeout(t); }
}

/** Detects the link, checks it, and finds a title. YouTube also checks that the video exists and may be embedded. */
export async function resolveVideo(input: string): Promise<(ParsedVideo & { title: string }) | { error: string }> {
  const p = parseVideoLink(input);
  if (!p) return { error: BAD_LINK };
  if (p.kind === 'youtube') {
    let title = p.id;
    try { // oEmbed says up front whether the video exists and may be embedded
      const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${p.id}&format=json`);
      if (r.status === 404) return { error: 'That video wasn’t found, or it is private.' };
      if (r.status === 401 || r.status === 403) return { error: 'The owner doesn’t allow this video to be embedded, so it can’t play here.' };
      if (r.ok) title = String((await r.json()).title || p.id).slice(0, 120);
    } catch {}
    return { ...p, title };
  }
  const c = await checkDrive(p.id);
  if ('error' in c) return { error: c.error };
  return { ...p, title: c.name ?? 'Google Drive video' };
}
