'use client';
import { useEffect, useRef, useState } from 'react';
import { FileVideo } from 'lucide-react';
import type { FileSignal, StageProps } from '@/lib/types';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function StageLocalFile({ socket, playback, emitPlayback }: StageProps) {
  const vid = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const sending = useRef(false);
  const [role, setRole] = useState<'none' | 'sender' | 'receiver'>('none');
  const [status, setStatus] = useState('Pick a video on one device. It streams straight to your partner, with no upload.');
  const pbRef = useRef(playback); pbRef.current = playback;

  const makePc = () => {
    pc.current?.close();
    const p = new RTCPeerConnection({ iceServers: ICE });
    p.onicecandidate = (e) => e.candidate && socket.emit('file:signal', { kind: 'ice', candidate: e.candidate.toJSON() });
    p.ontrack = (e) => { if (vid.current) { vid.current.srcObject = e.streams[0]; vid.current.play().catch(() => setStatus('Tap the video to start playback')); setStatus(''); } };
    p.onconnectionstatechange = () => p.connectionState === 'failed' && setStatus('Connection failed. Ask your partner to re-pick the file.');
    pc.current = p; return p;
  };
  async function offer() {
    const v = vid.current as any, p = makePc();
    const stream: MediaStream = (v.captureStream || v.mozCaptureStream).call(v);
    stream.getTracks().forEach((t) => p.addTrack(t, stream));
    await p.setLocalDescription(await p.createOffer());
    socket.emit('file:signal', { kind: 'offer', sdp: p.localDescription! });
  }

  useEffect(() => {
    const on = async (s: FileSignal) => {
      if (s.kind === 'ready' && sending.current) await offer();
      if (s.kind === 'offer') { setRole('receiver'); const p = makePc(); await p.setRemoteDescription(s.sdp);
        await p.setLocalDescription(await p.createAnswer()); socket.emit('file:signal', { kind: 'answer', sdp: p.localDescription! }); }
      if (s.kind === 'answer') await pc.current?.setRemoteDescription(s.sdp);
      if (s.kind === 'ice') await pc.current?.addIceCandidate(s.candidate).catch(() => {});
      if (s.kind === 'ctrl' && sending.current && vid.current) { // partner's remote control
        vid.current.currentTime = s.time; s.playing ? vid.current.play() : vid.current.pause(); }
    };
    socket.on('file:signal', on);
    const joined = () => sending.current && offer();
    socket.on('peer:joined', joined);
    return () => { socket.off('file:signal', on); socket.off('peer:joined', joined); pc.current?.close(); };
  }, []); // eslint-disable-line

  useEffect(() => { // sender follows room playback from partner (via ctrl); receiver mirrors state for Smart Mic only
    const v = vid.current; if (!v || role !== 'sender') return;
    if (Math.abs(v.currentTime - playback.time) > 0.8 && !playback.playing) v.currentTime = playback.time;
    playback.playing ? v.play().catch(() => {}) : v.pause();
  }, [playback, role]);

  function pick(f?: File) {
    if (!f || !vid.current) return;
    sending.current = true; setRole('sender'); setStatus('');
    vid.current.srcObject = null; vid.current.src = URL.createObjectURL(f);
    vid.current.onloadedmetadata = () => offer();
  }
  const send = (playing: boolean) => {
    const v = vid.current!; const snap = { playing, time: v.currentTime, rate: 1 };
    emitPlayback(snap);
    if (!sending.current) socket.emit('file:signal', { kind: 'ctrl', playing, time: v.currentTime });
  };

  return <div className="relative h-full w-full bg-black">
    <video ref={vid} className="h-full w-full object-contain" playsInline controls={role !== 'none'}
      onPlay={() => send(true)} onPause={() => send(false)} onSeeked={() => send(!vid.current!.paused)} />
    {role === 'none' && <label className="absolute inset-0 grid cursor-pointer place-items-center p-6 text-center">
      <span className="flex flex-col items-center gap-3 text-cream/80"><FileVideo size={36} />{status}
        <span className="rounded-full bg-blush px-4 py-2 font-semibold text-night">Choose video file</span></span>
      <input type="file" accept="video/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} /></label>}
    {status && role !== 'none' && <p className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs">{status}</p>}
  </div>;
}
