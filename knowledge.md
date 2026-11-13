# Vimo: Project Knowledge

Hand this file to any AI assistant before asking it to work on the project.

## What it is
A private watch-together PWA for 2 to 10 people (originally a couple). Shared video, live camera and voice, chat, reactions. Free-tier only: Vercel (client), Render (server), Daily.co (calls), Hyperbeam (cloud browser).
Tagline: "Better together."

## Architecture
- `/client`: Next.js 14 App Router, TypeScript, Tailwind, lucide-react. Deployed on Vercel (root dir `client`).
- `/server`: Node 18+, Express, Socket.io, in-memory room state. Deployed on Render free tier (root `server`, start `npm start`, health path `/health`). Cannot run on Vercel (needs long-lived sockets).
- No database. Room state resets when Render restarts or sleeps.

## Environment variables (never rename)
Server: `ROOM_PASSCODE`, `DAILY_API_KEY`, `HYPERBEAM_API_KEY`, `CLIENT_ORIGIN` (exact Vercel URL; a trailing slash is tolerated), `PORT`, optional `HYPERBEAM_PROFILE`.
Shared video upload (all optional; without them the file mode shows a setup notice): `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (the real bucket region, e.g. `us-west-004`; never `auto` on Backblaze), `MAX_UPLOAD_MB` (default 2048, capped at 4700). Storage is Backblaze B2 (private bucket, single presigned PUT, lifecycle rule hides/deletes `rooms/` after 2+1 days). See `SETUP_STORAGE.md`. Not yet tested against a live B2 bucket.
Client origin: `https://vimo1.vercel.app` (set as `CLIENT_ORIGIN` on Render). Client: `NEXT_PUBLIC_SERVER_URL` (Render URL). It is baked in at build time, so redeploy Vercel after changing it.

## Auth
- Passcode checked server-side only (`POST /api/auth`, constant-time compare, 10 failed attempts per IP per 10 minutes, then 429).
- On success the client keeps the passcode in `sessionStorage` and sends it as `x-passcode` header (REST) and `auth.passcode` (Socket.io handshake). Every API route and socket is guarded by the same check.
- Known limitation: no signed session token yet. A token issued by `/api/auth` would be the next hardening step.

## Screens and routes
- `/` : Passcode gate (`app/page.tsx`). After unlock it renders `Dashboard` (Home, Settings, About; three mode cards; join-by-code; server status from `/health`).
- `/room/[roomId]?mode=youtube|file|browser` : the room. If passcode or nickname is missing it shows `JoinGate` inline (so shared links work). `mode` is applied only by the first person in the room.

## Client files
- Note: the room route folder is literally named `[roomld]` (lowercase L). The page reads the id defensively, so it works; do not add a second `[roomId]` folder next to it.
- `lib/types.ts`: all shared TypeScript types, Socket.io event maps (`ServerToClient`, `ClientToServer`), `SERVER`, `getPass()`.
- `lib/socket.ts`: singleton socket, `api()` REST helper, `ytId()` URL parser.
- `components/ui.tsx`: design-system parts (Logo, Card, Button, TextField, PasswordField, StatusPill, ModeCard, `cx`).
- `components/Dashboard.tsx`, `JoinGate.tsx`, `ChatAndQueue.tsx`, `VideoCallBar.tsx`, `StageYouTube.tsx`, `StageLocalFile.tsx`, `StageBrowser.tsx`.
- `app/room/[roomId]/page.tsx`: layout engine (desktop >=1024px, mobile portrait, mobile landscape "cinema mode"), reactions overlay, autoplay-unlock overlay, unread badge.

## Design tokens (`tailwind.config.ts`)
Brand palette from the Vimo kit: `#6A5B9A` (brand), `#A76DCA` (secondary), `#8A3FBB` (primary), `#FFFFFF`. bg `#07061A`, surface `#110F26`, surface2 `#1A1736`, accent `#F97316` (alerts only), muted `#A9A5C4`. Font Poppins. Logo mark: `public/vimo-mark.png` (via `Logo` in `ui.tsx`); icons are derived from the supplied logo sheet. Legacy names (night, dusk, plum, blush, cream, ember) alias these so older components follow the theme. Use shared components from `ui.tsx` instead of new page-specific styles. Utility class `.bg-cinema` gives the page background.

## Server (`server/index.js`)
- Room state per `roomId`: mode, queue, current video, playback `{playing,time,rate}`, chat (last 100), Hyperbeam session, Daily URL, controller, members `{id,name,avatar,color}`. Max 10 members. Empty rooms are deleted after 60s (and the Hyperbeam VM is stopped).
- REST: `GET /health` (`{ok,rooms,people}`), `POST /api/auth`, `POST /api/daily/:roomId` (room must already exist). Hyperbeam start/stop are socket events now, so the server can authorize them.
- Socket events: `room:join(roomId, profile+cid, cb)`, `room:leave`, `mode:set`, `playback`, `queue:add|remove`, `video:change`, `video:ended`, `chat:send`, `reaction`, `browser:start|stop|control`, `file:prepare|progress|ready|remove|refresh`. Server also pushes private `hb:admin`, and `file:updated` / `file:uploading`. Server pushes `peer:joined|left`, `mode:changed`, `playback`, `queue:updated`, `chat:message` (including system lines), `reaction`, `hb:started|stopped`, `browser:controller`.

## Room UI (cinema room)
- `app/room/[roomId]/page.tsx`: `RoomInner` (socket + room state) and `RoomView` (layout). Layouts: desktop 7fr/3fr grid with collapsible sidebar, portrait (stage on top, controls, collapsible panel), landscape (full-bleed stage, floating feeds, slide-over drawer).
- `lib/useCall.ts`: owns the single Daily call (feeds, mic/cam, measured network quality, Smart Mic). Participants are matched to socket members by Daily `userData.sid`.
- `components/VideoCallBar.tsx`: `CallAudio` (plays remote audio once), `Tile`, `FeedGrid`, `FloatingFeeds`.
- `components/RoomControls.tsx`: room controls only (mic, camera, people, chat with a reactions popup, invite, settings, leave). Playback controls (play/seek/volume/captions) are the native YouTube/`<video>` controls.
- `components/RoomPanel.tsx`: People / Live Chat / Queue tabs; `ChatAndQueue` takes a `view` prop and stays mounted.
- Status chips: Server link (socket), Network (Daily `getNetworkStats`/`network-quality-change`), Sync (stages report measured drift via `onDrift`; "in sync" only if drift <= 0.8 s within the last 6 s).

## Security and identity (server)
- Identity: each tab has a secret `cid` (sessionStorage). The server derives a public id `pid = sha256(cid)`; `room:join` is idempotent per pid, so reconnects and repeated joins never duplicate a participant. A dropped socket keeps its seat for 15 s (grace) before the member is removed.
- Every socket event is validated (types, ranges, YouTube id regex, emoji allow-list, size limits), requires a joined member, and is rate-limited per socket. Failed passcodes (REST and socket handshake) are limited per IP (10 per 10 min). REST /api is limited to 60/min per IP. `CLIENT_ORIGIN` is also enforced on the websocket handshake.
- `video:change` only accepts items already in the server's queue. Queue max 50, rooms max 200.
- Hyperbeam: VMs are created with `control_disable_default: true`. The admin token is never in room state or broadcasts. Only the current controller's socket gets it (`hb:admin`). Take/pass/release are authorized on the server (controller or host). Limit: a former controller still holds a token it already received; stop and restart the VM if that matters.

## Call (Daily) behavior
- Users join the call listen-only with no permission prompt. Mic and camera are requested only when the user taps them. Denied or missing devices show a subtle note and never block the room.
- Join has a 15 s timeout and 3 attempts; failures show specific messages (network, session, not configured, service, timeout) with a Retry button.
- Smart Mic never prompts: playing mutes an enabled mic, pausing restores it only if Smart Mic muted it.
- There are no mode chips in the room. The mode is chosen on the dashboard (`?mode=`); the server still supports `mode:set`.

## Sync model
- Any device may control playback. A device emits `playback` with a snapshot; the server stores it and relays it to the others. Receivers compute expected time as `time + (now - receivedAt) * rate` while playing.
- Loop prevention: `remote` ref mutex around programmatic player calls (about 700 ms). Drift check every 3 s; seek if more than 0.8 s off.
- YouTube: IFrame API, `playsinline`. The host's device auto-advances the queue.
- Local file mode (shared upload): one person picks a file; the client PUTs it straight to an S3-compatible bucket with a presigned URL (progress via XHR); `file:ready` makes the server HEAD-check the object, then broadcast `file:updated` with a signed GET url (12 h). Everyone's `<video>` loads that url and follows the same `playback` state as YouTube. The server signs with its own SigV4 code (no SDK; verified against the AWS test vector) and deletes the object when it is replaced, removed, or the room is deleted. If storage is not configured the stage offers the old dual-file sync as a fallback.
- Server `playback` keeps `pbAt`; `pub()` returns the LIVE position (`time + elapsed`) so late joiners and reconnects start in the right place. `queue:updated` can carry `playback` so a video change and its reset time arrive in one event. Any client reports `video:ended`; the server advances once.
- Browser mode: Hyperbeam VM with persistent profile `couple_default_profile`; Stop button deletes the VM to save free minutes.
- Smart Mic: playing mutes local mic, pausing unmutes (each client applies the rule to itself via Daily `setLocalAudio`).

## Gotchas
- Render free tier sleeps after inactivity (about 30 to 60 s cold start). Open the site a minute before use.
- Daily free tier: 10,000 participant-minutes per month, shared by everyone. Hyperbeam is similar.
- iOS/Android block programmatic play with sound until a tap, so a "Tap to sync & unmute" overlay appears.
- Hyperbeam calls to verify against current docs: `control_disable_default` (VM option), `updateControlDisabled`, `sendEvent` (mobile typing helper), `adminToken` option. Daily: verify `startAudioOff/startVideoOff` join without a prompt and that `setLocalAudio/Video(true)` requests the device.
- The Daily `getCallInstance()` guard avoids duplicate call objects; React strict mode is off.
- Never commit API keys. Set them only in Render and Vercel dashboards.

## Status
Last change set: YouTube sync rewrite (single apply function, timestamp mutex, scrub detection, muted autoplay until a tap, error overlay with skip), shared video upload, Daily retry fix (wait for the old call object to be destroyed), landscape layout (stage shrinks beside the panel, controls at the top). Server logic was tested with a fake Socket.IO harness (41 checks). Client was type-checked against library stubs only: run the real `npx tsc --noEmit` and `npm run build` before trusting it.
Written without a local build (no network in the authoring sandbox). `node --check server/index.js` passes. Run `cd client && npm i && npx tsc --noEmit && npm run build` first and fix any type errors. Untested in real devices: Daily calls, Hyperbeam control, iOS autoplay overlay.

## Conventions
Make small targeted edits. Keep env var names, the 10-person cap, `/health`, and the free-tier architecture. Keep strict TypeScript. No TODO placeholders.
