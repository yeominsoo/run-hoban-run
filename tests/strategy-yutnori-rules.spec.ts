import { expect, test } from '@playwright/test';
import { cornerNodeId } from '../src/game/yutnori-board';
import {
  createStrategyYutGame,
  currentMover,
  getAutoMoveRequest,
  partnerOf,
  resolveThrow,
  submitFace,
  submitMove,
  type FaceChoice,
  type GameState,
} from '../src/game/strategy-yutnori-rules';

const TOKENS = ['A', 'B', 'C', 'D'];

function submitRound(state: GameState, faces: [FaceChoice, FaceChoice, FaceChoice, FaceChoice]) {
  let result = null;
  TOKENS.forEach((token, i) => {
    result = submitFace(state, token, faces[i]);
  });
  return result!;
}

test('front-count-to-kind mapping matches yut scoring, with do forced to backdo in this variant', () => {
  expect(resolveThrow({ A: 'back', B: 'back', C: 'back', D: 'back' }).kind).toBe('mo');
  expect(resolveThrow({ A: 'front', B: 'back', C: 'back', D: 'back' }).kind).toBe('backdo');
  expect(resolveThrow({ A: 'back', B: 'back', C: 'front', D: 'front' }).kind).toBe('gae');
  expect(resolveThrow({ A: 'front', B: 'front', C: 'front', D: 'back' }).kind).toBe('geol');
  expect(resolveThrow({ A: 'front', B: 'front', C: 'front', D: 'front' }).kind).toBe('yut');
});

test('partner pairing groups (0,1) and (2,3), and partners can still capture each other', () => {
  const state = createStrategyYutGame(TOKENS);
  expect(partnerOf(state, 'A')).toBe('B');
  expect(partnerOf(state, 'C')).toBe('D');

  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-2'];
  state.pieces.find((p) => p.id === 'B-0')!.path = ['outer-4']; // A의 파트너 B

  const result = submitRound(state, ['back', 'back', 'front', 'front']); // 뒷면 2개 = 개(2)
  expect(result.kind).toBe('gae');
  expect(currentMover(state)).toBe('A');

  const outcome = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.capturedPieceIds).toContain('B-0'); // 파트너인데도 잡힘 — 배신 가능 확인
  expect(outcome.bonusThrow).toBe(true);
  expect(currentMover(state)).toBe('A'); // 잡으면 같은 플레이어가 한 번 더 던진다
  expect(state.phase).toBe('collecting');
});

test('piggyback only merges pieces owned by the same individual, not a partner\'s pieces', () => {
  const state = createStrategyYutGame(TOKENS);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-4'];
  state.pieces.find((p) => p.id === 'A-1')!.path = ['outer-2'];

  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)
  expect(currentMover(state)).toBe('A');
  const outcome = submitMove(state, 'A', { pieceId: 'A-1' });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.joinedPieceIds).toContain('A-0');

  const a0 = state.pieces.find((p) => p.id === 'A-0')!;
  const a1 = state.pieces.find((p) => p.id === 'A-1')!;
  expect(a0.leadId).toBe('A-1'); // 같은 개인 소유끼리는 업힘
  expect(currentMover(state)).toBe('B');
});

test('one resolved throw belongs to the current player only, then turn advances', () => {
  const state = createStrategyYutGame(TOKENS);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-1'];
  state.pieces.find((p) => p.id === 'B-0')!.path = ['outer-6'];
  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)

  expect(currentMover(state)).toBe('A');
  const res = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(res.status).toBe('applied');
  if (res.status !== 'applied') throw new Error('unreachable');
  expect(res.bonusThrow).toBe(false);
  expect(state.phase).toBe('collecting');
  expect(currentMover(state)).toBe('B');
  expect(() => submitMove(state, 'B', { pieceId: 'B-0' })).toThrow();
  expect(state.round).toBe(2);
});

test('yut and mo give the same strategy player another throw', () => {
  const state = createStrategyYutGame(TOKENS);
  submitRound(state, ['front', 'front', 'front', 'front']); // yut(4)
  expect(currentMover(state)).toBe('A');
  let res = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(res.status).toBe('applied');
  if (res.status !== 'applied') throw new Error('unreachable');
  expect(res.bonusThrow).toBe(true);
  expect(state.phase).toBe('collecting');
  expect(currentMover(state)).toBe('A');

  submitRound(state, ['back', 'back', 'back', 'back']); // mo(5)
  res = submitMove(state, 'A', { pieceId: 'A-1' });
  expect(res.status).toBe('applied');
  if (res.status !== 'applied') throw new Error('unreachable');
  expect(res.bonusThrow).toBe(true);
  expect(currentMover(state)).toBe('A');
});

test('unmovable backdo immediately advances to the next strategy player', () => {
  const state = createStrategyYutGame(TOKENS);
  const result = submitRound(state, ['front', 'back', 'back', 'back']); // forced backdo
  expect(result.kind).toBe('backdo');
  expect(state.phase).toBe('collecting');
  expect(currentMover(state)).toBe('B');
});

test('auto move launches a fresh piece first, otherwise moves the piece closest to start', () => {
  const state = createStrategyYutGame(TOKENS);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-0', 'outer-1', 'outer-2'];
  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)

  expect(getAutoMoveRequest(state, 'A')).toEqual({ pieceId: 'A-1' });
  state.pieces.find((p) => p.id === 'A-1')!.path = ['outer-0'];
  expect(getAutoMoveRequest(state, 'A')).toEqual({ pieceId: 'A-1' });
});

test('a player wins individually once their own 2 pieces reach home, regardless of partner', () => {
  // outer-19에서 gae(2)를 쓰면 outer-0에 정확히 멈추지 않고 시작점을 지나 완주한다.
  const state = createStrategyYutGame(TOKENS);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-19'];
  state.pieces.find((p) => p.id === 'A-1')!.home = true;

  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)
  expect(currentMover(state)).toBe('A');
  const outcome = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.gameOver).toBe(true);
  expect(state.winner).toBe('A');
});

test('a piece already resting exactly on a corner is forced through the shortcut, no choice asked (same as base yutnori)', () => {
  const state = createStrategyYutGame(TOKENS);
  state.pieces.find((p) => p.id === 'A-0')!.path = [cornerNodeId(1)];
  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)
  expect(currentMover(state)).toBe('A');

  const outcome = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.path).toEqual([cornerNodeId(1), 'diag-1-0', 'diag-1-1']);
});
