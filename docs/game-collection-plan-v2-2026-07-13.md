# 게임 모음집 확장 계획서 v2 (현재 아키텍처 기준)

> 이 문서는 `docs/game-collection-plan-2026-07-13.md`(v1, Vanilla JS + Canvas 단일 허브
> 전제)를 **현재 저장소의 실제 아키텍처**(Vite + TypeScript, 멀티페이지 + 기존 허브)에 맞게
> 다시 짠 버전이다. 게임 아이디어와 각 게임의 룰 명세는 v1과 동일하게 유지하고, 허브 구조·
> 페이지 추가 절차·공용 자원·협업 규칙만 실제 코드베이스에 맞춰 새로 썼다.

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [현재 상태와 달라지는 점](#현재-상태와-달라지는-점)
3. [디렉터리 구조](#디렉터리-구조)
4. [공통 시스템](#공통-시스템)
5. [게임별 명세](#게임별-명세)
6. [새 게임 페이지 추가 절차](#새-게임-페이지-추가-절차)
7. [개발 단계](#개발-단계)
8. [모바일 대응](#모바일-대응)
9. [보류 항목 — Google Play 출품](#보류-항목--google-play-출품)
10. [세션 간 협업 규칙](#세션-간-협업-규칙)

---

## 프로젝트 개요

- **프로젝트명**: run-hoban-run(허브 타이틀 `Toris Arcade`) 게임 모음집 확장
- **목표**: 기존 9종 행사/파티 게임(경마 추첨·팀배분·주사위·가위바위보·라이어게임·마피아게임·
  할리갈리·윷놀이·전략윷놀이)에 이어, 짧게 즐기는 **솔로 미니게임 10종**을 허브에 추가
- **기술 스택**: Vite + TypeScript + 순수 DOM / Canvas API (React 미도입, 외부 게임 라이브러리
  미도입 — 기존 규칙 그대로 유지). Three.js는 이미 프로젝트 의존성에 있지만 이번 미니게임들은
  전부 2D이므로 사용하지 않는다.
- **배포**: 기존과 동일한 Firebase Hosting 파이프라인(`npm run deploy:firebase`), 신규 WAS/
  WebSocket 인프라 불필요
- **작성일**: 2026-07-13 (v1 대체)

### 포함 게임 (신규 10종, 기존 9종은 이미 완성)

| # | 게임 | 난이도 | 상태 |
|---|------|--------|------|
| - | 경마 추첨 / 팀배분 / 주사위 / 가위바위보 / 라이어게임 / 마피아게임 / 할리갈리 / 윷놀이 / 전략윷놀이 | - | ✅ 기존 완성 (9종) |
| 1 | 에임 트레이너 | 쉬움 | ⬜ 미개발 |
| 2 | 색 맞추기 슬라이더 | 쉬움 | ⬜ 미개발 |
| 3 | 볼 피하기 + 수집 | 쉬움 | ⬜ 미개발 |
| 4 | 타워 쌓기 | 쉬움 | ⬜ 미개발 |
| 5 | 스네이크 비틀기 | 쉬움 | ⬜ 미개발 |
| 6 | 타이핑 생존 | 중간 | ⬜ 미개발 |
| 7 | 2048 변형 (육각형) | 중간 | ⬜ 미개발 |
| 8 | 무한 러너 | 중간 | ⬜ 미개발 |
| 9 | 방치형 농장 | 중간 | ⬜ 미개발 |
| 10 | 핀볼 로그라이크 | 어려움 | ⬜ 미개발 |

---

## 현재 상태와 달라지는 점

v1은 "허브를 새로 만든다"는 전제였지만, 실제로는 이미 `src/pages/hub/main.ts`에 게임 카드
배열(`GAMES`)과 `hub.css` 아이콘 체계가 있고 9개 게임이 등록되어 있다. 따라서:

- **허브를 새로 만들 필요 없음.** `GAMES` 배열에 항목 10개를 추가하고 `hub.css`에 아이콘
  클래스(`.aim-trainer-mark` 등)만 추가하면 된다.
- **모든 신규 게임은 로컬 단일 플레이**로 설계한다 (기존 `race`/`team`/`dice`와 같은 계열).
  실시간 대전이 필요 없으므로 `ws-server/`, `.env`의 `VITE_*_WS_URL`, 배포 매니페스트의 WS
  env 추가가 전부 불필요하다 — v1에는 없던 제약이지만, 현재 저장소의 `rps`/`liar`/`mafia`/
  `halligalli`/`yutnori`/`strategy-yutnori`처럼 무거운 WebSocket 서버 확장 절차
  (`docs/party-games-handoff-2026-07-03.md` 참고)를 이번엔 그대로 반복할 필요가 없다는 뜻.
  단, 특정 게임을 나중에 실시간 대전으로 확장하고 싶다면 그 문서의 "새 WS 게임 추가 절차"를
  그대로 따르면 된다.
- **점수 저장은 `localStorage`**로 기존 계획과 동일하게 유지한다 (`rhh_<game>_best` 키).
- **Capacitor / Google Play 출품**은 이 저장소에 전례가 없는 별도 사업 결정이라 확정 계획에서
  분리해 [보류 항목](#보류-항목--google-play-출품)으로 내렸다.

---

## 디렉터리 구조

새 게임은 기존 게임과 완전히 동일한 패턴으로 저장소 루트와 `src/pages/`에 나란히 추가된다.

```
run-hoban-run/
├── index.html                    ← 허브 홈 (기존, src/pages/hub/main.ts 로드)
├── race/  team/  dice/  rps/  liar/  mafia/  halligalli/  yutnori/  strategy-yutnori/
│   └── index.html                ← 기존 9종 (변경 없음)
├── aim-trainer/index.html        ← 신규
├── color-slider/index.html       ← 신규
├── ball-dodge/index.html         ← 신규
├── tower-stack/index.html        ← 신규
├── snake/index.html              ← 신규
├── typing-survival/index.html    ← 신규
├── 2048-hex/index.html           ← 신규
├── endless-runner/index.html     ← 신규
├── idle-farm/index.html          ← 신규
├── pinball-rogue/index.html      ← 신규
├── src/
│   ├── pages/
│   │   ├── hub/                  ← GAMES 배열에 10개 항목 추가
│   │   ├── (기존 9개 게임 디렉터리, 변경 없음)
│   │   ├── aim-trainer/{main.ts, aim-trainer.css}
│   │   ├── color-slider/{main.ts, color-slider.css}
│   │   ├── ball-dodge/{main.ts, ball-dodge.css}
│   │   ├── tower-stack/{main.ts, tower-stack.css}
│   │   ├── snake/{main.ts, snake.css}
│   │   ├── typing-survival/{main.ts, typing-survival.css}
│   │   ├── 2048-hex/{main.ts, 2048-hex.css}
│   │   ├── endless-runner/{main.ts, endless-runner.css}
│   │   ├── idle-farm/{main.ts, idle-farm.css}
│   │   └── pinball-rogue/{main.ts, pinball-rogue.css}
│   └── shared/
│       ├── seed.ts, participants.ts, center-toast.ts/css,
│       │   chat-widget.ts/css, pastel-theme.css, share.ts   ← 기존
│       ├── pointer.ts             ← 신규: touch/mouse 좌표 통합 유틸
│       └── score-store.ts         ← 신규: localStorage 최고점수 저장/조회
├── vite.config.ts                 ← rollupOptions.input에 10개 entry 추가
├── firebase.json                  ← headers(no-cache) + rewrites에 10개 경로 추가
└── docs/
```

---

## 공통 시스템

### 재사용 가능한 기존 `src/shared/` 자원

- `seed.ts` — 시드 기반 RNG (`randomSeed`, `rollValues` 등). 신규 게임 중 시드 재현이 의미
  있는 것(예: 없음, 대부분 실시간 반응속도 게임)은 없지만 필요 시 그대로 가져다 쓸 수 있다.
- `participants.ts` — 참가자 목록 로드/저장. 이번 미니게임들은 단일 플레이어라 대부분 불필요.
- `center-toast.ts/css` — 결과/오류 토스트. 게임오버 안내 등에 재사용.
- `pastel-theme.css` — 기존 9종 게임과 시각 톤을 통일하기 위해 신규 게임 CSS도 이 팔레트를
  기준으로 작성한다.

### 신규로 추가할 공용 자원

- `src/shared/pointer.ts` — touch/mouse 통합 좌표 및 이벤트 헬퍼. v1의 `shared/utils.js`
  아이디어를 TypeScript로 이식:
  ```ts
  export function getPointerPos(e: PointerEvent | TouchEvent): { x: number; y: number };
  export function onTap(el: HTMLElement, cb: () => void): void;
  export function onSwipe(el: HTMLElement, cb: (dir: 'up'|'down'|'left'|'right') => void): void;
  ```
- `src/shared/score-store.ts` — `localStorage` 최고점수 저장/조회 (`rhh_<game>_best` 키),
  방치형 농장의 오프라인 수익 계산에 필요한 "마지막 접속 시각" 저장도 이 모듈에 포함.

### 게임 쉘 UI

별도 공통 컴포넌트를 새로 만들기보다, 기존 게임들(`dice`, `team` 등)이 쓰는 `sidebar` +
`back-link`(`← 게임 선택`) 레이아웃 패턴을 그대로 따른다. 미니게임은 사이드바 없이 캔버스
중심 레이아웃이 자연스러우므로, 상단에 `← 게임 선택` 링크 + 게임명 + 최고점수만 있는 얇은
헤더바를 게임마다 반복 작성한다(공통 컴포넌트화는 3개 이상 게임에서 중복이 확인된 뒤 판단).

---

## 게임별 명세

룰과 판정 기준은 v1과 동일하다 (요약만 유지, 상세 문구는 `docs/game-collection-plan-2026-07-13.md`
참고). Canvas 구현은 각 게임의 `src/pages/<name>/main.ts`에서 `<canvas>` 엘리먼트를 직접
다룬다 (외부 렌더링 라이브러리 없음).

| 게임 | 입력 | 핵심 규칙 | Canvas | 모바일 주의사항 |
|---|---|---|---|---|
| 에임 트레이너 | 탭/클릭 | 30초 제한, 원 크기 80→30px로 축소 | 예 | 없음 |
| 색 맞추기 슬라이더 | 슬라이더 드래그 | 10라운드×15초, RGB 오차→정확도% | 부분 | 슬라이더 터치 영역 44px 이상 |
| 볼 피하기+수집 | 드래그 | HP3, 빨간공 -1 / 초록공 +10, 30초마다 난이도↑ | 예 | 없음 |
| 타워 쌓기 | 탭 1회 | 겹치는 부분만 유지, 너비 10px 미만 시 종료 | 예 | 없음 |
| 스네이크 비틀기 | 방향키/스와이프 | 벽 없음(반대편 통과), 속도업마다 색 테마 변경 | 예 | 스와이프 방향 감지 |
| 타이핑 생존 | 키보드 | 낙하 단어 타이핑, HP3, 10초마다 난이도↑ | Canvas+DOM input | `visualViewport` 기준 높이 재계산, 모바일은 영어 전용 권장 |
| 2048 변형(육각) | 스와이프6방향/qweasd | 반지름2 육각격자(19칸) | 예 | 각도 기반 6방향 스와이프 판별 |
| 무한 러너 | 탭=점프, 스와이프다운=슬라이드 | 속도 지속 상승, 코인+10점 | 예 | 없음 |
| 방치형 농장 | 탭, 버튼 | 작물3종, 업그레이드, 오프라인 수익 계산 | 아니오(DOM+CSS) | 없음 |
| 핀볼 로그라이크 | 탭(좌/우 플리퍼) | 자체 원형 충돌 물리, 라운드마다 업그레이드 선택 | 예 | 좌우 분할 탭 처리 |

---

## 새 게임 페이지 추가 절차

`docs/party-games-handoff-2026-07-03.md`가 정리한 "새 정적 페이지(entry) 추가 체크리스트"
7단계 중, 이번 게임들은 WS 서버가 필요 없으므로 **앞의 5단계만** 그대로 적용한다.

1. `<game>/index.html` 신규 (저장소 루트, 기존 게임과 동일 패턴 — `<div id="app"></div>` +
   `<script type="module" src="/src/pages/<game>/main.ts">`)
2. `src/pages/<game>/main.ts` + `<game>.css` 신규
3. `vite.config.ts`의 `rollupOptions.input`에 항목 추가
4. `firebase.json`의 `hosting.headers`(no-cache) + `hosting.rewrites`(`/<game>`, `/<game>/**`)
   양쪽에 추가
5. `src/pages/hub/main.ts`의 `GAMES` 배열에 카드 추가 + `src/pages/hub/hub.css`에 아이콘
   (`.<game>-mark`) 추가

(6, 7단계 — `.env.example`의 `VITE_<GAME>_WS_URL`, `deploy/k8s/base/firebase-deploy-job.yaml`
env 추가 — 는 WS 서버가 필요한 게임에만 해당하므로 이번 10종에는 **적용하지 않는다**.)

---

## 개발 단계

허브가 이미 있으므로 v1의 "Phase 0 — 허브 구축"은 생략한다.

### Phase 1 — 쉬운 게임 5종

| 브랜치 | 게임 |
|--------|------|
| `feature/aim-trainer` | 에임 트레이너 |
| `feature/color-slider` | 색 맞추기 슬라이더 |
| `feature/ball-dodge` | 볼 피하기 + 수집 |
| `feature/tower-stack` | 타워 쌓기 |
| `feature/snake` | 스네이크 비틀기 |

완료 기준(게임당):
- [ ] 게임 루프 동작 (시작 → 플레이 → 게임오버 → 재시작)
- [ ] 최고점수 `localStorage` 저장/표시
- [ ] 모바일 터치 동작 확인
- [ ] 허브 카드에서 진입/`← 게임 선택`으로 복귀 확인
- [ ] `npm run test:render`(Playwright) 통과

### Phase 2 — 중간 난이도 4종

`feature/typing-survival`, `feature/2048-hex`, `feature/endless-runner`, `feature/idle-farm`

### Phase 3 — 핀볼 로그라이크

`feature/pinball-rogue` — 자체 물리(원형 충돌 반사 벡터)가 핵심 난관이므로 별도 검증 시간을
확보한다. 로그라이크 업그레이드 시스템은 물리 검증 후 추가.

### Phase 4 — 마무리

- 허브 카드 전체 정렬/아이콘 최종 점검
- 전체 게임 최고점수는 로컬(`localStorage`) 스코프로 충분 — 서버 리더보드는 범위 밖
- Firebase 배포 (`npm run deploy:firebase`)

---

## 모바일 대응

기존 게임들(윷놀이 등)이 이미 모바일 대응을 하고 있는 패턴을 그대로 따른다.

- 루트 `index.html`의 viewport 메타(`width=device-width, initial-scale=1.0`)는 이미
  적용되어 있으므로 신규 게임 `index.html`도 동일하게 작성
- Canvas 반응형 크기 계산은 게임 헤더바 높이를 제외한 `window.innerWidth/innerHeight` 기준
- 터치 이벤트는 `touchstart`/`touchmove`/`touchend` 모두 `preventDefault()`로 스크롤 방지,
  `shared/pointer.ts`의 `getPointerPos()`로 좌표 통일, 탭 영역 최소 44×44px

---

## 보류 항목 — Google Play 출품

v1에 있던 Capacitor 세팅 및 Google Play 출품 계획은 **이 저장소의 기존 배포 파이프라인
(Firebase Hosting 단일)에 없던 새로운 배포 축**이라 이번 계획에서는 확정하지 않는다. 미니게임
10종이 완성된 뒤 실제로 앱스토어 출품을 진행할지는 별도로 사용자와 논의해서 결정한다
(APK 서명 키스토어 관리, 콘텐츠 등급, 개인정보처리방침 URL 등 이 저장소 밖의 운영 부담이
따르기 때문).

---

## 세션 간 협업 규칙

`AGENTS.md`의 기존 규칙을 그대로 따른다. 이번 계획 관련해 특히 유의할 점:

- **GitHub SSH**: WSL2에서 fetch/push 시 `GIT_SSH_COMMAND='ssh -i
  /home/msyeo/.ssh/yeominsoo_ed25519 -o IdentitiesOnly=yes'`를 명시한다.
- **병렬 세션 확인**: 이 저장소는 여러 세션이 동시에 작업한 이력이 있다. 특히 `vite.config.ts`,
  `firebase.json`, `src/pages/hub/main.ts`는 게임을 하나 추가할 때마다 공통으로 건드리는
  파일이라 충돌 가능성이 높다 — 작업 전 `git fetch && git log origin/master --oneline -10`으로
  확인하는 습관을 유지한다.
- **브랜치 전략**: `master`는 완성된 기능만 병합, 게임별로 `feature/{game-name}` 독립 브랜치
  사용, PR 병합 전 기준은 위 [개발 단계](#개발-단계)의 완료 기준 체크리스트.
- **코딩 규칙**: 외부 라이브러리 사용 금지(Vanilla TS + Canvas API만, `three` 미사용), 주석은
  WHY가 비자명할 때만 최소한으로(레포 공통 스타일), `src/shared/`의 재사용 유틸을 적극 활용해
  중복 코드 방지.
- **게임 상태 업데이트**: 게임 하나 완료할 때마다 이 파일의 [포함 게임](#포함-게임-신규-10종-기존-9종은-이미-완성)
  표 상태를 `⬜ 미개발 → 🚧 개발 중 → ✅ 완료`로 갱신한다.
- **참조 문서**: `AGENTS.md`(저장소 전체 규칙), `docs/party-games-handoff-2026-07-03.md`
  (새 페이지/WS 게임 추가 패턴, 이번엔 WS 부분 제외 적용), `docs/game-collection-plan-2026-07-13.md`
  (v1, 게임 룰 상세 원본).
