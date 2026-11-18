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

## Party flow (host and friends)
1. The host enters the passcode, sees four options (YouTube, Share a Video File, Shared Cloud Browser, Have a code).
2. YouTube and file go to `/party/new?mode=...`: paste a link (or pick a video), nickname, profile picture, "Only I have control" toggle, "Start the party". The client emits `room:create` (passcode-authenticated sockets only); the server makes a random 12-hex room id and records the host (`hostPid`) and `hostOnly`. The file the host picked is handed to the room in memory (`lib/party.ts`) and starts uploading on arrival.
3. The room shows the host an invite link (Copy / Share). Friends open `/room/<id>`, enter only a nickname and picture (`JoinGate`), no passcode. Their socket connects with `auth.room` instead of `auth.passcode`; the server accepts that only for a room that already exists and only for that room.
4. With "Only I have control" on, the server ignores `playback`, queue and `video:change` from friends (`canControl`), and the client blocks taps on the player. The host can flip it in Settings (`room:settings`). Only the host can upload a file, start the shared browser, or switch mode.
5. The Daily call link is handed out over the socket (`call:url`) to people who are in the party; the old REST route remains but needs the passcode.

## Auth
- Passcode (host only) checked server-side only (`POST /api/auth`, constant-time compare, 10 failed attempts per IP per 10 minutes, then 429).
- On success the client keeps the passcode in `sessionStorage` and sends it as `x-passcode` header (REST) and `auth.passcode` (Socket.io handshake). Sockets are either host sockets (passcode) or friend sockets (valid invite room id); wrong room ids are rate-limited per IP. Room ids are the secret that protects a party, so keep invite links private.
- Known limitation: no signed session token yet. A token issued by `/api/auth` would be the next hardening step.

## Screens and routes
- `/party/new?mode=youtube|file` : host setup page (needs the passcode in this tab).
- `/` : Passcode gate (`app/page.tsx`). After unlock it renders `Dashboard` (Home, Settings, About; three mode cards; join-by-code; server status from `/health`).
- `/room/[roomId]?mode=youtube|file|browser` : the room. If passcode or nickname is missing it shows `JoinGate` inline (so shared links work). `mode` is applied only by the first person in the room.

## Client files
- Note: the room route folder is literally named `[roomld]` (lowercase L). The page reads the id defensively, so it works; do not add a second `[roomId]` folder next to it.
- `lib/avatars.ts`, `lib/party.ts` (createRoom, ytTitle, pending file), `components/ProfileEditor.tsx` (nickname and picture, shared by setup and join). `lib/types.ts`: all shared TypeScript types, Socket.io event maps (`ServerToClient`, `ClientToServer`), `SERVER`, `getPass()`.
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
- `app/room/[roomld]/page.tsx`: `RoomInner` (socket + room state) and `RoomView` (layout). Portrait: header, 16:9 stage, control bar, then the chat fills the rest (`h-dvh`). Desktop: stage and controls on the left, chat column (380px) on the right. Landscape (touch devices only): cinema mode, nothing but the video plus floating chat toasts (`ChatToasts`, ~2.8 s) and reactions. The same React tree is used for portrait and landscape so the player never restarts on rotation; the Tailwind variant `touch-land:` (`@media (pointer: coarse) and (orientation: landscape)`) hides the rest instantly. There are NO custom rotate or fullscreen buttons on phones (the desktop-only Maximize button stays). `lib/useCinema.ts` handles fullscreen: when the player's own fullscreen button is tapped (YouTube iframe or `<video>` controls) the hook moves fullscreen to the room's video container so the floating chat stays visible, and locks landscape if the phone was upright; turning the phone sideways requests fullscreen on the container, and if the browser refuses (it needs a tap) `pending` is set and the page shows a transparent tap shield over the video (taps inside the cross-origin YouTube iframe never reach the page, so a window listener cannot work); one exit (Back gesture or turning upright) closes both fullscreen levels and unlocks rotation. iPhone Safari has no element fullscreen, so there only the CSS landscape layout applies and the player's own fullscreen is used.
- Floating chat in fullscreen: browser fullscreen draws only the fullscreen element and its descendants (top layer), so a z-index on anything outside it never shows (verified in Chromium). `ChatToasts` is therefore a direct child of the player container (`wrapRef`), which is the element that goes fullscreen. If the browser will not move fullscreen from the YouTube iframe / `<video>` to the container, `useCinema` exits the player's fullscreen and shows the "Tap for fullscreen" shield, because bubbles cannot appear over the player's own fullscreen. iPhone Safari cannot fullscreen page elements, so bubbles are not shown over its native player fullscreen (the chat sound still plays).
- Keyboard: the phone room (`.room-shell` in `globals.css`) is as tall as the VISUAL viewport (`useViewportHeight` publishes `--vvh`). While the soft keyboard is open the header and controls step aside and the video becomes a preview strip, so video, chat and the input stay on screen. `useTyping` keeps the layout in portrait and the chat visible whenever a text box has focus. Orientation comes from `screen.orientation`, not the page size. Add `?debug=1` to a room address for a live on-screen log of focus, viewport and layout events (to find what closes the keyboard on a device). `Sheet` uses `lib/useVisualViewport.ts` so its inputs are not covered.
- No tab bar. People and Queue open as sheets (`Sheet` in `ui.tsx`); Leave asks for confirmation.
- `components/RoomHeader.tsx`: people capsule (stacked avatars + count, opens the People sheet), real sync status, Leave.
- `components/RoomControls.tsx`: mic, camera, invite (left); settings popover (Smart Mic, host-only toggle, call quality) and queue (right). Playback controls are the native YouTube/`<video>` controls.
- `components/ChatPanel.tsx`: history with avatars, names and times, "is typing…" (server event `typing`), input bar whose emoji button sends floating reactions. `components/QueuePanel.tsx`: playlist.
- `lib/useCall.ts`: owns the single Daily call (feeds, mic/cam, measured network quality, Smart Mic). `components/VideoCallBar.tsx`: `CallAudio`, `Tile`, `FeedGrid` (real feeds in the People sheet), `FloatingFeeds`.
- Sync status: stages report measured drift via `onDrift`; "In sync" only if drift <= 0.8 s within the last 6 s.

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

## Debugging shared upload
`/health?storage=1` runs a server-side put/get/delete against the bucket and reports step status and B2 error codes (no secrets). It cannot test browser CORS. The upload UI shows the real failure reason (CORS vs HTTP status). The YouTube stage distinguishes a blocked script, a timeout and a player error, and offers Retry without a page reload.

## Checking Daily and Hyperbeam
`/health?services=1` asks Daily and Hyperbeam whether they accept the keys set on Render (no secrets shown; also logged as `[services]` at boot). Daily `ok: true` means the key works. The Hyperbeam check is an inference (404 for a made-up VM id = key accepted). It does not prove calls or browsing work end to end. Failure messages in the app now name the cause (key rejected, limits used up, not configured).

## Video sources (YouTube and Google Drive)
- A video in a party or queue has `kind`: `youtube` (default when missing) or `gdrive`. Facebook is not supported.
- Detection: `lib/party.ts` `parseVideoLink()` recognises YouTube links and `drive.google.com` file links (`/file/d/<id>/...`, `/file/u/0/d/<id>/...`, `/open?id=<id>`, `/uc?id=<id>`). Folders, Docs, Sheets and other hosts are refused with a clear message.
- Validation before queueing: `resolveVideo()` calls the Drive API once (`checkDrive`) for the name, MIME type and shortcut target. Refused: folders, Google Docs/Sheets/Slides, non-video files, private files (sharing must be "Anyone with the link"), missing files, and a rejected or restricted API key (named as a setup problem). Accepted anyway: rate limits, quota and offline (the player decides). Shortcuts are followed once.
- Playback: `components/StageGoogleDrive.tsx` streams the file in each viewer's browser from `googleapis.com` (`alt=media`). The browser asks for byte ranges, so seeking works without the server. The server never sees the video. Play, pause, seek, rate and position use the same socket `playback` events as YouTube.
- Buffering shows "Loading video…" / "Buffering…". A dropped connection (media error code 2) resumes at the same place, up to 2 times. No first frame within 20 s, or any other media error (unsupported codec, Google refusing the file), switches to Manual Sync Mode.
- Manual Sync Mode: Google's own preview player (`drive.google.com/file/d/<id>/preview`), which cannot be controlled from outside. The room hides the sync indicator, and the host can start a shared 3-2-1 countdown so everyone presses play together. Without `NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY` every Drive video starts in this mode.
- The server validates shapes only (`cleanVideo`): Drive ids 10-80 characters from `[A-Za-z0-9_-]`. The server never calls Google.
- `queue:add` now confirms success with `{ ok: true }`, so the input clears only when the video was added.
- `NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY` is public (it ships to browsers). Restrict it in Google Cloud to the Drive API only and to the site's referrers (`https://vimo1.vercel.app/*` and preview domains).
- Limits: Google limits how often one file can be downloaded per day, so a very popular movie can hit that limit (viewers then get Manual Sync Mode). Browsers cannot play every codec (for example MKV with AC3/DTS audio); those also use Manual Sync Mode. Not verified on real devices yet: whether Google honours byte ranges for `alt=media` at full speed for multi-gigabyte films.
