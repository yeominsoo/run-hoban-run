import './hub.css';

interface GameEntry {
  slug: string;
  icon: string;
  name: string;
  desc: string;
}

const GAMES: GameEntry[] = [
  { slug: 'race', icon: 'race-mark', name: '말발광 레이스', desc: '최대 500명이 참여하는 3D 레이스 토너먼트. 헬기 탈락 이벤트와 스킬 연출 포함.' },
  { slug: 'team', icon: 'team-mark', name: '팀 랜덤 배분', desc: '참가자 명단을 원하는 수의 팀으로 무작위 배분. 같은 시드로 결과 재현 가능.' },
  { slug: 'dice', icon: 'dice-mark', name: '주사위 돌리기', desc: '2~20명이 함께 굴리는 주사위. 눈금은 참가자 수 × 10까지, 가장 높은 사람이 1등.' },
  { slug: 'rps', icon: 'rps-mark', name: '가위바위보 대결', desc: '방을 만들어 코드를 공유하면 친구와 실시간 1:1 대결. 승패가 쌓이는 스코어보드 포함.' },
  { slug: 'liar', icon: 'liar-mark', name: '라이어게임', desc: '3~12명이 참여하는 눈치게임. 라이어 혼자만 제시어를 모른 채 설명하고, 나머지는 투표로 라이어를 찾아낸다.' },
  { slug: 'mafia', icon: 'mafia-mark', name: '마피아게임', desc: '4~12명이 참여하는 역할 추리 게임. 밤에는 마피아·경찰·의사가 은밀히 행동하고, 낮에는 토론과 투표로 마피아를 찾아낸다.' },
  { slug: 'halligalli', icon: 'halligalli-mark', name: '할리갈리', desc: '2~6명이 참여하는 순발력 카드게임. 같은 과일이 5개가 되는 순간 누구보다 먼저 종을 쳐야 카드를 독식한다.' },
  { slug: 'yutnori', icon: 'yutnori-mark', name: '윷놀이', desc: '2~4명이 실시간으로 즐기는 3D 윷놀이. 업기·잡기·갈라치기·지름길까지 표준 규칙 그대로.' },
  { slug: 'strategy-yutnori', icon: 'strategy-yutnori-mark', name: '전략윷놀이', desc: '4명이 2:2로 겨루는 심리전 윷놀이. 앞면·뒷면을 비공개로 동시에 내 윷값을 정하고, 팀원마저 배신할 수 있다. &lt;더 지니어스&gt; 데스매치 변형.' },
  { slug: 'aim-trainer', icon: 'aim-trainer-mark', name: '에임 트레이너', desc: '30초 동안 화면에 나타나는 원을 최대한 빠르고 정확하게 탭! 레벨이 오를수록 원이 작아진다.' },
  { slug: 'color-slider', icon: 'color-slider-mark', name: '색 맞추기 슬라이더', desc: 'R/G/B 슬라이더로 목표 색을 최대한 똑같이 맞춰라. 10라운드, 라운드당 15초.' },
];

const app = document.getElementById('app')!;

app.innerHTML = `
  <div class="hub">
    <header class="hub-header">
      <h1 class="hub-title">Toris Arcade</h1>
      <p class="hub-sub">추첨게임모음</p>
    </header>
    <nav class="hub-grid" aria-label="게임 목록">
      ${GAMES.map(g => `
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
      </div>`).join('')}
    </nav>
  </div>
`;

const closeCard = (card: Element) => {
  const toggle = card.querySelector<HTMLButtonElement>('.game-card-toggle');
  const details = card.querySelector<HTMLElement>('.game-card-details');
  if (!toggle || !details) return;
  toggle.setAttribute('aria-expanded', 'false');
  details.hidden = true;
  card.classList.remove('expanded');
};

Array.from(app.querySelectorAll<HTMLButtonElement>('.game-card-toggle')).forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.game-card');
    if (!card) return;

    const details = card.querySelector<HTMLElement>('.game-card-details');
    if (!details) return;

    const expanded = btn.getAttribute('aria-expanded') === 'true';
    Array.from(app.querySelectorAll('.game-card.expanded')).forEach(closeCard);
    btn.setAttribute('aria-expanded', String(!expanded));
    details.hidden = expanded;
    card.classList.toggle('expanded', !expanded);
  });
});
