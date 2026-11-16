# Vimo audio/video calling

Vimo uses native browser WebRTC with Socket.io signaling on the existing Render server. There is no Daily.co dependency, calling-provider account, API key, or extra media server.

## Network setup

The browser uses Google's public STUN endpoints:

- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

STUN discovers possible direct network paths; it does not relay media. Calls normally connect directly, but some carrier, school, office, hotel, VPN, and symmetric-NAT networks block direct connectivity. Those cases may fail because this deliberately has no TURN relay. No STUN-only implementation can promise universal reachability or zero latency.

## Room and call behavior

- Existing room membership and passcode/invite checks authorize call signaling.
- `call-join` / `call-leave` maintain the set of active call participants.
- `webrtc-offer`, `webrtc-answer`, and `webrtc-ice-candidate` relay only between active sockets in the same room.
- The server validates signaling targets and basic SDP/ICE payload shape and rate-limits signaling events.
- Up to three cameras may be active in one room at a time. Other participants can join audio-only.
- Microphone and camera permissions are requested only after the corresponding user taps its button.
- Mic mute toggles the audio track; camera-off replaces the outgoing video track with `null` and stops the camera device without closing peer connections.
- Video starts at a mobile-friendly 640×360 / 24 fps target and adapts its sender bitrate based on measured connection RTT and packet loss where the browser exposes those stats.
- Peer connections and local media tracks are closed/stopped when leaving or disconnecting.

## Deployment

1. Deploy the updated `server` and `client` directories.
2. Remove `DAILY_API_KEY` from the Render environment; it is no longer read by Vimo.
3. Keep `ROOM_PASSCODE`, `CLIENT_ORIGIN`, `HYPERBEAM_API_KEY` (only if Shared Cloud Browser is used), and the existing storage variables as applicable.
4. Rebuild/redeploy the Vercel client so the Daily package is removed from the production bundle.
5. Test between two different devices and networks. A test using two tabs on one device is not sufficient to validate NAT traversal or real camera/microphone behavior.

This setup is intentionally zero-key and zero-cost for calling. It prioritizes small 2–3 person calls, but cannot guarantee connection through restrictive networks without a TURN relay.
