require('dotenv').config();
const express = require('express'), http = require('http'), cors = require('cors');
const { Server } = require('socket.io');
const ROOM_PASSCODE = process.env.ROOM_PASSCODE || '';
const crypto = require('crypto');
const sha = (x) => crypto.createHash('sha256').update(x).digest();
const ok = (p) => !!ROOM_PASSCODE && typeof p === 'string' && crypto.timingSafeEqual(sha(p), sha(ROOM_PASSCODE)); // constant-time check
const origin = process.env.CLIENT_ORIGIN || '*';
const app = express();
app.use(cors({ origin })); app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin } });

/** roomId -> state. Keep in sync with client/src/lib/types.ts */
const MAX = 10;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const who = (r, sid) => (r.members.find((m) => m.id === sid) || {}).name || 'Someone';
const sys = (id, r, text) => { const m = { id: uid(), from: 'system', name: '', avatar: '', color: '', text, at: Date.now(), system: true };
  r.chat.push(m); io.to(id).emit('chat:message', m); };
const rooms = new Map();
const room = (id) => {
  if (!rooms.has(id)) rooms.set(id, { mode: 'youtube', queue: [], current: null,
    playback: { playing: false, time: 0, rate: 1 }, chat: [], hb: null, daily: null, controller: null, members: [] });
  return rooms.get(id);
};
const pub = (r) => ({ mode: r.mode, queue: r.queue, current: r.current, playback: r.playback,
  chat: r.chat.slice(-100), hb: r.hb && { embedUrl: r.hb.embedUrl, adminToken: r.hb.adminToken }, controller: r.controller, members: r.members });

app.get('/health', (_q, s) => s.json({ ok: true, rooms: rooms.size, people: [...rooms.values()].reduce((n, r) => n + r.members.length, 0) }));
app.set('trust proxy', 1);
const tries = new Map(); // ip -> failed-attempt timestamps (10 per 10 min)
app.post('/api/auth', (q, s) => {
  const now = Date.now(), t = (tries.get(q.ip) || []).filter((x) => now - x < 600000);
  if (t.length >= 10) return s.status(429).json({ ok: false, error: 'too_many' });
  if (ok(q.body && q.body.passcode)) return s.json({ ok: true });
  t.push(now); tries.set(q.ip, t); s.status(401).json({ ok: false });
});
const guard = (q, s, n) => (ok(q.get('x-passcode')) ? n() : s.status(401).json({ error: 'bad passcode' }));

app.post('/api/daily/:roomId', guard, async (q, s) => {
  try {
    const r = room(q.params.roomId);
    if (!r.daily) {
      const res = await fetch('https://api.daily.co/v1/rooms', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DAILY_API_KEY}` },
        body: JSON.stringify({ properties: { max_participants: 10, exp: Math.floor(Date.now() / 1000) + 6 * 3600, enable_prejoin_ui: false } }) });
      if (!res.ok) throw new Error(await res.text());
      r.daily = (await res.json()).url;
    }
    s.json({ url: r.daily });
  } catch (e) { s.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/hyperbeam/start', guard, async (q, s) => {
  try {
    const id = q.body.roomId, r = room(id);
    if (!r.hb) {
      const res = await fetch('https://engine.hyperbeam.com/v0/vm', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HYPERBEAM_API_KEY}` },
        body: JSON.stringify({ profile: { save: true, load: process.env.HYPERBEAM_PROFILE || 'couple_default_profile' } }) });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      r.hb = { sessionId: d.session_id, embedUrl: d.embed_url, adminToken: d.admin_token };
    }
    const out = { embedUrl: r.hb.embedUrl, adminToken: r.hb.adminToken };
    io.to(id).emit('hb:started', out); s.json(out);
  } catch (e) { s.status(500).json({ error: String(e.message || e) }); }
});

async function stopHb(id) {
  const r = room(id); if (!r.hb) return;
  const sid = r.hb.sessionId; r.hb = null; r.controller = null;
  await fetch(`https://engine.hyperbeam.com/v0/vm/${sid}`, { method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.HYPERBEAM_API_KEY}` } }).catch(() => {});
  io.to(id).emit('hb:stopped');
}
app.post('/api/hyperbeam/stop', guard, async (q, s) => { await stopHb(q.body.roomId); s.json({ ok: true }); });

io.use((sock, next) => (ok(sock.handshake.auth.passcode) ? next() : next(new Error('bad passcode'))));
io.on('connection', (sock) => {
  let id = null;
  sock.on('room:join', (roomId, profile, cb) => {
    const r = room(roomId);
    if (r.members.length >= MAX && !r.members.some((m) => m.id === sock.id)) return cb({ error: 'Room is full (max 10 people)' });
    id = roomId; sock.join(id);
    const me = { id: sock.id, name: String((profile && profile.name) || 'Guest').slice(0, 20),
      avatar: String((profile && profile.avatar) || '🙂').slice(0, 4), color: String((profile && profile.color) || '#f0a3b5').slice(0, 9) };
    r.members.push(me);
    cb({ state: pub(r), selfId: sock.id, isHost: r.members[0].id === sock.id });
    sock.to(id).emit('peer:joined', me); sys(id, r, `${me.name} joined`);
  });
  const w = (fn) => (...a) => { if (id) fn(room(id), ...a); };
  sock.on('mode:set', w((r, mode) => { r.mode = mode; sys(id, r, `${who(r, sock.id)} switched to ${mode} mode`); r.playback = { playing: false, time: 0, rate: 1 };
    io.to(id).emit('mode:changed', { mode, playback: r.playback }); }));
  sock.on('playback', w((r, p) => { if (r.playback.playing !== !!p.playing) sys(id, r, `${who(r, sock.id)} ${p.playing ? 'played' : 'paused'} the video`); r.playback = { playing: !!p.playing, time: +p.time || 0, rate: +p.rate || 1 };
    sock.to(id).emit('playback', { ...r.playback, from: sock.id }); }));
  sock.on('queue:add', w((r, item) => { sys(id, r, `${who(r, sock.id)} added “${String(item.title).slice(0, 60)}”`); r.queue.push(item); if (!r.current) r.current = r.queue.shift();
    io.to(id).emit('queue:updated', { queue: r.queue, current: r.current }); }));
  sock.on('queue:remove', w((r, vid) => { r.queue = r.queue.filter((v) => v.id !== vid);
    io.to(id).emit('queue:updated', { queue: r.queue, current: r.current }); }));
  sock.on('video:change', w((r, item) => { r.current = item; r.queue = r.queue.filter((v) => v.id !== item.id);
    r.playback = { playing: true, time: 0, rate: 1 };
    io.to(id).emit('queue:updated', { queue: r.queue, current: r.current });
    io.to(id).emit('playback', { ...r.playback, from: sock.id }); }));
  sock.on('chat:send', w((r, text) => { const me = r.members.find((x) => x.id === sock.id) || {}; const m = { id: uid(), from: sock.id, name: me.name, avatar: me.avatar, color: me.color, text: String(text).slice(0, 500), at: Date.now() };
    r.chat.push(m); io.to(id).emit('chat:message', m); }));
  sock.on('reaction', w((_r, emoji) => io.to(id).emit('reaction', { id: uid(), emoji: String(emoji).slice(0, 4), from: sock.id })));
  sock.on('file:signal', w((_r, data) => sock.to(id).emit('file:signal', data)));
  sock.on('browser:control', w((r, who) => { r.controller = who; io.to(id).emit('browser:controller', who); }));
  sock.on('disconnect', () => {
    if (!id) return; const rid = id, r = room(rid); const nm = who(r, sock.id); r.members = r.members.filter((m) => m.id !== sock.id); sys(rid, r, `${nm} left`);
    sock.to(rid).emit('peer:left', sock.id);
    if (!r.members.length) setTimeout(() => { const x = rooms.get(rid); if (x && !x.members.length) { stopHb(rid); rooms.delete(rid); } }, 60000);
  });
});
server.listen(process.env.PORT || 4000, () => console.log('server up'));
