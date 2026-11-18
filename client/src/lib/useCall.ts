'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from './socket';
import type { AppSocket } from './types';

export type CallState = 'joining' | 'joined' | 'error' | 'left';
export type NetQuality = 'good' | 'low' | 'very-low' | null;
export interface CallParticipant {
  socketId: string; memberId: string; name: string; mic: boolean; cam: boolean;
  audioTrack?: MediaStreamTrack; videoTrack?: MediaStreamTrack;
  connectionState: RTCPeerConnectionState; local?: boolean;
}
type PeerInfo = { socketId: string; memberId: string; name: string; mic: boolean; cam: boolean };
type Signal = { from: string; data: RTCSessionDescriptionInit | RTCIceCandidateInit };
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const mediaMessage = (e: any, kind: 'audio' | 'video') => {
  const label = kind === 'audio' ? 'microphone' : 'camera';
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return `Access to your ${label} is blocked. Allow it in your browser site settings, then try again.`;
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return `No ${label} was found on this device.`;
  if (e?.name === 'NotReadableError' || e?.name === 'AbortError') return `Your ${label} is being used by another app.`;
  return `The ${label} isn’t available right now.`;
};

/** STUN-only WebRTC mesh. Media permissions are requested exclusively inside the user's button action. */
export function useCall({ roomId, userName, sid, playing, smartMic }: { roomId: string; userName: string; sid: string; playing: boolean; smartMic: boolean }) {
  const socket = useRef<AppSocket | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const peerInfo = useRef(new Map<string, PeerInfo>());
  const remoteTracks = useRef(new Map<string, { audio?: MediaStreamTrack; video?: MediaStreamTrack }>());
  const localTracks = useRef<{ audio?: MediaStreamTrack; video?: MediaStreamTrack }>({});
  const makingOffer = useRef(new Set<string>());
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const autoMuted = useRef(false);
  const restartAt = useRef(new Map<string, number>());
  const joined = useRef(false);
  const [parts, setParts] = useState<CallParticipant[]>([]);
  const [state, setState] = useState<CallState>('joining');
  const [mic, setMic] = useState(false), [cam, setCam] = useState(false);
  const [error, setError] = useState(''), [mediaNote, setMediaNote] = useState(''), [net, setNet] = useState<NetQuality>(null);

  const publish = useCallback(() => {
    const local = socket.current;
    const own: CallParticipant = { socketId: local?.id || 'local', memberId: sid, name: userName, mic: !!localTracks.current.audio?.enabled, cam: !!localTracks.current.video?.enabled,
      audioTrack: localTracks.current.audio, videoTrack: localTracks.current.video, connectionState: 'connected', local: true };
    const remote = [...peerInfo.current.values()].map((p) => ({ ...p, ...remoteTracks.current.get(p.socketId), connectionState: peers.current.get(p.socketId)?.connectionState || 'new' }));
    setParts([own, ...remote]);
  }, [sid, userName]);

  const send = useCallback((event: 'webrtc-offer' | 'webrtc-answer' | 'webrtc-ice-candidate', target: string, data: any) => {
    socket.current?.emit(event, { target, data } as any);
  }, []);

  const ensurePeer = useCallback((info: PeerInfo, initiate: boolean) => {
    const existing = peers.current.get(info.socketId);
    if (existing) { peerInfo.current.set(info.socketId, info); publish(); return existing; }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    peers.current.set(info.socketId, pc); peerInfo.current.set(info.socketId, info); remoteTracks.current.set(info.socketId, {});
    if (initiate) {
      const audio = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const video = pc.addTransceiver('video', { direction: 'sendrecv' });
      void audio.sender.replaceTrack(localTracks.current.audio || null).catch(() => {});
      void video.sender.replaceTrack(localTracks.current.video || null).catch(() => {});
    }
    pc.onicecandidate = (event) => { if (event.candidate) send('webrtc-ice-candidate', info.socketId, event.candidate.toJSON()); };
    pc.ontrack = (event) => {
      const bucket = remoteTracks.current.get(info.socketId) || {};
      if (event.track.kind === 'audio') bucket.audio = event.track; else if (event.track.kind === 'video') bucket.video = event.track;
      remoteTracks.current.set(info.socketId, bucket);
      event.track.onended = () => { const b = remoteTracks.current.get(info.socketId); if (b) { if (event.track.kind === 'audio') delete b.audio; else delete b.video; } publish(); };
      publish();
    };
    pc.onconnectionstatechange = () => {
      publish();
      if (pc.connectionState === 'failed') {
        const now = Date.now(), last = restartAt.current.get(info.socketId) || 0;
        if (now - last > 8000) { restartAt.current.set(info.socketId, now); try { pc.restartIce(); } catch {} }
      }
      if (pc.connectionState === 'closed') { peers.current.delete(info.socketId); peerInfo.current.delete(info.socketId); remoteTracks.current.delete(info.socketId); publish(); }
    };
    pc.onnegotiationneeded = async () => {
      if (!initiate && pc.signalingState === 'stable' && !pc.localDescription) return;
      if (makingOffer.current.has(info.socketId)) return;
      try {
        makingOffer.current.add(info.socketId);
        if (pc.signalingState !== 'stable') return;
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        if (pc.localDescription) send('webrtc-offer', info.socketId, pc.localDescription.toJSON());
      } catch { /* A later ICE restart or track change can negotiate again. */ }
      finally { makingOffer.current.delete(info.socketId); }
    };
    // Existing peers initiate offers; new joiners wait for those offers to avoid glare.
    if (initiate) queueMicrotask(() => { if (pc.signalingState === 'stable') pc.dispatchEvent(new Event('negotiationneeded')); });
    publish();
    return pc;
  }, [publish, send]);

  const closePeer = useCallback((id: string) => {
    const pc = peers.current.get(id); if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; pc.close(); }
    peers.current.delete(id); peerInfo.current.delete(id); remoteTracks.current.delete(id); makingOffer.current.delete(id); restartAt.current.delete(id); pendingIce.current.delete(id); publish();
  }, [publish]);

  const announce = useCallback((nextMic = !!localTracks.current.audio?.enabled, nextCam = !!localTracks.current.video?.enabled) => {
    const s = socket.current; if (!s) return;
    s.emit('call-join', { mic: nextMic, cam: nextCam }, (result: any) => {
      if (result?.error) { setMediaNote(result.error); if (nextCam) { localTracks.current.video?.stop(); delete localTracks.current.video; setCam(false); } return; }
      joined.current = true; setState('joined'); setError('');
      for (const p of (result?.peers || []) as PeerInfo[]) ensurePeer(p, false);
      publish();
    });
  }, [ensurePeer, publish]);

  useEffect(() => {
    const s = getSocket(roomId); socket.current = s; let disposed = false;
    const onConnect = () => { if (!disposed) { setState('joining'); announce(); } };
    const onDisconnect = () => { joined.current = false; for (const id of [...peers.current.keys()]) closePeer(id); if (!disposed) setState('joining'); };
    const onPeerJoined = (p: PeerInfo) => { if (p.socketId !== s.id) ensurePeer(p, true); };
    const onPeerLeft = ({ socketId }: { socketId: string }) => closePeer(socketId);
    const onOffer = async ({ from, data }: Signal) => {
      const info = peerInfo.current.get(from) || { socketId: from, memberId: from, name: 'Guest', mic: false, cam: false };
      const pc = ensurePeer(info, false);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit));
        for (const t of pc.getTransceivers()) { const kind = t.receiver.track.kind as 'audio' | 'video'; if (kind === 'audio' || kind === 'video') await t.sender.replaceTrack(localTracks.current[kind] || null).catch(() => {}); }
        const queued = pendingIce.current.get(from) || []; pendingIce.current.delete(from);
        for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); if (pc.localDescription) send('webrtc-answer', from, pc.localDescription.toJSON());
      } catch { closePeer(from); }
    };
    const onAnswer = async ({ from, data }: Signal) => { const pc = peers.current.get(from); if (pc) try { await pc.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit)); const queued = pendingIce.current.get(from) || []; pendingIce.current.delete(from); for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); } catch {} };
    const onIce = async ({ from, data }: Signal) => { const pc = peers.current.get(from), candidate = data as RTCIceCandidateInit; if (!pc || !pc.remoteDescription) { const q = pendingIce.current.get(from) || []; if (q.length < 100) q.push(candidate); pendingIce.current.set(from, q); return; } try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {} };
    s.on('connect', onConnect); s.on('disconnect', onDisconnect); s.on('call-peer-joined', onPeerJoined); s.on('call-peer-left', onPeerLeft);
    s.on('webrtc-offer', onOffer); s.on('webrtc-answer', onAnswer); s.on('webrtc-ice-candidate', onIce);
    if (s.connected) announce(); else s.connect();
    return () => {
      disposed = true; s.off('connect', onConnect); s.off('disconnect', onDisconnect); s.off('call-peer-joined', onPeerJoined); s.off('call-peer-left', onPeerLeft);
      s.off('webrtc-offer', onOffer); s.off('webrtc-answer', onAnswer); s.off('webrtc-ice-candidate', onIce);
      if (joined.current && s.connected) s.emit('call-leave'); joined.current = false;
      for (const id of [...peers.current.keys()]) closePeer(id);
      for (const track of Object.values(localTracks.current)) track?.stop(); localTracks.current = {}; setParts([]);
      if (socket.current === s) socket.current = null;
    };
  }, [announce, closePeer, ensurePeer, send, roomId]);

  const tuneSender = async (sender: RTCRtpSender, kind: 'audio' | 'video', bitrate = 520000) => {
    try { const p = sender.getParameters(); if (!p.encodings?.length) p.encodings = [{}];
      if (kind === 'video') { p.encodings[0].maxBitrate = bitrate; p.encodings[0].maxFramerate = 24; }
      else p.encodings[0].maxBitrate = 48000;
      await sender.setParameters(p);
    } catch { /* Browser may not support sender tuning; WebRTC congestion control remains active. */ }
  };
  const replaceTrack = useCallback(async (kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
    for (const pc of peers.current.values()) {
      const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === kind);
      if (transceiver) { await transceiver.sender.replaceTrack(track); if (track) await tuneSender(transceiver.sender, kind); }
      else if (track) { const sender = pc.addTrack(track, new MediaStream([track])); await tuneSender(sender, kind); }
    }
  }, []);

  const enable = useCallback(async (kind: 'audio' | 'video') => {
    if (!navigator.mediaDevices?.getUserMedia) { setMediaNote('Camera and microphone require a secure browser connection. Open Vimo over HTTPS.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio'
        ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }
        : { audio: false, video: { facingMode: 'user', width: { ideal: 640, max: 960 }, height: { ideal: 360, max: 540 }, frameRate: { ideal: 24, max: 24 } } });
      const track = stream.getTracks()[0];
      const old = localTracks.current[kind]; if (old) old.stop(); localTracks.current[kind] = track;
      if (kind === 'video') { track.contentHint = 'motion'; }
      await replaceTrack(kind, track);
      if (kind === 'audio') { track.enabled = !smartMic || !playing; autoMuted.current = !!(smartMic && playing); setMic(track.enabled); } else setCam(true);
      setMediaNote(''); publish(); announce(kind === 'audio' ? track.enabled : !!localTracks.current.audio?.enabled, kind === 'video' ? true : !!localTracks.current.video?.enabled);
    } catch (e: any) { setMediaNote(mediaMessage(e, kind)); }
  }, [announce, playing, publish, replaceTrack, smartMic]);

  const disable = useCallback(async (kind: 'audio' | 'video') => {
    const track = localTracks.current[kind]; if (track) { track.enabled = false; await replaceTrack(kind, null).catch(() => {}); track.stop(); delete localTracks.current[kind]; }
    if (kind === 'audio') setMic(false); else setCam(false);
    announce(kind === 'audio' ? false : !!localTracks.current.audio?.enabled, kind === 'video' ? false : !!localTracks.current.video?.enabled); publish();
  }, [announce, publish, replaceTrack]);

  const toggleMic = useCallback(() => { setMediaNote(''); const track = localTracks.current.audio; if (track) { track.enabled = !track.enabled; setMic(track.enabled); announce(track.enabled, !!localTracks.current.video?.enabled); publish(); } else void enable('audio'); }, [announce, enable, publish]);
  const toggleCam = useCallback(() => { setMediaNote(''); if (localTracks.current.video) void disable('video'); else void enable('video'); }, [disable, enable]);

  useEffect(() => {
    const track = localTracks.current.audio; if (!track) return;
    if (smartMic && playing) { if (track.enabled) autoMuted.current = true; track.enabled = false; }
    else if (autoMuted.current) { track.enabled = true; autoMuted.current = false; }
    setMic(track.enabled); announce(track.enabled, !!localTracks.current.video?.enabled); publish();
  }, [playing, smartMic, announce, publish]);
  useEffect(() => {
    if (state !== 'joined') return;
    const timer = setInterval(async () => {
      const pcs = [...peers.current.values()]; if (!pcs.length) { setNet(null); return; }
      let worstRtt = 0, worstLoss = 0, failed = false;
      for (const pc of pcs) {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') failed = true;
        try { const stats = await pc.getStats(); stats.forEach((v: any) => { if (v.type === 'candidate-pair' && v.state === 'succeeded' && v.currentRoundTripTime) worstRtt = Math.max(worstRtt, v.currentRoundTripTime); if (v.type === 'remote-inbound-rtp' && typeof v.fractionLost === 'number') worstLoss = Math.max(worstLoss, v.fractionLost); }); } catch {}
      }
      const bitrate = failed || worstRtt > 0.5 || worstLoss > 0.08 ? 180000 : worstRtt > 0.22 || worstLoss > 0.03 ? 320000 : 520000;
      for (const pc of pcs) for (const sender of pc.getSenders()) if (sender.track?.kind === 'video') await tuneSender(sender, 'video', bitrate);
      setNet(bitrate <= 180000 ? 'very-low' : bitrate <= 320000 ? 'low' : 'good');
    }, 10000);
    return () => clearInterval(timer);
  }, [state]);

  const retry = useCallback(() => { setError(''); setState('joining'); announce(); }, [announce]);
  return { parts, state, mic, cam, error, mediaNote, net, toggleMic, toggleCam, retry };
}
