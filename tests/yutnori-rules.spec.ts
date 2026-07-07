import { expect, test } from '@playwright/test';
import { buildYutBoardGraph, cornerNodeId, entryNodeId } from '../src/game/yutnori-board';
import {
  createYutGame,
  currentToken,
  getAutoMoveRequest,
  mulberry32,
  rollYutThrow,
  submitMove,
  submitThrow,
  type GameState,
  type ThrowKind,
} from '../src/game/yutnori-rules';

function forceThrow(state: GameState, kind: ThrowKind) {
  // 테스트에서 특정 결과를 강제하기 위해 rng를 잠깐 바꿔치기한다.
  const table: Record<string, number> = { backdo: 0, do: 5, gae: 40, geol: 70, yut: 88, mo: 97 };
  const savedRng = state.rng;
  state.rng = () => (table[kind] ?? 5) / 100;
  const result = submitThrow(state);
  state.rng = savedRng;
  expect(result.kind).toBe(kind);
  return result;
}

/** 단위 테스트용: 순번을 강제로 특정 플레이어의 깨끗한 던지기 단계로 되돌린다. */
function resetTurnTo(state: GameState, token: string) {
  state.turnIndex = state.turnOrder.indexOf(token);
  state.phase = 'throw';
  state.pendingThrows = [];
  state.awaitingBranch = null;
}

test('throw distribution stays within the documented weight table over many rolls', () => {
  const rng = mulberry32(1234);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 5000; i += 1) {
    const result = rollYutThrow(rng);
    counts[result.kind] = (counts[result.kind] ?? 0) + 1;
  }
  expect(counts.backdo).toBeGreaterThan(0);
  expect(counts.mo).toBeGreaterThan(0);
  const doGaeShare = ((counts.do ?? 0) + (counts.gae ?? 0)) / 5000;
  expect(doGaeShare).toBeGreaterThan(0.5);
  expect(doGaeShare).toBeLessThan(0.8);
});

test('the board uses the traditional 29 stations', () => {
  expect(Object.keys(buildYutBoardGraph())).toHaveLength(29);
});

test('a basic forward move places a fresh piece on the first point after the start corner', () => {
  const state = createYutGame(['A', 'B'], 1);
  forceThrow(state, 'do');
  const outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.event.path).toEqual(['outer-1']);
  expect(currentToken(state)).toBe('B'); // do는 추가 턴이 없으니 바로 다음 사람 차례로 넘어간다
});

test('all players share the same start/home node and leave it in the fixed outer direction', () => {
  const state = createYutGame(['A', 'B'], 11);
  forceThrow(state, 'do');
  let outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.event.path).toEqual(['outer-1']);

  resetTurnTo(state, 'A');
  forceThrow(state, 'do');
  outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.event.path).toEqual(['outer-1', 'outer-2']);
});

test('a fresh mo reaches the first corner, because the start corner is not counted as do', () => {
  const state = createYutGame(['A', 'B'], 111);
  forceThrow(state, 'mo');
  forceThrow(state, 'do'); // mo는 추가 턴이라 이동 단계로 넘기기 위해 한 번 더 던진다
  const moThrow = state.pendingThrows.find((pt) => pt.result.kind === 'mo')!;
  const outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: moThrow.id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.event.path).toEqual(['outer-1', 'outer-2', 'outer-3', 'outer-4', cornerNodeId(1)]);
});

test('yut and mo keep the player in throw phase for one more throw', () => {
  const state = createYutGame(['A', 'B'], 12);
  forceThrow(state, 'yut');
  expect(state.phase).toBe('throw');
  expect(currentToken(state)).toBe('A');
  expect(state.pendingThrows).toHaveLength(1);

  forceThrow(state, 'mo');
  expect(state.phase).toBe('throw');
  expect(currentToken(state)).toBe('A');
  expect(state.pendingThrows).toHaveLength(2);

  forceThrow(state, 'do');
  expect(state.phase).toBe('move');
  expect(currentToken(state)).toBe('A');
  expect(state.pendingThrows).toHaveLength(3);
});

test('auto move launches a fresh piece first, otherwise moves the piece closest to start', () => {
  const state = createYutGame(['A', 'B'], 13);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-0', 'outer-1', 'outer-2'];
  state.pieces.find((p) => p.id === 'A-1')!.path = ['outer-0'];
  resetTurnTo(state, 'A');

  forceThrow(state, 'gae');
  expect(getAutoMoveRequest(state)).toEqual({ pieceId: 'A-2', pendingThrowId: state.pendingThrows[0].id });
  state.pieces.find((p) => p.id === 'A-2')!.path = ['outer-0', 'outer-1'];
  state.pieces.find((p) => p.id === 'A-3')!.path = ['outer-0', 'outer-1', 'outer-2', 'outer-3'];
  expect(getAutoMoveRequest(state)).toEqual({ pieceId: 'A-1', pendingThrowId: state.pendingThrows[0].id });
});

test('landing on your own piece piggybacks it, and 갈라치기 splits it back off', () => {
  const state = createYutGame(['A', 'B'], 2);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-4'];
  state.pieces.find((p) => p.id === 'A-1')!.path = ['outer-2'];
  resetTurnTo(state, 'A');

  forceThrow(state, 'gae'); // outer-2 -> outer-3 -> outer-4 (코너를 지나지 않는 구간)
  const merge = submitMove(state, { pieceId: 'A-1', pendingThrowId: state.pendingThrows[0].id });
  expect(merge.status).toBe('applied');
  if (merge.status !== 'applied') throw new Error('unreachable');
  expect(merge.event.joinedPieceIds).toContain('A-0');

  const a0 = state.pieces.find((p) => p.id === 'A-0')!;
  const a1 = state.pieces.find((p) => p.id === 'A-1')!;
  expect(a0.leadId).toBe('A-1');
  expect(a1.leadId).toBe('A-1');

  resetTurnTo(state, 'A');
  forceThrow(state, 'do'); // outer-4 -> outer-5(코너, 도착만 하고 더 안 감 - 분기 불필요)
  const split = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id, splitOff: true });
  expect(split.status).toBe('applied');
  if (split.status !== 'applied') throw new Error('unreachable');

  expect(a0.leadId).toBe('A-0'); // 독립함
  expect(a1.leadId).toBe('A-1'); // 남은 말은 그대로 outer-4에 머무름
  expect(a1.path).toEqual(['outer-2', 'outer-3', 'outer-4']);
  expect(a0.path).toEqual(['outer-2', 'outer-3', 'outer-4', 'outer-5']);
});

test('capturing an opponent piece sends it back to start and grants a bonus throw', () => {
  const state = createYutGame(['A', 'B'], 4);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-2'];
  state.pieces.find((p) => p.id === 'B-0')!.path = ['outer-4'];
  resetTurnTo(state, 'A');

  forceThrow(state, 'gae'); // outer-2 -> outer-3 -> outer-4 (B-0이 있는 칸)
  const outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.event.capturedPieceIds).toContain('B-0');
  expect(outcome.bonusThrow).toBe(true);

  const b0 = state.pieces.find((p) => p.id === 'B-0')!;
  expect(b0.path).toEqual([]);
  expect(currentToken(state)).toBe('A'); // 보너스 턴이라 턴이 안 넘어가야 한다
  expect(state.phase).toBe('throw');
});

test('backdo retreats a piece by exactly one step', () => {
  const state = createYutGame(['A', 'B'], 5);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-2', 'outer-3'];
  resetTurnTo(state, 'A');

  forceThrow(state, 'backdo');
  const outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  const a0 = state.pieces.find((p) => p.id === 'A-0')!;
  expect(a0.path).toEqual(['outer-2']);
});

test('backdo from the do point retreats to the start corner instead of creating another back move', () => {
  const state = createYutGame(['A', 'B'], 55);
  state.pieces.find((p) => p.id === 'A-0')!.path = ['outer-1'];
  resetTurnTo(state, 'A');

  forceThrow(state, 'backdo');
  const outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  const a0 = state.pieces.find((p) => p.id === 'A-0')!;
  expect(a0.path).toEqual([entryNodeId(0)]);
  expect(a0.home).toBe(false);
});

test('taking the shortcut at a corner asks for a branch choice and moves through two diagonal points', () => {
  const state = createYutGame(['A', 'B'], 6);
  state.pieces.find((p) => p.id === 'A-0')!.path = [cornerNodeId(1)]; // 지름길이 있는 코너에 이미 서 있음
  resetTurnTo(state, 'A');

  forceThrow(state, 'gae'); // 코너에서 2칸 더 가려면 반드시 분기를 골라야 한다
  const pendingId = state.pendingThrows[0].id;
  const first = submitMove(state, { pieceId: 'A-0', pendingThrowId: pendingId });
  expect(first.status).toBe('awaiting-branch');
  if (first.status !== 'awaiting-branch') throw new Error('unreachable');
  expect(first.branch.cornerId).toBe(cornerNodeId(1));

  const resolved = submitMove(state, { pieceId: 'A-0', pendingThrowId: pendingId, branch: 'shortcut' });
  expect(resolved.status).toBe('applied');
  if (resolved.status !== 'applied') throw new Error('unreachable');
  expect(resolved.event.path).toEqual([cornerNodeId(1), 'diag-1-0', 'diag-1-1']);
});

test('the center exits through the opposite diagonal toward the opposite corner', () => {
  const state = createYutGame(['A', 'B'], 66);
  state.pieces.find((p) => p.id === 'A-0')!.path = [cornerNodeId(1), 'diag-1-0', 'diag-1-1', 'center'];
  resetTurnTo(state, 'A');

  forceThrow(state, 'geol');
  const outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.event.path).toEqual([
    cornerNodeId(1),
    'diag-1-0',
    'diag-1-1',
    'center',
    'diag-3-1',
    'diag-3-0',
    cornerNodeId(3),
  ]);
});

test('a piece that already passed the center can take a shortcut again on a later lap', () => {
  const state = createYutGame(['A', 'B'], 7);
  // 이미 중앙을 한 번 지난 이력(path에 center 포함)이 있고, 지름길이 있는 코너(코너1)에 다시 서 있는 말.
  const a0 = state.pieces.find((p) => p.id === 'A-0')!;
  a0.path = ['center', cornerNodeId(1)];
  resetTurnTo(state, 'A');

  forceThrow(state, 'geol'); // 3칸
  const pendingId = state.pendingThrows[0].id;
  let outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: pendingId });
  expect(outcome.status).toBe('awaiting-branch');
  outcome = submitMove(state, { pieceId: 'A-0', pendingThrowId: pendingId, branch: 'shortcut' });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  // 과거 center 이력 때문에 지름길이 코너로 튕겨선 안 되고, 대각선 2칸을 지나 다시 중앙으로 이어져야 한다.
  expect(outcome.event.path).toEqual(['center', cornerNodeId(1), 'diag-1-0', 'diag-1-1', 'center']);
});

test('landing exactly on the start corner is not home; passing it completes the course', () => {
  const state = createYutGame(['A', 'B'], 7);
  state.pieces.forEach((p) => {
    if (p.ownerToken === 'A' && p.id !== 'A-3') {
      p.home = true;
      p.path = [];
    }
  });
  const lastPiece = state.pieces.find((p) => p.id === 'A-3')!;
  lastPiece.path = ['outer-19']; // 시작/도착 코너(outer-0) 바로 앞 칸
  resetTurnTo(state, 'A');

  forceThrow(state, 'do');
  let outcome = submitMove(state, { pieceId: 'A-3', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.gameOver).toBe(false);
  expect(lastPiece.path).toEqual(['outer-19', entryNodeId(0)]);
  expect(lastPiece.home).toBe(false);

  resetTurnTo(state, 'A');
  forceThrow(state, 'do');
  outcome = submitMove(state, { pieceId: 'A-3', pendingThrowId: state.pendingThrows[0].id });
  expect(outcome.status).toBe('applied');
  if (outcome.status !== 'applied') throw new Error('unreachable');
  expect(outcome.gameOver).toBe(true);

  expect(state.winner).toBe('A');
  expect(state.pieces.filter((p) => p.ownerToken === 'A' && p.home)).toHaveLength(4);
});
