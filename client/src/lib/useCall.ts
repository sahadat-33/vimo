'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import DailyIframe from '@daily-co/daily-js';
import type { DailyCall, DailyParticipant } from '@daily-co/daily-js';
import { api } from './socket';

export type CallState = 'joining' | 'joined' | 'error' | 'left';
export type NetQuality = 'good' | 'low' | 'very-low' | null;

class CallErr extends Error { constructor(public kind: 'network' | 'auth' | 'config' | 'server' | 'timeout' | 'join') { super(kind); } }
const MSG: Record<CallErr['kind'], string> = {
  network: 'Can’t reach the server. Check your connection and retry.', auth: 'Your session expired. Go back and enter the passcode again.',
  config: 'Video calls aren’t set up on the server yet.', server: 'The call service had a problem. Try again shortly.',
  timeout: 'The call took too long to connect.', join: 'Couldn’t connect to the call.' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new CallErr('timeout')), ms))]);

function mediaMessage(e: any): string {
  const t = e?.error?.type as string | undefined;
  if (t === 'permissions') return 'Camera or mic access is blocked. Allow it in your browser’s site settings, then tap the button again.';
  if (t === 'not-found') return 'No camera or microphone was found on this device.';
  if (t === 'cam-in-use' || t === 'mic-in-use' || t === 'cam-mic-in-use') return 'Your camera or mic is being used by another app.';
  return 'Camera or mic isn’t available right now. You can keep watching and chatting.';
}

/** Owns the single Daily call. Joins listen-only (no permission prompt); mic/camera are requested only when the user turns them on. */
export function useCall({ roomId, userName, sid, playing, smartMic }: { roomId: string; userName: string; sid: string; playing: boolean; smartMic: boolean }) {
  const call = useRef<DailyCall | null>(null);
  const sidRef = useRef(sid); sidRef.current = sid;
  const autoMuted = useRef(false);
  const tracks = useRef<{ audio?: MediaStreamTrack; video?: MediaStreamTrack }>({});
  const [parts, setParts] = useState<DailyParticipant[]>([]);
  const [state, setState] = useState<CallState>('joining');
  const [mic, setMic] = useState(false), [cam, setCam] = useState(false);
  const [error, setError] = useState(''), [mediaNote, setMediaNote] = useState(''), [net, setNet] = useState<NetQuality>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false, created: DailyCall | null = null;
    setState('joining'); setError(''); setMic(false); setCam(false);
    (async () => {
      // A previous attempt may still be shutting down. Daily refuses a second call object (and a half-destroyed one cannot join), so wait for it.
      const old = DailyIframe.getCallInstance(); if (old) await old.destroy().catch(() => {});
      if (dead) return;
      const c = DailyIframe.createCallObject({ startAudioOff: true, startVideoOff: true });
      created = c; call.current = c;
      const upd = () => { setParts(Object.values(c.participants())); setMic(!!c.localAudio()); setCam(!!c.localVideo()); };
      c.on('participant-joined', upd); c.on('participant-updated', upd); c.on('participant-left', upd);
      c.on('joined-meeting', () => { setState('joined'); setError(''); upd(); });
      c.on('left-meeting', () => { if (!dead) setState('left'); });
      c.on('camera-error', (e: any) => { setMediaNote(mediaMessage(e)); upd(); }); // non-blocking: the user stays in the room
      c.on('error', (e: any) => { if (dead) return; setState('error'); setError(e?.errorMsg ? `Call error: ${String(e.errorMsg).slice(0, 120)}` : MSG.join); });
      c.on('network-quality-change', (e: any) => setNet((e?.threshold as NetQuality) ?? null));
      for (let i = 0; i < 3 && !dead; i++) {
        try {
          const r = await api(`/api/daily/${roomId}`).catch(() => null);
          if (!r) throw new CallErr('network');
          if (r.status === 401 || r.status === 429) throw new CallErr('auth');
          if (r.status === 503) throw new CallErr('config');
          if (!r.ok) throw new CallErr('server');
          const { url } = await r.json();
          await withTimeout(c.join({ url, userName, userData: { sid: sidRef.current }, startAudioOff: true, startVideoOff: true }), 15000);
          return;
        } catch (e) {
          if (dead) return;
          const kind: CallErr['kind'] = e instanceof CallErr ? e.kind : 'join';
          if (kind === 'timeout') await c.leave().catch(() => {});
          if (kind === 'auth' || kind === 'config' || i === 2) { setState('error'); setError(MSG[kind]); return; }
          await sleep(1500 * (i + 1));
        }
      }
    })();
    return () => { dead = true; tracks.current.audio?.stop(); tracks.current.video?.stop(); tracks.current = {}; const x = created; if (call.current === x) call.current = null; x?.destroy().catch(() => {}); };
  }, [roomId, userName, attempt]);

  useEffect(() => { if (state === 'joined') call.current?.setUserData({ sid }).catch(() => {}); }, [sid, state]);
  useEffect(() => { // measured network quality, polled while connected
    if (state !== 'joined') return;
    const poll = () => call.current?.getNetworkStats().then((s: any) => setNet((s?.threshold as NetQuality) ?? null)).catch(() => {});
    poll(); const t = setInterval(poll, 10000); return () => clearInterval(t);
  }, [state]);

  // Smart Mic: playing mutes an enabled mic; pausing restores it only if Smart Mic muted it. Never prompts for permission by itself.
  useEffect(() => {
    const c = call.current; if (!smartMic || !c || state !== 'joined') return;
    if (playing) { if (c.localAudio()) { autoMuted.current = true; c.setLocalAudio(false); } }
    else if (autoMuted.current) { autoMuted.current = false; c.setLocalAudio(true); }
  }, [playing, smartMic, state]);

  // Turning a device on asks the browser for permission right here, inside the tap, so the prompt always appears and failures are specific.
  const enable = useCallback(async (kind: 'audio' | 'video') => {
    const c = call.current; if (!c) return;
    if (!navigator.mediaDevices?.getUserMedia) { setMediaNote('This browser can’t use the camera or microphone here. Open the link in Chrome or Safari.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: { echoCancellation: true, noiseSuppression: true } } : { video: { facingMode: 'user' } });
      const track = stream.getTracks()[0]; tracks.current[kind]?.stop(); tracks.current[kind] = track;
      await c.setInputDevicesAsync(kind === 'audio' ? { audioSource: track } : { videoSource: track });
      if (kind === 'audio') { c.setLocalAudio(true); setMic(true); } else { c.setLocalVideo(true); setCam(true); }
    } catch (e: any) {
      const what = kind === 'audio' ? 'microphone' : 'camera', n = e?.name;
      setMediaNote(n === 'NotAllowedError' || n === 'SecurityError' ? `Access to your ${what} is blocked. Tap the lock icon in the address bar, allow the ${what}, then tap the button again.`
        : n === 'NotFoundError' || n === 'OverconstrainedError' ? `No ${what} was found on this device.`
        : n === 'NotReadableError' || n === 'AbortError' ? `Your ${what} is being used by another app.`
        : `The ${what} isn’t available right now. You can keep watching and chatting.`);
    }
  }, []);
  const disable = useCallback((kind: 'audio' | 'video') => {
    const c = call.current; if (!c) return;
    if (kind === 'audio') { c.setLocalAudio(false); setMic(false); } else { c.setLocalVideo(false); setCam(false); }
    tracks.current[kind]?.stop(); tracks.current[kind] = undefined; // release the device so the browser's recording indicator turns off
  }, []);
  const toggleMic = useCallback(() => { const c = call.current; if (!c) return; autoMuted.current = false; setMediaNote(''); if (c.localAudio()) disable('audio'); else void enable('audio'); }, [enable, disable]);
  const toggleCam = useCallback(() => { const c = call.current; if (!c) return; setMediaNote(''); if (c.localVideo()) disable('video'); else void enable('video'); }, [enable, disable]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { parts, state, mic, cam, error, mediaNote, net, toggleMic, toggleCam, retry };
}
