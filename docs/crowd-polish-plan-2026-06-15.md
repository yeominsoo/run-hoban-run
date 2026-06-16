# 관중 디테일 개선 계획 - 2026-06-15

기준 프롬프트: `docs/crowd-polish-planning-prompt-2026-06-15.md`

## 목표

관중석을 더 풍성하게 보이게 하되, 브라우저 부하는 현재와 같은 낮은 수준으로 유지한다. 관중은 주인공이 아니라 말, 기수, 주로, 순위 UI를 받쳐주는 배경 요소이므로 개별 사람 모델이 아니라 절차형 crowd texture billboard 중심으로 구현한다.

## 성능 원칙

- 관중 개별 GLB 또는 외부 런타임 에셋을 추가하지 않는다.
- 관중 한 명을 여러 개의 독립 Mesh로 만들지 않는다.
- 사람 몸통/머리/팔/깃발은 CanvasTexture로 합성한 billboard panel에 그려 draw call 증가를 제한한다.
- 관중 인스턴스에는 `castShadow`를 켜지 않는다.
- 관중별 매 프레임 애니메이션은 넣지 않는다.
- material 수는 소수의 공유 material로 제한한다.

## 구현 범위

- `src/main.ts`의 `addCrowdStrip()`을 저부하 관중석 구성으로 개선한다.
- 기존 단일 stand 박스는 3단 관중석, 뒤쪽 월, 얇은 지붕/캐노피, 색상 배너로 보강한다.
- 기존 chip 64개는 배경 crowd mass texture와 전면 crowd wall section으로 대체해 멀리서도 관중 수가 많아 보이게 한다.
- 관중 texture 안에 팔, 작은 깃발, 색상 군집을 함께 그리고, 전면 가까운 레이어에는 큰 한글 응원 현수막과 삼각 깃발 라인을 추가한다.
- 테스트에서는 런타임 외부 에셋 요청이 없고, 관중 billboard 진단값이 예상 범위인지 확인한다.

## 비범위

- 관중 개별 얼굴, 의상, 이름, 애니메이션.
- 관중 GLB/텍스처 에셋 추가.
- 모바일 전용 별도 관중 로직.
- 품질을 위해 말/기수/카메라/레이스 룰을 변경하는 작업.

## 단계

1. 계획/프롬프트 문서 작성.
2. `addCrowdStrip()`을 절차형 billboard crowd 기반 관중석으로 교체.
3. race stage에 관중 품질/카운트 진단용 `data-*` 값을 설정한다.
4. Playwright 렌더 테스트에서 진단값과 기존 그래픽 모드를 검증한다.
5. `npm run build`, 타깃 렌더 테스트, 가능하면 전체 render suite로 회귀를 확인한다.

## 완료 기준

- 관중석이 단순 색 막대보다 사람 군중처럼 읽힌다.
- 관중 관련 draw call은 소수 billboard panel 중심으로 유지된다.
- 외부 관중 에셋 요청이 없다.
- 기존 20마리/64명 토너먼트, 모바일 minimap/leaderboard, 컷신 테스트가 깨지지 않는다.

## 2026-06-15 진행 결과

구현:

- `addCrowdStrip()`을 3단 관중석, back wall, canopy, 배경 crowd mass, 전면 crowd wall section, 큰 한글 응원 현수막, 삼각 깃발 라인 구조로 개선.
- 관중은 720명 규모로 보이되 CanvasTexture billboard 중심으로 12개 이하 draw group 진단값으로 제한.
- 외부 관중 에셋, 관중별 애니메이션, 관중 shadow cast는 추가하지 않음.

검증:

- `npm run build` 통과.
- `PLAYWRIGHT_BASE_URL=http://localhost:30000 npx playwright test tests/render.spec.ts -g "uses detailed graphics|captures the gallop and grounding|starts a 64 runner tournament"` 통과, 4 passed.
- `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render` 통과, 34 passed.
- `test-results/qa-crowd-polish-wall-banner-desktop.png`, `test-results/qa-crowd-polish-large-banner-desktop.png`, `test-results/qa-crowd-polish-muted-desktop.png`로 desktop 관중석 캡처 확인.
