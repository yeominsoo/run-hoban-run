import './hub.css';
import { THEMES, loadTheme, saveTheme, type ThemeId } from '../../shared/theme';

type Category = 'single' | 'multi';

interface GameEntry {
  slug: string;
  icon: string;
  name: string;
  desc: string;
  category: Category;
}

const GAMES: GameEntry[] = [
  { slug: 'race', icon: 'race-mark', name: '말발광 레이스', desc: '최대 500명이 참여하는 3D 레이스 토너먼트. 헬기 탈락 이벤트와 스킬 연출 포함.', category: 'single' },
  { slug: 'team', icon: 'team-mark', name: '팀 랜덤 배분', desc: '참가자 명단을 원하는 수의 팀으로 무작위 배분. 같은 시드로 결과 재현 가능.', category: 'single' },
  { slug: 'dice', icon: 'dice-mark', name: '주사위 돌리기', desc: '2~20명이 함께 굴리는 주사위. 눈금은 참가자 수 × 10까지, 가장 높은 사람이 1등.', category: 'single' },
  { slug: 'aim-trainer', icon: 'aim-trainer-mark', name: '에임 트레이너', desc: '화면에 나타나는 원을 최대한 빠르고 정확하게 탭! 레벨이 오를수록 원이 작아진다.', category: 'single' },
  { slug: 'color-slider', icon: 'color-slider-mark', name: '색 맞추기 슬라이더', desc: 'R/G/B 슬라이더로 목표 색을 최대한 똑같이 맞춰라. 10라운드, 라운드당 15초.', category: 'single' },
  { slug: 'ball-dodge', icon: 'ball-dodge-mark', name: '볼 피하기 + 수집', desc: '드래그로 캐릭터를 움직여 빨간 볼은 피하고 초록 볼은 모으세요. HP 3, 30초마다 더 치열해진다.', category: 'single' },
  { slug: 'tower-stack', icon: 'tower-stack-mark', name: '타워 쌓기', desc: '좌우로 움직이는 블록을 탭해서 정확히 쌓아 올리세요. 삐져나온 부분은 잘려나가고, 너비가 10px 미만이면 게임 오버.', category: 'single' },
  { slug: 'snake', icon: 'snake-mark', name: '스네이크 비틀기', desc: '방향키·WASD·스와이프로 뱀을 조종해 먹이를 먹으세요. 벽이 없어 반대편으로 통과하고, 시간이 지날수록 빨라지며 색이 바뀝니다.', category: 'single' },
  { slug: 'typing-survival', icon: 'typing-survival-mark', name: '타이핑 생존', desc: '떨어지는 영어·한국어 단어를 바닥에 닿기 전에 타이핑하세요. HP 3, 10초마다 더 빠르고 많아집니다.', category: 'single' },
  { slug: '2048-hex', icon: 'hex2048-mark', name: '2048 변형(육각형)', desc: '육각형 격자에서 같은 숫자 타일을 밀어 합쳐 2048을 만들어보세요. 키보드 6방향 또는 스와이프로 조작.', category: 'single' },
  { slug: 'endless-runner', icon: 'endless-runner-mark', name: '무한 러너', desc: '탭=점프, 아래 스와이프=슬라이드! 장애물과 구덩이를 피해 최대한 멀리 달려 코인을 모으세요.', category: 'single' },
  { slug: 'idle-farm', icon: 'idle-farm-mark', name: '방치형 농장', desc: '씨앗을 심고 기다렸다가 수확! 업그레이드로 수확량과 성장 속도를 올리고, 자동 수확기로 방치 수익도 챙기세요.', category: 'single' },
  { slug: 'rps', icon: 'rps-mark', name: '가위바위보 대결', desc: '방을 만들어 코드를 공유하면 친구와 실시간 1:1 대결. 승패가 쌓이는 스코어보드 포함.', category: 'multi' },
  { slug: 'liar', icon: 'liar-mark', name: '라이어게임', desc: '3~12명이 참여하는 눈치게임. 라이어 혼자만 제시어를 모른 채 설명하고, 나머지는 투표로 라이어를 찾아낸다.', category: 'multi' },
  { slug: 'mafia', icon: 'mafia-mark', name: '마피아게임', desc: '4~12명이 참여하는 역할 추리 게임. 밤에는 마피아·경찰·의사가 은밀히 행동하고, 낮에는 토론과 투표로 마피아를 찾아낸다.', category: 'multi' },
  { slug: 'halligalli', icon: 'halligalli-mark', name: '할리갈리', desc: '2~6명이 참여하는 순발력 카드게임. 같은 과일이 5개가 되는 순간 누구보다 먼저 종을 쳐야 카드를 독식한다.', category: 'multi' },
  { slug: 'yutnori', icon: 'yutnori-mark', name: '윷놀이', desc: '2~4명이 실시간으로 즐기는 3D 윷놀이. 업기·잡기·갈라치기·지름길까지 표준 규칙 그대로.', category: 'multi' },
  { slug: 'strategy-yutnori', icon: 'strategy-yutnori-mark', name: '전략윷놀이', desc: '4명이 2:2로 겨루는 심리전 윷놀이. 앞면·뒷면을 비공개로 동시에 내 윷값을 정하고, 팀원마저 배신할 수 있다. &lt;더 지니어스&gt; 데스매치 변형.', category: 'multi' },
  { slug: 'mole-hunt', icon: 'mole-hunt-mark', name: '두더지 사냥', desc: '2~8명이 실시간으로 겨루는 반응속도 게임. 구멍에서 튀어나오는 두더지를 누구보다 먼저 탭! 30초간 최다 명중자가 승리한다.', category: 'multi' },
  { slug: 'memory-sequence', icon: 'memory-sequence-mark', name: '순서 기억 챌린지', desc: '2~8명이 함께 도전하는 기억력 서바이벌. 타일이 켜지는 순서를 그대로 따라 탭하세요, 라운드마다 한 칸씩 길어지고 마지막까지 살아남으면 승리!', category: 'multi' },
  { slug: 'updown-number', icon: 'updown-number-mark', name: '업다운 넘버', desc: '2~8명이 함께 추리하는 숫자 맞히기. 모두에게 같은 숨은 숫자가 주어지고, UP/DOWN 힌트로 가장 먼저 맞히는 사람이 1등!', category: 'multi' },
  { slug: 'multiplication-sprint', icon: 'multiplication-sprint-mark', name: '구구단 스퍼트', desc: '2~8명이 겨루는 암산 속도전. 모두에게 똑같은 구구단 문제가 동시에 나오고, 제한시간 안에 가장 많이·빠르게 맞힌 사람이 1등!', category: 'multi' }
];

const CATEGORY_LABEL: Record<Category, string> = {
  single: '싱글플레이',
  multi: '멀티플레이'
};

const app = document.getElementById('app')!;

app.innerHTML = `
  <div class="hub">
    <header class="hub-header">
      <div class="hub-header-spacer" aria-hidden="true"></div>
      <div class="hub-header-titles">
        <h1 class="hub-title">Toris Arcade</h1>
        <p class="hub-sub">추첨게임모음</p>
      </div>
      <button class="hub-theme-btn" id="hub-theme-btn" type="button" aria-label="테마 설정">
        <span class="hub-theme-btn-icon" aria-hidden="true">
          <span class="hub-theme-dot hub-theme-dot-a"></span>
          <span class="hub-theme-dot hub-theme-dot-b"></span>
          <span class="hub-theme-dot hub-theme-dot-c"></span>
        </span>
      </button>
    </header>

    <nav class="hub-categories" id="hub-categories" aria-label="게임 카테고리">
      <button class="category-card" data-category="single" type="button">
        <span class="category-icon category-icon-single" aria-hidden="true"></span>
        <span class="category-name">싱글플레이</span>
        <span class="category-count">${GAMES.filter((g) => g.category === 'single').length}종 · 혼자 또는 다같이 진행</span>
      </button>
      <button class="category-card" data-category="multi" type="button">
        <span class="category-icon category-icon-multi" aria-hidden="true"></span>
        <span class="category-name">멀티플레이</span>
        <span class="category-count">${GAMES.filter((g) => g.category === 'multi').length}종 · 실시간 온라인 대전</span>
      </button>
    </nav>

    <div class="hub-game-list hidden" id="hub-game-list">
      <button class="hub-back-btn" id="hub-back-btn" type="button">← 카테고리로</button>
      <h2 class="hub-list-title" id="hub-list-title"></h2>
      <nav class="hub-grid" id="hub-grid" aria-label="게임 목록"></nav>
    </div>

    <div class="theme-overlay hidden" id="theme-overlay">
      <div class="theme-overlay-card">
        <h2>테마 선택</h2>
        <p>사이트 전체에 적용돼요. 원하는 분위기를 골라보세요.</p>
        <div class="theme-option-list" id="theme-option-list"></div>
        <button class="hub-back-btn" id="theme-close-btn" type="button">닫기</button>
      </div>
    </div>
  </div>
`;

const categoriesNav = document.getElementById('hub-categories')!;
const gameListSection = document.getElementById('hub-game-list')!;
const gameListTitle = document.getElementById('hub-list-title')!;
const gameGrid = document.getElementById('hub-grid')!;
const backBtn = document.getElementById('hub-back-btn') as HTMLButtonElement;
const themeBtn = document.getElementById('hub-theme-btn') as HTMLButtonElement;
const themeOverlay = document.getElementById('theme-overlay')!;
const themeOptionList = document.getElementById('theme-option-list')!;
const themeCloseBtn = document.getElementById('theme-close-btn') as HTMLButtonElement;

function cardHtml(g: GameEntry): string {
  return `
    <div class="game-card" data-slug="${g.slug}">
      <button class="game-card-toggle" type="button" aria-expanded="false" aria-controls="details-${g.slug}">
        <span class="game-card-icon ${g.icon}" aria-hidden="true"></span>
        <span class="game-card-name">${g.name}</span>
        <span class="game-card-chevron" aria-hidden="true"></span>
      </button>
      <div class="game-card-details" id="details-${g.slug}" hidden>
        <p class="game-card-desc">${g.desc}</p>
        <a class="game-card-start-btn" href="/${g.slug}/">시작하기</a>
      </div>
    </div>`;
}

function closeCard(card: Element) {
  const toggle = card.querySelector<HTMLButtonElement>('.game-card-toggle');
  const details = card.querySelector<HTMLElement>('.game-card-details');
  if (!toggle || !details) return;
  toggle.setAttribute('aria-expanded', 'false');
  details.hidden = true;
  card.classList.remove('expanded');
}

function bindCardToggles() {
  Array.from(gameGrid.querySelectorAll<HTMLButtonElement>('.game-card-toggle')).forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.game-card');
      if (!card) return;
      const details = card.querySelector<HTMLElement>('.game-card-details');
      if (!details) return;

      const expanded = btn.getAttribute('aria-expanded') === 'true';
      Array.from(gameGrid.querySelectorAll('.game-card.expanded')).forEach(closeCard);
      btn.setAttribute('aria-expanded', String(!expanded));
      details.hidden = expanded;
      card.classList.toggle('expanded', !expanded);
    });
  });
}

function openCategory(category: Category) {
  gameListTitle.textContent = CATEGORY_LABEL[category];
  gameGrid.innerHTML = GAMES.filter((g) => g.category === category).map(cardHtml).join('');
  bindCardToggles();
  categoriesNav.classList.add('hidden');
  gameListSection.classList.remove('hidden');
}

function closeCategory() {
  gameListSection.classList.add('hidden');
  categoriesNav.classList.remove('hidden');
}

Array.from(categoriesNav.querySelectorAll<HTMLButtonElement>('.category-card')).forEach((btn) => {
  btn.addEventListener('click', () => {
    const category = btn.dataset.category as Category;
    openCategory(category);
  });
});

backBtn.addEventListener('click', closeCategory);

// ── 테마 선택 ──────────────────────────────
const THEME_SWATCHES: Record<ThemeId, [string, string, string]> = {
  cloud: ['#ff6f91', '#5ecfbc', '#ffc857'],
  casino: ['#0e2a1c', '#c9a227', '#1f8f5f'],
  girlish: ['#ff5ca8', '#c9a8ff', '#ffb6d9'],
  cyberpunk: ['#0a0e27', '#f724c9', '#00e5f0']
};

function renderThemeOptions() {
  const current = loadTheme();
  themeOptionList.innerHTML = THEMES.map((t) => {
    const [a, b, c] = THEME_SWATCHES[t.id];
    return `
      <button class="theme-option${t.id === current ? ' selected' : ''}" type="button" data-theme-id="${t.id}">
        <span class="theme-option-swatch" style="background: linear-gradient(135deg, ${a}, ${b} 55%, ${c});"></span>
        <span class="theme-option-text">
          <span class="theme-option-name">${t.name}</span>
          <span class="theme-option-desc">${t.desc}</span>
        </span>
        <span class="theme-option-check" aria-hidden="true">${t.id === current ? '✓' : ''}</span>
      </button>`;
  }).join('');

  themeOptionList.querySelectorAll<HTMLButtonElement>('.theme-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.themeId as ThemeId;
      saveTheme(id);
      renderThemeOptions();
    });
  });
}

themeBtn.addEventListener('click', () => {
  renderThemeOptions();
  themeOverlay.classList.remove('hidden');
});
themeCloseBtn.addEventListener('click', () => themeOverlay.classList.add('hidden'));
