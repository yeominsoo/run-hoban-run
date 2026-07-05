import './hub.css';

const app = document.getElementById('app')!;

app.innerHTML = `
  <div class="hub">
    <header class="hub-header">
      <h1 class="hub-title">Toris Arcade</h1>
      <p class="hub-sub">추첨게임모음</p>
    </header>
    <nav class="hub-grid" aria-label="게임 목록">
      <a class="game-card" href="/race/">
        <span class="game-card-icon race-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">말발광 레이스</h2>
        <p class="game-card-desc">최대 500명이 참여하는 3D 레이스 토너먼트. 헬기 탈락 이벤트와 스킬 연출 포함.</p>
      </a>
      <a class="game-card" href="/team/">
        <span class="game-card-icon team-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">팀 랜덤 배분</h2>
        <p class="game-card-desc">참가자 명단을 원하는 수의 팀으로 무작위 배분. 같은 시드로 결과 재현 가능.</p>
      </a>
      <a class="game-card" href="/dice/">
        <span class="game-card-icon dice-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">주사위 돌리기</h2>
        <p class="game-card-desc">2~20명이 함께 굴리는 주사위. 눈금은 참가자 수 × 10까지, 가장 높은 사람이 1등.</p>
      </a>
      <a class="game-card" href="/rps/">
        <span class="game-card-icon rps-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">가위바위보 대결</h2>
        <p class="game-card-desc">방을 만들어 코드를 공유하면 친구와 실시간 1:1 대결. 승패가 쌓이는 스코어보드 포함.</p>
      </a>
      <a class="game-card" href="/liar/">
        <span class="game-card-icon liar-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">라이어게임</h2>
        <p class="game-card-desc">3~12명이 참여하는 눈치게임. 라이어 혼자만 제시어를 모른 채 설명하고, 나머지는 투표로 라이어를 찾아낸다.</p>
      </a>
      <a class="game-card" href="/mafia/">
        <span class="game-card-icon mafia-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">마피아게임</h2>
        <p class="game-card-desc">4~12명이 참여하는 역할 추리 게임. 밤에는 마피아·경찰·의사가 은밀히 행동하고, 낮에는 토론과 투표로 마피아를 찾아낸다.</p>
      </a>
      <a class="game-card" href="/halligalli/">
        <span class="game-card-icon halligalli-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">할리갈리</h2>
        <p class="game-card-desc">2~6명이 참여하는 순발력 카드게임. 같은 과일이 5개가 되는 순간 누구보다 먼저 종을 쳐야 카드를 독식한다.</p>
      </a>
      <a class="game-card" href="/yutnori/">
        <span class="game-card-icon yutnori-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">윷놀이</h2>
        <p class="game-card-desc">2~4명이 실시간으로 즐기는 3D 윷놀이. 업기·잡기·갈라치기·지름길까지 표준 규칙 그대로.</p>
      </a>
      <a class="game-card" href="/strategy-yutnori/">
        <span class="game-card-icon strategy-yutnori-mark" aria-hidden="true"></span>
        <h2 class="game-card-name">전략윷놀이</h2>
        <p class="game-card-desc">4명이 2:2로 겨루는 심리전 윷놀이. 앞면·뒷면을 비공개로 동시에 내 윷값을 정하고, 팀원마저 배신할 수 있다. &lt;더 지니어스&gt; 데스매치 변형.</p>
      </a>
    </nav>
  </div>
`;
