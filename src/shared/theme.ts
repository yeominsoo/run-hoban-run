export type ThemeId = 'cloud' | 'casino' | 'girlish' | 'cyberpunk';

const STORAGE_KEY = 'rhh_theme';
const DEFAULT_THEME: ThemeId = 'cloud';
const THEME_IDS: ThemeId[] = ['cloud', 'casino', 'girlish', 'cyberpunk'];

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
}

export const THEMES: ThemeDef[] = [
  { id: 'cloud', name: '구름구름해', desc: '하늘색과 흰색이 어우러진 밝고 산뜻한 느낌' },
  { id: 'casino', name: '카지노', desc: '초록 펠트와 골드가 어우러진 묵직한 분위기' },
  { id: 'girlish', name: '소녀감성', desc: '핑크와 라벤더가 가득한 사랑스러운 느낌' },
  { id: 'cyberpunk', name: '사이버펑크', desc: '네온 마젠타와 시안이 빛나는 어두운 미래 도시' }
];

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && (THEME_IDS as string[]).includes(value);
}

export function loadTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemeId(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** localStorage에 저장하고 즉시 <html data-theme>에 반영한다(허브에서 실시간 미리보기용). */
export function saveTheme(theme: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage 접근 불가 환경(사파리 프라이빗 모드 등)에서도 이번 세션 동안은
    // <html data-theme>만으로 화면에 정상 반영되도록 저장 실패를 무시한다.
  }
  document.documentElement.dataset.theme = theme;
}

/**
 * 각 게임 페이지 진입 시 1회 호출. index.html에 이미 동일한 로직의 인라인 스크립트가
 * <head> 맨 앞에서 먼저 실행되어(FOUC 방지) data-theme를 세팅해두지만, 이 함수는 그
 * 인라인 스크립트가 없는 컨텍스트(예: 테스트)에서도 안전하게 같은 결과를 보장한다.
 */
export function applyStoredTheme() {
  document.documentElement.dataset.theme = loadTheme();
}
