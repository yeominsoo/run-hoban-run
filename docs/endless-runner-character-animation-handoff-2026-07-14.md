# 무한 러너 캐릭터 8프레임 애니메이션 handoff (2026-07-14)

> 2026-07-15 체크 조끼 소년 3스타일과 열린 무쌍 눈 보정은
> `docs/endless-runner-character-animation-handoff-2026-07-15.md`를 최신 기준으로 본다.

## 최종 요청과 적용 범위

기존 4프레임보다 동작을 길고 부드럽게 보이도록 모든 액션을 실제로 다시 그린 8프레임으로
교체한다. 슬라이딩은 고정 길이 GIF 하나로 끝내지 않고 `진입 → 반복 유지 → 일어남`으로
분리해 기본 슬라이드와 추가 입력으로 연장되는 긴 슬라이드를 모두 자연스럽게 표시한다.

‘최신 산출물만 유지’ 기준에 따라 최초 시안, v2 디자인, 기존 4프레임 시트·프레임·GIF는
폐기한다. 프로젝트 밖의 다른 게임 에셋은 정리 범위에 포함하지 않는다.

## 최신 디자인 기준

최신 기준은 `v3-two-girls-dress-corrected` 3장이다. 이전 파이프라인이 v2를 사용하면서
꽃모자 캐릭터를 소년으로 바꾸고 분홍안경 캐릭터의 원피스를 바지 형태로 바꾼 문제를 함께
수정했다.

| 스타일 | 꽃모자 소녀 ID | 분홍안경 소녀 ID |
|---|---|---|
| 플랫 스티커 | `floral-hat-girl-flat-sticker` | `pink-glasses-girl-flat-sticker` |
| 동화책 페이퍼 | `floral-hat-girl-storybook-paper` | `pink-glasses-girl-storybook-paper` |
| 소프트 3D 토이 | `floral-hat-girl-soft-3d-toy` | `pink-glasses-girl-soft-3d-toy` |

- 꽃모자 소녀: 일자 앞머리, 분홍 끈의 낮은 양갈래 땋은 머리, 꽃무늬 버킷햇, 왼쪽 가슴의
  컬러 줄무늬 하트 패치, 분홍 하트 바지, 파스텔 운동화
- 분홍안경 소녀: 흰 보닛, 분홍 둥근 안경, 흰 블라우스, 하나로 이어진 발목 길이 A라인
  세로 줄무늬 원피스, 흰색 클로그

## 이미지 생성 방식과 프롬프트 계약

- 모드: 내장 `image_gen`; CLI/API 폴백 미사용
- 참조: 각 스타일의 최신 v3 시트에서 위·아래 캐릭터를 각각 정체성·복장·질감 기준으로 사용
- 산출: 캐릭터별 4×4 시트 2장, 총 12장
  - `*-run-jump-8frame-sheet.png`: 1~2행 RUN 1~8, 3~4행 JUMP 1~8
  - `*-slide-fall-8frame-sheet.png`: 1~2행 SLIDE 1~8, 3~4행 FALL 1~8

공통 최종 프롬프트 계약은 다음과 같다.

```text
Use case: identity-preserve
Asset type: production source sheet for an eight-frame side-scrolling endless-runner animation
Input image: latest approved v3 character and rendering-style reference
Primary request: create exactly 16 genuinely redrawn full-body poses in a strict implicit 4x4 sheet.
RUN 1-8: A-foot contact, compression, pass, flight, B-foot contact, compression, pass, flight.
JUMP 1-8: anticipation, deep crouch, takeoff, ascent, apex, descent, landing compression, recovery.
SLIDE 1-8: lower, drop, low entry, low hold A, low hold B, low hold C, stand up, running recovery.
FALL 1-8: trip, lost balance, forward pitch, airborne tumble, hands/knees impact, torso down,
fully prone, distinct side-rest with cheek on folded arms and one lower leg bent upward.
Every frame must be a distinct drawing with different limbs, weight, silhouette, cloth and secondary motion.
Never translate, rotate, scale, mirror or duplicate another frame. Always face right. Preserve the exact
v3 identity, face, outfit, proportions, palette and style. Keep SLIDE frames 3-6 equally low and loopable.
One complete character per cell with generous gutters. No text, grid, borders, props, motion marks,
shadows, crop, watermark or extra figures. Flat solid #00ff00 chroma-key background.
```

캐릭터별 프롬프트에는 꽃모자 소녀의 양갈래 땋은 머리·하트 패치와 분홍안경 소녀의
`ONE CONTINUOUS A-LINE DRESS / NEVER pants, romper, overalls or divided hem` 조건을 반복해
복장 드리프트를 막았다.

최종 유사도 감사에서 분홍안경 동화책 캐릭터의 FALL 7·8이 지나치게 비슷해, FALL 8만
내장 `image_gen`으로 한 번 더 독립 생성했다. 이때 사용한 보정 프롬프트 계약은 다음과 같다.

```text
Use case: identity-preserve, targeted replacement for pink-glasses-girl-storybook-paper FALL 08.
References: latest approved v3 storybook design and the existing FALL 07 only as the preceding pose.
Draw one genuinely new right-facing full-body pose, not a warp or transform of FALL 07.
Pose: an exhausted distinct side-rest, cheek on folded forearms, one knee and lower leg bent upward,
eyes gently closed; clearly different silhouette from the fully prone FALL 07 while still fallen.
Preserve the white bonnet, round pink glasses, white blouse, one continuous ankle-length A-line
vertical-striped dress, and white clogs. Never pants, romper, overalls, or divided hem.
Exactly one character; no crop, shadow, text, props, motion marks, watermark, or extra figure.
Solid exact #00ff00 background.
```

보정 포즈를 시트 4행 4열의 기존 연결 성분과 교체할 때 다른 15개 피사체와 교체 영역 밖의
픽셀은 바꾸지 않았다. FALL 7·8의 실루엣 IoU는 `0.9711 → 0.8179`로 낮아졌다.

## 파일 배치와 규격

- 최신 디자인 참조 3장: `endless-runner/assets/characters/sources/`
- 최신 4×4 원화 시트 12장: `endless-runner/assets/characters/frame-sheets/`
- 정규화한 원화 192장: `endless-runner/assets/characters/<캐릭터-ID>/frames/`
- 액션 미리보기 PNG 24장과 8프레임 GIF 24개: 캐릭터별 폴더
- 슬라이드 단계 GIF 18개: 캐릭터별 `slide-enter`, `slide-hold`, `slide-exit`
- manifest: `endless-runner/assets/characters/manifest.json` v3
- 생성·검증: `tools/build_endless_runner_character_assets.py`,
  `tools/verify_endless_runner_character_assets.py`

모든 분리 프레임은 `256×256` RGBA와 발 피벗 `(128, 232)`에 정규화한다. 생성 시트의 배경은
정확한 `#00ff00`으로 정규화하고, border auto-key, soft matte, despill, 1px edge contract로
제거한다.

공중·저자세 포즈가 명목상 4×4 셀 경계를 넘을 수 있으므로 고정 셀 크롭은 사용하지 않는다.
투명화한 전체 시트에서 연결된 완전한 피사체 16개를 검출하고 중심점 순서로 4×4 슬롯에
배정한 뒤 각 피사체 전체를 크롭한다. 생성기와 검증기는 슬롯당 1개, 행·열 중심점 순서,
자기 슬롯 안의 중심점, 외곽선 비접촉, 16개 전부 소진을 강제한다. 최종 192개 PNG도 각각
단일 연결 피사체인지 검사해 이웃 셀 조각과 잘린 포즈의 재발을 차단한다.

생성기는 staging 폴더에서 전체 세트를 성공적으로 만든 뒤 기존 에셋 루트를 교체하므로 ID
변경 뒤 구형 폴더가 남지 않는다.

## 재생 시간과 슬라이드 상태

- run: 8×80ms = 640ms, 무한 반복
- jump: `[70, 70, 80, 90, 100, 90, 90, 100]ms` = 690ms, 1회
- slide 전체 미리보기: `[90, 90, 200, 200, 200, 200, 90, 90]ms` = 1,160ms
- fall: `[90, 100, 110, 120, 130, 150, 180, 220]ms` = 1,100ms, 1회

런타임 슬라이드는 같은 `sliding` 상태 안에서 다음 세 단계로 진행한다.

1. `enter`: 1~2번, 180ms, 1회
2. `hold`: 3~6번, 400ms 주기로 반복; 기본 800ms 유지
3. `exit`: 7~8번, 180ms, 1회

슬라이드 중 다시 입력하면 `enter`를 재생하지 않고 `hold` 종료 시각만 800ms 연장한다.
따라서 일어났다 다시 눕는 반복 없이 긴 슬라이드를 표시하며, 기본 총 시간은 1,160ms다.

## 재생성·검증

```bash
python3 tools/build_endless_runner_character_assets.py
python3 tools/verify_endless_runner_character_assets.py
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:<PORT> npx playwright test tests/render.spec.ts --grep "endless runner"
npm run test:render
```

`output/imagegen/`이 없는 클론에서는 프로젝트에 보존된 최신 `sources/`와 `frame-sheets/`를
입력 폴백으로 사용한다. 크로마 변환에는 Codex imagegen skill의 `remove_chroma_key.py`가 필요하다.

## 검증 상태

| 검증 | 결과 |
|---|---|
| 에셋 정적 검증 | PASS — 최신 v3 디자인 3장, 시트 12장, 프레임 192장, 8프레임 GIF 24개, 슬라이드 단계 GIF 18개 |
| 크로마·분리 품질 | PASS — 12개 시트의 네 외곽선 exact `#00ff00`, 시트당 완전 피사체 16개, 최종 PNG당 단일 피사체 |
| 전체 시트·프레임 시각 QA | PASS — 브라우저에서 6캐릭터 run/jump/fall 각 8, slide 2/4/2, 교정 FALL 07→08 변화와 이웃 조각 부재 확인 |
| 구형 산출물 정리 | PASS — 4프레임, v1/v2, 소년 ID, 임시 staging 및 `__pycache__` 없음 |
| clean clone 재현성 | PASS — `output/imagegen/` 없이 재빌드·검증, 274개 파일 SHA-256 동일 |
| `npm run build` | PASS — Vite 7.3.6, 152 modules |
| 무한 러너 Playwright | PASS — 최종 FALL 08 교정 빌드에서 5/5 |
| `npm run test:render` | PASS — 103/103, 10.2분; 이후 픽셀 크롭 보정은 정적 검증·빌드·무한 러너 5개로 재검증 |

## Git 상태

- 이 작업은 아직 커밋·푸시·배포하지 않았다.
- 현재 작업 전 기준 로컬 `master`와 `origin/master`는 같은 커밋이며, 위 변경은 작업 트리에만 있다.
