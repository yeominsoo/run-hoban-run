# Graphics Rework Implementation Prompt - 2026-06-12

아래 프롬프트를 그대로 사용해 `run-hoban-run`의 첫 번째 그래픽 리워크 소스 수정을 진행한다.

```text
너는 `/home/msyeo/workspace/run-hoban-run` 저장소에서 작업하는 시니어 프론트엔드/Three.js 엔지니어다.

목표는 `docs/graphics-rework-plan-2026-06-12.md`와 `docs/graphics-rework-phase-index-2026-06-12.md`를 기준으로 첫 번째 그래픽 리워크 소스 수정을 진행하는 것이다. 전체 그래픽 리워크를 한 번에 끝내려 하지 말고, 기본 완료 범위는 `P0 -> P1A -> P1B`로 제한한다. `P1C`는 카메라와 콜아웃 정책이 안정된 경우에만 같은 세션에서 이어서 진행한다.

반드시 먼저 읽을 파일:

1. AGENTS.md
2. git status --short --branch 출력
3. docs/graphics-reference-analysis-2026-06-12.md
4. docs/graphics-rework-plan-2026-06-12.md
5. docs/graphics-rework-phase-index-2026-06-12.md
6. src/main.ts
7. src/style.css
8. src/ui/app-shell.ts
9. tests/render.spec.ts

작업 전 원칙:

- commit, push, deploy는 하지 않는다.
- `.idea/` 같은 기존 미추적 IDE 파일은 건드리지 않는다.
- 배포/Firebase/Kubernetes/Argo CD 파일은 건드리지 않는다.
- 토너먼트 엔진, 시드 계산, 참가자 입력 정책은 건드리지 않는다.
- 랜덤 무료 GLB를 추가하지 않는다.
- horse/rider 모델 전면 교체는 이번 범위가 아니다. 기존 모델은 유지하고 화면 문법부터 개선한다.
- 테스트를 위해 제품 DOM/UI/runtime 동작을 왜곡하지 않는다. 테스트는 실제 사용자-visible 품질에 맞춰 바꾼다.
- 헬리콥터 탈락 이벤트는 유지하되, 이번 리워크의 중심 목표로 삼지 않는다.

이번 세션의 구현 목표:

1. `P0`: baseline screenshot과 금지 범위를 확인한다.
2. `P1A`: 기본 카메라를 높은 고각 overview에서 낮은 3/4 pack view로 바꾼다.
3. `P1A`: selected runner 카메라는 선택 주자가 화면에 더 크게 보이도록 조정한다.
4. `P1B`: 모든 말 위에 이름표가 상시 떠 있는 상태를 제거한다.
5. `P1B`: 캔버스 위 콜아웃은 leader, selected runner, skill event, eliminated/winner 정도로 제한한다.
6. 선택 작업 `P1C`: 주로가 육상 트랙처럼 보이지 않도록 흰 레인 라인을 줄이고, 경마장 문법을 추가한다.
7. 선택 작업 `P1D`: Playwright에 visual 품질 검증 초안을 추가한다.

권장 수정 대상:

- `src/main.ts`
  - `getOverviewCameraView`
  - `getFocusedCameraView`
  - `snapCameraToLeader`
  - `updateCamera`
  - `updateLaneGuides`
  - `makeRail`
  - track/ground/finishLine 생성부
  - `makeLabel`
  - `updateRunnerLabel`
  - `positionRunnerLabels`
  - 필요한 경우 racecourse prop 생성 함수 추가
- `src/style.css`
  - `.runner-tag` 또는 새 callout class
  - leaderboard/minimap과 callout 겹침 관련 스타일
  - 모바일 callout 크기
- `tests/render.spec.ts`
  - 기존 nonblank canvas 테스트 보강
  - permanent runner label 기대값을 새 callout 정책에 맞게 수정
  - pre-race, mid-race, final-stretch 또는 winner screenshot 초안 추가

구현 세부 요구사항:

## 1. 카메라

- desktop 기본 race camera는 말이 화면에서 작게 흩어지지 않게 낮은 3/4 뷰로 잡는다.
- 화면에 선두 한 마리만 고립되지 않도록 주변 pack도 함께 보이게 한다.
- `overview`라는 내부 이름은 유지해도 되지만, 실제 의미는 "broadcast pack view"에 가깝게 바꾼다.
- `focused` 카메라는 selected runner가 화면 중심 또는 1/3 지점에 크게 잡히게 한다.
- mobile은 너무 멀어지지 않도록 desktop과 별도 offset을 둔다.
- 헬리콥터/스킬 컷신 카메라는 이번 작업에서 깨지지 않는 선에서만 조정한다.

완료 기준:

- 1440x900 mid-race screenshot에서 선두권 말이 주요 피사체로 보인다.
- 390x844 mobile에서도 말이 너무 작아지지 않는다.
- leaderboard를 클릭해 selected runner 추적이 계속 동작한다.

## 2. 라벨/콜아웃

- 모든 `visualRunners`에 DOM label을 만들 수는 있지만, 화면에는 항상 보이지 않아야 한다.
- 기본 주행 중에는 leader와 selected runner 정도만 표시한다.
- skill 발동 중에는 해당 runner의 skill callout을 표시한다.
- eliminated, winner, qualified 상태는 짧고 명확하게 표시한다.
- 동시에 보이는 callout은 4개 이하를 목표로 한다.
- 이름 전체 목록은 하단 leaderboard가 담당한다.

구현 힌트:

- `getLiveRunnerRank(runner)` 결과를 활용해 rank 1만 기본 callout 후보로 둔다.
- `selectedCameraEntryId !== 'overview'`인 경우 selected runner를 callout 후보에 포함한다.
- `runner.skillActive`, `runner.eliminated`, `raceFinished && placement.qualified`는 중요한 callout 후보로 둔다.
- `positionRunnerLabels`에서 important가 아닌 runner는 opacity 0으로 숨긴다.
- class 이름은 기존 `.runner-tag`를 유지해도 되지만, 의미가 "permanent label"이 아니라 "conditional callout"이어야 한다.

완료 기준:

- 레이스 중 화면이 이름표 구름처럼 보이지 않는다.
- visible callout 수가 일반 주행 중 1-2개, 이벤트 중 최대 4개 수준이다.
- skill/탈락/우승 정보는 계속 확인 가능하다.

## 3. 경마장 문법

이 항목은 `P1C`다. `P1A/P1B`가 흔들리면 같은 세션에서 진행하지 말고 다음 세션으로 넘긴다.

- 흰 레인 라인은 모든 lane을 가르는 운동장 선처럼 보이지 않게 줄인다.
- `updateLaneGuides`는 출발 정렬이나 보조선 느낌으로 약화한다.
- 경마장으로 읽히는 오브젝트를 추가한다:
  - 출발 게이트 또는 출발 라인 구조물
  - 결승 포스트
  - 거리 표지판
  - 안쪽/바깥쪽 레일 강화
  - 관중석 또는 crowd strip 실루엣
  - 말 접지 그림자 또는 먼지 느낌
- 과도한 디테일보다 화면에서 경마장이라고 읽히는 실루엣을 우선한다.

완료 기준:

- 첫 화면이나 race 중 스크린샷에서 "육상 트랙"보다 "경마 코스"로 읽힌다.
- 트랙 장식이 말/기수를 가리지 않는다.
- desktop/mobile 모두 UI와 주요 오브젝트가 겹치지 않는다.

## 4. 테스트

이 항목은 `P1D`다. 최소한 build를 실행하고, 시간이 허용되면 render suite까지 실행한다. visual test 추가는 P1A/P1B/P1C 결과가 안정된 뒤 진행한다.

- 기존 테스트가 "모든 runner-tag가 보여야 한다"는 식으로 permanent label 정책에 의존한다면, 새 callout 정책에 맞게 수정한다.
- 제품에 테스트 전용 `data-*`를 추가하는 방식은 피한다.
- 이미 존재하는 product state는 유지해도 되지만, 새 검증은 실제 DOM 배치/가시성/스크린샷 중심으로 작성한다.
- 적어도 다음 검증을 추가하거나 기존 검증에 포함한다:
  - pre-race screenshot 저장
  - mid-race screenshot 저장
  - visible callout 수가 4개 이하
  - leaderboard와 minimap이 겹치지 않음
  - desktop/mobile canvas가 보이고 nonblank

주의:

- 현 테스트에는 헬리콥터, frenzy, asset status 관련 긴 테스트가 있다. 이번 리워크로 깨지면 원인을 분석해 제품 의도에 맞게 테스트를 갱신한다.
- 테스트 통과를 위해 라벨을 다시 상시 노출시키면 안 된다.

## 5. 검증 명령

가능하면 아래 순서로 검증한다.

1. `npm run build`
2. `npm run test:render`

`npm run test:render`는 시간이 걸릴 수 있다. 실패하면 실패 테스트 이름, 실패 원인, 제품 문제인지 테스트 기대값 문제인지 구분해 수정한다.

수동 확인이 가능하면 dev server를 30000번대 포트로 실행해 확인한다.

예:

```bash
npm run dev -- --host 0.0.0.0 --port 30000 --strictPort
```

수동 확인 URL:

```text
http://localhost:30000/
```

최종 보고에 포함할 것:

- 수정한 파일 목록.
- 카메라/라벨/경마장 문법/테스트 변경 요약.
- 실행한 검증 명령과 결과.
- 남은 문제와 다음 Phase로 넘길 항목.
- commit/push/deploy를 하지 않았다는 점.
```
