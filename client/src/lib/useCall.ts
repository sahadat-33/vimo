'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import DailyIframe from '@daily-co/daily-js';
import type { DailyCall, DailyParticipant } from '@daily-co/daily-js';
import { api } from './socket';

export type CallState = 'joining' | 'joined' | 'error' | 'left';
export type NetQuality = 'good' | 'low' | 'very-low' | null;

/** Owns the single Daily call. Real feeds only; Smart Mic: playing mutes local mic, paused unmutes. */
export function useCall({ roomId, userName, sid, playing, smartMic }: { roomId: string; userName: string; sid: string; playing: boolean; smartMic: boolean }) {
  const call = useRef<DailyCall | null>(null);
  const sidRef = useRef(sid); sidRef.current = sid;
  const [parts, setParts] = useState<DailyParticipant[]>([]);
  const [state, setState] = useState<CallState>('joining');
  const [mic, setMic] = useState(true), [cam, setCam] = useState(true);
  const [error, setError] = useState(''), [net, setNet] = useState<NetQuality>(null);

  useEffect(() => {
    let dead = false;
    const c = DailyIframe.getCallInstance() ?? DailyIframe.createCallObject({ audioSource: true, videoSource: true });
    call.current = c;
    const upd = () => setParts(Object.values(c.participants()));
    c.on('participant-joined', upd); c.on('participant-updated', upd); c.on('participant-left', upd);
    c.on('joined-meeting', () => { setState('joined'); upd(); });
    c.on('left-meeting', () => setState('left'));
    c.on('error', () => { setState('error'); setError('Call connection lost.'); });
    c.on('network-quality-change', (e: any) => setNet((e?.threshold as NetQuality) ?? null));
    (async () => {
      const r = await api(`/api/daily/${roomId}`);
      if (!r.ok) { setState('error'); return setError('Could not start the call. Check your Daily key.'); }
      const { url } = await r.json();
      if (!dead) await c.join({ url, userName, userData: { sid: sidRef.current } }).catch(() => { setState('error'); setError('Camera or mic permission is needed to join the call.'); });
    })();
    return () => { dead = true; c.destroy(); };
  }, [roomId, userName]);

  useEffect(() => { if (state === 'joined') call.current?.setUserData({ sid }).catch(() => {}); }, [sid, state]);

  useEffect(() => { // measured network quality from Daily, polled while connected
    if (state !== 'joined') return;
    const poll = () => call.current?.getNetworkStats().then((s: any) => setNet((s?.threshold as NetQuality) ?? null)).catch(() => {});
    poll(); const t = setInterval(poll, 10000); return () => clearInterval(t);
  }, [state]);

  useEffect(() => { if (smartMic && call.current) { call.current.setLocalAudio(!playing); setMic(!playing); } }, [playing, smartMic]);

  const toggleMic = useCallback(() => { call.current?.setLocalAudio(!mic); setMic(!mic); }, [mic]);
  const toggleCam = useCallback(() => { call.current?.setLocalVideo(!cam); setCam(!cam); }, [cam]);
  return { parts, state, mic, cam, error, net, toggleMic, toggleCam };
}
