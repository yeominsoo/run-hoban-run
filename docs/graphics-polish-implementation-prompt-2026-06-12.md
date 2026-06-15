# 그래픽 Polish 구현 프롬프트 - 2026-06-12

아래 프롬프트는 `run-hoban-run` 그래픽 polish 작업을 이어받는 구현자가 그대로 사용할 수 있는 지시문이다.

```text
작업 저장소: /home/msyeo/workspace/run-hoban-run

먼저 확인할 문서:
- docs/graphics-rework-phase-index-2026-06-12.md
- docs/graphics-rework-manual-qa-checklist-2026-06-12.md
- docs/graphics-polish-improvement-items-2026-06-12.md
- docs/graphics-polish-work-plan-2026-06-12.md

목표:
- P0-P5B 그래픽 리워크는 완료 상태로 유지한다.
- 이번 작업은 PL1 순위 UI 안전영역만 처리한다.
- 주행/결승 직전 장면에서 귀여운 말과 기수가 leaderboard에 심하게 묻히지 않게 한다.

금지:
- 토너먼트 엔진, 시드 계산, 참가자 입력 정책, 배포 설정은 바꾸지 않는다.
- 테스트 통과만을 위해 제품 DOM/UI/runtime 상태를 추가하지 않는다.
- 화면을 크게 갈아엎거나 새 모델 전략을 도입하지 않는다.

구현 방향:
- src/style.css에서 desktop leaderboard를 우측 결과 영역의 세로 스크롤 목록으로 배치한다.
- mobile은 기존 하단 가로 leaderboard와 minimap 간격 검증을 유지한다.
- src/main.ts의 broadcast camera framing은 피사체가 하단 UI와 충돌하지 않도록 보수적으로 조정한다.
- 캡처 파일은 test-results/p2c-gallop-grounding-*.png, p3a-camera-sequence-*.png, p3b-*.png를 기준으로 확인한다.

검증:
- npm run build
- PLAYWRIGHT_BASE_URL=http://localhost:30000 npx playwright test tests/render.spec.ts -g "captures the gallop and grounding|moves the overview camera through broadcast"
- 가능하면 PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render

완료 보고:
- 변경한 파일
- 개선된 장면
- 테스트 결과
- 남은 polish 후보
```

## 후속 PL2 구현 프롬프트

```text
작업 저장소: /home/msyeo/workspace/run-hoban-run

먼저 확인할 문서:
- docs/graphics-polish-improvement-items-2026-06-12.md
- docs/graphics-polish-work-plan-2026-06-12.md

목표:
- 사용자가 참가자 목록/leaderboard를 눌러야만 주자가 누구인지 알 수 있는 불편을 줄인다.
- 주행 화면 자체에서 각 주자의 이름을 바로 확인할 수 있게 한다.
- 말 옆구리에 큰 이름 nameplate를 붙여 플로팅 UI 없이도 주자를 식별할 수 있게 한다.
- 귀여운 말/기수 그래픽과 기존 순위/이벤트 callout은 유지한다.

금지:
- 참가자 입력, 토너먼트 엔진, 결과 계산 로직은 바꾸지 않는다.
- 테스트 편의를 위해 제품 DOM/UI/runtime 상태를 왜곡하지 않는다.
- 모든 말 위에 큰 플로팅 이름표를 항상 띄워 화면을 과밀하게 만들지 않는다.

구현 방향:
- src/main.ts에서 visual runner마다 별도의 small identity label을 생성한다.
- 기존 runner-tag가 순위/이벤트를 표시하는 경우에는 중복 identity label을 숨긴다.
- 말 옆구리 nameplate 텍스처와 보조 identity label에는 숫자 없이 이름만 크게 넣어 근접 컷 식별성을 보강한다.
- src/style.css에는 말 주변에서 읽히는 compact identity pill 스타일을 추가한다.
- tests/render.spec.ts에는 identity label이 생성되고 최소 하나 이상 화면에 보이는지 검증한다.

검증:
- npm run build
- PLAYWRIGHT_BASE_URL=http://localhost:30000 npx playwright test tests/render.spec.ts -g "captures the gallop and grounding"
- PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render

완료 보고:
- 변경한 파일
- 화면에서 주자 식별이 어떻게 바뀌었는지
- 테스트 결과
- 남은 polish 후보
```
