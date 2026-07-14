import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000; // rps와 동일한 재접속 유예 시간
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const MAX_DESC_LEN = 80;
const MAX_CHAT_LEN = 120;

// 카테고리/제시어는 서버 메모리에만 존재한다. 이 파일이 클라이언트 번들에 포함될 일은 없지만,
// 라이어에게 보내는 payload에도 word 필드 자체를 만들지 않는 것으로 부정행위를 원천 차단한다.
const CATEGORIES = {
  '음식': ['김치찌개', '삼겹살', '떡볶이', '초밥', '피자', '치킨', '라면', '비빔밥', '냉면', '짜장면', '호떡', '붕어빵'],
  '동물': ['호랑이', '코끼리', '펭귄', '캥거루', '고양이', '강아지', '기린', '다람쥐', '판다', '부엉이', '악어', '고래'],
  '직업': ['의사', '경찰관', '요리사', '선생님', '소방관', '변호사', '유튜버', '미용사', '택배기사', '승무원', '건축가', '수의사'],
  '장소': ['학교', '병원', '공원', '영화관', '목욕탕', '편의점', '도서관', '놀이공원', '시장', '기차역', '캠핑장', '노래방'],
  '스포츠': ['축구', '야구', '농구', '수영', '볼링', '탁구', '골프', '스키', '양궁', '씨름', '배드민턴', '당구'],
  '탈것': ['자전거', '기차', '비행기', '스쿠터', '케이블카', '유람선', '헬리콥터', '지하철', '썰매', '로켓', '열기구', '트럭'],
};
const CATEGORY_NAMES = Object.keys(CATEGORIES);

function pickRound() {
  const category = CATEGORY_NAMES[Math.floor(Math.random() * CATEGORY_NAMES.length)];
  const words = CATEGORIES[category];
  const word = words[Math.floor(Math.random() * words.length)];
  return { category, word };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws }],   // ws = null when disconnected
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'describe' | 'vote' | 'revote' | 'liar_guess' | 'round_over',
 *   round: number,
 *   category: string | null,
 *   word: string | null,              // 서버 메모리 전용, 절대 브로드캐스트하지 않는다
 *   liarToken: string | null,
 *   speakingOrder: string[],
 *   turnIndex: number,
 *   transcript: [{ token, name, text }],
 *   votes: Map<voterToken, targetToken>,
 *   revoteRound: 0 | 1,
 * }
 */
export function registerLiarServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('liar');

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
      const digest = createHash('sha256').update(`liar-${base}-${attempt}`).digest('hex');
      code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
      attempt++;
    } while (rooms.has(code));
    return code;
  }

  function playerByToken(room, token) { return room.players.find(p => p.token === token); }

  function clearDisconnectTimer(room, token) {
    const t = room.disconnectTimers.get(token);
    if (t) { clearTimeout(t); room.disconnectTimers.delete(token); }
  }

  function clearAllDisconnectTimers(room) {
    room.players.forEach(p => clearDisconnectTimer(room, p.token));
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

  // ── 라운드 진행 ──────────────────────────────────────────────────
  function startRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const connected = room.players.filter(p => p.ws);
    if (connected.length < MIN_PLAYERS) return;

    room.round++;
    const { category, word } = pickRound();
    room.category = category;
    room.word = word;
    room.liarToken = connected[Math.floor(Math.random() * connected.length)].token;
    room.speakingOrder = shuffle(connected.map(p => p.token));
    room.turnIndex = 0;
    room.transcript = [];
    room.votes = new Map();
    room.revoteRound = 0;
    room.phase = 'describe';
    room.started = true;

    for (const p of room.players) {
      if (!p.ws) continue;
      if (p.token === room.liarToken) {
        send(p.ws, { type: 'role_assigned', role: 'liar', category: room.category });
      } else {
        send(p.ws, { type: 'role_assigned', role: 'citizen', category: room.category, word: room.word });
      }
    }

    const order = room.speakingOrder.map(t => ({ token: t, name: playerByToken(room, t)?.name ?? '?' }));
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'turn_order', round: room.round, order, currentTurnToken: room.speakingOrder[0] });
    }
  }

  // describe 단계에서 다음 발언자로 넘어간다. 그 사이 이탈한 사람은 자동으로 건너뛴다.
  function advanceTurn(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'describe') return;
    room.turnIndex++;
    while (room.turnIndex < room.speakingOrder.length && !playerByToken(room, room.speakingOrder[room.turnIndex])) {
      room.turnIndex++;
    }
    if (room.turnIndex >= room.speakingOrder.length) {
      startVotePhase(roomCode);
    } else {
      const nextToken = room.speakingOrder[room.turnIndex];
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'next_turn', currentTurnToken: nextToken });
      }
    }
  }

  function startVotePhase(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'vote';
    room.votes = new Map();
    const players = room.players.map(p => ({ token: p.token, name: p.name }));
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'vote_phase_start', players });
    }
  }

  function checkVoteComplete(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || (room.phase !== 'vote' && room.phase !== 'revote')) return;
    const connectedCount = room.players.filter(p => p.ws).length;
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'vote_progress', votedCount: room.votes.size, totalCount: connectedCount });
    }
    if (room.votes.size >= connectedCount) resolveVotes(roomCode);
  }

  function resolveVotes(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const tallyMap = new Map(); // targetToken -> voterTokens[]
    for (const [voter, target] of room.votes) {
      if (!tallyMap.has(target)) tallyMap.set(target, []);
      tallyMap.get(target).push(voter);
    }
    const tally = [...tallyMap.entries()]
      .map(([targetToken, voters]) => ({
        targetToken,
        targetName: playerByToken(room, targetToken)?.name ?? '?',
        voterNames: voters.map(v => playerByToken(room, v)?.name ?? '?'),
      }))
      .sort((a, b) => b.voterNames.length - a.voterNames.length);

    const topCount = tally[0]?.voterNames.length ?? 0;
    const topCandidates = tally.filter(t => t.voterNames.length === topCount);
    const isTie = topCandidates.length !== 1;

    if (isTie) {
      if (room.revoteRound >= 1) {
        // 재투표까지 했는데도 또 동률이면 더 이상 진행하지 않고 무승부 처리.
        finishRound(roomCode, { winner: 'draw', reason: 'tie_twice', tally });
        return;
      }
      room.revoteRound = 1;
      room.phase = 'revote';
      room.votes = new Map();
      const tiedCandidates = topCandidates.map(t => ({ token: t.targetToken, name: t.targetName }));
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'revote_start', tiedCandidates, tally });
      }
      return;
    }

    const accusedToken = topCandidates[0].targetToken;
    const accusedName = topCandidates[0].targetName;
    for (const p of room.players) {
      if (p.ws) send(p.ws, { type: 'vote_reveal', tally, accusedToken, accusedName, isTie: false });
    }

    if (accusedToken === room.liarToken) {
      room.phase = 'liar_guess';
      for (const p of room.players) {
        if (!p.ws) continue;
        if (p.token === room.liarToken) send(p.ws, { type: 'liar_guess_start', category: room.category });
        else send(p.ws, { type: 'waiting_for_liar_guess' });
      }
    } else {
      finishRound(roomCode, { winner: 'liar', reason: 'not_accused', accusedToken, accusedName, tally });
    }
  }

  function finishRound(roomCode, resultInfo) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'round_over';
    room.started = false; // 호스트가 다시 'start'를 보내면 새 라운드가 시작되도록 게이트를 연다
    const liarName = playerByToken(room, room.liarToken)?.name ?? '?';
    // 무승부(재투표까지 갔는데도 또 동률)는 승패 어느 쪽도 아니므로 기록하지 않는다.
    if (resultInfo.winner !== 'draw') {
      for (const p of room.players) {
        const isLiar = p.token === room.liarToken;
        const won = resultInfo.winner === (isLiar ? 'liar' : 'citizens');
        ranking.recordResult(p.name, won);
      }
    }
    for (const p of room.players) {
      if (p.ws) {
        send(p.ws, {
          type: 'round_result',
          category: room.category,
          word: room.word, // 라운드가 끝났으니 전원에게 전면 공개
          liarToken: room.liarToken,
          liarName,
          ...resultInfo,
        });
      }
    }
  }

  // ── 이탈/재접속 처리 ─────────────────────────────────────────────
  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    const leavingIsHost = room.hostToken === leavingToken;
    const wasLiar = room.liarToken === leavingToken;
    const wasCurrentTurn = room.phase === 'describe' && room.speakingOrder[room.turnIndex] === leavingToken;
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

    if (wasLiar) {
      finishRound(roomCode, { winner: 'citizens', reason: 'liar_left' });
      return;
    }

    const connectedCount = room.players.filter(p => p.ws).length;
    if (connectedCount < MIN_PLAYERS) {
      room.phase = 'lobby';
      room.started = false;
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'round_aborted', reason: 'not_enough_players' });
      }
      broadcastLobbyUpdate(room, roomCode);
      return;
    }

    if (room.phase === 'describe' && wasCurrentTurn) {
      room.transcript.push({ token: leavingToken, name: '(나간 사람)', text: '(설명 없음)' });
      for (const p of room.players) {
        if (p.ws) send(p.ws, { type: 'description_submitted', token: leavingToken, name: '(나간 사람)', text: '(설명 없음)' });
      }
      advanceTurn(roomCode);
    } else if (room.phase === 'vote' || room.phase === 'revote') {
      room.votes.delete(leavingToken);
      checkVoteComplete(roomCode);
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
  // 수동으로 이 인스턴스의 handleUpgrade를 호출해준다 (여러 path를 한 httpServer에 붙이는
  // 방법은 ws가 기본 지원하지 않음 — server.mjs 상단 주석 참고).
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // ── create ────────────────────────────────────────────────
      if (msg.type === 'create') {
        const name = sanitizeName(msg.name);
        const capacity = Math.min(Math.max(Number(msg.capacity) || 6, MIN_PLAYERS), MAX_PLAYERS);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token, capacity,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          round: 0,
          category: null, word: null, liarToken: null,
          speakingOrder: [], turnIndex: 0, transcript: [],
          votes: new Map(), revoteRound: 0,
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

        // 토큰(localStorage 세션)을 잃어버려 rejoin 대신 새로 join하는 경우, 같은 이름의
        // 끊긴 플레이어가 로비에 유령처럼 남아있지 않도록 정리한다.
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
          const isLiar = token === room.liarToken;
          const round = {
            category: room.category,
            role: isLiar ? 'liar' : 'citizen',
            // 라이어면 word 필드 자체를 만들지 않는다 — role_assigned 때와 동일한 안티치트 규칙.
            ...(isLiar ? {} : { word: room.word }),
            turnOrder: room.speakingOrder.map(t => ({ token: t, name: playerByToken(room, t)?.name ?? '?' })),
            currentTurnToken: room.phase === 'describe' ? room.speakingOrder[room.turnIndex] : null,
            transcript: room.transcript,
          };
          if (room.phase === 'vote' || room.phase === 'revote') {
            const connectedCount = room.players.filter(p => p.ws).length;
            round.voteStatus = { votedCount: room.votes.size, totalCount: connectedCount, yourVote: room.votes.get(token) ?? null };
          }
          send(ws, { ...base, round });
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

        for (const p of room.players) if (p.ws) send(p.ws, { type: 'round_starting' });
        startRound(identity.roomCode);
        return;
      }

      // ── submit_description ───────────────────────────────────────
      if (msg.type === 'submit_description') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'describe') return;
        const { token, roomCode } = identity;
        if (room.speakingOrder[room.turnIndex] !== token) return;

        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_DESC_LEN) : '';
        if (!text) return;

        const name = playerByToken(room, token)?.name ?? '?';
        room.transcript.push({ token, name, text });
        for (const p of room.players) {
          if (p.ws) send(p.ws, { type: 'description_submitted', token, name, text });
        }
        advanceTurn(roomCode);
        return;
      }

      // ── submit_vote ───────────────────────────────────────────────
      if (msg.type === 'submit_vote') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || (room.phase !== 'vote' && room.phase !== 'revote')) return;
        const { token, roomCode } = identity;
        if (room.votes.has(token)) return; // 중복 투표 무시
        const targetToken = msg.targetToken;
        if (targetToken === token) return; // 자기 자신 투표 불가
        if (!playerByToken(room, targetToken)) return;

        room.votes.set(token, targetToken);
        checkVoteComplete(roomCode);
        return;
      }

      // ── submit_guess ──────────────────────────────────────────────
      if (msg.type === 'submit_guess') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'liar_guess') return;
        if (identity.token !== room.liarToken) return;

        const guess = typeof msg.guess === 'string' ? msg.guess.trim().slice(0, 40) : '';
        const guessCorrect = guess.length > 0 && guess === room.word;
        finishRound(identity.roomCode, {
          winner: guessCorrect ? 'liar' : 'citizens',
          reason: 'liar_guess',
          guess, guessCorrect,
          accusedToken: room.liarToken,
          accusedName: playerByToken(room, room.liarToken)?.name ?? '?',
        });
        return;
      }

      // ── submit_chat ───────────────────────────────────────────────
      if (msg.type === 'submit_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        const { token } = identity;
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : '';
        if (!text) return;
        const name = playerByToken(room, token)?.name ?? '?';
        for (const p of room.players) {
          if (p.ws) send(p.ws, { type: 'chat_message', token, name, text });
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

  console.log('[liar-server] registered ws path: /liar');
  return { wss, getRanking: ranking.getRanking };
}
