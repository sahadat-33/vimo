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
- Hyperbeam (checked against docs.hyperbeam.com): session options `control_disable_default` and `profile` are as documented; `sendEvent` (typing box) and `DELETE /v0/vm/{session_id}` (stop) are as documented; `setPermissions` is deprecated and replaced by `addRoles` / `removeRoles`. Daily: verify `startAudioOff/startVideoOff` join without a prompt and that `setLocalAudio/Video(true)` requests the device.
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
- Detection and checks before queueing: `lib/party.ts` (`parseVideoLink`, `resolveVideo`, `checkDrive`). Folders, Docs and private files are refused with clear messages.
- Playback: `components/StageGoogleDrive.tsx` plays the file in VIMO's own `<video>`. Every viewer's browser streams from Google; the server never sees the video.
- Attempts (`lib/driveSync.ts`): a metadata check first (`probeDrive`). Permanent problems (private file, missing file, invalid key, not a video, unsupported format) stop at once with a message. Temporary problems (slow start over 15 s, dropped connection, rate limit, network) retry: "Trying to load (1/3)", (2/3), (3/3), with short pauses. The sources alternate: the documented Drive API, then the second route, then the API again.
- The second route is Drive's download address, which is NOT documented and may stop working.
- Google's own player is never used just because loading is slow. It is used only when the room chooses it: the person in control presses "Use Google’s player for the room" after a failure (or switches via the manual badge). The choice is stored on the server (`driveMode`, per video), broadcast as `drive:mode`, and announced in chat. Every participant switches together; "Back to VIMO player" reverses it. A late joiner gets the current choice.
- Sync: the host's play, pause, seek and speed are shared (`playback`). Small drift (0.8 to 3 s) is absorbed by a 5% speed change; larger drift seeks; nothing corrects while buffering. A stall of 1.5 s on the host's side pauses the room until it recovers. Late joiners get the live position.
- Temporary 2x: press and hold the picture (controller only). The 2x is shared (`playback-hold`) and put back on release, or when the controller leaves (`releaseHold`).
- Gestures: double-tap left or right for -10 s / +10 s (controller only); the flash shows the jump. Gestures ignore taps on the controls.
- Controls (`components/DriveControls.tsx`): row 1 time, progress, duration; row 2 play, volume, then settings and fullscreen. Settings: speed 0.5 to 2 (controller only, shared) and quality (only "Original" exists for a Drive file).
- Limits: captions and per-device quality choice are not provided. The Drive API key is public; restrict it to the Drive API and the site's referrers. Google limits downloads of popular files. Not tested on real devices yet.

## Presence and reconnects
- Identity: `getCid()` is stored per browser (localStorage). Every tab of one browser is the same participant, and reopening an invitation resumes the same seat. A different browser or device is a different participant.
- A person is present while any of their connections (tabs) is open (`members[].sids`).
- Intentional leave (Leave button, browser Back, navigating away): the seat is released at once and announced. If another tab of the same person is still open, the seat stays.
- Temporary absence (tab closed, connection lost, app in the background via `presence {away:true}`): the seat is kept for 10 s (`GRACE_MS`, env override for tests) and nothing is announced. Returning cancels the grace (`presence {away:false}`) and the page re-confirms the seat with `room:join`, which is idempotent.
- No duplicate entries: `room:join` finds the existing member by stable id and only announces a join for a new member.
- Limits: a mobile browser may freeze a backgrounded socket; the server then removes the seat after 10 s, and the page re-joins when it returns (announced as a new join, which is what happened).

## Player state (Google Drive stage)
- Phases: probe → loading (Trying to load n/3) → ready (controls shown, paused or playing) → failed. `ready` is reached on loadedmetadata whether or not the room is playing; the room's play state is separate (`playing`).
- `buffering` is set only by `waiting` while ready, and cleared by canplay or play. Retries (up to 3) happen only on a start timeout or a genuine media error, never because the host has not pressed Play.
- The pure logic is `reducePlayer` in `lib/driveSync.ts`, tested in Node (paused load, playing load, play after a paused load, buffering, late load after failure).
- Lesson: a rename that touches helper bodies can create a self-call (infinite recursion). The stage helpers `setPh`, `setBuf`, `setPly` call React's setters `setPhase`, `setBuffering`, `setPlaying`.

## Queue, auto-advance and resync
- Mixed queue: YouTube and Google Drive items can be queued and played in any order. The room picks the stage from the current item's `kind` (StageYouTube or StageGoogleDrive). Facebook is not supported.
- Auto-advance: when a video ends and something is queued, the server (`startUpNext`) starts a 5 s countdown (`UP_NEXT_MS`, env override for tests) and announces it with `up-next`. Cancel (`up-next:cancel`, person in control only) or any manual pick (`video:change`) or removing the next item clears it. A second end report during the countdown is ignored. With nothing queued the room simply stops, as before.
- Resync: the sync indicator is a button. Clicking it, and every successful join (including returning to the app), bumps a shared `resync` counter. Each stage then jumps to the live position (`time + elapsed * rate` while playing) and matches play/pause and speed.
- Typing in the queue: while a sheet is open the room no longer reacts to the keyboard (no layout change under the typing box), and QueuePanel is memoized so chat and playback updates do not re-render it.
- Chat toasts (landscape and fullscreen): they are passed to the stage as `overlay` and rendered inside the stage's own element, so they stay visible when the stage goes fullscreen. Covered: YouTube, Google Drive (both players), local file.
- YouTube fullscreen: when the YouTube iframe itself goes fullscreen, `useCinema` asks the room's container to take the fullscreen over, so the chat toasts stay visible. If the browser refuses, the video keeps playing and the toasts stay hidden.

## UI polish (room screen, visual only)
- Charcoal surfaces (#121212 to #171717) with a thin border and backdrop blur on the controls, sync pill, people capsule, queue rows and countdown card. Defined as `.surface-charcoal` and `.press` in `globals.css`.
- Motion: entrance (`riseIn`) for the header, controls, queue rows and countdown; a breathing dot on the "In sync" pill (`breathe`); press feedback on buttons (`.press`).
- The countdown card has a progress bar that drains with the timer (`UpNextOverlay`).
- `prefers-reduced-motion` shortens all animations and transitions to near-instant.
- Only class names, CSS and the countdown progress bar changed. No props, handlers, socket events or layout conditions changed.

## Dashboard and party setup (visual only)
- Dashboard: editorial hero, tiles with a glowing art panel (`ModeCard`), charcoal surfaces. Top bar keeps icon-only navigation with history on phones and tablets; the desktop sidebar keeps labels.
- Party setup: same form and handlers, restyled with charcoal surfaces and larger type.
- Logic unchanged: routes, `start`, `join`, health polling, passcode lock, history view.

## Landscape video and speed nudges (fix)
- No backdrop blur over the picture: on phones, a blurred layer above a playing video can blank the picture until the screen re-lays out. Overlays that sit on the video (header pills, controls, countdown, settings) use solid charcoal instead.
- Speed nudges keep the echo-suppression window short (400 ms), so a real play or pause right after a nudge is still shared.

## Microphone and camera (temporarily disabled)
- The microphone and camera buttons in `RoomControls.tsx` are disabled for now. Their handlers and the call code are kept, so they can be re-enabled by removing the `disabled` attribute.

## YouTube fullscreen on Samsung Internet (fix)
- The YouTube iframe is no longer handed to the room container. A handoff left Samsung Internet showing a black picture with dead controls until Back was pressed. YouTube's own fullscreen is used again. Chat toasts are not drawn over YouTube's own fullscreen (they still appear in landscape without fullscreen).

## Remember me, share from other apps, YouTube fullscreen
- Remember me: ticking it on the passcode page keeps the passcode in this device's local storage for 7 days (`lib/types.ts`, key `vimoPass`, with an expiry). It is stored as plain text on that device; a signed session token would be the safer next step. Lock this device clears it.
- Sharing: the manifest has a `share_target` at `/share`. A YouTube or Google Drive link shared from another app opens `app/share`. Without the passcode the link is kept (`vimoPendingShare`), the passcode gate runs, and the share page continues. With the passcode a room opens straight away with that video (host, "Only I have control" on). Chrome on Android supports installed web apps as share targets; Samsung Internet may not.
- YouTube fullscreen: the YouTube player's own fullscreen button is off (`fs: 0`), so the room's full-screen view is used and the chat bubbles stay visible. Drive's fullscreen keeps them too, because they sit inside the player.
- Haptic feedback: when a message from someone else arrives while the room is in landscape or fullscreen, the phone buzzes once (`navigator.vibrate` in `ChatToasts.tsx`). Portrait never buzzes. Phones without vibration support (iPhone) show nothing.
- YouTube keeps its own fullscreen button (no `fs: 0`). Chat bubbles are not drawn over YouTube's native fullscreen.

## Chat panel and landscape toasts (visual only)
- Chat messages: charcoal bubbles (own messages in a soft purple gradient), a gentle entrance for new messages, and press feedback on the reaction and send buttons. Reactions and the input are unchanged.
- Landscape toasts: solid charcoal cards with no blur (blur over a playing video can blank it on phones). Their positioning, timing and vibration are unchanged.
- There is no reply feature in the project yet.

## Shared browser (Hyperbeam)
- Session created on the server with `control_disable_default: true` (nobody can control by default) and a saved profile. The admin token goes only to the current controller's socket, never into room state.
- The controller's browser grants itself control with `addRoles([userId], ['control'], true)`. `exclusive: true` removes control from every other connection, so the server's one-controller rule is enforced by Hyperbeam too.
- Connection timeout is 10 s (the SDK default of 2 s is too short on mobile data).
- Server rules: only the host starts or stops the browser (stop also works for the controller); control can be taken when free or by the host; the controller can pass or release.
- Each tab is a separate Hyperbeam user, so control follows the exact connection that holds the admin token.
- Not tested against live Hyperbeam: the server rules are tested with a fake Hyperbeam (`hb_test.js`).
- Session profile: the `profile` option takes the session ID of a saved profile. It is sent only when `HYPERBEAM_PROFILE` holds such an ID (with `load` and `save` set to it). A made-up profile name is refused by Hyperbeam with HTTP 400, which is what stopped sessions from starting. Without a real ID the browser starts without a saved profile, so logins are not kept between sessions.

