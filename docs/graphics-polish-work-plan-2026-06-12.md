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
| PL1 | 순위 UI 안전영역 | `src/style.css`, `src/main.ts`, `tests/render.spec.ts` | 주요 말이 leaderboard에 심하게 묻히지 않고 render suite 통과 |
| PL2 | 주자 즉시 식별 | `src/main.ts`, `src/style.css`, `tests/render.spec.ts` | 참가자 목록을 누르지 않아도 화면 위 주자를 바로 구분 가능 |
| PL3 | Runner tag edge clamp | `src/main.ts`, `tests/render.spec.ts` | 이벤트/탈락 라벨이 화면 끝에서 잘리지 않음 |
| PL4 | 모바일 결과 캡처 밀도 | `src/main.ts`, `tests/render.spec.ts` | 모바일 결과 캡처에서 우승자/우승마/순위가 한눈에 들어옴 |
| PL5 | 첫 화면 패널 가림 완화 | `src/style.css`, `src/ui/app-shell.ts` | 준비 화면에서 출발선/말 라인업이 더 잘 보임 |
| PL6 | 결승 구조물/이펙트 정돈 | `src/main.ts` | winner 장면에서 우승마와 배너가 먼저 보임 |

## 2026-06-12 진행 결과

완료:

- PL1: desktop race 중 leaderboard를 우측 결과 영역의 세로 스크롤 패널로 전환하고, mobile은 기존 하단 가로 leaderboard를 유지해 화면 안전영역을 개선.
- PL2: 말 옆구리에 큰 이름 nameplate를 붙이고 보조 주자 식별 라벨을 추가해 참가자 목록을 열지 않아도 주자를 바로 확인할 수 있게 개선.
- PL2 후속: 말 옆구리 nameplate와 보조 주자 식별 라벨에는 숫자 없이 이름만 표시.
- PL2 후속: 한 레이스 출전 최대치를 20명으로 상향하고, 시드 입력은 숨긴 뒤 기존 랜덤 버튼을 `순서변경` 버튼으로 변경.
- PL2 후속: 경기 조건 선택 UI를 제거하고 단일 모래 주로로 고정.
- PL2 후속: 진출 인원수만큼 주자가 도달하면 레이스 재생 속도를 x3으로 올려 남은 레이스를 빠르게 마무리.
- PL2 후속: 별도 결과 목록을 제거하고, `출발 대기`/경기 정보 아래의 `현재 순위` 목록이 실시간 순위와 종료 후 결과를 함께 표시하게 통합.
- PL2 후속: 가장자리 레인이 트랙 밖처럼 보이지 않도록 모래 주로 폭을 넓히고, 선택/스킬 근접 카메라는 바깥쪽에서 안쪽을 보게 조정.

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

- desktop leaderboard는 우측 결과 영역에 세로 스크롤 목록으로 배치한다.
- mobile leaderboard 검증이 깨지지 않도록 기존 하단 가로 UI를 유지한다.
- camera final-stretch/mid framing에서 말이 하단 UI에 덜 묻히도록 안전영역을 소폭 반영한다.
- P2C/P3A/P3B 캡처를 다시 생성해 비교한다.
- 주행 중 말 옆에 작은 이름 라벨을 표시한다.
- 중요 이벤트/순위 callout이 있는 주자는 중복 라벨을 숨겨 화면을 과밀하게 만들지 않는다.
- 말 옆구리 nameplate 텍스처에는 이름만 크게 넣어 확대/근접 컷에서 식별성을 보강한다.
- 20명 동시 출전 기준으로 기본 샘플, 입력 상한, 테스트 기대값을 갱신한다.
- 시드 값은 사용자 UI와 경기 요약에서 숨기고 `순서변경` 버튼으로 새 시드를 생성하게 한다.
- 경기 조건은 별도 선택 없이 모래 주로 하나만 사용한다.
- 기존 트랙 구분선은 제거하고 모래사장 질감 하나로 주로를 표현한다.
- 진출 인원수 도달 뒤에는 x3 재생 속도로 후미 주자의 완주 대기 시간을 줄인다.
- 별도 `결과` 목록은 제거하고, 현재 순위 목록이 종료 후 시간/진출/탈락 상세까지 표시하게 한다.
- 1번처럼 가장자리 레인에 배치된 주자가 추적 카메라에서 트랙 밖처럼 보이지 않도록 주로 여백과 카메라 방향을 보정한다.

검증:

- `npm run build`
- `npx playwright test tests/rules.spec.ts`
- `PLAYWRIGHT_BASE_URL=http://localhost:30000 npx playwright test tests/render.spec.ts -g "captures the gallop and grounding|moves the overview camera through broadcast"`
- 가능하면 `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render`

## 보류 항목

- PL3-PL6은 PL1/PL2 결과를 확인한 뒤 별도 작은 변경으로 진행한다.
- 첫 화면 패널 구조 변경은 운영 UX에 영향이 있으므로 별도 확인 후 진행한다.
