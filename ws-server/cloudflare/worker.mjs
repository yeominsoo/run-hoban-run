import { DurableObject } from 'cloudflare:workers';
import { EventEmitter } from 'node:events';
import { GameTimers } from '../game-timers.mjs';
import { createResultRanking, createRpsRanking, isoWeekKey } from '../ranking-data.mjs';
import { normalizeEntry, collapseBestScores } from '../score-ranking-data.mjs';
import { encodeSnapshot, decodeSnapshot } from './snapshot.mjs';
import { games, scoreGames } from './games.mjs';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' };
const IDLE_MS = 30 * 60 * 1000;
const MAX_MESSAGE_BYTES = 4096;
function json(data, status = 200) { return Response.json(data, { status, headers: CORS }); }
function gameForPath(path) {
  if (path === '/ranking') return 'rps';
  if (path.startsWith('/ranking/score/')) {
    const key = path.slice('/ranking/score/'.length);
    return scoreGames.includes(key) ? `score:${key}` : null;
  }
  const key = path.startsWith('/ranking/') ? path.slice('/ranking/'.length) : path.slice(1);
  return Object.hasOwn(games, key) ? key : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/healthz') return new Response('ok', { headers: CORS });
    const migration = url.pathname.startsWith('/__migration/');
    const game = migration ? gameForPath(url.pathname.slice('/__migration'.length)) : gameForPath(url.pathname);
    if (!game) return json({ error: 'unknown game' }, 404);
    if (migration) {
      if (!env.MIGRATION_TOKEN || request.headers.get('authorization') !== `Bearer ${env.MIGRATION_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    } else if (!url.pathname.startsWith('/ranking') && request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket required' }, 426);
    }
    const headers = new Headers(request.headers);
    headers.set('x-game-key', game);
    return env.GAMES.getByName(game).fetch(new Request(request, { headers }));
  },
};

class SocketServer extends EventEmitter {}
class GameSocket extends EventEmitter {
  constructor(id, owner, socket = null) { super(); this.id = id; this.owner = owner; this.socket = socket; this.OPEN = 1; }
  get readyState() { return this.socket?.readyState ?? 3; }
  send(data) { this.owner.outbox.push(() => { if (this.readyState === 1) this.socket.send(data); }); }
  close(code = 1000, reason = '') { this.owner.outbox.push(() => this.socket?.close(code, reason)); }
}

export class GameService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sockets = new Map();
    this.outbox = [];
    this.nativeTimer = null;
    ctx.blockConcurrencyWhile(async () => {
      this.game = await ctx.storage.get('game');
      const saved = await ctx.storage.get('snapshot');
      this.saved = saved;
      for (const ws of ctx.getWebSockets()) {
        const { id } = ws.deserializeAttachment();
        this.sockets.set(id, new GameSocket(id, this, ws));
      }
      this.state = saved ? decodeSnapshot(saved, id => this.socket(id)) : {
        rooms: new Map(), wsIdentity: new Map(), ranking: {}, activity: new Map(),
        timers: { nextId: 1, tasks: new Map() },
      };
      if (this.game) this.initialize();
    });
  }

  socket(id) {
    if (!this.sockets.has(id)) this.sockets.set(id, new GameSocket(id, this));
    return this.sockets.get(id);
  }

  initialize() {
    if (this.game.startsWith('score:')) return;
    this.timers = new GameTimers(this.state.timers);
    this.engine = games[this.game]({
      WebSocketServer: SocketServer, timers: this.timers,
      rooms: this.state.rooms, wsIdentity: this.state.wsIdentity,
      createRankingStore: () => createResultRanking(this.state.ranking),
      createRpsRankingStore: () => createRpsRanking(this.state.ranking),
    });
    for (const socket of this.sockets.values()) this.engine.wss.emit('connection', socket);
  }

  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const game = request.headers.get('x-game-key');
      if (!this.game) {
        this.game = game;
        this.initialize();
        await this.ctx.storage.put('game', game);
      }
      if (game !== this.game) return json({ error: 'wrong game' }, 400);
      const url = new URL(request.url);
      if (url.pathname.startsWith('/__migration/')) return this.importRankings(request);
      if (this.game.startsWith('score:')) return this.scoreRanking(request);
      this.maintain();
      if (url.pathname.startsWith('/ranking')) {
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const week = url.searchParams.get('week') || isoWeekKey();
        const entries = this.engine.getRanking(week);
        await this.save();
        return json({ week, entries, prevWeek: isoWeekKey(new Date(Date.now() - 7 * 86400000)) });
      }
      if (this.ctx.getWebSockets().length >= 256) return json({ error: '서버가 혼잡합니다. 잠시 후 다시 접속해주세요.' }, 503);
      const pair = new WebSocketPair();
      const id = crypto.randomUUID();
      pair[1].serializeAttachment({ id, openedAt: Date.now(), messages: 0, windowAt: Date.now() });
      this.ctx.acceptWebSocket(pair[1]);
      const socket = new GameSocket(id, this, pair[1]);
      this.sockets.set(id, socket);
      this.engine.wss.emit('connection', socket);
      await this.save();
      return new Response(null, { status: 101, webSocket: pair[0] });
    });
  }

  async webSocketMessage(ws, raw) {
    return this.ctx.blockConcurrencyWhile(async () => {
      this.maintain();
      const attachment = ws.deserializeAttachment();
      const socket = this.socket(attachment.id);
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) {
        ws.close(1009, 'Message too large'); await this.save(); return;
      }
      if (Date.now() - attachment.windowAt > 1000) { attachment.windowAt = Date.now(); attachment.messages = 0; }
      if (++attachment.messages > 60) { ws.close(1008, 'Too many messages'); await this.save(); return; }
      ws.serializeAttachment(attachment);
      let message;
      try { message = JSON.parse(raw); } catch { await this.save(); return; }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') { await this.save(); return; }
      const bound = this.state.wsIdentity.get(socket);
      if (bound && ['create', 'join', 'rejoin'].includes(message.type)) {
        socket.send(JSON.stringify({ type: 'error', message: '이미 방에 참가하고 있습니다.' }));
      } else if (message.type === 'create' && this.state.rooms.size >= 64) {
        socket.send(JSON.stringify({ type: 'error', message: '사용 중인 방이 많습니다. 잠시 후 다시 시도해주세요.' }));
      } else {
        if (message.type === 'rejoin') {
          const code = typeof message.roomCode === 'string' ? message.roomCode.trim().toUpperCase().slice(0, 6) : '';
          const player = this.state.rooms.get(code)?.players.find(p => p.token === message.token);
          if (player?.ws && player.ws !== socket) {
            // A delayed close from the old connection must not disconnect the new one.
            this.state.wsIdentity.delete(player.ws);
            player.ws.close(1000, 'Reconnected');
          }
        }
        socket.emit('message', raw);
        const identity = this.state.wsIdentity.get(socket);
        if (identity) this.state.activity.set(identity.roomCode, Date.now());
      }
      await this.save();
    });
  }

  async webSocketClose(ws, code, reason) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const id = ws.deserializeAttachment()?.id;
      const socket = this.sockets.get(id);
      if (socket) { socket.emit('close'); socket.socket = null; }
      try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
      this.maintain();
      await this.save();
    });
  }
  async webSocketError(ws) { return this.webSocketClose(ws, 1011, 'Connection error'); }

  maintain() {
    if (!this.engine) return;
    for (const socket of this.state.wsIdentity.keys()) {
      if (!socket.socket) socket.emit('close');
    }
    for (const [code, room] of this.state.rooms) {
      if (!this.state.activity.has(code)) this.state.activity.set(code, Date.now());
      if (Date.now() - this.state.activity.get(code) < IDLE_MS) continue;
      this.state.rooms.delete(code);
      for (const [socket, identity] of this.state.wsIdentity) {
        if (identity.roomCode !== code) continue;
        this.state.wsIdentity.delete(socket);
        socket.send(JSON.stringify({ type: 'error', message: '오랫동안 활동이 없어 방이 종료되었습니다.' }));
        socket.close(1000, 'Room expired');
      }
      for (const [id, task] of this.state.timers.tasks) {
        if (task.args.includes(code) || task.args.includes(room)) this.state.timers.tasks.delete(id);
      }
    }
    this.timers.runDue();
    for (const [socket, identity] of this.state.wsIdentity) {
      if (!this.state.rooms.has(identity.roomCode)) this.state.wsIdentity.delete(socket);
    }
    for (const code of this.state.activity.keys()) if (!this.state.rooms.has(code)) this.state.activity.delete(code);
    // All games delete finished/empty rooms. Discard callbacks retaining those rooms.
    const liveRooms = new Set(this.state.rooms.values());
    for (const [id, task] of this.state.timers.tasks) {
      const roomArg = task.args.find(arg => arg && typeof arg === 'object' && Array.isArray(arg.players));
      const codeArg = task.args.find(arg => typeof arg === 'string' && /^[A-F0-9]{6}$/.test(arg));
      if ((roomArg && !liveRooms.has(roomArg)) || (codeArg && !this.state.rooms.has(codeArg))) this.state.timers.tasks.delete(id);
    }
  }

  async save() {
    this.maintain();
    const encoded = encodeSnapshot(this.state, value => value instanceof GameSocket ? value.id : null);
    let next = this.timers?.nextAt() ?? Infinity;
    for (const at of this.state.activity.values()) next = Math.min(next, at + IDLE_MS);
    for (const ws of this.ctx.getWebSockets()) {
      const { id, openedAt } = ws.deserializeAttachment();
      if (!this.state.wsIdentity.has(this.socket(id))) {
        if (Date.now() - openedAt > 60000) ws.close(1000, 'Join timeout');
        else next = Math.min(next, openedAt + 60001);
      }
    }
    await this.ctx.storage.transaction(async tx => {
      if (encoded !== this.saved) await tx.put('snapshot', encoded);
      const alarm = await tx.getAlarm();
      if (Number.isFinite(next)) { if (alarm !== next) await tx.setAlarm(next); }
      else if (alarm !== null) await tx.deleteAlarm();
    });
    this.saved = encoded;
    const outbox = this.outbox.splice(0);
    for (const send of outbox) { try { send(); } catch { /* disconnect races are handled by webSocketClose */ } }
    clearTimeout(this.nativeTimer);
    // Short animation/reaction deadlines stay precise; long waits use durable alarms.
    if (Number.isFinite(next) && next - Date.now() <= 2000) {
      this.nativeTimer = setTimeout(() => this.alarm(), Math.max(0, next - Date.now()));
    }
    for (const [id, socket] of this.sockets) {
      if (!socket.socket && !this.state.wsIdentity.has(socket)) this.sockets.delete(id);
    }
  }

  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => { this.maintain(); await this.save(); });
  }

  async scoreRanking(request) {
    if (request.method === 'GET') return json({ entries: this.state.ranking.entries || [] });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536) return json({ error: 'payload too large' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'invalid json' }, 400); }
    const incoming = (Array.isArray(body?.entries) ? body.entries : []).slice(0, 20).map(normalizeEntry).filter(Boolean);
    if (!incoming.length) return json({ error: 'no valid entries' }, 400);
    const previous = this.state.ranking.entries || [];
    const entries = collapseBestScores([...previous, ...incoming]);
    const changed = JSON.stringify(entries) !== JSON.stringify(previous);
    this.state.ranking.entries = entries;
    await this.save();
    return json({ accepted: incoming.length, changed, entries });
  }

  async importRankings(request) {
    if (Object.keys(this.state.ranking).length) return json({ error: 'rankings already exist; refusing to overwrite' }, 409);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1500000) return json({ error: 'payload too large' }, 413);
    let data;
    try { data = JSON.parse(raw); } catch { return json({ error: 'invalid json' }, 400); }
    if (this.game.startsWith('score:')) {
      const entries = Array.isArray(data) ? data : data?.entries;
      if (!Array.isArray(entries)) return json({ error: 'invalid score ranking' }, 400);
      this.state.ranking.entries = collapseBestScores(entries.map(normalizeEntry).filter(Boolean));
    } else {
      if (!data || Array.isArray(data) || typeof data !== 'object') return json({ error: 'invalid ranking' }, 400);
      for (const [week, entries] of Object.entries(data)) {
        if (!/^\d{4}-W\d{2}$/.test(week) || !entries || typeof entries !== 'object' || Array.isArray(entries)) return json({ error: 'invalid ranking week' }, 400);
        for (const record of Object.values(entries)) {
          if (!record || typeof record !== 'object' || Object.values(record).some(n => !Number.isSafeInteger(n) || n < 0)) return json({ error: 'invalid ranking record' }, 400);
        }
      }
      Object.assign(this.state.ranking, data);
    }
    await this.save();
    return json({ imported: true });
  }
}
