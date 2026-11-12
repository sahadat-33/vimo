require('dotenv').config();
const express = require('express'), http = require('http'), cors = require('cors');
const { Server } = require('socket.io');
const ROOM_PASSCODE = process.env.ROOM_PASSCODE || '';
const ok = (p) => !!ROOM_PASSCODE && p === ROOM_PASSCODE;
const origin = process.env.CLIENT_ORIGIN || '*';
const app = express();
app.use(cors({ origin })); app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin } });

/** roomId -> state. Keep in sync with client/src/lib/types.ts */
const rooms = new Map();
const room = (id) => {
  if (!rooms.has(id)) rooms.set(id, { mode: 'youtube', queue: [], current: null,
    playback: { playing: false, time: 0, rate: 1 }, chat: [], hb: null, daily: null, controller: null, members: [] });
  return rooms.get(id);
};
const pub = (r) => ({ mode: r.mode, queue: r.queue, current: r.current, playback: r.playback,
  chat: r.chat.slice(-100), hb: r.hb && { embedUrl: r.hb.embedUrl, adminToken: r.hb.adminToken }, controller: r.controller });

app.get('/health', (_q, s) => s.json({ ok: true, rooms: rooms.size }));
app.post('/api/auth', (q, s) => (ok(q.body.passcode) ? s.json({ ok: true }) : s.status(401).json({ ok: false })));
const guard = (q, s, n) => (ok(q.get('x-passcode')) ? n() : s.status(401).json({ error: 'bad passcode' }));

app.post('/api/daily/:roomId', guard, async (q, s) => {
  try {
    const r = room(q.params.roomId);
    if (!r.daily) {
      const res = await fetch('https://api.daily.co/v1/rooms', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DAILY_API_KEY}` },
        body: JSON.stringify({ properties: { max_participants: 2, exp: Math.floor(Date.now() / 1000) + 6 * 3600, enable_prejoin_ui: false } }) });
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
  sock.on('room:join', (roomId, cb) => {
    const r = room(roomId);
    if (r.members.length >= 2 && !r.members.includes(sock.id)) return cb({ error: 'Room is full' });
    id = roomId; sock.join(id); r.members.push(sock.id);
    cb({ state: pub(r), selfId: sock.id, isHost: r.members[0] === sock.id });
    sock.to(id).emit('peer:joined', sock.id);
  });
  const w = (fn) => (...a) => { if (id) fn(room(id), ...a); };
  sock.on('mode:set', w((r, mode) => { r.mode = mode; r.playback = { playing: false, time: 0, rate: 1 };
    io.to(id).emit('mode:changed', { mode, playback: r.playback }); }));
  sock.on('playback', w((r, p) => { r.playback = { playing: !!p.playing, time: +p.time || 0, rate: +p.rate || 1 };
    sock.to(id).emit('playback', { ...r.playback, from: sock.id }); }));
  sock.on('queue:add', w((r, item) => { r.queue.push(item); if (!r.current) r.current = r.queue.shift();
    io.to(id).emit('queue:updated', { queue: r.queue, current: r.current }); }));
  sock.on('queue:remove', w((r, vid) => { r.queue = r.queue.filter((v) => v.id !== vid);
    io.to(id).emit('queue:updated', { queue: r.queue, current: r.current }); }));
  sock.on('video:change', w((r, item) => { r.current = item; r.queue = r.queue.filter((v) => v.id !== item.id);
    r.playback = { playing: true, time: 0, rate: 1 };
    io.to(id).emit('queue:updated', { queue: r.queue, current: r.current });
    io.to(id).emit('playback', { ...r.playback, from: sock.id }); }));
  sock.on('chat:send', w((r, text) => { const m = { id: Date.now() + sock.id, from: sock.id, text: String(text).slice(0, 500), at: Date.now() };
    r.chat.push(m); io.to(id).emit('chat:message', m); }));
  sock.on('file:signal', w((_r, data) => sock.to(id).emit('file:signal', data)));
  sock.on('browser:control', w((r, who) => { r.controller = who; io.to(id).emit('browser:controller', who); }));
  sock.on('disconnect', () => {
    if (!id) return; const rid = id, r = room(rid); r.members = r.members.filter((m) => m !== sock.id);
    sock.to(rid).emit('peer:left', sock.id);
    if (!r.members.length) setTimeout(() => { const x = rooms.get(rid); if (x && !x.members.length) { stopHb(rid); rooms.delete(rid); } }, 60000);
  });
});
server.listen(process.env.PORT || 4000, () => console.log('server up'));
