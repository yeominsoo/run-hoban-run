# WS 로비 "플레이팁 + 시작 카운트다운" 공용 패턴 (2026-07-16)

## 배경

사용자가 순서 기억 챌린지(memory-sequence)를 실제로 플레이해보고 "접속 직후 순서가
시작되면서 화면이 가려지는 부분은 보이지도 않고, 플레이 팁이 없어서 어떻게 하는지도
모르겠다"는 피드백을 줬다. 원인을 보니 두 가지였다:

1. **호스트가 "게임 시작"을 누르면 서버가 곧바로 1라운드를 진행**했다. `game_starting` →
   `startGame()`이 동기 호출이라 유예 시간이 없고, 1라운드 첫 타일까지의 `REVEAL_LEAD_MS`도
   700ms뿐이라 처음 해보는 사람은 화면 전환에 눈이 적응하기도 전에 첫 타일을 놓친다.
   같은 계열인 두더지 사냥은 `COUNTDOWN_MS = 3000`짜리 "3, 2, 1" 카운트다운을 이미
   갖고 있었는데, 순서 기억 챌린지는 이 단계 자체가 빠져 있었다.
2. **로비 화면에 룰 설명이 사실상 없었다.** 제목 아래 한 줄짜리 서브타이틀(`ms-sub`)이
   전부였고, "게임 시작" 버튼 바로 옆에서 규칙을 읽을 수 있는 곳이 없었다.

v1 유래 솔로 게임 10종(에임 트레이너~방치형 농장)은 이미 `start-overlay`에 규칙 문단 +
"시작하기" 버튼을 같이 보여주는 패턴을 갖고 있어 문제가 없었다(템플릿을 그대로 복붙해온
결과). 예외는 **방치형 농장**으로, 상시 진행형(idle) 게임이라 애초에 "시작" 시점이 없어
템플릿이 적용된 적이 없었다 — 첫 방문 시에만 뜨는 튜토리얼 오버레이(`intro-overlay`,
`rhh_idle-farm_tutorial_seen` 플래그로 1회만 노출)를 별도로 추가해 맞췄다.

## 확정한 패턴 — 앞으로 만들 WS 게임(업다운 넘버부터) 전부 적용

### 1. 로비에 "게임 방법" 팁 카드

`src/shared/ws-lobby-tip.css`의 `.how-to-play` / `.how-to-play-title` / `.how-to-play-list`를
가져다 쓴다. 위치는 **로비 패널의 `lobby-players` 아래, `게임 시작` 버튼 위** — 호스트도
누르기 전에 읽고, 참가자도 기다리는 동안 읽는다. 마크업 예시:

```html
<div class="how-to-play">
  <p class="how-to-play-title">🎮 게임 방법</p>
  <ul class="how-to-play-list">
    <li>...</li>
    <li>...</li>
  </ul>
</div>
```

### 2. "게임 시작" 클릭 후 3초 카운트다운(1라운드 한정)

서버: `COUNTDOWN_MS = 3000` 상수 + `startCountdown(roomCode)` 함수를 두고, `start` 메시지
핸들러가 `startGame()`을 직접 부르지 않고 `startCountdown()`을 부르게 한다.
`startCountdown`은 `{ type: 'game_starting', countdownMs: COUNTDOWN_MS }`를 브로드캐스트한
뒤 `setTimeout(() => startGame(roomCode), COUNTDOWN_MS)`로 실제 게임 시작을 미룬다.
`room.countdownTimer`를 두고 `clearRoundTimers()`에서 같이 정리해야 한다(방 파괴/재시작
시 누수 방지).

클라이언트: `Phase`에 `'countdown'` 추가, `countdown-panel`(카운트다운 숫자는
`.ws-countdown-number` 공용 클래스) 추가, `game_starting` 핸들러에서
`setInterval`로 숫자를 1초마다 감소시키며 표시. 재연결 판정용 `inGame` 배열에도
`'countdown'`을 포함시킨다.

두더지 사냥(mole-hunt)이 이미 이 패턴의 원본이었다 — 새 WS 게임은 매번 새로 설계하지 말고
mole-hunt/memory-sequence 코드를 템플릿으로 그대로 복붙해서 시작할 것.

### 3. 라운드 2 이후는 700ms~짧은 리드타임 유지

한 번 게임 규칙을 겪은 플레이어에게는 매 라운드 3초씩 기다리게 하는 게 오히려 템포를
해친다. 카운트다운은 **최초 게임 시작 시 1회만** 적용하고, 라운드 사이 전환(예:
`ROUND_ADVANCE_DELAY_MS`)은 게임별로 이미 있던 값을 그대로 둔다.

## 모바일 세로화면 확인

Playwright로 390×844(모바일 세로) 뷰포트에서 두더지 사냥·순서 기억 챌린지·방치형 농장
로비/카운트다운/플레이 화면을 스크린샷 확인 — 팁 카드, 카운트다운 숫자, 채팅 FAB(우하단
고정 원형 버튼) 모두 겹침 없이 정상 렌더링됨을 확인했다.
