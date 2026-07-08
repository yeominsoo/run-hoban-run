import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000; // rps/liar와 동일한 재접속 유예 시간
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 12;
const MAX_CHAT_LEN = 120;
const DAY_TIME_MS = 60000; // 토론+투표를 합쳐 60초
const NIGHT_TIME_MS = 30000;
const REVOTE_TIME_MS = 30000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 인원수별 역할 배치: 4명(마피아1+시민3) -> 5~6명(+경찰) -> 7~9명(+의사) -> 10~12명(마피아2)
function assignRoles(tokens) {
  const n = tokens.length;
  const mafiaCount = n >= 10 ? 2 : 1;
  const hasPolice = n >= 5;
  const hasDoctor = n >= 7;

  const shuffled = shuffle(tokens);
  const roles = new Map();
  let idx = 0;
  for (let i = 0; i < mafiaCount; i++) roles.set(shuffled[idx++], 'mafia');
  if (hasPolice) roles.set(shuffled[idx++], 'police');
  if (hasDoctor) roles.set(shuffled[idx++], 'doctor');
  for (; idx < shuffled.length; idx++) roles.set(shuffled[idx], 'citizen');
  return roles;
}

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'night' | 'day' | 'day_revote' | 'game_over',
 *   round: number,               // 밤 시작 시에만 증가 (밤+낮 한 세트 = 1라운드)
 *   roles: Map<token, 'mafia'|'police'|'doctor'|'citizen'>,
 *   alive: Set<token>,
 *   nightActions: Map<token, targetToken>,   // 마피아/경찰/의사가 이번 밤 제출한 지목
 *   policeHistory: Map<policeToken, [{round, targetName, isMafia}]>,  // 재접속 시 복원용
 *   dayVotes: Map<voterToken, targetToken>,
 *   revoteRound: 0 | 1,
 *   chatLog: [{token, name, text}],          // 이번 낮의 채팅 기록
 *   phaseTimer: Timeout | null,
 *   deathsThisRound: [{token, name}],        // 방금 밤에 죽은 사람 (낮 시작 메시지용)
 * }
 */
export function registerMafiaServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();

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
      const digest = createHash('sha256').update(`mafia-${base}-${attempt}`).digest('hex');
      code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
      attempt++;
    } while (rooms.has(code));
    return code;
  }

  function playerByToken(room, token) { return room.players.find(p => p.token === token); }
  function nameOf(room, token) { return playerByToken(room, token)?.name ?? '?'; }

  function clearDisconnectTimer(room, token) {
    const t = room.disconnectTimers.get(token);
    if (t) { clearTimeout(t); room.disconnectTimers.delete(token); }
  }
  function clearAllDisconnectTimers(room) {
    room.players.forEach(p => clearDisconnectTimer(room, p.token));
  }
  function clearPhaseTimer(room) {
    if (room.phaseTimer) { clearTimeout(room.phaseTimer); room.phaseTimer = null; }
  }

  // ── 로비 브로드캐스트 ────────────────────────────────────────────
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
          canStart: room.players.filter(x => x.ws).length >= MIN_PLAYERS && p.token === room.hostToken,
        });
      }
    }
  }

  // ── 게임 진행 ────────────────────────────────────────────────────
  function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const connected = room.players.filter(p => p.ws);
    if (connected.length < MIN_PLAYERS) return;

    room.roles = assignRoles(connected.map(p => p.token));
    room.alive = new Set(connected.map(p => p.token));
    room.round = 0;
    room.policeHistory = new Map();
    room.started = true;

    for (const p of room.players) {
      if (!p.ws) continue;
      const role = room.roles.get(p.token);
      if (role === 'mafia') {
        const teammates = [...room.roles.entries()]
          .filter(([t, r]) => r === 'mafia' && t !== p.token)
          .map(([t]) => ({ token: t, name: nameOf(room, t) }));
        send(p.ws, { type: 'role_assigned', role, teammates });
      } else {
        send(p.ws, { type: 'role_assigned', role });
      }
    }

    startNight(roomCode);
  }

  function aliveMafiaTokens(room) {
    return [...room.alive].filter(t => room.roles.get(t) === 'mafia');
  }
  function nightActorTokens(room) {
    return [...room.alive].filter(t => ['mafia', 'police', 'doctor'].includes(room.roles.get(t)));
  }

  function startNight(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearPhaseTimer(room);
    room.round++;
    room.phase = 'night';
    room.nightActions = new Map();

    const alive = [...room.alive].map(t => ({ token: t, name: nameOf(room, t) }));
    for (const p of room.players) {
      if (!p.ws) continue;
      const role = room.roles.get(p.token);
      const isActor = room.alive.has(p.token) && ['mafia', 'police', 'doctor'].includes(role);
      send(p.ws, { type: 'night_start', round: room.round, alive, timeLimit: NIGHT_TIME_MS, yourActionRequired: isActor });
    }

    room.phaseTimer = setTimeout(() => resolveNight(roomCode), NIGHT_TIME_MS);
  }

  function checkNightReady(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'night') return;
    const actors = nightActorTokens(room);
    const actedCount = actors.filter(t => room.nightActions.has(t)).length;
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'night_action_progress', actedCount, totalCount: actors.length });
    }
    if (actedCount >= actors.length) resolveNight(roomCode);
  }

  function resolveNight(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'night') return;
    clearPhaseTimer(room);

    // 마피아 킬 타겟: 생존 마피아들이 지목한 대상 중 최다 득표 (동률이면 랜덤).
    const mafias = aliveMafiaTokens(room);
    const killVotes = mafias.map(t => room.nightActions.get(t)).filter(Boolean);
    let killTarget = null;
    if (killVotes.length) {
      const tally = new Map();
      for (const t of killVotes) tally.set(t, (tally.get(t) || 0) + 1);
      const max = Math.max(...tally.values());
      const top = [...tally.entries()].filter(([, c]) => c === max).map(([t]) => t);
      killTarget = top[Math.floor(Math.random() * top.length)];
    }

    // 경찰 조사 결과 (생존 경찰이 있다면)
    const policeToken = [...room.alive].find(t => room.roles.get(t) === 'police');
    if (policeToken) {
      const targetToken = room.nightActions.get(policeToken);
      if (targetToken) {
        const targetName = nameOf(room, targetToken);
        const isMafia = room.roles.get(targetToken) === 'mafia';
        if (!room.policeHistory.has(policeToken)) room.policeHistory.set(policeToken, []);
        room.policeHistory.get(policeToken).push({ round: room.round, targetName, isMafia });
        const policePlayer = playerByToken(room, policeToken);
        if (policePlayer?.ws) send(policePlayer.ws, { type: 'police_result', targetToken, targetName, isMafia });
      }
    }

    // 의사 보호 대상
    const doctorToken = [...room.alive].find(t => room.roles.get(t) === 'doctor');
    const protectedToken = doctorToken ? room.nightActions.get(doctorToken) : null;

    const deaths = [];
    if (killTarget && killTarget !== protectedToken) {
      room.alive.delete(killTarget);
      deaths.push({ token: killTarget, name: nameOf(room, killTarget) });
    }
    room.deathsThisRound = deaths;

    if (checkGameOver(roomCode)) return;
    startDay(roomCode);
  }

  function startDay(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearPhaseTimer(room);
    room.phase = 'day';
    room.dayVotes = new Map();
    room.revoteRound = 0;
    room.chatLog = [];

    const alive = [...room.alive].map(t => ({ token: t, name: nameOf(room, t) }));
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'day_start', round: room.round, alive, deaths: room.deathsThisRound, timeLimit: DAY_TIME_MS });
    }
    room.phaseTimer = setTimeout(() => resolveDayVote(roomCode, true), DAY_TIME_MS);
  }

  function checkDayVoteReady(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || (room.phase !== 'day' && room.phase !== 'day_revote')) return;
    const aliveCount = room.alive.size;
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'day_vote_progress', votedCount: room.dayVotes.size, totalCount: aliveCount });
    }
    if (room.dayVotes.size >= aliveCount) resolveDayVote(roomCode, false);
  }

  function resolveDayVote(roomCode, forcedByTimeout) {
    const room = rooms.get(roomCode);
    if (!room || (room.phase !== 'day' && room.phase !== 'day_revote')) return;
    clearPhaseTimer(room);

    const tallyMap = new Map();
    for (const [voter, target] of room.dayVotes) {
      if (!tallyMap.has(target)) tallyMap.set(target, []);
      tallyMap.get(target).push(voter);
    }
    const tally = [...tallyMap.entries()]
      .map(([targetToken, voters]) => ({
        targetToken, targetName: nameOf(room, targetToken),
        voterNames: voters.map(v => nameOf(room, v)),
      }))
      .sort((a, b) => b.voterNames.length - a.voterNames.length);

    if (tally.length === 0) {
      // 아무도 투표하지 않고 시간이 끝난 경우 -> 처형 없음
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'day_vote_reveal', tally: [], executedToken: null, executedName: null, isTie: false, noExecution: true });
      }
      if (checkGameOver(roomCode)) return;
      startNight(roomCode);
      return;
    }

    const topCount = tally[0].voterNames.length;
    const topCandidates = tally.filter(t => t.voterNames.length === topCount);
    const isTie = topCandidates.length !== 1;

    if (isTie && !forcedByTimeout) {
      if (room.revoteRound >= 1) {
        for (const p of room.players) {
          if (p.ws) send(p.ws, { type: 'day_vote_reveal', tally, executedToken: null, executedName: null, isTie: true, noExecution: true });
        }
        if (checkGameOver(roomCode)) return;
        startNight(roomCode);
        return;
      }
      room.revoteRound = 1;
      room.phase = 'day_revote';
      room.dayVotes = new Map();
      const tiedCandidates = topCandidates.map(t => ({ token: t.targetToken, name: t.targetName }));
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'day_revote_start', tiedCandidates, tally });
      }
      room.phaseTimer = setTimeout(() => resolveDayVote(roomCode, true), REVOTE_TIME_MS);
      return;
    }

    // 동률이 안 풀렸는데 타임아웃으로 강제 종료된 경우에도 처형 없음으로 처리.
    if (isTie && forcedByTimeout) {
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'day_vote_reveal', tally, executedToken: null, executedName: null, isTie: true, noExecution: true });
      }
      if (checkGameOver(roomCode)) return;
      startNight(roomCode);
      return;
    }

    const executedToken = topCandidates[0].targetToken;
    const executedName = topCandidates[0].targetName;
    room.alive.delete(executedToken);
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'day_vote_reveal', tally, executedToken, executedName, isTie: false });
    }

    if (checkGameOver(roomCode)) return;
    startNight(roomCode);
  }

  /** 승패 조건을 확인하고, 게임이 끝났으면 game_over를 브로드캐스트한 뒤 true를 반환한다. */
  function checkGameOver(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return true;
    const aliveMafiaCount = aliveMafiaTokens(room).length;
    const aliveCitizenCount = room.alive.size - aliveMafiaCount;

    let winner = null;
    if (aliveMafiaCount === 0) winner = 'citizens';
    else if (aliveMafiaCount >= aliveCitizenCount) winner = 'mafia';
    if (!winner) return false;

    clearPhaseTimer(room);
    room.phase = 'game_over';
    room.started = false;
    const roles = room.players.map(p => ({ name: p.name, role: room.roles.get(p.token) ?? '?' }));
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'game_over', winner, roles });
    }
    return true;
  }

  // ── 이탈/재접속 처리 ─────────────────────────────────────────────
  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    const leavingIsHost = room.hostToken === leavingToken;
    const remaining = room.players.filter(p => p.token !== leavingToken);
    room.players = remaining;
    if (remaining.length === 0) { rooms.delete(roomCode); return; }
    if (leavingIsHost) {
      const newHost = remaining.find(p => p.ws) || remaining[0];
      room.hostToken = newHost.token;
    }
    wsIdentity.forEach((id, ws) => { if (id.token === leavingToken) wsIdentity.delete(ws); });

    if (!room.started) {
      broadcastLobbyUpdate(room, roomCode);
      return;
    }

    room.alive.delete(leavingToken);
    if (checkGameOver(roomCode)) return;

    const connectedCount = room.players.filter(p => p.ws).length;
    if (connectedCount < MIN_PLAYERS || room.alive.size < MIN_PLAYERS) {
      clearPhaseTimer(room);
      room.phase = 'lobby';
      room.started = false;
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'round_aborted', reason: 'not_enough_players' });
      }
      broadcastLobbyUpdate(room, roomCode);
      return;
    }

    if (room.phase === 'night') {
      room.nightActions.delete(leavingToken);
      checkNightReady(roomCode);
    } else if (room.phase === 'day' || room.phase === 'day_revote') {
      room.dayVotes.delete(leavingToken);
      checkDayVoteReady(roomCode);
    }
  }

  function scheduleDisconnectCleanup(roomCode, token) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearDisconnectTimer(room, token);
    const timer = setTimeout(() => finalizeLeave(roomCode, token), RECONNECT_GRACE_MS);
    room.disconnectTimers.set(token, timer);
  }

  // ── WebSocket 연결 처리 ──────────────────────────────────────────
  // server.mjs가 noServer 모드로 생성해 httpServer의 'upgrade' 이벤트에서 경로를 보고
  // 수동으로 이 인스턴스의 handleUpgrade를 호출해준다.
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // ── create ────────────────────────────────────────────────
      if (msg.type === 'create') {
        const name = sanitizeName(msg.name);
        const capacity = Math.min(Math.max(Number(msg.capacity) || 8, MIN_PLAYERS), MAX_PLAYERS);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token, capacity,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          round: 0,
          roles: new Map(), alive: new Set(),
          nightActions: new Map(), policeHistory: new Map(),
          dayVotes: new Map(), revoteRound: 0, chatLog: [],
          phaseTimer: null, deathsThisRound: [],
        });
        wsIdentity.set(ws, { roomCode, token });
        send(ws, { type: 'room_created', roomCode, token, capacity });
        return;
      }

      // ── join ──────────────────────────────────────────────────
      if (msg.type === 'join') {
        const name = sanitizeName(msg.name);
        const roomCode = sanitizeRoomCode(msg.roomCode);
        const room = rooms.get(roomCode);
        if (!room) { send(ws, { type: 'error', message: '방을 찾을 수 없습니다.' }); return; }
        if (room.started) { send(ws, { type: 'error', message: '이미 시작된 게임입니다.' }); return; }

        const staleIndex = room.players.findIndex(p => !p.ws && p.name === name);
        let inheritsHost = false;
        if (staleIndex !== -1) {
          const stale = room.players[staleIndex];
          clearDisconnectTimer(room, stale.token);
          room.players.splice(staleIndex, 1);
          inheritsHost = room.hostToken === stale.token;
        }

        if (room.players.length >= room.capacity) { send(ws, { type: 'error', message: '인원이 가득 찬 방입니다.' }); return; }

        const token = randomUUID();
        room.players.push({ token, name, ws });
        wsIdentity.set(ws, { roomCode, token });
        if (inheritsHost) room.hostToken = token;

        send(ws, { type: 'joined_lobby', roomCode, token });
        broadcastLobbyUpdate(room, roomCode);
        return;
      }

      // ── rejoin ────────────────────────────────────────────────
      if (msg.type === 'rejoin') {
        const roomCode = sanitizeRoomCode(msg.roomCode);
        const token = typeof msg.token === 'string' ? msg.token : '';
        const room = rooms.get(roomCode);
        const player = room && playerByToken(room, token);
        if (!room || !player) { send(ws, { type: 'error', message: '재연결 실패. 방이 종료됐을 수 있어요.' }); return; }

        clearDisconnectTimer(room, token);
        player.ws = ws;
        wsIdentity.set(ws, { roomCode, token });

        const playersList = room.players.map(p => ({ name: p.name, isHost: p.token === room.hostToken, connected: !!p.ws }));
        const base = { type: 'rejoined', roomCode, token, started: room.started, phase: room.phase, players: playersList };

        if (!room.started || room.phase === 'lobby') {
          send(ws, base);
        } else {
          const role = room.roles.get(token) ?? 'citizen';
          const teammates = role === 'mafia'
            ? [...room.roles.entries()].filter(([t, r]) => r === 'mafia' && t !== token).map(([t]) => ({ token: t, name: nameOf(room, t) }))
            : undefined;
          const game = {
            role, teammates,
            round: room.round,
            phase: room.phase,
            alive: [...room.alive].map(t => ({ token: t, name: nameOf(room, t) })),
            isAlive: room.alive.has(token),
            policeHistory: role === 'police' ? (room.policeHistory.get(token) ?? []) : undefined,
            chatLog: (room.phase === 'day' || room.phase === 'day_revote') ? room.chatLog : undefined,
          };
          send(ws, { ...base, game });
        }

        const others = room.players.filter(p => p.token !== token);
        for (const p of others) {
          if (p.ws) send(p.ws, { type: 'player_reconnected', token, name: player.name });
        }
        if (!room.started) broadcastLobbyUpdate(room, roomCode);
        return;
      }

      // ── start (host only) ───────────────────────────────────────
      if (msg.type === 'start') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        if (identity.token !== room.hostToken) return;
        if (room.started) return;
        if (room.players.filter(p => p.ws).length < MIN_PLAYERS) return;

        for (const p of room.players) if (p.ws) send(p.ws, { type: 'game_starting' });
        startGame(identity.roomCode);
        return;
      }

      // ── submit_night_action ───────────────────────────────────────
      if (msg.type === 'submit_night_action') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'night') return;
        const { token, roomCode } = identity;
        if (!room.alive.has(token)) return;
        const role = room.roles.get(token);
        if (!['mafia', 'police', 'doctor'].includes(role)) return;
        if (room.nightActions.has(token)) return;

        const targetToken = msg.targetToken;
        if (role !== 'doctor' && targetToken === token) return; // 의사만 자기 자신 보호 가능
        if (!room.alive.has(targetToken)) return;

        room.nightActions.set(token, targetToken);
        checkNightReady(roomCode);
        return;
      }

      // ── submit_chat ───────────────────────────────────────────────
      if (msg.type === 'submit_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || (room.phase !== 'day' && room.phase !== 'day_revote')) return;
        const { token } = identity;
        if (!room.alive.has(token)) return;
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : '';
        if (!text) return;

        const name = nameOf(room, token);
        room.chatLog.push({ token, name, text });
        for (const p of room.players) {
          if (p.ws) send(p.ws, { type: 'chat_message', token, name, text });
        }
        return;
      }

      // ── submit_mafia_chat: 마피아끼리만 보이는 전용 채널(살아있는 동안, 로비/종료 제외 상시). ──
      if (msg.type === 'submit_mafia_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase === 'lobby' || room.phase === 'game_over') return;
        const { token } = identity;
        if (!room.alive.has(token) || room.roles.get(token) !== 'mafia') return;
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : '';
        if (!text) return;

        const name = nameOf(room, token);
        for (const mafiaToken of aliveMafiaTokens(room)) {
          const p = playerByToken(room, mafiaToken);
          if (p?.ws) send(p.ws, { type: 'mafia_chat_message', token, name, text });
        }
        return;
      }

      // ── submit_day_vote ───────────────────────────────────────────
      if (msg.type === 'submit_day_vote') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || (room.phase !== 'day' && room.phase !== 'day_revote')) return;
        const { token, roomCode } = identity;
        if (!room.alive.has(token) || room.dayVotes.has(token)) return;
        const targetToken = msg.targetToken;
        if (targetToken === token || !room.alive.has(targetToken)) return;

        room.dayVotes.set(token, targetToken);
        checkDayVoteReady(roomCode);
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
        broadcastLobbyUpdate(room, identity.roomCode);
      } else {
        const others = room.players.filter(p => p.token !== identity.token);
        for (const p of others) {
          if (p.ws) send(p.ws, { type: 'player_disconnected', token: identity.token, name: player?.name ?? '?' });
        }
      }
      scheduleDisconnectCleanup(identity.roomCode, identity.token);
    });
  });

  console.log('[mafia-server] registered ws path: /mafia');
  return wss;
}
