# 그래픽 리워크 Phase Index - 2026-06-12

이 문서는 `docs/graphics-rework-plan-2026-06-12.md`를 실제 구현 세션 단위로 쪼갠 작업 index다. 각 세션은 앞 단계의 완료 기준을 통과한 뒤 다음 단계로 넘어간다.

## Index 원칙

- 한 세션은 한 가지 시각 문제만 확실히 줄인다.
- 카메라/라벨/트랙/모델/테스트를 한 번에 크게 바꾸지 않는다.
- 토너먼트 엔진, 시드 계산, 참가자 입력 정책, 배포 파일은 이 index 범위 밖이다.
- 테스트를 위해 제품 DOM/UI/runtime을 왜곡하지 않는다.
- 각 단계는 screenshot 또는 Playwright 결과로 확인 가능한 완료 기준을 가진다.

## 전체 단계

| Index | 이름 | 목적 | 주요 파일 | 선행 조건 |
| --- | --- | --- | --- | --- |
| P0 | Baseline & Guardrail | 현재 상태와 금지 범위 고정 | docs, test-results | 없음 |
| P1A | Camera Framing | 말/팩이 크게 보이게 함 | `src/main.ts` | P0 |
| P1B | Conditional Callouts | 이름표 구름 제거 | `src/main.ts`, `src/style.css`, `tests/render.spec.ts` | P1A |
| P1C | Racecourse Props | 경마장 문법 추가 | `src/main.ts` | P1A |
| P1D | Visual Test Draft | 화면 품질 검증 초안 | `tests/render.spec.ts` | P1A-P1C |
| P2A | Stylized Horse Base | 절차형 말 기본형 확정 | `src/main.ts` 또는 신규 scene 모듈 | P1D |
| P2B | Jockey & Saddlecloth | 기수/번호/색상 통일 | `src/main.ts`, `src/style.css` | P2A |
| P2C | Gallop & Grounding | 달리는 느낌/접지감 개선 | `src/main.ts` | P2B |
| P3A | Race Camera Sequence | 자동 중계 흐름 구성 | `src/main.ts` | P2C |
| P3B | Final Stretch & Finish | 결승선 박력 강화 | `src/main.ts`, `src/style.css` | P3A |
| P3C | Skill/Hazard Integration | 스킬/헬리콥터 컷 통합 | `src/main.ts`, `tests/render.spec.ts` | P3B |
| P4A | Winner Presentation | 우승자 발표 장면 개선 | `src/main.ts`, `src/style.css` | P3C |
| P4B | Capture Quality | 결과 이미지/영상 품질 정리 | `src/main.ts`, `tests/render.spec.ts` | P4A |
| P5A | Visual Regression Set | 주요 장면 스냅샷 고정 | `tests/render.spec.ts` | P4B |
| P5B | Manual QA Checklist | 수동 검증 기준 운영화 | `docs/graphics-rework-manual-qa-checklist-2026-06-12.md` | P5A |

## 2026-06-12 구현 현황

완료:

- P1A: 기본 race camera를 낮은 3/4 pack view 중심으로 조정.
- P1B: runner callout을 leader/selected/event 중심으로 제한하고 동시 표시 수 검증 추가.
- P1C: 출발 게이트, 결승 포스트, 거리 표지판, crowd strip을 추가하고 레인 가이드를 약화.
- P1D: desktop/mobile callout 제한 render test 추가.
- P2A: 외부 racer GLB 조합 대신 절차형 stylized horse를 기본 전략으로 전환.
- P2B 일부: 절차형 jockey와 saddlecloth 번호 텍스처를 추가.
- P2C: gallop 주기에 맞춘 몸통 bob, 목/머리 반동, 꼬리 흔들림, 접지 그림자, 발굽 먼지를 연결.
- P3A: overview 카메라를 레이스 진행률 기준 `early -> mid -> final` 자동 중계 흐름으로 전환.
- P3B: final phase를 `final-stretch`와 `finish`로 세분화하고, 결승선 접근/우승 직후 shot을 분리.
- P3C: 프렌지 컷은 짧은 window와 복귀 간격으로 제한하고, 헬기 시퀀스 종료 후 일반 카메라/lock 해제를 검증.
- P4A: 결승 직후 `finish` shot을 짧게 유지한 뒤 `winner` presentation close-up으로 전환하고, 우승자 스포트라이트/배너를 강화.
- P4B: 결과 screenshot/video 합성 캔버스에 winner banner를 포함하고, 최종 결과 다운로드 이미지를 고정 캡처로 검증.
- P5A: P2C gallop/grounding 캡처를 render suite에 편입해 P2C-P4B visual regression 증거 세트를 자동 생성.
- P5B: 수동 QA 체크리스트와 보고 형식을 `docs/graphics-rework-manual-qa-checklist-2026-06-12.md`로 정리.

검증:

- `npm run build` 통과.
- `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render` 통과, 33 passed.
- production build 산출물에서 racer GLB 파일이 제외됨.
- P2C 확인 캡처: `test-results/p2c-gallop-grounding-desktop.png`, `test-results/p2c-gallop-grounding-mobile.png`.
- P3A/P3B 확인 캡처: `test-results/p3a-camera-sequence-early.png`, `test-results/p3a-camera-sequence-mid.png`, `test-results/p3b-final-stretch.png`, `test-results/p3b-finish.png`.
- P3C 확인 캡처: `test-results/p3c-frenzy-brief-cut.png`, `test-results/p3c-frenzy-return.png`, `test-results/p3c-helicopter-return.png`.
- P4A 확인 캡처: `test-results/p4a-winner-presentation.png`.
- P4B 확인 캡처: `test-results/p4b-result-capture.png`.

남은 우선순위:

- 없음. 후속 작업은 실제 사용자 확인 후 polish 이슈로 분리한다.

## P0 - Baseline & Guardrail

목표:

- 리워크 전 화면을 기준 자료로 남긴다.
- 다음 세션에서 금지 범위를 다시 확인하지 않아도 되게 한다.

작업:

- `git status --short --branch` 확인.
- desktop 1440x900, mobile 390x844 기준으로 pre-race/mid-race screenshot 저장.
- `docs/graphics-rework-plan-2026-06-12.md`와 이 phase index를 구현자가 먼저 읽도록 프롬프트에 연결.

완료 기준:

- baseline screenshot 경로가 최종 보고에 남는다.
- 소스 수정 전 금지 범위가 확인된다.

## P1A - Camera Framing

목표:

- 모델을 바꾸기 전에 말과 팩이 화면의 주인공으로 보이게 한다.

작업:

- `getOverviewCameraView`를 높은 전체뷰에서 낮은 3/4 pack view로 조정한다.
- `getFocusedCameraView`에서 selected runner가 더 크게 잡히게 한다.
- `snapCameraToLeader`가 새 기본 framing을 따르게 확인한다.
- mobile offset은 별도로 둔다.

완료 기준:

- 1440x900 mid-race screenshot에서 선두권 말이 주요 피사체로 보인다.
- 390x844에서도 말이 작게 흩어지지 않는다.
- leaderboard 선택 추적이 유지된다.

## P1B - Conditional Callouts

목표:

- 모든 말 위 이름표가 화면을 덮는 문제를 제거한다.

작업:

- `updateRunnerLabel`과 `positionRunnerLabels`의 표시 정책을 바꾼다.
- 기본 주행 중 callout은 leader와 selected runner 중심으로 제한한다.
- skill, eliminated, winner/qualified는 중요한 이벤트 callout으로 유지한다.
- 일반 주행 중 visible callout 1-2개, 이벤트 중 최대 4개를 목표로 한다.

완료 기준:

- 화면이 이름표 구름처럼 보이지 않는다.
- 이름 목록은 leaderboard에서 확인 가능하다.
- skill/탈락/우승 정보는 계속 보인다.

## P1C - Racecourse Props

목표:

- 주로가 육상 트랙이 아니라 경마 코스로 읽히게 한다.

작업:

- `updateLaneGuides`의 흰 레인 라인을 약화하거나 출발 정렬용으로 제한한다.
- 출발 게이트 또는 출발 라인 구조물을 추가한다.
- 결승 포스트, 거리 표지판, 관중석/crowd strip 실루엣을 추가한다.
- 기존 `makeRail`을 강화하되 말/기수를 가리지 않게 한다.

완료 기준:

- pre-race 또는 mid-race screenshot에서 경마장 문법이 보인다.
- 장식이 주요 피사체를 가리지 않는다.
- desktop/mobile 모두 UI와 주요 오브젝트가 겹치지 않는다.

## P1D - Visual Test Draft

목표:

- nonblank canvas 검증에서 사용자-visible 품질 검증으로 넘어가는 초안을 만든다.

작업:

- pre-race/mid-race screenshot을 저장하는 테스트를 정리한다.
- visible callout 수가 4개 이하인지 검증한다.
- leaderboard/minimap 겹침 검증을 유지 또는 보강한다.
- 제품에 테스트 전용 상태를 추가하지 않는다.

완료 기준:

- `npm run build` 통과.
- 가능한 경우 `npm run test:render` 통과.
- 실패 시 제품 문제와 테스트 기대값 문제를 분리해 보고한다.

## P2 - Model Cohesion

목표:

- 현재 GLB 조합의 어색함을 통일된 스타일로 대체한다.

세부 단계:

- P2A: 절차형 stylized horse 기본 실루엣 확정.
- P2B: 기수, saddlecloth 번호, 색상/무늬 체계 통일.
- P2C: gallop, 몸통 bob, 꼬리 흔들림, 접지 먼지 연결.

진입 조건:

- P1D까지 완료되어 카메라/라벨/경마장 문법이 먼저 안정돼 있어야 한다.

## P3 - Broadcast Sequence

목표:

- 자동 중계처럼 보이는 race camera sequence를 만든다.

세부 단계:

- P3A: early/mid/final 기본 카메라 흐름.
- P3B: final-stretch와 finish shot.
- P3C: skill/frenzy/helicopter 컷을 기본 경주 흐름에 짧게 통합.

진입 조건:

- P2C까지 완료되어 말/기수 모델과 움직임이 큰 화면에서 버틸 수 있어야 한다.

## P4 - Winner & Capture

목표:

- 결과 장면이 행사장에서 캡처/공유 가능한 품질이 되게 한다.

세부 단계:

- P4A: winner circle 또는 결승선 우승자 클로즈업.
- P4B: 결과 screenshot/video capture 레이아웃 정리.

## P5 - Verification Operating Set

목표:

- 그래픽 품질 검증이 다시 nonblank canvas 수준으로 후퇴하지 않게 한다.

세부 단계:

- P5A: 고정 seed 기반 visual regression screenshot set.
- P5B: 수동 QA 체크리스트와 보고 형식 정리.

## 다음 구현 세션 권장 범위

그래픽 리워크 index의 계획된 P0-P5B는 완료 상태다.

다음 작업이 필요하면 `docs/graphics-rework-manual-qa-checklist-2026-06-12.md`로 수동 확인을 먼저 진행한 뒤, 발견한 항목만 별도 polish phase로 새 index를 만든다.
