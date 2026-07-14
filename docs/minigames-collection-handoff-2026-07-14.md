# 미니게임 모음집 확장 — 인수인계 문서 (2026-07-14)

## 배경

`docs/game-collection-plan-v2-2026-07-13.md`(현재 아키텍처 기준 계획서, v1은
`docs/game-collection-plan-2026-07-13.md`)에 따라 v1 유래 솔로 미니게임 10종을 순서대로
구현 중이다. 진행 중 사용자가 몇 가지 추가 요구사항(싱글 게임 랭킹, 허브 재구성, 타이핑
생존 사전 확장 등)을 얹었고, 전부 반영·배포까지 완료했다.

## 현재 진행 상황 (Phase 1~3, 계획서의 "개발 단계" 섹션 참고)

| # | 게임 | 상태 |
|---|---|---|
| 1 | 에임 트레이너 | ✅ 완료 |
| 2 | 색 맞추기 슬라이더 | ✅ 완료 |
| 3 | 볼 피하기 + 수집 | ✅ 완료 |
| 4 | 타워 쌓기 | ✅ 완료 |
| 5 | 스네이크 비틀기 | ✅ 완료 (Phase 1 종료) |
| 6 | 타이핑 생존 | ✅ 완료 |
| 7 | 2048 변형(육각형) | ✅ 완료 (Phase 2 절반) |
| 8 | **무한 러너** | ⬜ **다음 작업** |
| 9 | 방치형 농장 | ⬜ 대기 |
| 10 | 핀볼 로그라이크 | ⬜ 대기 (Phase 3) |

완료된 7종은 전부 `docs/<game>-implementation-notes-2026-07-13.md` 문서에 v1 스펙에 없던
수치·설계 결정과 근거가 정리돼 있다. 새 게임을 시작하기 전에 비슷한 장르의 기존 노트를
훑어보면 이 저장소의 "수치를 정하는 방식"(스펙에 없으면 근거를 대고 직접 정하되 반드시
문서화) 감을 잡을 수 있다.

## 세션 중 추가된 요구사항 (전부 반영·배포 완료)

1. **싱글 게임 랭킹/닉네임 시스템** (`src/shared/leaderboard.ts`,
   `src/shared/game-shell.css`) — 결과 화면에서 닉네임 입력 후 "기록 저장"(로컬
   `localStorage` 상위 20개), 마지막 닉네임은 게임 간 공유, 시작 화면에 "랭킹보기" 버튼,
   랭킹 목록도 이미지로 저장/공유 가능(Web Share API). **완료된 7개 게임 전부 이미 적용됨.**
   앞으로 만들 3개 게임(무한 러너·방치형 농장·핀볼 로그라이크)도 처음부터 이 패턴을
   포함해서 만들어야 한다 — 아래 "새 게임에 랭킹 UI 넣는 법" 참고.
2. **허브 재구성** (`src/pages/hub/`) — 게임이 16종으로 늘어 목록이 복잡해졌다는 피드백으로
   싱글플레이(10종)/멀티플레이(6종) 카테고리 선택 화면으로 분리. 새 게임을 추가할 때
   `src/pages/hub/main.ts`의 `GAMES` 배열에 `category: 'single'` 항목만 추가하면 자동으로
   반영된다.
3. **에임 트레이너 개선**: 타이머가 "시작하기" 클릭이 아니라 첫 탭(명중/미스 무관)부터
   시작하도록 변경, 결과 이미지 저장/공유 버튼 추가.
4. **타이핑 생존**: 모바일 소프트 키보드가 뜨면 문서 전체가 스크롤돼 상단이 안 보이던 버그
   수정(`body { position: fixed }` + `visualViewport` 동기화). 단어 목록을 오픈소스
   국어사전(hunspell-ko)·영어사전(SCOWL)에서 2글자 이상 전부 추출(한국어 98,703개, 영어
   52,383개)해 `words-ko.json`/`words-en.json`으로 교체, 모바일은 접속 로캘 기준 언어
   자동 선택으로 변경.

## 새 게임에 랭킹 UI 넣는 법 (무한 러너부터 적용)

완료된 7개 게임 중 아무거나(`src/pages/tower-stack/main.ts`가 비교적 짧아 참고하기 좋다)
템플릿으로 삼는다. 체크리스트:

1. **HTML**: 시작 오버레이에 `<button id="view-ranking-btn" class="ghost-btn">랭킹보기</button>`
   추가. 결과 오버레이의 record-badge 아래에 닉네임 입력 폼(`#rank-entry-form`,
   `#rank-name-input`, `#rank-save-btn`, `#rank-saved-msg`) 추가. 게임-스테이지 안에
   `#ranking-overlay`(목록 `#ranking-list` + 이미지 저장/공유 버튼 + 닫기 버튼) 추가.
   완료된 게임의 main.ts에서 그대로 복붙 후 텍스트만 바꾸면 된다.
2. **JS**: `import { setupRankingUI, resetRankingSubmission } from '../../shared/leaderboard'`
   추가. 새 DOM ref 10개(rankNameInput, rankSaveBtn, rankSavedMsg, viewRankingBtn,
   rankingOverlay, rankingList, closeRankingBtn, rankingSaveImageBtn, rankingShareImageBtn)
   추가. 초기화 시점에 `setupRankingUI({ gameSlug, gameTitle, ...refs }, () => score)` 호출.
   `endGame()` 안에서 결과 오버레이를 보여주기 직전에
   `resetRankingSubmission({ nameInput, saveBtn, savedMsg })` 호출.
3. **CSS**: 파일 맨 위에 `@import "../../shared/game-shell.css";` 추가하고, 기존에 복붙돼
   있던 `.game-header`/`.back-link`/`.game-title`/`.best-score`/`.overlay`/`.overlay-card`/
   `.primary-btn`/`.result-score`/`.record-badge` 블록은 전부 삭제(공용 파일에 이미 있음).
   게임 고유 스타일(`.game-stage`, `.hud` 등)만 남긴다.
4. **테스트**: `tests/render.spec.ts`에 이미 있는
   `verifyRankingSaveAndView(page, gamePath, name?)` 공용 헬퍼를 재사용 — 결과 화면
   도달까지만 게임별로 다르게 작성하고, 그 다음은 `await verifyRankingSaveAndView(page, '/<game>/');`
   한 줄로 끝난다.

## 알아두면 좋은 함정들 (테스트 작성 시)

- **레이스 컨디션**: 실시간 애니메이션을 정확한 타이밍에 조작하는 테스트는 "상태 확인"과
  "액션 실행"을 반드시 같은 `page.evaluate()` 안에서 처리해야 한다. Node 쪽에서 두 단계로
  나누면 그 사이 애니메이션이 진행돼 어긋난다(`tower-stack` 테스트에서 실제로 겪음).
- **게임 로직의 조건부 규칙은 테스트 입력도 그 규칙을 피해가야 함**: 예를 들어 스네이크의
  "반대 방향 입력 무시" 규칙 때문에, 고정된 키 시퀀스로 자기 충돌을 유도하면 간헐적으로
  실패한다. 게임의 실제 현재 상태(`data-*` 속성으로 노출)를 읽어서 그 상태 기준으로 다음
  입력을 계산해야 결정론적이다.
- **테스트 전용 상태 노출은 값이 바뀌는 즉시 갱신**: 렌더 루프 맨 끝에서만 `data-*` 속성을
  갱신하면, 게임오버처럼 함수가 중간에 `return`해버리는 프레임에서 그 프레임의 최종 상태가
  누락될 수 있다(`ball-dodge`에서 실제로 겪음). 상태가 바뀌는 그 지점에서 바로 반영할 것.

## 다음 작업

1. **무한 러너(endless-runner)** — v1 스펙: 탭/클릭=점프, 스와이프다운/빠른 탭2=슬라이드,
   속도 지속 상승, 코인 수집 +10점, 낮은 장애물(점프)/높은 장애물(슬라이드)/구덩이(타이밍
   점프), 점수 = 달린 거리(1m=1점) + 코인. Canvas 사용. 상세 스펙은
   `docs/game-collection-plan-v2-2026-07-13.md`의 "게임별 명세" 표 참고.
2. 방치형 농장(idle-farm) — localStorage 지속 상태 + 오프라인 수익 계산이 핵심.
3. 핀볼 로그라이크(pinball-rogue) — 자체 원형 충돌 물리가 핵심 난관, Phase 3 마지막.
4. 위 3개 완료 후 `docs/game-collection-plan-v2-2026-07-13.md`의 상태 표 갱신 + Task #10
   "Phase 1-3 완료 후 상태 재점검".
5. Task #13 — 멀티게임 6종(rps/liar/mafia/halligalli/yutnori/strategy-yutnori) 승패+점수
   누적 기록. **주의**: 이건 프로덕션 `ws-server/`(실사용자가 접속 중인 WebSocket 서버)를
   건드리는 작업이라 `ws-server/README.md`와
   `docs/party-games-handoff-2026-07-03.md`의 "새 WS 게임 추가 절차"를 먼저 읽고, WAS
   배포(58.228.188.17)까지 필요하면 SSH 접근 가능 여부부터 확인할 것.

## 작업 방식 관련 사용자 지시 (계속 적용할 것)

- 별다른 확정/결정이 필요 없는 부분은 추천안으로 바로 진행하되, 어떤 선택지에서 어떤
  이유로 그 방식을 골랐는지 `docs/<game>-implementation-notes-*.md`에 문서화.
- 매 게임마다: 구현 → 타입체크(`npx tsc --noEmit`) → 실제 브라우저 상호작용으로 시각 확인
  (Playwright 스크린샷) → Playwright 테스트 작성·통과 → `npm run build` → 계획서 상태
  갱신 → 커밋 → `git fetch` 후 필요하면 `rebase`(CI가 배포 리비전 커밋을 자동으로 얹으므로)
  → push. 이 사이클을 반복.
- 커밋·푸시는 매 게임 완료 시마다 진행(사용자가 별도로 확인 요청한 적 없음, 지금까지
  계속 이렇게 진행해왔고 문제없었음).
