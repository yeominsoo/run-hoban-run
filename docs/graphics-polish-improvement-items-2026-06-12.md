# 그래픽 Polish 개선건 - 2026-06-12

이 문서는 P0-P5B 그래픽 리워크 이후 발견된 후속 polish 후보를 정리한다. 현재 화면은 귀여운 스타일과 경마 문법이 잡힌 상태이므로, 후속 작업은 새 모델/새 연출을 크게 추가하지 않고 화면 가독성과 공유 품질을 높이는 좁은 개선으로 제한한다.

## 기준 캡처

- `test-results/p2c-gallop-grounding-desktop.png`
- `test-results/p2c-gallop-grounding-mobile.png`
- `test-results/p3a-camera-sequence-early.png`
- `test-results/p3a-camera-sequence-mid.png`
- `test-results/p3b-final-stretch.png`
- `test-results/p3b-finish.png`
- `test-results/p4a-winner-presentation.png`
- `test-results/p4b-result-capture.png`
- `test-results/qa-pre-race-ready-desktop.png`
- `test-results/qa-pre-race-mobile.png`
- `test-results/qa-mobile-winner-presentation.png`
- `test-results/qa-mobile-result-capture.png`

## PI-1. 하단 UI 안전영역

문제:

- desktop 주행/결승 직전 컷에서 말의 다리와 몸통 일부가 leaderboard 뒤로 들어간다.
- 귀여운 말/기수 모델이 잘 만들어졌지만, 가장 중요한 하단 피사체가 UI에 가려져 매력이 줄어든다.

증거:

- `test-results/p2c-gallop-grounding-desktop.png`
- `test-results/p3a-camera-sequence-early.png`
- `test-results/p3a-camera-sequence-mid.png`
- `test-results/p3b-final-stretch.png`

개선 방향:

- race 중 leaderboard 높이와 padding을 조금 줄인다.
- camera framing은 더 멀리 빼기보다 말이 하단 UI 위로 올라오도록 target/height를 소폭 조정한다.
- 테스트 전용 DOM이나 runtime 상태를 만들지 않는다.

완료 기준:

- desktop P2C/P3A/P3B 캡처에서 주요 말의 몸통이 leaderboard에 심하게 묻히지 않는다.
- mobile leaderboard와 minimap 겹침 검증은 유지된다.
- `npm run build`, `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render`가 통과한다.

## PI-2. 주자 즉시 식별성

문제:

- 주행 중 화면만 보면 각 말이 어떤 참가자인지 바로 알기 어렵다.
- 하단 참가자 목록/leaderboard를 눌러야 주자 이름을 확인할 수 있어 관람 흐름이 끊긴다.

증거:

- `test-results/p2c-gallop-grounding-desktop.png`
- `test-results/p2c-gallop-grounding-mobile.png`

개선 방향:

- 말 주변에 작은 번호+이름 라벨을 표시해 화면 위 주자를 바로 식별하게 한다.
- 기존 이벤트/순위 callout은 유지하되, 같은 주자에게 중복 라벨이 겹치지 않게 한다.
- 말 옆구리 nameplate 텍스처에도 번호와 이름을 크게 넣어 근접 컷에서 식별성을 보강한다.

완료 기준:

- 참가자 목록을 열지 않아도 주행 중 주요 주자의 이름을 확인할 수 있다.
- 화면 위 callout 제한과 모바일 가독성은 유지된다.
- `npm run build`, `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render`가 통과한다.

완료:

- `src/main.ts`에 말 옆구리 nameplate와 `.runner-identity` 라벨 생성/투영 로직을 추가했다.
- `src/style.css`에 compact runner identity pill 스타일을 추가했다.
- `tests/render.spec.ts`에서 identity label 존재와 최소 표시 상태를 검증한다.

## PI-3. 첫 화면 패널 가림

문제:

- desktop/mobile 준비 화면에서 control panel과 race panel이 장면을 많이 가린다.
- 운영자에게는 유용하지만, 시연/관람 첫인상은 출발 게이트와 말 라인업이 더 먼저 보여야 한다.

증거:

- `test-results/qa-pre-race-ready-desktop.png`
- `test-results/qa-pre-race-mobile.png`

개선 방향:

- start 전에도 패널을 접을 수 있는 현재 토글은 유지한다.
- 추가 polish에서는 mobile 기본 패널 높이를 더 줄이거나, sample/start row를 상단에 두고 옵션은 접는 구조를 검토한다.
- 이 항목은 운영 workflow에 영향이 있으므로 하단 UI/주자 식별성보다 뒤에 둔다.

완료 기준:

- 첫 화면에서 말/출발선이 패널 사이로 충분히 보인다.
- 참가자 입력과 시작 버튼은 찾기 쉬운 상태를 유지한다.

## PI-4. 모바일 결과 캡처 밀도

문제:

- 모바일 winner/result 캡처는 읽히지만 배너와 결과 패널 사이의 빈 공간이 크다.
- 공유 이미지로 보면 핵심 정보와 우승마가 조금 느슨하게 떨어져 있다.

증거:

- `test-results/qa-mobile-winner-presentation.png`
- `test-results/qa-mobile-result-capture.png`

개선 방향:

- 모바일 결과 캡처 전용으로 winner banner와 result panel의 위치를 조금 더 압축한다.
- 실제 화면 UI와 다운로드 합성 캔버스의 차이가 지나치게 커지지 않게 한다.

완료 기준:

- 모바일 결과 캡처에서 우승자, 우승마, 결과 순위가 한눈에 들어온다.
- `test-results/p4b-result-capture.png`와 모바일 QA 캡처가 모두 깨지지 않는다.

## PI-5. Runner Tag Edge Clipping

문제:

- 일부 탈락/이벤트 runner tag가 화면 좌우 끝에 붙거나 잘릴 수 있다.

개선 방향:

- `positionRunnerLabels`에서 edge 근처 라벨은 조금 더 안쪽으로 clamp한다.
- 중요도가 낮은 라벨은 edge에서 숨기는 정책을 유지한다.

완료 기준:

- 이벤트 라벨이 화면 밖으로 반쯤 나가지 않는다.
- 일반 주행 중 visible callout 제한은 유지된다.

## PI-6. 결승 구조물/이펙트 정돈

문제:

- finish/winner 장면에서 결승 포스트, 흰 결승 라인, 우승 배너, 스포트라이트가 한 영역에 몰리며 약간 시끄럽다.

개선 방향:

- winner phase에서 스포트라이트 opacity를 소폭 낮추거나 결승 구조물 대비를 낮춘다.
- 우승마가 잘 보이는 현재 장점은 유지한다.

완료 기준:

- `p4a-winner-presentation.png`에서 우승마와 배너가 먼저 보인다.
- 결승 구조물은 맥락만 제공하고 시선을 과하게 빼앗지 않는다.

## 권장 순서

1. PI-1 하단 UI 안전영역
2. PI-2 주자 즉시 식별성
3. PI-5 Runner Tag Edge Clipping
4. PI-4 모바일 결과 캡처 밀도
5. PI-3 첫 화면 패널 가림
6. PI-6 결승 구조물/이펙트 정돈
