import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { registerLiarServer } from './liar.mjs';
import { registerMafiaServer } from './mafia.mjs';
import { registerHalliGalliServer } from './halligalli.mjs';
import { registerYutnoriServer } from './yutnori.mjs';
import { registerStrategyYutnoriServer } from './strategy-yutnori.mjs';

const PORT = Number(process.env.PORT) || 8787;
const MOVES = new Set(['rock', 'paper', 'scissors']);
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000;
const WINS_TO_SET = 2;    // best-of-3 within a set: 2 wins
const WINS_TO_BATTLE = 3; // battle royale: first to 3 round wins (or last survivor) wins

// ── Ranking DB (file-backed in-memory store) ─────────────────────
const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
const RANKING_FILE = join(DATA_DIR, 'ranking.json');

let rankingData = {};
try {
  mkdirSync(DATA_DIR, { recursive: true });
  rankingData = JSON.parse(readFileSync(RANKING_FILE, 'utf8'));
} catch { /* first run or corrupt — start fresh */ }

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { writeFileSync(RANKING_FILE, JSON.stringify(rankingData)); } catch (e) { console.error('[ranking] save failed', e.message); }
  }, 2000);
}

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Record a set/round win for a player in the current ISO week. */
function recordSetWin(name, mode) {
  if (!name || !mode) return;
  const week = isoWeekKey();
  if (!rankingData[week]) rankingData[week] = {};
  if (!rankingData[week][name]) rankingData[week][name] = { '1v1': 0, battle: 0, tournament: 0 };
  rankingData[week][name][mode] = (rankingData[week][name][mode] || 0) + 1;
  scheduleSave();
}

/** Returns sorted ranking entries for a given ISO week key. */
function getRanking(week) {
  const weekData = rankingData[week] || {};
  return Object.entries(weekData)
    .map(([name, modes]) => {
      const byMode = { '1v1': modes['1v1'] || 0, battle: modes.battle || 0, tournament: modes.tournament || 0 };
      return { name, byMode, total: byMode['1v1'] + byMode.battle + byMode.tournament };
    })
    .filter(e => e.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 50);
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const httpServer = createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS_HEADERS); res.end(); return; }
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (req.url === '/ranking' || req.url?.startsWith('/ranking?')) {
    const week = new URL(req.url, 'http://localhost').searchParams.get('week') || isoWeekKey();
    const entries = getRanking(week);
    const prevWeek = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return isoWeekKey(d); })();
    res.writeHead(200, { 'content-type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ week, entries, prevWeek }));
    return;
  }
  res.writeHead(404); res.end();
});

// ws는 같은 httpServer에 path별로 여러 WebSocketServer를 그냥 붙이는 걸 지원하지 않는다 —
// 각 인스턴스가 'upgrade' 리스너를 등록해 path가 안 맞으면 그 자리에서 즉시 400을 응답해버려서,
// 나중에 등록된 서버(liar)가 처리할 기회조차 없이 소켓이 끊긴다. 그래서 noServer 모드로 만들고
// 이 파일 하단에서 요청 경로를 보고 수동으로 라우팅한다.
const wss = new WebSocketServer({ noServer: true });

/**
 * Room:
 * {
 *   mode: '1v1' | 'battle' | 'tournament',
 *   hostToken: string,
 *   capacity: number,
 *   players: [{ token, name, ws }],   // ws = null when disconnected
 *   choices: Map<token, choice>,
 *   matchWins: Map<pairKey, Map<token, number>>,  // pairKey = sorted tokens joined by ':' — 1v1/tournament only
 *   setScores: Map<token, number>,    // 1v1/tournament: cumulative set wins. battle: cumulative round wins.
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   round: number,
 *   // tournament only:
 *   activePairs: [string, string][],  // token pairs currently playing
 *   byeTokens: string[],              // players sitting out this round
 *   eliminated: Set<string>,          // eliminated (out of the bracket)
 *   // battle only:
 *   aliveTokens: Set<string>,         // survivors still in the current round
 * }
 */
const rooms = new Map();
/** ws -> { roomCode, token } */
const wsIdentity = new Map();

// ── helpers ──────────────────────────────────────────────────────
function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function sanitizeName(name) {
  const s = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  return s || '손님';
}

function sanitizeRoomCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase().slice(0, ROOM_CODE_LENGTH) : '';
}

function genRoomCode() {
  const now = new Date();
  const base = [now.getFullYear(), now.getMonth() + 1, now.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()].join('-');
  let attempt = 0, code;
  do {
    const digest = createHash('sha256').update(`${base}-${attempt}`).digest('hex');
    code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
    attempt++;
  } while (rooms.has(code));
  return code;
}

function playerByToken(room, token) { return room.players.find(p => p.token === token); }

function resolveOutcome(mine, theirs) {
  if (mine === theirs) return 'draw';
  return BEATS[mine] === theirs ? 'win' : 'lose';
}

function pairKey(t1, t2) { return [t1, t2].sort().join(':'); }

function clearDisconnectTimer(room, token) {
  const t = room.disconnectTimers.get(token);
  if (t) { clearTimeout(t); room.disconnectTimers.delete(token); }
}

function clearAllDisconnectTimers(room) {
  room.players.forEach(p => clearDisconnectTimer(room, p.token));
}

// ── lobby broadcast ──────────────────────────────────────────────
function broadcastLobbyUpdate(room, roomCode) {
  const playerList = room.players.map(p => ({
    name: p.name,
    isHost: p.token === room.hostToken,
    connected: !!p.ws,
  }));
  for (const p of room.players) {
    if (p.ws) {
      send(p.ws, {
        type: 'lobby_update',
        players: playerList,
        roomCode,
        isHost: p.token === room.hostToken,
        canStart: room.players.filter(x => x.ws).length >= 2 && p.token === room.hostToken,
      });
    }
  }
}

// ── match-win tracking per pair ─────────────────────────────────
function getMatchWins(room, t1, t2) {
  const k = pairKey(t1, t2);
  if (!room.matchWins.has(k)) room.matchWins.set(k, new Map());
  return room.matchWins.get(k);
}

function resetMatchWins(room, t1, t2) {
  room.matchWins.delete(pairKey(t1, t2));
}

// ── resolve a pair's choice ──────────────────────────────────────
function resolvePair(roomCode, t1, t2) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (!room.choices.has(t1) || !room.choices.has(t2)) return;

  const c1 = room.choices.get(t1);
  const c2 = room.choices.get(t2);
  room.choices.delete(t1);
  room.choices.delete(t2);

  const o1 = resolveOutcome(c1, c2);
  const o2 = resolveOutcome(c2, c1);

  const mw = getMatchWins(room, t1, t2);
  if (o1 === 'win') mw.set(t1, (mw.get(t1) || 0) + 1);
  if (o2 === 'win') mw.set(t2, (mw.get(t2) || 0) + 1);

  const w1 = mw.get(t1) || 0;
  const w2 = mw.get(t2) || 0;
  const p1 = playerByToken(room, t1);
  const p2 = playerByToken(room, t2);

  const sendResult = (ws, you, opp, outcome, yourWins, oppWins, yourSets, oppSets) => {
    send(ws, { type: 'result', you, opponent: opp, outcome, matchWins: { you: yourWins, opponent: oppWins }, setScore: { you: yourSets, opponent: oppSets } });
  };

  if (p1?.ws) sendResult(p1.ws, c1, c2, o1, w1, w2, room.setScores.get(t1) || 0, room.setScores.get(t2) || 0);
  if (p2?.ws) sendResult(p2.ws, c2, c1, o2, w2, w1, room.setScores.get(t2) || 0, room.setScores.get(t1) || 0);

  // 다른 대진이 대기 중일 때 실시간 진행 현황을 볼 수 있도록, 세트가 끝나지 않아도 매 판마다 갱신해서 뿌린다.
  if (room.mode === 'tournament') broadcastTournamentState(room, roomCode);

  // Check set (best-of-3) completion
  const setWinner = w1 >= WINS_TO_SET ? t1 : w2 >= WINS_TO_SET ? t2 : null;
  if (setWinner) {
    const setLoser = setWinner === t1 ? t2 : t1;
    room.setScores.set(setWinner, (room.setScores.get(setWinner) || 0) + 1);
    resetMatchWins(room, t1, t2);

    const sw1 = room.setScores.get(t1) || 0;
    const sw2 = room.setScores.get(t2) || 0;
    const winnerName = playerByToken(room, setWinner)?.name;

    // Record set win in ranking DB
    recordSetWin(winnerName, room.mode);

    if (p1?.ws) send(p1.ws, { type: 'set_over', youWon: setWinner === t1, setScore: { you: sw1, opponent: sw2 }, winnerName });
    if (p2?.ws) send(p2.ws, { type: 'set_over', youWon: setWinner === t2, setScore: { you: sw2, opponent: sw1 }, winnerName });

    if (room.mode === 'tournament') {
      // Eliminate loser, advance winner
      room.eliminated.add(setLoser);
      room.activePairs = room.activePairs.filter(([a, b]) => !(a === t1 && b === t2) && !(a === t2 && b === t1));
      // 방금 세트를 끝낸 플레이어가 대기 화면에 들어가자마자 남은 대진의 현재 상황을 바로 볼 수 있도록.
      broadcastTournamentState(room, roomCode);
      checkTournamentRound(roomCode);
    }
    // 1v1: pair stays active; players click "다음 세트" independently
  }
}

// ── tournament logic ─────────────────────────────────────────────
function startTournamentRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const alive = room.players.filter(p => !room.eliminated.has(p.token) && p.ws);
  if (alive.length <= 1) {
    const winner = alive[0] || room.players.find(p => !room.eliminated.has(p.token));
    if (winner) recordSetWin(winner.name, 'tournament'); // bonus: tournament win counts as extra set win
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'tournament_winner', winnerName: winner?.name || '?' });
    }
    rooms.delete(roomCode);
    return;
  }

  // Shuffle and pair up; odd player gets a bye
  const shuffled = [...alive].sort(() => Math.random() - 0.5);
  const pairs = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairs.push([shuffled[i].token, shuffled[i + 1].token]);
  }
  const byePlayer = shuffled.length % 2 === 1 ? shuffled[shuffled.length - 1] : null;

  room.activePairs = pairs;
  room.round++;

  // Notify each player of their opponent (or bye)
  for (const [t1, t2] of pairs) {
    const p1 = playerByToken(room, t1);
    const p2 = playerByToken(room, t2);
    const roundInfo = { round: room.round, totalPlayers: alive.length };
    if (p1?.ws) send(p1.ws, { type: 'match_start', opponentName: p2.name, ...roundInfo });
    if (p2?.ws) send(p2.ws, { type: 'match_start', opponentName: p1.name, ...roundInfo });
  }
  if (byePlayer?.ws) {
    send(byePlayer.ws, { type: 'bye', round: room.round });
  }

  // Broadcast bracket info to all
  broadcastTournamentState(room, roomCode);
}

// 다음 라운드로 넘어가기 전 대기 시간. 클라이언트는 마지막 판의 콜 애니메이션(~1.3초) +
// 리빌 유지시간(REVEAL_HOLD_MS, 1초) 이후에야 set_over 화면을 띄우므로, 그 전에 다음
// 라운드가 시작되면 set_over 화면이 뜨기도 전에 다음 라운드로 넘어가버리는 것처럼 보인다.
const ROUND_ADVANCE_DELAY_MS = 4200;

function checkTournamentRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.activePairs.length > 0) return;
  // All pairs in this round resolved → start next round
  setTimeout(() => startTournamentRound(roomCode), ROUND_ADVANCE_DELAY_MS);
}

function broadcastTournamentState(room, roomCode) {
  const alive = room.players.filter(p => !room.eliminated.has(p.token)).map(p => ({
    name: p.name, token: p.token, isEliminated: false
  }));
  const elim = room.players.filter(p => room.eliminated.has(p.token)).map(p => ({
    name: p.name, token: p.token, isEliminated: true
  }));

  // 지금 진행 중인 다른 대진들의 실시간 세트 스코어
  const activeMatches = room.activePairs.map(([t1, t2]) => {
    const p1 = playerByToken(room, t1);
    const p2 = playerByToken(room, t2);
    const mw = getMatchWins(room, t1, t2);
    return {
      p1Name: p1?.name ?? '?',
      p2Name: p2?.name ?? '?',
      p1Wins: mw.get(t1) || 0,
      p2Wins: mw.get(t2) || 0,
    };
  });

  // 이번 라운드에 아직 안 뛰거나(부전승) 이미 이겨서 다음 라운드를 기다리는 사람들
  const activeTokens = new Set(room.activePairs.flat());
  const waiting = room.players
    .filter(p => p.ws && !room.eliminated.has(p.token) && !activeTokens.has(p.token))
    .map(p => p.name);

  for (const p of room.players) {
    if (p.ws) {
      send(p.ws, {
        type: 'tournament_state',
        round: room.round,
        players: [...alive, ...elim],
        yourToken: p.token,
        activeMatches,
        waiting,
      });
    }
  }
}

// ── battle royale logic ───────────────────────────────────────────
// 카드게임처럼 생존자 전원이 동시에 손을 낸 뒤 한꺼번에 공개한다. 나온 손모양이 정확히
// 2종류일 때만 승부가 갈리고(이긴 손을 낸 사람은 라운드 승, 진 손을 낸 사람은 즉시 탈락),
// 1종류(전원 같은 손) 또는 3종류(가위바위보 모두 등장)면 무승부라 같은 라운드를 다시 진행한다.
// 누군가 개인 누적 3승을 먼저 채우거나, 생존자가 1명만 남으면 그 사람이 최종 우승이다.
function battleScoreboard(room) {
  return room.players
    .map(p => ({ name: p.name, wins: room.setScores.get(p.token) || 0, alive: room.aliveTokens.has(p.token) }))
    .sort((a, b) => b.wins - a.wins);
}

function startBattleRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.aliveTokens.size < 1) return;

  room.round++;
  room.choices.clear();

  const scores = battleScoreboard(room);
  const aliveNames = [...room.aliveTokens].map(t => playerByToken(room, t)?.name ?? '?');

  for (const p of room.players) {
    if (!p.ws) continue;
    if (room.aliveTokens.has(p.token)) {
      send(p.ws, { type: 'battle_round_start', round: room.round, aliveNames, aliveCount: room.aliveTokens.size, scores });
    } else {
      send(p.ws, { type: 'battle_spectate', round: room.round, aliveNames, aliveCount: room.aliveTokens.size, scores });
    }
  }
}

function checkBattleReady(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.mode !== 'battle' || !room.started) return;
  if (room.aliveTokens.size <= 1) { finishBattle(roomCode); return; }
  if (room.choices.size >= room.aliveTokens.size) resolveBattleRound(roomCode);
}

function resolveBattleRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const picks = [...room.aliveTokens].map(t => ({
    token: t, name: playerByToken(room, t)?.name ?? '?', choice: room.choices.get(t),
  }));
  room.choices.clear();

  const distinctMoves = [...new Set(picks.map(p => p.choice))];

  if (distinctMoves.length !== 2) {
    // 전원 같은 손(1종류) 또는 세 손 모두 등장(3종류) → 무승부, 같은 라운드를 재시도한다.
    const revealPicks = picks.map(p => ({ name: p.name, choice: p.choice, result: 'draw' }));
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'battle_reveal', round: room.round, draw: true, picks: revealPicks, scores: battleScoreboard(room) });
    }
    setTimeout(() => {
      if (!rooms.has(roomCode)) return;
      const aliveNames = [...room.aliveTokens].map(t => playerByToken(room, t)?.name ?? '?');
      const scores = battleScoreboard(room);
      for (const t of room.aliveTokens) {
        const p = playerByToken(room, t);
        if (p?.ws) send(p.ws, { type: 'battle_round_start', round: room.round, aliveNames, aliveCount: room.aliveTokens.size, scores, retry: true });
      }
    }, ROUND_ADVANCE_DELAY_MS);
    return;
  }

  const [moveA, moveB] = distinctMoves;
  const winningMove = BEATS[moveA] === moveB ? moveA : moveB;
  const losingMove = winningMove === moveA ? moveB : moveA;

  const winners = picks.filter(p => p.choice === winningMove);
  const losers = picks.filter(p => p.choice === losingMove);

  for (const w of winners) {
    room.setScores.set(w.token, (room.setScores.get(w.token) || 0) + 1);
    recordSetWin(w.name, 'battle');
  }
  for (const l of losers) room.aliveTokens.delete(l.token);

  const revealPicks = picks.map(p => ({ name: p.name, choice: p.choice, result: p.choice === winningMove ? 'win' : 'lose' }));
  const scores = battleScoreboard(room);
  for (const p of room.players) {
    if (p.ws) send(p.ws, {
      type: 'battle_reveal', round: room.round, draw: false, picks: revealPicks,
      winningMove, losingMove, eliminatedNames: losers.map(l => l.name), scores,
    });
  }

  // 개인 누적 3승을 먼저 채운 사람이 정확히 1명이면 그 자리에서 최종 우승 확정.
  // (동시에 여러 명이 3승에 도달하면 우열을 가릴 수 없으니, 생존자가 1명으로 좁혀질 때까지 계속 진행한다.)
  const finishers = winners.filter(w => (room.setScores.get(w.token) || 0) >= WINS_TO_BATTLE);
  setTimeout(() => {
    if (!rooms.has(roomCode)) return;
    if (finishers.length === 1) finishBattle(roomCode, finishers[0].token);
    else if (room.aliveTokens.size <= 1) finishBattle(roomCode);
    else startBattleRound(roomCode);
  }, ROUND_ADVANCE_DELAY_MS);
}

function finishBattle(roomCode, forcedWinnerToken) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const winnerToken = forcedWinnerToken ?? [...room.aliveTokens][0];
  const winner = winnerToken ? playerByToken(room, winnerToken) : null;
  if (winner) recordSetWin(winner.name, 'battle'); // 최종 우승 보너스 1점 (토너먼트 우승 보너스와 동일한 정책)
  const scores = battleScoreboard(room);
  for (const p of room.players) {
    if (p.ws) send(p.ws, { type: 'battle_over', winnerName: winner?.name || '?', scores });
  }
  rooms.delete(roomCode);
}

// ── finalizeLeave ────────────────────────────────────────────────
function finalizeLeave(roomCode, leavingToken) {
  const room = rooms.get(roomCode);
  if (!room) return;
  clearAllDisconnectTimers(room);

  const leavingIsHost = room.hostToken === leavingToken;
  const remaining = room.players.filter(p => p.token !== leavingToken);

  if (room.mode === '1v1') {
    if (leavingIsHost || remaining.length === 0) {
      // Host left or nobody left → delete room
      rooms.delete(roomCode);
      for (const p of remaining) if (p.ws) send(p.ws, { type: 'host_left' });
    } else {
      // Guest left → host waits for new player, room persists
      room.players = remaining;
      room.choices.clear();
      room.matchWins.clear();
      room.setScores.clear();
      remaining.forEach(p => room.setScores.set(p.token, 0));
      wsIdentity.forEach((id, ws) => { if (id.token === leavingToken) wsIdentity.delete(ws); });
      const host = remaining[0];
      if (host?.ws) send(host.ws, { type: 'guest_left', roomCode });
    }
  } else {
    // battle/tournament: remove player from room
    room.players = remaining;
    if (remaining.length === 0) { rooms.delete(roomCode); return; }
    if (leavingIsHost && remaining.length > 0) {
      // Promote first connected player as new host
      const newHost = remaining.find(p => p.ws) || remaining[0];
      room.hostToken = newHost.token;
    }
    wsIdentity.forEach((id, ws) => { if (id.token === leavingToken) wsIdentity.delete(ws); });
    broadcastLobbyUpdate(room, roomCode);
    if (room.started) {
      if (room.mode === 'tournament') {
        room.activePairs = room.activePairs.filter(([a, b]) => a !== leavingToken && b !== leavingToken);
        checkTournamentRound(roomCode);
      } else if (room.mode === 'battle') {
        room.aliveTokens.delete(leavingToken);
        room.choices.delete(leavingToken);
        checkBattleReady(roomCode);
      }
    }
  }
}

function scheduleDisconnectCleanup(roomCode, token) {
  const room = rooms.get(roomCode);
  if (!room) return;
  clearDisconnectTimer(room, token);
  const timer = setTimeout(() => finalizeLeave(roomCode, token), RECONNECT_GRACE_MS);
  room.disconnectTimers.set(token, timer);
}

// ── connection handler ───────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // ── create ──────────────────────────────────────────────────
    if (msg.type === 'create') {
      const name = sanitizeName(msg.name);
      const mode = ['1v1', 'battle', 'tournament'].includes(msg.mode) ? msg.mode : '1v1';
      const capacity = mode === '1v1' ? 2 : Math.min(Math.max(Number(msg.capacity) || 8, 2), 16);
      const roomCode = genRoomCode();
      const token = randomUUID();
      rooms.set(roomCode, {
        mode, hostToken: token, capacity,
        players: [{ token, name, ws }],
        choices: new Map(),
        matchWins: new Map(),
        setScores: new Map([[token, 0]]),
        disconnectTimers: new Map(),
        started: false,
        activePairs: [],
        byeTokens: [],
        round: 0,
        eliminated: new Set(),
        aliveTokens: new Set(),
      });
      wsIdentity.set(ws, { roomCode, token });
      send(ws, { type: 'room_created', roomCode, token, mode, capacity });
      return;
    }

    // ── join ─────────────────────────────────────────────────────
    if (msg.type === 'join') {
      const name = sanitizeName(msg.name);
      const roomCode = sanitizeRoomCode(msg.roomCode);
      const room = rooms.get(roomCode);
      if (!room) { send(ws, { type: 'error', message: '방을 찾을 수 없습니다.' }); return; }
      if (room.started) { send(ws, { type: 'error', message: '이미 시작된 게임입니다.' }); return; }

      // 토큰(localStorage 세션)을 잃어버려 rejoin 대신 새로 join하는 경우, 같은 이름의
      // 끊긴 플레이어가 로비에 유령처럼 남아있지 않도록 정리한다 — 안 그러면 재입장할 때마다
      // 로비 목록에 같은 이름이 중복으로 쌓인다.
      const staleIndex = room.players.findIndex(p => !p.ws && p.name === name);
      let inheritsHost = false;
      if (staleIndex !== -1) {
        const stale = room.players[staleIndex];
        clearDisconnectTimer(room, stale.token);
        room.players.splice(staleIndex, 1);
        room.setScores.delete(stale.token);
        inheritsHost = room.hostToken === stale.token;
      }

      if (room.players.length >= room.capacity) { send(ws, { type: 'error', message: '인원이 가득 찬 방입니다.' }); return; }

      const token = randomUUID();
      room.players.push({ token, name, ws });
      room.setScores.set(token, 0);
      wsIdentity.set(ws, { roomCode, token });
      if (inheritsHost) room.hostToken = token;

      if (room.mode === '1v1') {
        const [host, guest] = room.players;
        send(host.ws, { type: 'matched', opponentName: guest.name, roomCode, token: host.token });
        send(guest.ws, { type: 'matched', opponentName: host.name, roomCode, token: guest.token });
      } else {
        send(ws, { type: 'joined_lobby', roomCode, token, mode: room.mode });
        broadcastLobbyUpdate(room, roomCode);
      }
      return;
    }

    // ── rejoin ───────────────────────────────────────────────────
    if (msg.type === 'rejoin') {
      const roomCode = sanitizeRoomCode(msg.roomCode);
      const token = typeof msg.token === 'string' ? msg.token : '';
      const room = rooms.get(roomCode);
      const player = room && playerByToken(room, token);
      if (!room || !player) { send(ws, { type: 'error', message: '재연결 실패. 방이 종료됐을 수 있어요.' }); return; }

      clearDisconnectTimer(room, token);
      player.ws = ws;
      wsIdentity.set(ws, { roomCode, token });

      if (room.mode === '1v1') {
        const opponent = room.players.find(p => p.token !== token);
        const mw = opponent ? getMatchWins(room, token, opponent.token) : null;
        send(ws, {
          type: 'rejoined',
          roomCode, token, mode: '1v1',
          opponentName: opponent ? opponent.name : null,
          opponentConnected: !!(opponent?.ws),
          score: { you: room.setScores.get(token) || 0, opponent: opponent ? room.setScores.get(opponent.token) || 0 : 0 },
          matchWins: opponent ? { you: mw.get(token) || 0, opponent: mw.get(opponent.token) || 0 } : { you: 0, opponent: 0 },
        });
        if (opponent?.ws) send(opponent.ws, { type: 'opponent_reconnected' });
      } else if (room.mode === 'tournament') {
        send(ws, { type: 'rejoined', roomCode, token, mode: room.mode, started: room.started });
        broadcastLobbyUpdate(room, roomCode);
        if (room.started) {
          // Re-send match_start if in active pair
          const pair = room.activePairs.find(([a, b]) => a === token || b === token);
          if (pair) {
            const oppToken = pair[0] === token ? pair[1] : pair[0];
            const opp = playerByToken(room, oppToken);
            const mw = getMatchWins(room, token, oppToken);
            send(ws, {
              type: 'match_start',
              opponentName: opp?.name || '?',
              round: room.round,
              matchWins: { you: mw.get(token) || 0, opponent: mw.get(oppToken) || 0 },
            });
          } else if (room.byeTokens?.includes(token)) {
            send(ws, { type: 'bye', round: room.round });
          }
        }
      } else {
        // battle
        send(ws, { type: 'rejoined', roomCode, token, mode: room.mode, started: room.started });
        broadcastLobbyUpdate(room, roomCode);
        if (room.started) {
          const scores = battleScoreboard(room);
          const aliveNames = [...room.aliveTokens].map(t => playerByToken(room, t)?.name ?? '?');
          if (room.aliveTokens.has(token)) {
            send(ws, {
              type: 'battle_round_start', round: room.round, aliveNames, aliveCount: room.aliveTokens.size,
              scores, alreadyChosen: room.choices.has(token),
            });
          } else {
            send(ws, { type: 'battle_spectate', round: room.round, aliveNames, aliveCount: room.aliveTokens.size, scores });
          }
        }
      }
      return;
    }

    // ── start (host only, battle/tournament) ──────────────────────
    if (msg.type === 'start') {
      const identity = wsIdentity.get(ws);
      const room = identity && rooms.get(identity.roomCode);
      if (!room || room.mode === '1v1') return;
      if (identity.token !== room.hostToken) return;
      if (room.started) return;
      if (room.players.filter(p => p.ws).length < 2) return;

      room.started = true;
      if (room.mode === 'tournament') {
        for (const p of room.players) if (p.ws) send(p.ws, { type: 'tournament_starting' });
        startTournamentRound(identity.roomCode);
      } else {
        room.aliveTokens = new Set(room.players.filter(p => p.ws).map(p => p.token));
        for (const p of room.players) if (p.ws) send(p.ws, { type: 'battle_starting', totalPlayers: room.aliveTokens.size });
        startBattleRound(identity.roomCode);
      }
      return;
    }

    // ── choice ───────────────────────────────────────────────────
    if (msg.type === 'choice') {
      if (!MOVES.has(msg.choice)) return;
      const identity = wsIdentity.get(ws);
      const room = identity && rooms.get(identity.roomCode);
      if (!room) return;
      const { token, roomCode } = identity;

      if (room.mode === 'battle') {
        if (!room.aliveTokens.has(token) || room.choices.has(token)) return;
        room.choices.set(token, msg.choice);
        const chosenCount = room.choices.size;
        const aliveCount = room.aliveTokens.size;
        for (const p of room.players) {
          if (p.ws) send(p.ws, { type: 'battle_progress', chosenCount, aliveCount });
        }
        checkBattleReady(roomCode);
        return;
      }

      let pair;
      if (room.mode === '1v1') {
        // 1v1: pair is always the two players
        if (room.players.length < 2) return;
        pair = [room.players[0].token, room.players[1].token];
      } else {
        pair = room.activePairs.find(([a, b]) => a === token || b === token);
        if (!pair) return;
      }

      room.choices.set(token, msg.choice);
      const oppToken = pair[0] === token ? pair[1] : pair[0];
      const opp = playerByToken(room, oppToken);
      if (opp?.ws) send(opp.ws, { type: 'opponent_choice_made' });

      if (room.choices.has(oppToken)) {
        resolvePair(roomCode, pair[0], pair[1]);
      }
      return;
    }

    // ── leave ─────────────────────────────────────────────────────
    if (msg.type === 'leave') {
      const identity = wsIdentity.get(ws);
      if (identity) finalizeLeave(identity.roomCode, identity.token);
      return;
    }
  });

  ws.on('close', () => {
    const identity = wsIdentity.get(ws);
    if (!identity) return;
    wsIdentity.delete(ws);

    const room = rooms.get(identity.roomCode);
    if (!room) return;
    const player = playerByToken(room, identity.token);
    if (player) player.ws = null;

    if (!room.started) {
      // 로비 대기 중 끊김은 매치 중 끊김과 달리 다른 대기자들에게 실시간으로 보여줘야 한다
      // (연결 끊김 배지). opponent_disconnected는 진행 중인 매치 전용 메시지라 로비에는 안 온다.
      broadcastLobbyUpdate(room, identity.roomCode);
    } else {
      const others = room.players.filter(p => p.token !== identity.token);
      for (const p of others) {
        if (p.ws) send(p.ws, { type: 'opponent_disconnected' });
      }
    }
    scheduleDisconnectCleanup(identity.roomCode, identity.token);
  });
});

const liarWss = registerLiarServer();
const mafiaWss = registerMafiaServer();
const halliGalliWss = registerHalliGalliServer();
const yutnoriWss = registerYutnoriServer();
const strategyYutnoriWss = registerStrategyYutnoriServer();

httpServer.on('upgrade', (req, socket, head) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/rps') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/liar') {
    liarWss.handleUpgrade(req, socket, head, (ws) => liarWss.emit('connection', ws, req));
  } else if (pathname === '/mafia') {
    mafiaWss.handleUpgrade(req, socket, head, (ws) => mafiaWss.emit('connection', ws, req));
  } else if (pathname === '/halligalli') {
    halliGalliWss.handleUpgrade(req, socket, head, (ws) => halliGalliWss.emit('connection', ws, req));
  } else if (pathname === '/yutnori') {
    yutnoriWss.handleUpgrade(req, socket, head, (ws) => yutnoriWss.emit('connection', ws, req));
  } else if (pathname === '/strategy-yutnori') {
    strategyYutnoriWss.handleUpgrade(req, socket, head, (ws) => strategyYutnoriWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, () => {
  console.log(`[rps-server] listening on :${PORT} (ws paths: /rps, /liar, /mafia, /halligalli, /yutnori, /strategy-yutnori)`);
});
