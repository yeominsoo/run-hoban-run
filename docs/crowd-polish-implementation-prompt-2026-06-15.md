# 관중 디테일 개선 구현 프롬프트 - 2026-06-15

```text
작업 저장소: /home/msyeo/workspace/run-hoban-run

먼저 확인할 문서:
- docs/crowd-polish-plan-2026-06-15.md
- docs/graphics-polish-work-plan-2026-06-12.md

목표:
- 브라우저 부하를 크게 늘리지 않고 관중석 시각 품질을 올린다.
- src/main.ts의 addCrowdStrip()을 절차형 crowd texture billboard 중심으로 개선한다.
- 단순 chip 64개보다 풍성하지만, 외부 에셋/개별 사람 Mesh/관중 애니메이션은 쓰지 않는다.

구현 지시:
- 관중석 구조물은 3단 stand, back wall, canopy, 배너 정도로 보강한다.
- 관중 body/head/cheer-arm/flag는 CanvasTexture에 합성해 배경 crowd mass panel과 전면 crowd wall section에 입힌다.
- 전면 가까운 레이어에는 큰 한글 응원 현수막과 삼각 깃발 라인을 추가해 overview 카메라에서도 읽히게 한다.
- 관중 인스턴스는 castShadow를 켜지 않는다.
- raceStage.dataset.crowdQuality, crowdSpectators, crowdDrawGroups를 설정해 테스트에서 확인할 수 있게 한다.
- tests/render.spec.ts의 detailed graphics 테스트에 관중 진단값 검증을 추가한다.

검증:
- npm run build
- PLAYWRIGHT_BASE_URL=http://localhost:30000 npx playwright test tests/render.spec.ts -g "uses detailed graphics|captures the gallop and grounding|starts a 64 runner tournament"
- 가능하면 PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render

완료 보고:
- 변경 파일
- 성능을 지키기 위해 선택한 구현 방식
- 테스트 결과
```
