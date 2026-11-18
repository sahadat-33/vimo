'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from './socket';

export type CallState = 'joining' | 'joined' | 'error' | 'left';
export type NetQuality = 'good' | 'low' | 'very-low' | null;

export interface CallParticipant {
  socketId: string;
  memberId: string;
  name: string;
  local: boolean;
  mic: boolean;
  cam: boolean;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
}

type PeerInfo = {
  socketId: string;
  memberId: string;
  name: string;
  mic: boolean;
  cam: boolean;
};

type SignalMessage = {
  from: string;
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const mediaError = (error: unknown, kind: 'audio' | 'video') => {
  const name = (error as { name?: string })?.name;
  const device = kind === 'audio' ? 'microphone' : 'camera';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Access to your ${device} is blocked. Allow it in your browser settings, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No ${device} was found on this device.`;
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `Your ${device} is being used by another app.`;
  }
  return `The ${device} isn't available right now. You can keep watching and chatting.`;
};

const waitForSocket = (socket: any) =>
  new Promise<void>((resolve, reject) => {
    if (socket.connected) return resolve();
    const timeout = setTimeout(() => {
      socket.off('connect', onConnect);
      reject(new Error('Could not connect to the room server.'));
    }, 10000);
    const onConnect = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.once('connect', onConnect);
    if (!socket.active) socket.connect();
  });

/**
 * Native browser WebRTC calling.
 * Socket.IO is used only for room membership and SDP/ICE signaling;
 * audio and video travel peer-to-peer whenever the network permits.
 */
export function useCall({
  roomId,
  userName,
  sid,
  playing,
  smartMic,
}: {
  roomId: string;
  userName: string;
  sid: string;
  playing: boolean;
  smartMic: boolean;
}) {
  const [parts, setParts] = useState<CallParticipant[]>([]);
  const [state, setState] = useState<CallState>('joining');
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [error, setError] = useState('');
  const [mediaNote, setMediaNote] = useState('');
  const [net, setNet] = useState<NetQuality>(null);
  const [attempt, setAttempt] = useState(0);

  const socketRef = useRef<any>(null);
  const localStream = useRef<MediaStream>(new MediaStream());
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerInfo = useRef<Map<string, PeerInfo>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const dead = useRef(false);
  const autoMuted = useRef(false);
  const micRef = useRef(false);
  const camRef = useRef(false);
  const stateRef = useRef<CallState>('joining');
  const sidRef = useRef(sid);
  sidRef.current = sid;

  const updateState = (next: CallState) => {
    stateRef.current = next;
    setState(next);
  };

  const refreshParts = useCallback(() => {
    const localSocketId = socketRef.current?.id;
    const local: CallParticipant = {
      socketId: localSocketId || 'local',
      memberId: sidRef.current,
      name: userName,
      local: true,
      mic: micRef.current,
      cam: camRef.current,
      audioTrack: localStream.current.getAudioTracks()[0],
      videoTrack: localStream.current.getVideoTracks()[0],
    };

    const remote = [...peerInfo.current.values()].map((info) => {
      const stream = remoteStreams.current.get(info.socketId);
      const audioTrack = stream?.getAudioTracks()[0];
      const videoTrack = stream?.getVideoTracks()[0];
      return {
        ...info,
        local: false,
        audioTrack,
        videoTrack,
        mic: !!audioTrack && audioTrack.readyState === 'live' && !audioTrack.muted,
        cam: !!videoTrack && videoTrack.readyState === 'live' && !videoTrack.muted,
      };
    });
    setParts([local, ...remote]);
  }, [userName]);

  const sendSignal = useCallback((event: string, target: string, data: unknown) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit(event, { target, data }, (result?: { error?: string }) => {
      if (result?.error) console.warn(`WebRTC ${event}:`, result.error);
    });
  }, []);

  const makePeer = useCallback((info: PeerInfo) => {
    const existing = peers.current.get(info.socketId);
    if (existing) return existing;

    peerInfo.current.set(info.socketId, info);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peers.current.set(info.socketId, pc);

    // Attach any local tracks already enabled.
    localStream.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStream.current);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('webrtc-ice-candidate', info.socketId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      let stream = remoteStreams.current.get(info.socketId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreams.current.set(info.socketId, stream);
      }
      if (!stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      event.track.onmute = refreshParts;
      event.track.onunmute = refreshParts;
      event.track.onended = refreshParts;
      refreshParts();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // ICE restart gives transient network changes a chance to recover.
        void pc.restartIce();
      }
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        refreshParts();
      }
    };

    // Perfect-negotiation pattern prevents offer collisions when tracks are toggled.
    let makingOffer = false;
    let ignoreOffer = false;
    let settingRemoteAnswer = false;
    const pendingIce: RTCIceCandidateInit[] = [];
    const polite = (socketRef.current?.id || '') > info.socketId;

    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          sendSignal('webrtc-offer', info.socketId, pc.localDescription.toJSON());
        }
      } catch (err) {
        console.warn('WebRTC offer failed:', err);
      } finally {
        makingOffer = false;
      }
    };

    (pc as RTCPeerConnection & { __receiveSignal?: (type: string, data: any) => Promise<void> }).__receiveSignal =
      async (type, data) => {
        try {
          const description = type === 'webrtc-ice-candidate'
            ? null
            : new RTCSessionDescription(data as RTCSessionDescriptionInit);
          const readyForOffer = !makingOffer &&
            (pc.signalingState === 'stable' || settingRemoteAnswer);
          const offerCollision = type === 'webrtc-offer' && !readyForOffer;

          ignoreOffer = !polite && offerCollision;
          if (ignoreOffer) return;

          if (type === 'webrtc-ice-candidate') {
            const candidate = data as RTCIceCandidateInit;
            if (!pc.remoteDescription) {
              pendingIce.push(candidate);
              return;
            }
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              if (!ignoreOffer) throw err;
            }
            return;
          }

          if (!description) return;
          if (type === 'webrtc-answer') {
            settingRemoteAnswer = true;
            await pc.setRemoteDescription(description);
            settingRemoteAnswer = false;
            while (pendingIce.length) {
              await pc.addIceCandidate(new RTCIceCandidate(pendingIce.shift()!));
            }
            return;
          }

          if (type === 'webrtc-offer') {
            if (offerCollision && polite) {
              await Promise.all([
                pc.setLocalDescription({ type: 'rollback' }),
                pc.setRemoteDescription(description),
              ]);
            } else {
              await pc.setRemoteDescription(description);
            }
            while (pendingIce.length) {
              await pc.addIceCandidate(new RTCIceCandidate(pendingIce.shift()!));
            }
            await pc.setLocalDescription();
            if (pc.localDescription) {
              sendSignal('webrtc-answer', info.socketId, pc.localDescription.toJSON());
            }
          }
        } catch (err) {
          settingRemoteAnswer = false;
          console.warn('WebRTC signaling failed:', err);
        }
      };

    refreshParts();
    return pc;
  }, [refreshParts, sendSignal]);

  const removePeer = useCallback((socketId: string) => {
    const pc = peers.current.get(socketId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onnegotiationneeded = null;
      pc.close();
    }
    peers.current.delete(socketId);
    peerInfo.current.delete(socketId);
    remoteStreams.current.delete(socketId);
    refreshParts();
  }, [refreshParts]);

  useEffect(() => {
    dead.current = false;
    updateState('joining');
    setError('');
    setMediaNote('');
    micRef.current = false;
    camRef.current = false;
    setMic(false);
    setCam(false);
    localStream.current = new MediaStream();

    const socket = getSocket(roomId) as any;
    socketRef.current = socket;

    const cleanup = () => {
      dead.current = true;
      socket.off('call-peer-joined', onPeerJoined);
      socket.off('call-peer-left', onPeerLeft);
      socket.off('webrtc-offer', onOffer);
      socket.off('webrtc-answer', onAnswer);
      socket.off('webrtc-ice-candidate', onIce);
      socket.emit('call-leave');
      peers.current.forEach((pc) => pc.close());
      peers.current.clear();
      peerInfo.current.clear();
      remoteStreams.current.clear();
      localStream.current.getTracks().forEach((track) => track.stop());
      localStream.current = new MediaStream();
      socketRef.current = null;
    };

    const receive = (event: string, message: SignalMessage) => {
      if (!message?.from || !message.data) return;
      const info = peerInfo.current.get(message.from);
      if (!info) return;
      const pc = peers.current.get(message.from) || makePeer(info);
      const handler = (pc as RTCPeerConnection & { __receiveSignal?: (type: string, data: any) => Promise<void> }).__receiveSignal;
      if (handler) void handler(event, message.data);
    };

    const onPeerJoined = (info: PeerInfo) => {
      if (!info?.socketId || info.socketId === socket.id) return;
      peerInfo.current.set(info.socketId, info);
      refreshParts();
      // The newcomer initiates offers to peers returned by call-join; existing
      // members wait for that offer, avoiding duplicate initial negotiations.
    };
    const onPeerLeft = (payload: { socketId?: string }) => {
      if (payload?.socketId) removePeer(payload.socketId);
    };
    const onOffer = (message: SignalMessage) => receive('webrtc-offer', message);
    const onAnswer = (message: SignalMessage) => receive('webrtc-answer', message);
    const onIce = (message: SignalMessage) => receive('webrtc-ice-candidate', message);

    socket.on('call-peer-joined', onPeerJoined);
    socket.on('call-peer-left', onPeerLeft);
    socket.on('webrtc-offer', onOffer);
    socket.on('webrtc-answer', onAnswer);
    socket.on('webrtc-ice-candidate', onIce);

    void (async () => {
      try {
        await waitForSocket(socket);
        if (dead.current) return;
        socket.emit('call-join', { mic: false, cam: false }, (result: { ok?: boolean; peers?: PeerInfo[]; error?: string }) => {
          if (dead.current) return;
          if (!result?.ok) {
            setError(result?.error || 'Could not join the voice call.');
            updateState('error');
            return;
          }
          updateState('joined');
          (result.peers || []).forEach((info) => {
            if (!info?.socketId || info.socketId === socket.id) return;
            const pc = makePeer(info);
            // This client is the newcomer, so it offers to existing participants.
            void pc.createOffer()
              .then((offer) => pc.setLocalDescription(offer))
              .then(() => {
                if (pc.localDescription) {
                  sendSignal('webrtc-offer', info.socketId, pc.localDescription.toJSON());
                }
              })
              .catch((err) => console.warn('Could not start peer connection:', err));
          });
          refreshParts();
        });
      } catch (err) {
        if (dead.current) return;
        setError(err instanceof Error ? err.message : 'Could not connect to the call.');
        updateState('error');
      }
    })();

    return cleanup;
  }, [roomId, attempt, makePeer, refreshParts, removePeer, sendSignal, userName]);

  useEffect(() => {
    if (state !== 'joined') return;
    const timer = setInterval(async () => {
      const samples: number[] = [];
      for (const pc of peers.current.values()) {
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            const pair = report as RTCStats & { state?: string; currentRoundTripTime?: number };
            if (pair.type === 'candidate-pair' && pair.state === 'succeeded' && pair.currentRoundTripTime) {
              samples.push(pair.currentRoundTripTime);
            }
          });
        } catch {
          // A peer may have disconnected while stats were being read.
        }
      }
      if (samples.length) {
        const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        setNet(average < 0.18 ? 'good' : average < 0.4 ? 'low' : 'very-low');
      } else if (peers.current.size) {
        setNet('low');
      } else {
        setNet(null);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (!smartMic || state !== 'joined') return;
    const track = localStream.current.getAudioTracks()[0];
    if (!track) return;
    if (playing && track.enabled) {
      autoMuted.current = true;
      track.enabled = false;
    } else if (!playing && autoMuted.current) {
      autoMuted.current = false;
      track.enabled = true;
    }
  }, [playing, smartMic, state]);

  const enable = useCallback(async (kind: 'audio' | 'video') => {
    if (stateRef.current !== 'joined') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaNote('This browser cannot access the camera or microphone. Open VIMO in Chrome or Safari.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'audio'
          ? { audio: { echoCancellation: true, noiseSuppression: true } }
          : { video: { facingMode: 'user' } },
      );
      const track = stream.getTracks()[0];
      if (!track) throw new Error('No media track was returned.');

      const existing = localStream.current.getTracks().find((item) => item.kind === kind);
      if (existing) {
        existing.stop();
        localStream.current.removeTrack(existing);
      }
      localStream.current.addTrack(track);

      peers.current.forEach((pc) => {
        const sender = pc.getSenders().find((item) => item.track?.kind === kind);
        if (sender) void sender.replaceTrack(track);
        else pc.addTrack(track, localStream.current);
      });

      if (kind === 'audio') {
        micRef.current = true;
        setMic(true);
      } else {
        camRef.current = true;
        setCam(true);
      }
      setMediaNote('');
      refreshParts();
    } catch (err) {
      setMediaNote(mediaError(err, kind));
    }
  }, [refreshParts]);

  const disable = useCallback((kind: 'audio' | 'video') => {
    const track = localStream.current.getTracks().find((item) => item.kind === kind);
    if (track) {
      localStream.current.removeTrack(track);
      peers.current.forEach((pc) => {
        const sender = pc.getSenders().find((item) => item.track?.id === track.id);
        if (sender) void sender.replaceTrack(null);
      });
      track.stop();
    }
    if (kind === 'audio') {
      micRef.current = false;
      setMic(false);
      autoMuted.current = false;
    } else {
      camRef.current = false;
      setCam(false);
    }
    refreshParts();
  }, [refreshParts]);

  const toggleMic = useCallback(() => {
    setMediaNote('');
    if (micRef.current) disable('audio');
    else void enable('audio');
  }, [disable, enable]);

  const toggleCam = useCallback(() => {
    setMediaNote('');
    if (camRef.current) disable('video');
    else void enable('video');
  }, [disable, enable]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { parts, state, mic, cam, error, mediaNote, net, toggleMic, toggleCam, retry };
}
