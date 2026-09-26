import { registerRpsServer } from './rps.mjs';
import { createNodePlatform } from './node-platform.mjs';
import { createServer } from 'node:http';
import { registerLiarServer } from './liar.mjs';
import { registerMafiaServer } from './mafia.mjs';
import { registerHalliGalliServer } from './halligalli.mjs';
import { registerYutnoriServer } from './yutnori.mjs';
import { registerStrategyYutnoriServer } from './strategy-yutnori.mjs';
import { registerMoleHuntServer } from './mole-hunt.mjs';
import { registerMemorySequenceServer } from './memory-sequence.mjs';
import { registerUpdownNumberServer } from './updown-number.mjs';
import { registerMultiplicationSprintServer } from './multiplication-sprint.mjs';
import { registerOddEvenMathServer } from './odd-even-math.mjs';
import { registerColorInstructionServer } from './color-instruction.mjs';
import { registerSumTenPuzzleServer } from './sum-ten-puzzle.mjs';
import { registerTugOfWarBattleServer } from './tug-of-war-battle.mjs';
import { registerTerritoryClashServer } from './territory-clash.mjs';
import { registerLightGuessServer } from './light-guess.mjs';
import { registerReversiServer } from './reversi.mjs';
import { registerGomokuServer } from './gomoku.mjs';
import { isoWeekKey } from './ranking-store.mjs';
import { createScoreRankingService } from './score-ranking-store.mjs';

const PORT = Number(process.env.PORT) || 8787;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const scoreRankingService = createScoreRankingService([
  'aim-trainer',
  'color-slider',
  'ball-dodge',
  'tower-stack',
  'snake',
  'typing-survival',
  '2048-hex',
  'endless-runner',
  'idle-farm',
  'sum-ten-puzzle',
], { corsHeaders: CORS_HEADERS });

/** rps 이외의 승/패 랭킹(라이어/마피아/할리갈리/윷놀이/전략윷놀이) 공용 응답 헬퍼. */
function respondGameRanking(req, res, getRankingFn) {
  const week = new URL(req.url, 'http://localhost').searchParams.get('week') || isoWeekKey();
  const entries = getRankingFn(week);
  const prevWeek = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return isoWeekKey(d); })();
  res.writeHead(200, { 'content-type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify({ week, entries, prevWeek }));
}

// /ranking 접두사 하위 경로("/ranking/liar" 등)를 각 게임의 랭킹 조회 함수로 매핑한다.
// 이 맵은 아래에서 각 게임 서버를 등록한 뒤 채워진다(파일 뒷부분의 registerXServer(createNodePlatform()) 참고).
const GAME_RANKING_HANDLERS = {};

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
  const pathname = req.url?.split('?')[0];
  if (pathname && scoreRankingService.handle(req, res, pathname)) return;
  if (pathname && pathname.startsWith('/ranking/')) {
    const gameKey = pathname.slice('/ranking/'.length);
    const getRankingFn = GAME_RANKING_HANDLERS[gameKey];
    if (getRankingFn) { respondGameRanking(req, res, getRankingFn); return; }
  }
  res.writeHead(404); res.end();
});

const { wss, getRanking } = registerRpsServer(createNodePlatform());

const { wss: liarWss, getRanking: getLiarRanking } = registerLiarServer(createNodePlatform());
const { wss: mafiaWss, getRanking: getMafiaRanking } = registerMafiaServer(createNodePlatform());
const { wss: halliGalliWss, getRanking: getHalliGalliRanking } = registerHalliGalliServer(createNodePlatform());
const { wss: yutnoriWss, getRanking: getYutnoriRanking } = registerYutnoriServer(createNodePlatform());
const { wss: strategyYutnoriWss, getRanking: getStrategyYutnoriRanking } = registerStrategyYutnoriServer(createNodePlatform());
const { wss: moleHuntWss, getRanking: getMoleHuntRanking } = registerMoleHuntServer(createNodePlatform());
const { wss: memorySequenceWss, getRanking: getMemorySequenceRanking } = registerMemorySequenceServer(createNodePlatform());
const { wss: updownNumberWss, getRanking: getUpdownNumberRanking } = registerUpdownNumberServer(createNodePlatform());
const { wss: multiplicationSprintWss, getRanking: getMultiplicationSprintRanking } = registerMultiplicationSprintServer(createNodePlatform());
const { wss: oddEvenMathWss, getRanking: getOddEvenMathRanking } = registerOddEvenMathServer(createNodePlatform());
const { wss: colorInstructionWss, getRanking: getColorInstructionRanking } = registerColorInstructionServer(createNodePlatform());
const { wss: sumTenPuzzleWss, getRanking: getSumTenPuzzleRanking } = registerSumTenPuzzleServer(createNodePlatform());
const { wss: tugOfWarBattleWss, getRanking: getTugOfWarBattleRanking } = registerTugOfWarBattleServer(createNodePlatform());
const { wss: territoryClashWss, getRanking: getTerritoryClashRanking } = registerTerritoryClashServer(createNodePlatform());
const { wss: lightGuessWss, getRanking: getLightGuessRanking } = registerLightGuessServer(createNodePlatform());
const { wss: reversiWss, getRanking: getReversiRanking } = registerReversiServer(createNodePlatform());
const { wss: gomokuWss, getRanking: getGomokuRanking } = registerGomokuServer(createNodePlatform());

GAME_RANKING_HANDLERS.liar = getLiarRanking;
GAME_RANKING_HANDLERS.mafia = getMafiaRanking;
GAME_RANKING_HANDLERS.halligalli = getHalliGalliRanking;
GAME_RANKING_HANDLERS.yutnori = getYutnoriRanking;
GAME_RANKING_HANDLERS['strategy-yutnori'] = getStrategyYutnoriRanking;
GAME_RANKING_HANDLERS['mole-hunt'] = getMoleHuntRanking;
GAME_RANKING_HANDLERS['memory-sequence'] = getMemorySequenceRanking;
GAME_RANKING_HANDLERS['updown-number'] = getUpdownNumberRanking;
GAME_RANKING_HANDLERS['multiplication-sprint'] = getMultiplicationSprintRanking;
GAME_RANKING_HANDLERS['odd-even-math'] = getOddEvenMathRanking;
GAME_RANKING_HANDLERS['color-instruction'] = getColorInstructionRanking;
GAME_RANKING_HANDLERS['sum-ten-puzzle'] = getSumTenPuzzleRanking;
GAME_RANKING_HANDLERS['tug-of-war-battle'] = getTugOfWarBattleRanking;
GAME_RANKING_HANDLERS['territory-clash'] = getTerritoryClashRanking;
GAME_RANKING_HANDLERS['light-guess'] = getLightGuessRanking;
GAME_RANKING_HANDLERS['reversi'] = getReversiRanking;
GAME_RANKING_HANDLERS['gomoku'] = getGomokuRanking;

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
  } else if (pathname === '/mole-hunt') {
    moleHuntWss.handleUpgrade(req, socket, head, (ws) => moleHuntWss.emit('connection', ws, req));
  } else if (pathname === '/memory-sequence') {
    memorySequenceWss.handleUpgrade(req, socket, head, (ws) => memorySequenceWss.emit('connection', ws, req));
  } else if (pathname === '/updown-number') {
    updownNumberWss.handleUpgrade(req, socket, head, (ws) => updownNumberWss.emit('connection', ws, req));
  } else if (pathname === '/multiplication-sprint') {
    multiplicationSprintWss.handleUpgrade(req, socket, head, (ws) => multiplicationSprintWss.emit('connection', ws, req));
  } else if (pathname === '/odd-even-math') {
    oddEvenMathWss.handleUpgrade(req, socket, head, (ws) => oddEvenMathWss.emit('connection', ws, req));
  } else if (pathname === '/color-instruction') {
    colorInstructionWss.handleUpgrade(req, socket, head, (ws) => colorInstructionWss.emit('connection', ws, req));
  } else if (pathname === '/sum-ten-puzzle') {
    sumTenPuzzleWss.handleUpgrade(req, socket, head, (ws) => sumTenPuzzleWss.emit('connection', ws, req));
  } else if (pathname === '/tug-of-war-battle') {
    tugOfWarBattleWss.handleUpgrade(req, socket, head, (ws) => tugOfWarBattleWss.emit('connection', ws, req));
  } else if (pathname === '/territory-clash') {
    territoryClashWss.handleUpgrade(req, socket, head, (ws) => territoryClashWss.emit('connection', ws, req));
  } else if (pathname === '/light-guess') {
    lightGuessWss.handleUpgrade(req, socket, head, (ws) => lightGuessWss.emit('connection', ws, req));
  } else if (pathname === '/reversi') {
    reversiWss.handleUpgrade(req, socket, head, (ws) => reversiWss.emit('connection', ws, req));
  } else if (pathname === '/gomoku') {
    gomokuWss.handleUpgrade(req, socket, head, (ws) => gomokuWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, () => {
  console.log(`[rps-server] listening on :${PORT} (ws paths: /rps, /liar, /mafia, /halligalli, /yutnori, /strategy-yutnori, /mole-hunt, /memory-sequence, /updown-number, /multiplication-sprint, /odd-even-math, /color-instruction, /sum-ten-puzzle, /tug-of-war-battle, /territory-clash, /light-guess, /reversi, /gomoku)`);
});
