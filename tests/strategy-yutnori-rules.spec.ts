import { expect, test } from '@playwright/test';
import { entryNodeId } from '../src/game/yutnori-board';
import {
  createStrategyYutGame,
  currentMover,
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

test('back-count-to-kind mapping matches the documented rule (exactly 1 back is always forced to backdo)', () => {
  expect(resolveThrow({ A: 'front', B: 'front', C: 'front', D: 'front' }).kind).toBe('mo');
  expect(resolveThrow({ A: 'back', B: 'front', C: 'front', D: 'front' }).kind).toBe('backdo');
  expect(resolveThrow({ A: 'back', B: 'back', C: 'front', D: 'front' }).kind).toBe('gae');
  expect(resolveThrow({ A: 'back', B: 'back', C: 'back', D: 'front' }).kind).toBe('geol');
  expect(resolveThrow({ A: 'back', B: 'back', C: 'back', D: 'back' }).kind).toBe('yut');
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
});

test('a full round makes all 4 players move once in order, then a new round begins', () => {
  const state = createStrategyYutGame(TOKENS);
  // 각자 서로 겹치지 않는 위치에 미리 놓아 이동끼리 업기/잡기가 섞이지 않게 한다(라운드 진행 자체만 검증).
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-1'];
  state.pieces.find((p) => p.id === 'B-0')!.path = ['outer-6'];
  state.pieces.find((p) => p.id === 'C-0')!.path = ['outer-11'];
  state.pieces.find((p) => p.id === 'D-0')!.path = ['outer-16'];
  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)

  expect(currentMover(state)).toBe('A');
  let res = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(res.status).toBe('applied');
  expect(currentMover(state)).toBe('B');
  res = submitMove(state, 'B', { pieceId: 'B-0' });
  expect(currentMover(state)).toBe('C');
  res = submitMove(state, 'C', { pieceId: 'C-0' });
  expect(currentMover(state)).toBe('D');
  res = submitMove(state, 'D', { pieceId: 'D-0' });
  if (res.status !== 'applied') throw new Error('unreachable');
  expect(res.roundOver).toBe(true);
  expect(state.phase).toBe('collecting');
  expect(state.round).toBe(2);
});

test('a player wins individually once their own 2 pieces reach home, regardless of partner', () => {
  // back=1(강제 백도)은 항상 후진이라 정방향 do 대신 gae(2)로 완주 지점을 넘기게 설계한다:
  // outer-18에서 2칸 전진하면 outer-19 -> outer-0(A의 진입 코너, 곧 완주 지점)에 정확히 닿는다.
  const state = createStrategyYutGame(TOKENS);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-18'];
  state.pieces.find((p) => p.id === 'A-1')!.home = true;

  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)
  expect(currentMover(state)).toBe('A');
  const outcome = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.gameOver).toBe(true);
  expect(state.winner).toBe('A');
});

test('taking the shortcut at a corner still asks for a branch choice, same as base yutnori', () => {
  const state = createStrategyYutGame(TOKENS);
  state.pieces.find((p) => p.id === 'A-0')!.path = [entryNodeId(0)];
  submitRound(state, ['back', 'back', 'front', 'front']); // gae(2)
  expect(currentMover(state)).toBe('A');

  const first = submitMove(state, 'A', { pieceId: 'A-0' });
  expect(first.status).toBe('awaiting-branch');
  if (first.status !== 'awaiting-branch') throw new Error('unreachable');
  expect(first.cornerId).toBe(entryNodeId(0));

  const resolved = submitMove(state, 'A', { pieceId: 'A-0', branch: 'shortcut' });
  expect(resolved.status).toBe('applied');
  if (resolved.status !== 'applied') throw new Error('unreachable');
  expect(resolved.path).toEqual([entryNodeId(0), 'diag-0', 'center']);
});
