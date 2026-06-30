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
    </nav>
  </div>
`;
