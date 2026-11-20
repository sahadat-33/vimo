require('dotenv').config();
const express = require('express'), http = require('http'), cors = require('cors'), crypto = require('crypto');
const { Server } = require('socket.io');

/* ---------- config & helpers ---------- */
const ROOM_PASSCODE = process.env.ROOM_PASSCODE || '';
const sha = (x) => crypto.createHash('sha256').update(x).digest();
const ok = (p) => !!ROOM_PASSCODE && typeof p === 'string' && p.length <= 200 && crypto.timingSafeEqual(sha(p), sha(ROOM_PASSCODE));
const origin = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '') || '*'; // tolerate a trailing slash in the env var
const MAX = 10, MAX_CALL_CAMERAS = 3, MAX_ROOMS = 200, GRACE_MS = Number(process.env.GRACE_MS) || 10000, MAX_QUEUE = 50, HOST_RETURN_MS = Number(process.env.HOST_RETURN_MS) || 5 * 60000; // how long an emptied room waits for its host to come back
const ROOM_RE = /^[A-Za-z0-9_-]{1,32}$/, CID_RE = /^[A-Za-z0-9_-]{8,64}$/, YT_RE = /^[\w-]{11}$/, COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MODES = ['youtube', 'file', 'browser'];
const norm = (e) => String(e).replace(/\uFE0F/g, '');
const EMOJI_LIST = ['\u2764\uFE0F', '\u{1F602}', '\u{1F631}', '\u{1F525}', '\u{1F62D}', '\u{1F37F}'];
const EMOJI = new Set(EMOJI_LIST.map(norm));
const EMOJI_CANON = new Map(EMOJI_LIST.map((e) => [norm(e), e])); // one spelling per emoji, so reactions from different phones land on the same key
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const uid = () => crypto.randomBytes(6).toString('hex');
const GD_RE = /^[\w-]{10,80}$/; // Google Drive file ids
/** A video someone wants to play (YouTube or Google Drive), checked and reduced to what the room needs. Video data never passes through this server. */
function cleanVideo(item) {
  if (!item || typeof item !== 'object') return null;
  const title = clean(item.title, 120);
  if (item.kind === 'gdrive') return typeof item.id === 'string' && GD_RE.test(item.id) ? { kind: 'gdrive', id: item.id, title: title || 'Google Drive video' } : null;
  return typeof item.id === 'string' && YT_RE.test(item.id) ? { kind: 'youtube', id: item.id, title: title || item.id } : null;
}
const pidOf = (cid) => crypto.createHash('sha256').update('cc:' + cid).digest('hex').slice(0, 12); // public id; the cid stays secret

/* ---------- abuse control (per IP) ---------- */
const fails = new Map(), hits = new Map(), roomFails = new Map();
const recent = (m, ip, win) => { const now = Date.now(); const t = (m.get(ip) || []).filter((x) => now - x < win); m.set(ip, t); return t; };
const blocked = (ip) => recent(fails, ip, 600000).length >= 10;
const noteFail = (ip) => recent(fails, ip, 600000).push(Date.now());
setInterval(() => { const now = Date.now(); for (const m of [fails, hits, roomFails]) for (const [k, v] of m) if (!v.some((x) => now - x < 600000)) m.delete(k); }, 600000).unref();
const ipOf = (h) => String((h.headers['x-forwarded-for'] || h.address || '')).split(',')[0].trim();

const app = express();
app.disable('x-powered-by'); app.set('trust proxy', 1);
app.use((_q, s, n) => { s.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); n(); });
app.use(cors({ origin })); app.use(express.json({ limit: '10kb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin }, maxHttpBufferSize: 100000,
  allowRequest: (req, cb) => cb(null, origin === '*' || !req.headers.origin || req.headers.origin === origin) });


/* ---------- shared video storage (any S3-compatible bucket; written for Backblaze B2, also fits R2). Presigned URLs only, no SDK. ---------- */
const endpointUrl = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
const b2Region = (endpointUrl.match(/^https?:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com$/i) || [])[1]; // e.g. us-west-004
if (b2Region && process.env.S3_REGION !== b2Region) console.warn(`S3_REGION is "${process.env.S3_REGION || ''}" but the Backblaze endpoint says "${b2Region}". Using "${b2Region}" (B2 never accepts "auto").`);
const S3 = { endpoint: endpointUrl, region: b2Region || process.env.S3_REGION || 'auto', bucket: process.env.S3_BUCKET || '',
  id: process.env.S3_ACCESS_KEY_ID || '', secret: process.env.S3_SECRET_ACCESS_KEY || '', vhost: false };
const MAX_UPLOAD = Math.min(Math.max(10, Number(process.env.MAX_UPLOAD_MB) || 2048), 4700) * 1048576; // one PUT per file (no multipart); B2's single-upload ceiling is about 5 GB
const s3On = () => !!(S3.endpoint && S3.bucket && S3.id && S3.secret);
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const awsEnc = (x) => encodeURIComponent(x).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function presign(method, key, expires, now = new Date(), c = S3) { // AWS Signature V4, query-string form, unsigned payload
  const u = new URL(c.endpoint), host = c.vhost ? `${c.bucket}.${u.host}` : u.host;
  const path = (c.vhost ? '' : `/${c.bucket}`) + '/' + key, uri = path.split('/').map(awsEnc).join('/');
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8), scope = `${day}/${c.region}/s3/aws4_request`;
  const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${c.id}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const cq = Object.keys(q).sort().map((k) => `${awsEnc(k)}=${awsEnc(q[k])}`).join('&');
  const creq = `${method}\n${uri}\n${cq}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const sts = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${crypto.createHash('sha256').update(creq).digest('hex')}`;
  const sig = hmac(hmac(hmac(hmac(hmac('AWS4' + c.secret, day), c.region), 's3'), 'aws4_request'), sts).toString('hex');
  return `${u.protocol}//${host}${uri}?${cq}&X-Amz-Signature=${sig}`;
}
const s3Head = async (key) => { const res = await fetch(presign('HEAD', key, 300), { method: 'HEAD', signal: AbortSignal.timeout(10000) });
  return res.ok ? Number(res.headers.get('content-length')) : -1; };
const s3Delete = (key) => s3On() && fetch(presign('DELETE', key, 300), { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => {});
const dropFile = (r) => { if (r.file) s3Delete(r.file.key); r.file = null; };
/* Storage self-test: uploads, downloads and deletes a tiny object from the server side. It proves region, keys, bucket and signing are right
   (it cannot test browser CORS). Result is logged at boot and shown, without secrets, at /health. */
let lastStorage = { configured: s3On() ? null : false }, lastTestAt = 0;
async function storageSelfTest() {
  lastTestAt = Date.now();
  if (!s3On()) return (lastStorage = { configured: false });
  const out = { configured: true, region: S3.region, steps: [] }, key = `rooms/_selftest/${uid()}.txt`;
  const run = async (step, method, body) => {
    try {
      const res = await fetch(presign(method, key, 120), { method, body, signal: AbortSignal.timeout(10000) });
      const text = (await res.text()).slice(0, 600);
      out.steps.push({ step, ok: res.ok, status: res.status, ...(res.ok ? {} : { code: (text.match(/<Code>([^<]+)<\/Code>/) || [])[1] || 'unknown' }) });
      return res.ok;
    } catch (e) { out.steps.push({ step, ok: false, error: e && e.name === 'TimeoutError' ? 'timeout' : 'network' }); return false; }
  };
  if (await run('upload', 'PUT', 'vimo')) { await run('download', 'GET'); await run('delete', 'DELETE'); }
  out.ok = out.steps.length === 3 && out.steps.every((x) => x.ok);
  return (lastStorage = out);
}
/* Service check: verify the optional Hyperbeam browser provider without exposing credentials. */
let lastServices = {}, lastSvcAt = 0;
async function servicesCheck() {
  lastSvcAt = Date.now();
  const probe = async (url, key, accepted) => {
    if (!key) return { configured: false };
    try { const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }); const ok = accepted(res.status); return { configured: true, ok, status: res.status, ...(ok ? {} : { note: res.status === 401 || res.status === 403 ? 'key rejected' : res.status === 400 ? 'inconclusive: request rejected before the key was checked' : 'unexpected answer' }) }; }
    catch (e) { return { configured: true, ok: false, error: e && e.name === 'TimeoutError' ? 'timeout' : 'network' }; }
  };
  const hyperbeam = await probe('https://engine.hyperbeam.com/v0/vm/00000000-0000-0000-0000-000000000000', process.env.HYPERBEAM_API_KEY, (st) => st === 404);
  return (lastServices = { hyperbeam });
}
const pubFile = (r) => r.file && { name: r.file.name, size: r.file.size, type: r.file.type, by: r.file.by, url: presign('GET', r.file.key, 12 * 3600) };

/* ---------- room state. Keep in sync with client/src/lib/types.ts ---------- */
const rooms = new Map();
const room = (id) => {
  if (!rooms.has(id)) rooms.set(id, { id, mode: 'youtube', queue: [], current: null, playback: { playing: false, time: 0, rate: 1 },
    chat: [], hb: null, hbStarting: false, callPeers: new Map(), controller: null, members: [], file: null, pending: new Map(), pbAt: Date.now(), hostPid: null, hostOnly: false, createdAt: Date.now() });
  return rooms.get(id);
};
const pubMember = (m) => ({ id: m.id, name: m.name, avatar: m.avatar, color: m.color });
const setPb = (r, p) => { r.playback = p; r.pbAt = Date.now(); };
// A joiner must start where the room is NOW, not where it was at the last play/pause event.
const livePb = (r) => { const p = r.playback; return p.playing ? { ...p, time: clamp(p.time + ((Date.now() - r.pbAt) / 1000) * p.rate, 0, 172800, 0) } : p; };
// The Google player choice applies to one video only; a later video starts back on VIMO's player.
// Auto-advance: when a video ends and something is queued, the next one starts after a short, cancelable countdown.
const UP_NEXT_MS = Number(process.env.UP_NEXT_MS) || 5000;
const emitUpNext = (r) => io.to(r.id).emit('up-next', r.upNext ? { item: r.queue[0], inMs: Math.max(0, r.upNext.at - Date.now()) } : null);
function clearUpNext(r) { if (!r.upNext) return; clearTimeout(r.upNext.timer); r.upNext = null; emitUpNext(r); }
function startUpNext(r) { r.upNext = { at: Date.now() + UP_NEXT_MS, timer: setTimeout(() => advanceQueue(r), UP_NEXT_MS) }; emitUpNext(r); }
function advanceQueue(r) {
  r.upNext = null; r.current = r.queue.shift() || null; setPb(r, { playing: !!r.current, time: 0, rate: 1 });
  io.to(r.id).emit('queue:updated', { queue: r.queue, current: r.current, playback: r.playback }); emitUpNext(r);
}
const liveDriveMode = (r) => (r.driveMode && r.current && r.driveMode.id === r.current.id ? r.driveMode : null);
// Ends the temporary 2x for the whole room and puts the shared speed back.
function releaseHold(r) {
  if (!r.hold) return; const prev = r.hold.prev; r.hold = null;
  setPb(r, { ...livePb(r), rate: prev }); io.to(r.id).emit('playback', { ...r.playback, from: 'server' });
}
const pub = (r) => ({ mode: r.mode, queue: r.queue, current: r.current, playback: livePb(r), driveMode: liveDriveMode(r), upNext: r.upNext ? { item: r.queue[0], inMs: Math.max(0, r.upNext.at - Date.now()) } : null, file: pubFile(r), chat: r.chat.slice(-100),
  hb: r.hb && { embedUrl: r.hb.embedUrl }, controller: r.controller, members: r.members.map(pubMember), hostOnly: r.hostOnly, hostId: r.hostPid }); // never include adminToken
const who = (r, pid) => (r.members.find((m) => m.id === pid) || {}).name || 'Someone';
const sys = (r, text) => { const m = { id: uid(), from: 'system', name: '', avatar: '', color: '', text, at: Date.now(), system: true };
  r.chat.push(m); if (r.chat.length > 200) r.chat.shift(); io.to(r.id).emit('chat:message', m); };
const isHostMember = (r, me) => me.id === r.hostPid;
const canControl = (r, me) => me.id === r.hostPid || !r.hostOnly; // 'only I have control' leaves playback to the host
const sidOf = (r, pid) => { const m = r.members.find((x) => x.id === pid); return m && m.sid; };

/* Hyperbeam control: the admin token only ever goes to the current controller's socket. */
function setController(r, pid) {
  const prev = r.controller; r.controller = pid;
  io.to(r.id).emit('browser:controller', pid);
  if (prev && prev !== pid && sidOf(r, prev)) io.to(sidOf(r, prev)).emit('hb:admin', { adminToken: null });
  if (pid && r.hb && sidOf(r, pid)) io.to(sidOf(r, pid)).emit('hb:admin', { adminToken: r.hb.adminToken });
}
async function stopHb(r) {
  if (!r.hb) return; const sid = r.hb.sessionId; r.hb = null; setController(r, null);
  io.to(r.id).emit('hb:stopped');
  await fetch(`https://engine.hyperbeam.com/v0/vm/${encodeURIComponent(sid)}`, { method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.HYPERBEAM_API_KEY}` }, signal: AbortSignal.timeout(10000) }).catch(() => {});
}
// Presence. A closed tab, a lost connection, or the app going to the background keeps the seat for GRACE_MS and announces nothing.
// A person is present while any of their connections (tabs) is open; a backgrounded app counts as away.
function startGrace(r, me) {
  if (me.dropTimer) return;
  me.dropTimer = setTimeout(() => { me.dropTimer = null; if ((!me.sids.size || me.away) && r.members.includes(me)) removeMember(r, me); }, GRACE_MS);
}
function cancelGrace(me) { if (me.dropTimer) { clearTimeout(me.dropTimer); me.dropTimer = null; } }
function removeMember(r, me) {
  if (r.hold && r.hold.memberId === me.id) releaseHold(r);
  clearTimeout(me.dropTimer);
  for (const [sid, peer] of r.callPeers) if (peer.memberId === me.id) { r.callPeers.delete(sid); io.to(r.id).emit('call-peer-left', { socketId: sid }); } r.members = r.members.filter((m) => m !== me);
  io.to(r.id).emit('peer:left', me.id); sys(r, `${me.name} left`);
  if (r.controller === me.id) setController(r, null);
  if (!r.members.length) {
    const since = (r.emptySince = Date.now()); // an emptied room stays rejoinable for a while so the host can come back after an accidental exit
    setTimeout(() => { const x = rooms.get(r.id); if (x && !x.members.length && x.emptySince === since) { stopHb(x); dropFile(x); rooms.delete(x.id); } }, r.hb ? 60000 : HOST_RETURN_MS);
  }
}

/* ---------- REST ---------- */
app.get('/health', async (q, s) => { // add ?storage=1 to re-run the storage self-test (at most once every 30 s)
  if (q.query.storage && s3On() && Date.now() - lastTestAt > 30000) await storageSelfTest();
  if (q.query.services && Date.now() - lastSvcAt > 30000) await servicesCheck();
  s.json({ ok: true, rooms: rooms.size, people: [...rooms.values()].reduce((n, r) => n + r.members.length, 0), storage: lastStorage, services: lastServices });
});
app.use('/api', (q, s, n) => { const t = recent(hits, q.ip, 60000); if (t.length >= 60) return s.status(429).json({ error: 'rate_limited' }); t.push(Date.now()); n(); });
app.post('/api/auth', (q, s) => {
  if (blocked(q.ip)) return s.status(429).json({ ok: false, error: 'too_many' });
  if (ok(q.body && q.body.passcode)) return s.json({ ok: true });
  noteFail(q.ip); s.status(401).json({ ok: false });
});
// Which of these rooms are still running? Used by the Party History list. Answers only yes/no for up to 5 well-formed ids.
app.get('/api/rooms/status', (q, s) => {
  const ids = String(q.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5);
  const live = {}; for (const id of ids) if (ROOM_RE.test(id)) live[id] = rooms.has(id);
  s.set('Cache-Control', 'no-store'); s.json({ live });
});
const guard = (q, s, n) => {
  if (blocked(q.ip)) return s.status(429).json({ error: 'too_many' });
  if (ok(q.get('x-passcode'))) return n(); noteFail(q.ip); s.status(401).json({ error: 'bad passcode' });
};

/* ---------- sockets ---------- */
io.use((sock, next) => {
  const ip = ipOf(sock.handshake);
  const a = sock.handshake.auth || {};
  if (ok(a.passcode)) { sock.data.authed = true; return next(); } // the host: knows the passcode
  if (typeof a.room === 'string' && ROOM_RE.test(a.room)) { // a friend: only the invite link, and only for a party a host already started
    if (recent(roomFails, ip, 600000).length >= 20) return next(new Error('too_many'));
    if (rooms.has(a.room)) { sock.data.guestRoom = a.room; return next(); }
    recent(roomFails, ip, 600000).push(Date.now()); return next(new Error('no_room'));
  }
  if (blocked(ip)) return next(new Error('too_many'));
  noteFail(ip); next(new Error('bad passcode'));
});

const LIMITS = { typing: [20, 5000], 'drive:mode': [10, 10000], 'playback-hold': [20, 10000], presence: [30, 10000], 'up-next:cancel': [10, 10000], 'room:create': [5, 60000], countdown: [6, 10000], 'room:settings': [10, 10000], 'call-join': [30, 60000], 'call-leave': [8, 60000], 'webrtc-offer': [60, 10000], 'webrtc-answer': [60, 10000], 'webrtc-ice-candidate': [180, 10000], 'room:join': [6, 10000], 'room:leave': [4, 10000], 'mode:set': [10, 10000], playback: [30, 5000], 'queue:add': [10, 10000], 'queue:remove': [20, 10000],
  'video:change': [10, 10000], 'chat:send': [10, 10000], 'chat-react': [40, 10000], reaction: [15, 5000], 'browser:control': [10, 10000], 'browser:start': [3, 60000], 'browser:stop': [5, 60000],
  'video:ended': [6, 10000], 'file:prepare': [6, 60000], 'file:progress': [120, 10000], 'file:ready': [6, 60000], 'file:remove': [4, 60000], 'file:refresh': [6, 60000] };
const allow = (sock, ev) => { const lim = LIMITS[ev]; if (!lim) return false; const now = Date.now(); const b = (sock.data.rl = sock.data.rl || {});
  const t = (b[ev] = (b[ev] || []).filter((x) => now - x < lim[1])); if (t.length >= lim[0]) return false; t.push(now); return true; };

io.on('connection', (sock) => {
  // Every event except room:join must come from a socket that is the live connection of a room member.
  const on = (ev, fn) => sock.on(ev, async (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    try {
      if (!allow(sock, ev)) return cb && cb({ error: 'Slow down a little.' });
      const r = sock.data.roomId && rooms.get(sock.data.roomId);
      const me = r && r.members.find((m) => m.sids.has(sock.id));
      if (!me) return cb && cb({ error: 'Not in a room.' });
      await fn(r, me, cb, ...args);
    } catch (e) { console.error(ev, e.message); if (cb) cb({ error: 'Request failed.' }); }
  });

  sock.on('room:join', (roomId, profile, cb) => {
    if (typeof cb !== 'function') return;
    if (!allow(sock, 'room:join')) return cb({ error: 'Slow down a little.' });
    if (typeof roomId !== 'string' || !ROOM_RE.test(roomId)) {
      console.warn('room:join rejected: invalid roomId', { received: roomId, type: typeof roomId });
      return cb({ error: 'Invalid room code. Reopen the invite link or check the room code.' });
    }
    const cid = profile && typeof profile === 'object' && typeof profile.cid === 'string' ? profile.cid.trim() : '';
    if (!cid || !CID_RE.test(cid)) {
      console.warn('room:join rejected: invalid participant ID');
      return cb({ error: 'Your browser session needs refreshing. Reload the page and try again.' });
    }
    if (!sock.data.authed && sock.data.guestRoom !== roomId) return cb({ error: 'This invite link belongs to a different party.' });
    const prof = { name: clean(profile.name, 20) || 'Guest', avatar: clean(profile.avatar, 8) || '🙂', color: COLOR_RE.test(profile.color) ? profile.color : '#A78BFA' };
    if (!rooms.has(roomId)) return cb({ error: 'This party has ended, or the link is wrong. Ask your host for a new link.' });
    const old = sock.data.roomId && rooms.get(sock.data.roomId);
    if (old && old.id !== roomId) { const m = old.members.find((x) => x.sids.has(sock.id)); if (m) { m.sids.delete(sock.id); if (!m.sids.size) removeMember(old, m); else m.sid = [...m.sids][0]; } sock.leave(old.id); }
    const r = rooms.get(roomId), pid = pidOf(cid);
    let me = r.members.find((m) => m.id === pid), isNew = false;
    if (me) { cancelGrace(me); me.away = false; me.sids.add(sock.id); me.sid = sock.id; Object.assign(me, prof); } // idempotent: reconnect, another tab, or a repeated join
    else {
      if (r.members.length >= MAX) return cb({ error: 'Room is full (max 10 people).' });
      me = { id: pid, sid: sock.id, sids: new Set([sock.id]), away: false, dropTimer: null, ...prof }; r.members.push(me); isNew = true;
    }
    sock.data.roomId = roomId; sock.join(roomId); r.emptySince = null;
    cb({ state: pub(r), selfId: pid, isHost: r.hostPid === pid }); // hostPid is derived from the stable browser id and never reassigned, so the original host gets host control back on any rejoin while the room runs
    if (r.controller === pid && r.hb) sock.emit('hb:admin', { adminToken: r.hb.adminToken });
    if (isNew) { sock.to(roomId).emit('peer:joined', pubMember(me)); sys(r, pid === r.hostPid ? `${me.name} is back (host)` : `${me.name} joined`); }
  });

  sock.on('room:create', (o, cb) => { // only someone who knows the passcode can start a party
    if (typeof cb !== 'function') return;
    if (!sock.data.authed) return cb({ error: 'Enter the passcode to start a party.' });
    if (!allow(sock, 'room:create')) return cb({ error: 'Slow down a little.' });
    if (!o || typeof o !== 'object' || typeof o.cid !== 'string' || !CID_RE.test(o.cid) || !MODES.includes(o.mode)) return cb({ error: 'Invalid request.' });
    if (rooms.size >= MAX_ROOMS) return cb({ error: 'The server is busy. Try again later.' });
    const r = room(uid()); r.hostPid = pidOf(o.cid); r.hostOnly = o.hostOnly === true; r.mode = o.mode;
    const first = cleanVideo(o.video); if (first) r.current = { ...first, addedBy: r.hostPid };
    cb({ roomId: r.id });
  });
  on('room:settings', (r, me, _cb, s) => {
    if (!isHostMember(r, me) || !s || typeof s.hostOnly !== 'boolean' || s.hostOnly === r.hostOnly) return;
    r.hostOnly = s.hostOnly; sys(r, s.hostOnly ? `${me.name} is now the only one in control` : `${me.name} gave everyone playback control`);
    io.to(r.id).emit('room:settings', { hostOnly: r.hostOnly });
  });
  // WebRTC signaling is room-scoped: only live members may join the call or relay SDP/ICE.
  on('call-join', (r, me, cb, status = {}) => {
    if (!status || typeof status !== 'object') return cb && cb({ error: 'Invalid call status.' });
    const mic = status.mic === true, cam = status.cam === true;
    const activeCameras = [...r.callPeers.values()].filter((p) => p.cam && p.socketId !== sock.id).length;
    if (cam && activeCameras >= MAX_CALL_CAMERAS) return cb && cb({ error: 'Camera limit reached. Up to 3 cameras can be active at once; you can still join with audio.' });
    const peers = [...r.callPeers.values()].filter((p) => p.socketId !== sock.id).map((p) => ({ socketId: p.socketId, memberId: p.memberId, name: p.name, mic: p.mic, cam: p.cam }));
    const peer = { socketId: sock.id, memberId: me.id, name: me.name, mic, cam, updatedAt: Date.now() };
    r.callPeers.set(sock.id, peer);
    sock.to(r.id).emit('call-peer-joined', peer);
    if (cb) cb({ ok: true, peers });
  });
  on('call-leave', (r, _me) => {
    if (!r.callPeers.has(sock.id)) return;
    r.callPeers.delete(sock.id); sock.to(r.id).emit('call-peer-left', { socketId: sock.id });
  });
  const relaySignal = (event) => on(event, (r, _me, cb, payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.target !== 'string' || payload.target.length > 80) return;
    const target = r.callPeers.get(payload.target);
    if (!target || target.socketId === sock.id) return cb && cb({ error: 'Peer is no longer in this call.' });
    const data = payload.data;
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > 12000) return cb && cb({ error: 'Invalid signaling payload.' });
    if ((event === 'webrtc-offer' || event === 'webrtc-answer') &&
        (!['offer', 'answer'].includes(data.type) || typeof data.sdp !== 'string' || data.sdp.length > 10000)) return cb && cb({ error: 'Invalid session description.' });
    if (event === 'webrtc-ice-candidate' && (typeof data.candidate !== 'string' || data.candidate.length > 4000)) return cb && cb({ error: 'Invalid ICE candidate.' });
    io.to(target.socketId).emit(event, { from: sock.id, data });
    if (cb) cb({ ok: true });
  });
  relaySignal('webrtc-offer'); relaySignal('webrtc-answer'); relaySignal('webrtc-ice-candidate');
  on('room:leave', (r, me) => { if (r.callPeers.has(sock.id)) { r.callPeers.delete(sock.id); sock.to(r.id).emit('call-peer-left', { socketId: sock.id }); } me.sids.delete(sock.id); if (!me.sids.size) removeMember(r, me); sock.leave(r.id); sock.data.roomId = null; }); // intentional: immediately, unless another tab of this person is still open
  on('mode:set', (r, me, _cb, mode) => {
    if (!isHostMember(r, me) || !MODES.includes(mode) || mode === r.mode) return;
    r.mode = mode; setPb(r, { playing: false, time: 0, rate: 1 }); sys(r, `${me.name} switched to ${mode} mode`);
    io.to(r.id).emit('mode:changed', { mode, playback: r.playback });
  });
  on('playback', (r, me, _cb, p) => {
    if (!canControl(r, me) || !p || typeof p !== 'object') return;
    const next = { playing: p.playing === true, time: clamp(p.time, 0, 172800, 0), rate: clamp(p.rate, 0.25, 2, 1) };
    if (r.playback.playing !== next.playing) sys(r, `${me.name} ${next.playing ? 'played' : 'paused'} the video`);
    setPb(r, next); sock.to(r.id).emit('playback', { ...next, from: me.id });
  });
  on('queue:add', (r, me, cb, item) => {
    if (!canControl(r, me)) return;
    const vid = cleanVideo(item); if (!vid) return cb && cb({ error: 'That link can’t be played here.' });
    if (r.queue.length >= MAX_QUEUE) return cb && cb({ error: 'The queue is full.' });
    const v = { ...vid, addedBy: me.id };
    sys(r, `${me.name} added “${v.title.slice(0, 60)}”`);
    if (!r.current) r.current = v; else r.queue.push(v);
    io.to(r.id).emit('queue:updated', { queue: r.queue, current: r.current });
    if (cb) cb({ ok: true }); // the client clears its input on success
  });
  // Manual Sync Mode (players that cannot be controlled from outside): whoever may control playback starts a shared 3-2-1 so everyone presses play together.
  // Google's player for the whole room, or back to VIMO's. Only the person in control may choose; everyone is told.
  on('drive:mode', (r, me, cb, p) => {
    if (!canControl(r, me)) return cb && cb({ error: 'Only the person in control can switch the player.' });
    if (!p || !r.current || p.id !== r.current.id || (p.mode !== 'auto' && p.mode !== 'manual')) return cb && cb({ error: 'That choice no longer applies to this video.' });
    r.driveMode = { id: p.id, mode: p.mode };
    sys(r, p.mode === 'manual' ? `${me.name} switched the room to Manual Sync Mode (Google’s player)` : `${me.name} switched the room back to VIMO’s player`);
    io.to(r.id).emit('drive:mode', r.driveMode);
    if (cb) cb({ ok: true });
  });
  // Temporary 2x speed: only the person in control, shared by the whole room; put back on release, or when that person leaves.
  on('playback-hold', (r, me, cb, p) => {
    if (!canControl(r, me)) return cb && cb({ error: 'Only the person in control can change speed.' });
    if (!p || typeof p !== 'object' || typeof p.on !== 'boolean') return cb && cb({ error: 'Invalid request.' });
    if (p.on) {
      if (r.hold) return cb && cb({ ok: true });
      r.hold = { memberId: me.id, sid: sock.id, prev: r.playback.rate };
      setPb(r, { ...livePb(r), rate: 2 });
      sock.to(r.id).emit('playback', { ...r.playback, from: me.id }); // the holder already knows: it plays at 2x locally
    } else if (r.hold && r.hold.memberId === me.id) releaseHold(r);
    if (cb) cb({ ok: true });
  });
  // App lifecycle: backgrounded (away) starts the same grace as a lost connection; returning cancels it. Nothing is announced either way.
  on('presence', (r, me, _cb, p) => {
    if (!p || typeof p.away !== 'boolean') return;
    me.away = p.away;
    if (p.away) startGrace(r, me); else cancelGrace(me);
  });
  on('countdown', (r, me) => { if (canControl(r, me)) io.to(r.id).emit('countdown', { by: me.name, seconds: 3 }); });
  on('queue:remove', (r, me, _cb, id) => {
    if (!canControl(r, me) || typeof id !== 'string') return; if (r.upNext && r.queue[0] && r.queue[0].id === id) clearUpNext(r); r.queue = r.queue.filter((v) => v.id !== id);
    io.to(r.id).emit('queue:updated', { queue: r.queue, current: r.current });
  });
  on('video:change', (r, me, _cb, item) => {
    if (!canControl(r, me)) return;
    const v = item && typeof item.id === 'string' && r.queue.find((q) => q.id === item.id); // only items that are really queued
    if (!v) return; clearUpNext(r); r.current = v; r.queue = r.queue.filter((q) => q.id !== v.id); setPb(r, { playing: true, time: 0, rate: 1 });
    io.to(r.id).emit('queue:updated', { queue: r.queue, current: r.current, playback: r.playback }); // one event, so clients never see a new video with the old time
  });
  on('video:ended', (r, _me, _cb, id) => { // any client may report it; only the first report for the current video starts the countdown
    if (typeof id !== 'string' || !r.current || r.current.id !== id || r.upNext) return;
    if (!r.queue.length) { r.current = null; setPb(r, { playing: false, time: 0, rate: 1 }); io.to(r.id).emit('queue:updated', { queue: r.queue, current: r.current, playback: r.playback }); return; }
    startUpNext(r);
  });
  on('up-next:cancel', (r, me) => { if (canControl(r, me)) clearUpNext(r); });

  /* shared local video: one person uploads straight to the bucket, everyone plays the same file */
  on('file:prepare', (r, me, cb, meta) => {
    if (!cb) return;
    if (!isHostMember(r, me)) return cb({ error: 'Only the host can share a video.' });
    if (!s3On()) return cb({ error: 'not_configured' });
    const size = Number(meta && meta.size), type = clean(meta && meta.type, 60).toLowerCase();
    if (!Number.isInteger(size) || size < 1) return cb({ error: 'That file looks empty.' });
    if (size > MAX_UPLOAD) return cb({ error: `That file is too large. The limit is ${Math.round(MAX_UPLOAD / 1048576)} MB.` });
    if (!/^video\/[a-z0-9.+-]{1,40}$/.test(type)) return cb({ error: 'Please choose a video file.' });
    const ext = (clean(meta.name, 120).match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || 'mp4';
    const key = `rooms/${r.id}/${uid()}.${ext.toLowerCase()}`;
    for (const [k, v] of r.pending) if (Date.now() - v.at > 8 * 3600000) r.pending.delete(k);
    r.pending.set(key, { pid: me.id, name: clean(meta.name, 120) || 'video', type, size, at: Date.now() });
    cb({ uploadUrl: presign('PUT', key, 6 * 3600), key, maxBytes: MAX_UPLOAD });
  });
  on('file:progress', (r, me, _cb, pct) => { sock.to(r.id).emit('file:uploading', { by: me.id, name: me.name, pct: clamp(pct, -1, 100, -1) }); });
  on('file:ready', async (r, me, cb, key) => {
    const p = typeof key === 'string' && r.pending.get(key);
    if (!p || p.pid !== me.id) return cb && cb({ error: 'Unknown upload.' });
    const len = await s3Head(key); // prove the object is really in the bucket before telling everyone it is ready
    if (len < 1 || len > MAX_UPLOAD) { s3Delete(key); r.pending.delete(key); return cb && cb({ error: 'The upload did not finish. Please try again.' }); }
    r.pending.delete(key); dropFile(r);
    r.file = { key, name: p.name, size: len, type: p.type, by: me.name, byId: me.id }; setPb(r, { playing: false, time: 0, rate: 1 });
    sys(r, `${me.name} shared “${p.name.slice(0, 60)}”`);
    io.to(r.id).emit('file:updated', { file: pubFile(r), playback: r.playback });
    if (cb) cb({ ok: true });
  });
  on('file:remove', (r, me) => {
    if (!r.file || (r.file.byId !== me.id && r.hostPid !== me.id)) return; // uploader or host
    dropFile(r); setPb(r, { playing: false, time: 0, rate: 1 });
    io.to(r.id).emit('file:updated', { file: null, playback: r.playback });
  });
  on('file:refresh', (_r, _me, cb) => { if (cb) cb({ file: pubFile(_r) }); }); // fresh presigned URL if the old one expired
  on('chat:send', (r, me, _cb, text) => {
    const payload = typeof text === 'string' ? { text } : (text && typeof text === 'object' ? text : {});
    const t = clean(payload.text, 500); if (!t) return;
    const targetId = typeof payload.replyToId === 'string' ? payload.replyToId : '';
    const target = targetId ? r.chat.find((x) => x.id === targetId && !x.system) : null;
    const replyTo = target ? { id: target.id, senderName: clean(target.name, 20) || 'Someone', text: clean(target.text, 180) } : undefined;
    const m = { id: uid(), from: me.id, name: me.name, avatar: me.avatar, color: me.color, text: t, at: Date.now(), ...(replyTo ? { replyTo } : {}) };
    r.chat.push(m); if (r.chat.length > 200) r.chat.shift(); io.to(r.id).emit('chat:message', m);
  });
  on('typing', (r, me) => { sock.to(r.id).emit('typing', { id: me.id, name: me.name }); }); // lets others show "Sam is typing…"
  // Message reactions: toggle the sender's reaction on a chat message and tell the whole room.
  //   client -> server: 'chat-react' { messageId, emoji }     server -> room: 'chat-reactions' { messageId, reactions: { [emoji]: memberId[] } }
  on('chat-react', (r, me, cb, p) => {
    const emoji = p && typeof p.emoji === 'string' ? EMOJI_CANON.get(norm(p.emoji)) : undefined;
    if (!p || typeof p.messageId !== 'string' || !emoji) return cb && cb({ error: 'Invalid reaction.' });
    const m = r.chat.find((x) => x.id === p.messageId && !x.system);
    if (!m) return cb && cb({ error: 'That message is no longer available.' });
    const reactions = m.reactions || (m.reactions = {}), who = reactions[emoji] || (reactions[emoji] = []), i = who.indexOf(me.id);
    if (i >= 0) who.splice(i, 1); else who.push(me.id);
    if (!who.length) delete reactions[emoji];
    if (!Object.keys(reactions).length) delete m.reactions;
    io.to(r.id).emit('chat-reactions', { messageId: m.id, reactions: m.reactions || {} });
    if (cb) cb({ ok: true });
  });
  on('reaction', (r, me, _cb, emoji) => {
    if (typeof emoji !== 'string' || !EMOJI.has(norm(emoji))) return;
    io.to(r.id).emit('reaction', { id: uid(), emoji, from: me.id });
  });

  on('browser:start', async (r, me, cb) => {
    if (!isHostMember(r, me)) return cb && cb({ error: 'Only the host can start the shared browser.' });
    if (r.hb) { if (!r.controller) setController(r, me.id); return cb && cb({ ok: true }); }
    if (r.hbStarting) return cb && cb({ error: 'The browser is already starting.' });
    if (!process.env.HYPERBEAM_API_KEY) return cb && cb({ error: 'The shared browser is not set up on the server.' });
    r.hbStarting = true;
    try {
      const res = await fetch('https://engine.hyperbeam.com/v0/vm', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HYPERBEAM_API_KEY}` },
        body: JSON.stringify({ control_disable_default: true, profile: { save: true, load: process.env.HYPERBEAM_PROFILE || 'couple_default_profile' } }) });
      if (!res.ok) throw Object.assign(new Error(`hyperbeam ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`), { status: res.status });
      const d = await res.json();
      if (!d.session_id || !d.embed_url || !d.admin_token) throw new Error('bad hyperbeam response');
      r.hb = { sessionId: d.session_id, embedUrl: d.embed_url, adminToken: d.admin_token };
      io.to(r.id).emit('hb:started', { embedUrl: r.hb.embedUrl }); setController(r, me.id);
      if (cb) cb({ ok: true });
    } catch (e) { console.error('hyperbeam start:', e.message); if (cb) cb({ error: e.status === 401 || e.status === 403 ? 'Hyperbeam rejected the API key. Check HYPERBEAM_API_KEY on Render.' : e.status === 402 || e.status === 429 ? 'Hyperbeam says the free minutes or the session limit are used up.' : e.status ? `Hyperbeam refused the request (HTTP ${e.status}). The Render logs have the details.` : 'Could not reach Hyperbeam. Try again in a moment.' }); }
    finally { r.hbStarting = false; }
  });
  on('browser:stop', async (r, me) => {
    if (!r.hb) return;
    if (r.controller && r.controller !== me.id && r.hostPid !== me.id) return; // controller or host only
    await stopHb(r);
  });
  on('browser:control', (r, me, cb, c) => {
    if (!r.hb || !c || typeof c !== 'object') return;
    const host = r.hostPid === me.id, isCtl = r.controller === me.id;
    if (!canControl(r, me)) return;
    if (c.action === 'take') { if (r.controller && !isCtl && !host) return cb && cb({ error: 'Someone else has control.' }); setController(r, me.id); }
    else if (c.action === 'release') { if (isCtl || host) setController(r, null); }
    else if (c.action === 'pass') { const to = isCtl || host ? r.members.find((m) => m.id === c.to) : null; if (to) setController(r, to.id); }
  });

  sock.on('disconnect', () => {
    { const r0 = sock.data.roomId && rooms.get(sock.data.roomId); if (r0 && r0.hold && r0.hold.sid === sock.id) releaseHold(r0); } // the 2x ends when its owner leaves
    const r = sock.data.roomId && rooms.get(sock.data.roomId);
    if (r && r.callPeers.has(sock.id)) { r.callPeers.delete(sock.id); sock.to(r.id).emit('call-peer-left', { socketId: sock.id }); }
    const me = r && r.members.find((m) => m.sids.has(sock.id));
    if (!me) return; me.sids.delete(sock.id); me.sid = [...me.sids][0] || null;
    if (!me.sids.size) startGrace(r, me); // the last connection is gone: keep the seat for GRACE_MS, silently
  });
});
setInterval(() => { for (const [id, r] of rooms) if (!r.members.length && Date.now() - (r.emptySince || r.createdAt) > Math.max(10 * 60000, HOST_RETURN_MS)) { stopHb(r); dropFile(r); rooms.delete(id); } }, 5 * 60000).unref(); // parties nobody ever joined
server.listen(process.env.PORT || 4000, () => {
  console.log('server up');
  setTimeout(() => storageSelfTest().then((r) => console.log('[storage]', JSON.stringify(r))), 3000);
  setTimeout(() => servicesCheck().then((r) => console.log('[services]', JSON.stringify(r))), 3500);
});
