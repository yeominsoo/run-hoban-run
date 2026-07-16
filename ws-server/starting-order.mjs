/** 선공/후공 결정전(주사위 대표 선출 + 가위바위보) 공용 순수 로직.
 * reversi/gomoku(1:1)와 yutnori/strategy-yutnori(팀전)에서 공유한다.
 * 방/소켓 상태 관리는 각 게임 파일이 갖고, 여기서는 판정 계산만 담당한다. */

export const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** 가위바위보 승자 판정. 비기면 null(재도전 필요). */
export function resolveRps(choiceA, choiceB) {
  if (!RPS_CHOICES.includes(choiceA) || !RPS_CHOICES.includes(choiceB)) return null;
  if (choiceA === choiceB) return null;
  return RPS_BEATS[choiceA] === choiceB ? 'a' : 'b';
}

/**
 * 팀(2인 이상) 내부에서 주사위로 대표 1명을 뽑는다. 동점이면 동점자끼리만 재굴림.
 * 팀원이 1명이면 굴릴 필요 없이 그 사람이 바로 대표.
 * 반환값의 rounds는 애니메이션용 굴림 기록 전체(재굴림 포함), winnerToken은 최종 대표.
 */
export function rollDiceOff(tokens, rng = Math.random) {
  if (tokens.length === 1) return { rounds: [], winnerToken: tokens[0] };

  const rounds = [];
  let candidates = tokens;
  for (let guard = 0; guard < 50; guard += 1) {
    const rolls = {};
    for (const token of candidates) rolls[token] = 1 + Math.floor(rng() * 6);
    rounds.push(rolls);
    const max = Math.max(...Object.values(rolls));
    const tied = candidates.filter((token) => rolls[token] === max);
    if (tied.length === 1) return { rounds, winnerToken: tied[0] };
    candidates = tied;
  }
  // 극히 드문 연속 동점 방지용 안전망(50회 굴려도 안 갈리면 첫 후보 확정)
  return { rounds, winnerToken: candidates[0] };
}
