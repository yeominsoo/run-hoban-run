export type Choice = 'rock' | 'paper' | 'scissors';

const SKIN_FILL = '#f2c9a0';
const SKIN_STROKE = '#8a5a34';

const BADGE_COLORS: Record<Choice, string> = {
  rock: 'rgba(147,164,187,0.22)',
  paper: 'rgba(126,200,248,0.22)',
  scissors: 'rgba(255,207,126,0.22)',
};

function palm(): string {
  return `<rect x="14" y="26" width="36" height="28" rx="13" fill="${SKIN_FILL}" stroke="${SKIN_STROKE}" stroke-width="2" />`;
}

function thumb(): string {
  return `<rect x="4" y="28" width="16" height="13" rx="6" transform="rotate(-20 12 34)" fill="${SKIN_FILL}" stroke="${SKIN_STROKE}" stroke-width="2" />`;
}

function finger(x: number, y: number, h: number, rotate?: string): string {
  const transform = rotate ? ` transform="rotate(${rotate})"` : '';
  return `<rect x="${x}" y="${y}" width="7" height="${h}" rx="3.5" fill="${SKIN_FILL}" stroke="${SKIN_STROKE}" stroke-width="2"${transform} />`;
}

function handBody(choice: Choice): string {
  if (choice === 'paper') {
    return [finger(17, 2, 26), finger(26, 1, 27), finger(35, 1, 27), finger(44, 2, 26), palm(), thumb()].join('');
  }
  if (choice === 'scissors') {
    const curledStub = `<rect x="16" y="20" width="16" height="8" rx="4" fill="${SKIN_FILL}" stroke="${SKIN_STROKE}" stroke-width="2" />`;
    return [
      finger(21, 2, 28, '-15 24.5 28'),
      finger(32, 0, 30, '12 35.5 28'),
      palm(),
      curledStub,
      thumb(),
    ].join('');
  }
  // rock
  const knuckleRidge = `<rect x="16" y="18" width="32" height="12" rx="6" fill="${SKIN_FILL}" stroke="${SKIN_STROKE}" stroke-width="2" />`;
  return [palm(), knuckleRidge, thumb()].join('');
}

export function handIcon(choice: Choice, withBadge = false): string {
  const body = handBody(choice);
  const badge = withBadge
    ? `<circle cx="32" cy="32" r="30" fill="${BADGE_COLORS[choice]}" />`
    : '';
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${badge}${body}</svg>`;
}

export function hiddenHandIcon(): string {
  return `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="10" y="10" width="44" height="44" rx="12" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
      <text x="32" y="40" text-anchor="middle" font-size="24" font-weight="900" fill="rgba(232,244,255,0.45)">?</text>
    </svg>
  `;
}

export const CHOICE_LABEL: Record<Choice, string> = {
  rock: '바위',
  paper: '보',
  scissors: '가위',
};
