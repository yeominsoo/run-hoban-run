import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000; // rps/liar/mafia와 동일한 재접속 유예 시간
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const FLIP_TIMEOUT_MS = 20000; // 차례인 사람이 20초간 뒤집지 않으면 다음 사람에게 순서를 넘긴다
const RING_RESOLUTION_WINDOW_MS = 350; // 첫 종치기가 처리되는 동안 뒤이은 종치기는 무시(오탐 벌칙 방지)
const MAX_CHAT_LEN = 120;

const FRUITS = [
  { id: 'strawberry', name: '딸기', emoji: '🍓' },
  { id: 'lime', name: '라임', emoji: '🍋' },
  { id: 'banana', name: '바나나', emoji: '🍌' },
  { id: 'grape', name: '포도', emoji: '🍇' },
];
// 과일당 14장(카운트 1~5), 총 56장. 실제 할리갈리 카드 구성과 유사한 분포.
const COUNTS_PER_FRUIT = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const deck = [];
  for (const fruit of FRUITS) {
    for (const count of COUNTS_PER_FRUIT) deck.push({ fruit: fruit.id, count });
  }
  return shuffle(deck);
}

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'playing' | 'game_over',
 *   totalCards: number,
 *   turnOrder: token[],           // 게임 시작 시점의 참가자 순서(고정)
 *   turnIndex: number,            // turnOrder 안에서 "현재 차례"의 인덱스
 *   piles: Map<token, { draw: {fruit,count}[], faceUp: {fruit,count}[] }>,
 *   resolvingRing: boolean,       // 첫 종치기 처리 중 여부(짧은 유예 동안 후속 종치기 무시)
 *   ringTimer: Timeout | null,
 *   flipTimer: Timeout | null,
 * }
 */
export function registerHalliGalliServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();

  function send(ws, payload) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }
  function broadcast(room, payload) {
    for (const p of room.players) if (p.ws) send(p.ws, payload);
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
      const digest = createHash('sha256').update(`halligalli-${base}-${attempt}`).digest('hex');
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
  function clearFlipTimer(room) {
    if (room.flipTimer) { clearTimeout(room.flipTimer); room.flipTimer = null; }
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

  // ── 보드 상태 직렬화 ─────────────────────────────────────────────
  function pileTotal(room, token) {
    const pile = room.piles.get(token);
    return pile ? pile.draw.length + pile.faceUp.length : 0;
  }

  function buildBoard(room) {
    return room.turnOrder.map(token => {
      const pile = room.piles.get(token);
      const player = playerByToken(room, token);
      return {
        token,
        name: nameOf(room, token),
        connected: !!player?.ws,
        drawCount: pile.draw.length,
        faceUpCount: pile.faceUp.length,
        topCard: pile.faceUp.length ? pile.faceUp[pile.faceUp.length - 1] : null,
      };
    });
  }

  function broadcastGameUpdate(room, event) {
    broadcast(room, {
      type: 'game_update',
      board: buildBoard(room),
      currentTurnToken: room.turnOrder[room.turnIndex] ?? null,
      totalCards: room.totalCards,
      event: event ?? null,
    });
  }

  // ── 차례 진행 ────────────────────────────────────────────────────
  function isEligibleFlipper(room, token) {
    const player = playerByToken(room, token);
    const pile = room.piles.get(token);
    return !!player?.ws && pile.draw.length > 0;
  }

  /** turnIndex부터(포함) 시계방향으로 뒤집을 수 있는 다음 참가자를 찾아 turnIndex를 갱신한다. 없으면 null. */
  function refreshCurrentFlipper(room, startAt) {
    const n = room.turnOrder.length;
    for (let i = 0; i < n; i++) {
      const idx = (startAt + i) % n;
      if (isEligibleFlipper(room, room.turnOrder[idx])) {
        room.turnIndex = idx;
        armFlipTimer(room);
        return room.turnOrder[idx];
      }
    }
    clearFlipTimer(room);
    return null;
  }

  function armFlipTimer(room) {
    clearFlipTimer(room);
    room.flipTimer = setTimeout(() => {
      if (room.phase !== 'playing') return;
      const skipped = room.turnOrder[room.turnIndex];
      refreshCurrentFlipper(room, room.turnIndex + 1);
      broadcastGameUpdate(room, { kind: 'turn_skipped', token: skipped, name: nameOf(room, skipped) });
    }, FLIP_TIMEOUT_MS);
  }

  // ── 게임 진행 ────────────────────────────────────────────────────
  function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const connected = room.players.filter(p => p.ws);
    if (connected.length < MIN_PLAYERS) return;

    const deck = buildDeck();
    room.totalCards = deck.length;
    room.turnOrder = connected.map(p => p.token);
    room.piles = new Map(room.turnOrder.map(token => [token, { draw: [], faceUp: [] }]));

    // 라운드로빈으로 균등 분배(카드 수가 인원수로 안 나눠떨어지면 앞사람부터 한 장씩 더 받음)
    let i = 0;
    for (const card of deck) {
      const token = room.turnOrder[i % room.turnOrder.length];
      room.piles.get(token).draw.push(card);
      i++;
    }

    room.turnIndex = 0;
    room.resolvingRing = false;
    room.ringTimer = null;
    room.started = true;
    room.phase = 'playing';

    refreshCurrentFlipper(room, 0);
    broadcastGameUpdate(room, null);
  }

  function submitFlip(room, roomCode, token) {
    if (room.phase !== 'playing') return;
    if (room.turnOrder[room.turnIndex] !== token) return;
    const pile = room.piles.get(token);
    if (!pile || pile.draw.length === 0) return;

    const card = pile.draw.pop();
    pile.faceUp.push(card);

    refreshCurrentFlipper(room, room.turnIndex + 1);
    broadcastGameUpdate(room, {
      kind: 'flip',
      token, name: nameOf(room, token),
      fruit: card.fruit, count: card.count,
    });
    checkGameOver(room, roomCode);
  }

  function currentFruitSums(room) {
    const sums = new Map();
    for (const token of room.turnOrder) {
      const pile = room.piles.get(token);
      const top = pile.faceUp[pile.faceUp.length - 1];
      if (!top) continue;
      sums.set(top.fruit, (sums.get(top.fruit) || 0) + top.count);
    }
    return sums;
  }

  function submitRing(room, roomCode, token) {
    if (room.phase !== 'playing') return;

    const sums = currentFruitSums(room);
    const matchedFruit = [...sums.entries()].find(([, sum]) => sum === 5)?.[0] ?? null;

    if (matchedFruit) {
      // 정답 처리 직후 RING_RESOLUTION_WINDOW_MS 동안은 늦게 도착한 다른 사람의 종치기가
      // (이미 비워진 보드를 보고) 억울하게 오답 벌칙을 받지 않도록 잠깐 잠근다.
      room.resolvingRing = true;
      if (room.ringTimer) clearTimeout(room.ringTimer);
      room.ringTimer = setTimeout(() => { room.resolvingRing = false; }, RING_RESOLUTION_WINDOW_MS);

      let cardsWon = 0;
      const winnerPile = room.piles.get(token);
      for (const t of room.turnOrder) {
        const pile = room.piles.get(t);
        cardsWon += pile.faceUp.length;
        winnerPile.draw.push(...pile.faceUp);
        pile.faceUp = [];
      }
      winnerPile.draw = shuffle(winnerPile.draw);
      refreshCurrentFlipper(room, room.turnIndex);
      broadcastGameUpdate(room, {
        kind: 'ring_correct', token, name: nameOf(room, token), fruit: matchedFruit, cardsWon,
      });
    } else {
      if (room.resolvingRing) return; // 방금 다른 사람이 정답 처리됨 - 오탐 벌칙 없이 조용히 무시
      const ringerPile = room.piles.get(token);
      const others = room.turnOrder.filter(t => t !== token);
      const givenTo = [];
      for (const other of others) {
        if (ringerPile.draw.length === 0) break;
        const card = ringerPile.draw.pop();
        room.piles.get(other).draw.push(card);
        givenTo.push({ token: other, name: nameOf(room, other) });
      }
      refreshCurrentFlipper(room, room.turnIndex);
      broadcastGameUpdate(room, {
        kind: 'ring_wrong', token, name: nameOf(room, token), givenTo,
      });
    }
    checkGameOver(room, roomCode);
  }

  /** 한 명이 전체 카드를 독식했는지 확인하고, 게임이 끝났으면 game_over를 브로드캐스트한 뒤 true를 반환한다. */
  function checkGameOver(room, roomCode) {
    const winner = room.turnOrder.find(t => pileTotal(room, t) === room.totalCards);
    if (!winner) return false;
    clearFlipTimer(room);
    room.phase = 'game_over';
    room.started = false;
    broadcast(room, {
      type: 'game_over',
      winnerToken: winner,
      winnerName: nameOf(room, winner),
      board: buildBoard(room),
    });
    return true;
  }

  // ── 이탈/재접속 처리 ─────────────────────────────────────────────
  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    const leavingName = playerByToken(room, leavingToken)?.name ?? '?';
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

    // 게임 도중 이탈: 최소 인원(2명) 미만이면 남은 한 명의 승리로 즉시 종료.
    room.turnOrder = room.turnOrder.filter(t => t !== leavingToken);
    if (room.turnOrder.length < MIN_PLAYERS) {
      clearFlipTimer(room);
      room.phase = 'game_over';
      room.started = false;
      const winner = room.turnOrder[0] ?? null;
      broadcast(room, {
        type: 'game_over',
        winnerToken: winner,
        winnerName: winner ? nameOf(room, winner) : null,
        board: buildBoard(room),
        opponentLeft: true,
      });
      return;
    }

    // 이탈한 사람의 카드는 남은 참가자에게 라운드로빈으로 재분배해 카드 총량을 보존한다.
    const leftoverPile = room.piles.get(leavingToken);
    const leftoverCards = shuffle([...leftoverPile.draw, ...leftoverPile.faceUp]);
    room.piles.delete(leavingToken);
    let i = 0;
    for (const card of leftoverCards) {
      const token = room.turnOrder[i % room.turnOrder.length];
      room.piles.get(token).draw.push(card);
      i++;
    }

    if (room.turnIndex >= room.turnOrder.length) room.turnIndex = 0;
    refreshCurrentFlipper(room, room.turnIndex);
    if (checkGameOver(room, roomCode)) return;
    broadcastGameUpdate(room, { kind: 'player_left', name: leavingName });
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
        const capacity = Math.min(Math.max(Number(msg.capacity) || 4, MIN_PLAYERS), MAX_PLAYERS);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token, capacity,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          totalCards: 0,
          turnOrder: [], turnIndex: 0,
          piles: new Map(),
          resolvingRing: false, ringTimer: null, flipTimer: null,
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
          send(ws, {
            ...base,
            game: {
              board: buildBoard(room),
              currentTurnToken: room.turnOrder[room.turnIndex] ?? null,
              totalCards: room.totalCards,
            },
          });
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

        broadcast(room, { type: 'game_starting' });
        startGame(identity.roomCode);
        return;
      }

      // ── submit_flip ─────────────────────────────────────────────
      if (msg.type === 'submit_flip') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        submitFlip(room, identity.roomCode, identity.token);
        return;
      }

      // ── submit_ring ───────────────────────────────────────────────
      if (msg.type === 'submit_ring') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        if (!room.turnOrder.includes(identity.token)) return;
        submitRing(room, identity.roomCode, identity.token);
        return;
      }

      // ── submit_chat ───────────────────────────────────────────────
      if (msg.type === 'submit_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : '';
        if (!text) return;
        const name = nameOf(room, identity.token);
        broadcast(room, { type: 'chat_message', token: identity.token, name, text });
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

  console.log('[halligalli-server] registered ws path: /halligalli');
  return wss;
}
