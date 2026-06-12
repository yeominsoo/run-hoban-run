# 그래픽 Polish 작업 계획 - 2026-06-12

기준 문서: `docs/graphics-polish-improvement-items-2026-06-12.md`

## 원칙

- P0-P5B 그래픽 리워크는 완료 상태로 유지한다.
- 후속 작업은 polish index로 분리하고, 한 번에 한 문제만 줄인다.
- 토너먼트 엔진, 참가자 입력 정책, 배포, 녹화 포맷은 범위 밖이다.
- 테스트를 위해 제품 DOM/UI/runtime을 왜곡하지 않는다.
- 모든 변경은 screenshot 또는 Playwright 결과로 확인한다.

## Phase

| Phase | 범위 | 파일 | 완료 기준 |
| --- | --- | --- | --- |
| PL1 | 하단 UI 안전영역 | `src/style.css`, `src/main.ts`, `tests/render.spec.ts` | 주요 말이 leaderboard에 심하게 묻히지 않고 render suite 통과 |
| PL2 | 주자 즉시 식별 | `src/main.ts`, `src/style.css`, `tests/render.spec.ts` | 참가자 목록을 누르지 않아도 화면 위 주자를 바로 구분 가능 |
| PL3 | Runner tag edge clamp | `src/main.ts`, `tests/render.spec.ts` | 이벤트/탈락 라벨이 화면 끝에서 잘리지 않음 |
| PL4 | 모바일 결과 캡처 밀도 | `src/main.ts`, `tests/render.spec.ts` | 모바일 결과 캡처에서 우승자/우승마/순위가 한눈에 들어옴 |
| PL5 | 첫 화면 패널 가림 완화 | `src/style.css`, `src/ui/app-shell.ts` | 준비 화면에서 출발선/말 라인업이 더 잘 보임 |
| PL6 | 결승 구조물/이펙트 정돈 | `src/main.ts` | winner 장면에서 우승마와 배너가 먼저 보임 |

## 2026-06-12 진행 결과

완료:

- PL1: desktop race 중 leaderboard를 단일 줄 compact rail로 전환하고, overview broadcast camera의 desktop vertical target을 소폭 조정해 하단 UI 안전영역을 개선.
- PL2: 말 옆구리에 큰 번호+이름 nameplate를 붙이고 보조 주자 식별 라벨을 추가해 참가자 목록을 열지 않아도 주자를 바로 확인할 수 있게 개선.
- PL2 후속: 한 레이스 출전 최대치를 20명으로 상향하고, 시드 입력은 숨긴 뒤 기존 랜덤 버튼을 `준비` 버튼으로 변경.

검증:

- `npm run build` 통과.
- `PLAYWRIGHT_BASE_URL=http://localhost:30000 npx playwright test tests/render.spec.ts -g "captures the gallop and grounding|moves the overview camera through broadcast"` 통과.
- `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render` 통과, 33 passed.

남은 polish 후보:

- PL3: Runner tag edge clamp.
- PL4: 모바일 결과 캡처 밀도.
- PL5: 첫 화면 패널 가림 완화.
- PL6: 결승 구조물/이펙트 정돈.

## 이번 작업 범위

초기 작업은 `PL1`만 구현했고, 이후 사용성 피드백에 따라 `PL2`를 추가 구현했다.

작업:

- desktop leaderboard 높이와 padding을 소폭 줄인다.
- mobile leaderboard 검증이 깨지지 않도록 mobile CSS는 보수적으로 유지한다.
- camera final-stretch/mid framing에서 말이 하단 UI에 덜 묻히도록 안전영역을 소폭 반영한다.
- P2C/P3A/P3B 캡처를 다시 생성해 비교한다.
- 주행 중 말 옆에 작은 번호+이름 라벨을 표시한다.
- 중요 이벤트/순위 callout이 있는 주자는 중복 라벨을 숨겨 화면을 과밀하게 만들지 않는다.
- 말 옆구리 nameplate 텍스처에도 번호와 이름을 크게 넣어 확대/근접 컷에서 식별성을 보강한다.
- 20명 동시 출전 기준으로 기본 샘플, 입력 상한, 테스트 기대값을 갱신한다.
- 시드 값은 사용자 UI와 경기 요약에서 숨기고 `준비` 버튼으로 새 시드를 생성하게 한다.

검증:

- `npm run build`
- `PLAYWRIGHT_BASE_URL=http://localhost:30000 npx playwright test tests/render.spec.ts -g "captures the gallop and grounding|moves the overview camera through broadcast"`
- 가능하면 `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render`

## 보류 항목

- PL3-PL6은 PL1/PL2 결과를 확인한 뒤 별도 작은 변경으로 진행한다.
- 첫 화면 패널 구조 변경은 운영 UX에 영향이 있으므로 별도 확인 후 진행한다.
