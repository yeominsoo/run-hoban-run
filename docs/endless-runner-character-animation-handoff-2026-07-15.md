# 무한 러너 체크 조끼 소년 8프레임 캐릭터 handoff (2026-07-15)

## 요청과 최종 보정 기준

동일한 남자아이가 나온 사진 3장을 정체성 참조로 사용해 기존 무한 러너 캐릭터와 같은
플랫 스티커·동화책 페이퍼·소프트 3D 토이 3스타일을 추가한다. 첫 생성본에서 웃는 눈이
너무 작거나 감긴 반달선처럼 표현된 문제는 세 번째 사진을 얼굴·눈의 최우선 참조로 삼아
전면 재검수한다.

- 비교적 크고 또렷하게 열린 짙은 무쌍 눈
- 보이는 홍채와 동공, 자연스러운 위·아래 눈 윤곽
- 쌍꺼풀 선, 작은 점눈, 상시 감긴 초승달 눈 금지
- 얼굴에 비해 과장된 애니메이션 눈으로 키우지 않음
- 짧은 검정 보울컷, 일자 앞머리, 둥근 볼, 작은 코, 밝은 치아 미소 유지

대표 복장은 첫 번째 스튜디오 사진의 흰 반소매 칼라 셔츠, 별도 V넥 회색 윈도페인 체크
조끼, 같은 체크의 무릎 위 반바지, 검은 발목 양말, 무브랜드 검정 러닝화와 미색 밑창이다.
다른 사진의 검정 재킷, 숫자 풍선, 스튜디오 배경은 게임 캐릭터에 포함하지 않는다.

## 최종 캐릭터

| 스타일 | 캐릭터 ID | 디자인 참조 |
|---|---|---|
| 플랫 스티커 | `checkered-vest-boy-flat-sticker` | `checkered-vest-boy-flat-sticker-action-sheet.png` |
| 동화책 페이퍼 | `checkered-vest-boy-storybook-paper` | `checkered-vest-boy-storybook-paper-action-sheet.png` |
| 소프트 3D 토이 | `checkered-vest-boy-soft-3d-toy` | `checkered-vest-boy-soft-3d-toy-action-sheet.png` |

기존 두 소녀의 6종을 포함한 제작 자산 9종은 재생성·비교용으로 그대로 보존한다. 최종
게임 선택 UI에는 `pink-glasses-girl-soft-3d-toy`와
`checkered-vest-boy-soft-3d-toy` 두 캐릭터만 사용한다. 표시 이름은 각각 `이엘이`, `이안이`이며
기본값은 이엘이다.
localStorage 키는 유지하고, 구형 소년 화풍 ID는 소년 소프트 3D로 이관하며 꽃모자 또는
알 수 없는 값은 기본 분홍안경 소녀로 정규화한다.

## 이미지 생성 계약

- 모드: Codex 내장 `image_gen`; CLI/API 폴백 미사용
- 디자인: 스타일당 달리기·점프·슬라이딩·넘어짐·회복을 보여 주는 6포즈 참조 1장
- 애니메이션: 스타일당 4×4 시트 2장
  - `*-run-jump-8frame-sheet.png`: 1~2행 RUN 1~8, 3~4행 JUMP 1~8
  - `*-slide-fall-8frame-sheet.png`: 1~2행 SLIDE 1~8, 3~4행 FALL 1~8
- 모든 포즈는 오른쪽을 향한 서로 다른 그림이며 이동·회전·스케일·미러·복제 보간을 금지
- 프레임 시트 배경은 exact `#00ff00`, 인물·그림자·소품은 셀 안에 완전히 수용
- 슬라이드 1~2는 진입, 3~6은 낮고 안정적인 반복 유지, 7은 일어남, 8은 달리기 복귀

눈 보정 프롬프트의 핵심 계약은 다음과 같다.

```text
Use the third photo as the PRIMARY face and eye-shape reference. Preserve relatively large,
clearly open dark monolid eyes with visible iris/pupil and natural upper/lower eye contours.
There must be no double-eyelid crease, no tiny dot eyes, and no permanently squeezed crescent eyes.
Even while smiling, keep enough eye opening that both pupils remain readable. Keep the size
natural for this child and do not turn them into oversized anime eyes. Preserve the same boy,
short dark bowl cut with blunt fringe, rounded cheeks, small nose and broad toothy smile in every pose.
```

## 자산·런타임 계약

- manifest: v4, 인물군과 스타일별 source 분리
- 디자인 참조: 6장
- 4×4 프레임 시트: 18장
- 정규화 PNG: 9캐릭터 × 4액션 × 8프레임 = 288장
- 액션 미리보기 PNG: 36장
- 8프레임 액션 GIF: 36개
- 슬라이드 단계 GIF: 27개 (`enter`, `hold`, `exit`)
- 프레임: `256×256` RGBA, 발 피벗 `(128, 232)`
- 슬라이드: enter 2프레임, hold 4프레임 반복, exit 2프레임
- 프로덕션 런타임: 이엘이(분홍안경 소녀) + 이안이(체크 조끼 소년) 소프트 3D 2종
- 프로덕션 번들: 위 두 디렉터리의 PNG/GIF 22개만 포함

프로젝트에서 사용하는 최종 파일은 다음 경로에 있다.

- 디자인 참조: `endless-runner/assets/characters/sources/`
- 4×4 원화 시트: `endless-runner/assets/characters/frame-sheets/`
- 캐릭터별 PNG/GIF: `endless-runner/assets/characters/checkered-vest-boy-*/`
- 전체 계약과 경로: `endless-runner/assets/characters/manifest.json`
- 이미지 생성 최종 입력: `output/imagegen/endless-runner-characters-2026-07-15/`,
  `output/imagegen/endless-runner-8frame-2026-07-15/`,
  `output/imagegen/endless-runner-8frame-2026-07-21/`,
  `output/imagegen/endless-runner-8frame-2026-07-24/`

생성·검증 명령은 다음과 같다.

```bash
python3 tools/build_endless_runner_character_assets.py
python3 tools/build_endless_runner_character_assets.py \
  --only-character checkered-vest-boy-soft-3d-toy \
  --only-action run
python3 tools/verify_endless_runner_character_assets.py
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:<PORT> npx playwright test tests/render.spec.ts --grep "endless runner"
npm run test:render
```

## 최종 검증 결과

| 검증 | 결과 |
|---|---|
| 이미지 입력 인벤토리 | PASS — 최신 디자인 3장과 4×4 시트 6장만 두 2026-07-15 출력 폴더에 유지 |
| 눈·정체성 시각 QA | PASS — 디자인 18/18포즈, 신규 프레임 96/96포즈에서 열린 무쌍 눈과 홍채·동공 확인 |
| 프레임 시트 구조 | PASS — 6장 모두 1254×1254 RGB, exact `#00ff00` 외곽선, 시트당 연결 피사체 16개, 슬롯당 1개, 경계 접촉 0 |
| 슬라이드·넘어짐 시각 QA | PASS — 세 스타일 모두 slide 1~2 진입, 3~6 저자세 유지, 7 일어남, 8 달리기 복귀 및 fall 1~8 변화 확인 |
| 자산 정적 검증 | PASS — 디자인 6장, 프레임 시트 18장, PNG 288장, 액션 GIF 36개, 슬라이드 단계 GIF 27개 |
| 최신-only 프로젝트 인벤토리 | PASS — manifest 포함 412개, 9캐릭터 폴더만 유지, 임시 staging·`__pycache__` 없음 |
| `npm run build` | PASS (2026-07-21) — Vite 7.3.6, 195 modules transformed |
| 런타임 번들 | PASS (2026-07-21) — 두 소프트 3D 캐릭터 파일 22개만 포함, 플랫 파일 0개 |
| 무한 러너 Playwright | PASS (2026-07-21) — 6/6, 구형값 이관·GIF 액션·연속 입력·2단 점프·충돌 확인 |
| `npm run test:render` | 이전 기준 PASS — 103/103; 2종 축소 후에는 무한 러너 5/5만 재실행 |

소프트 3D 슬라이드 2번은 최초 정적 검증에서 크로마 제거 후 저알파 신발 가장자리 때문에
검증 기준선이 피벗보다 3px 높게 계산됐다. 빌더가 허용 범위 2px를 넘는 프레임만
`alpha >= 96` 가시 기준선으로 재정렬하도록 보정했다. 기존에 통과하던 프레임은 이동하지
않으며, 전체 자산 재빌드 후 정적 검증과 모든 테스트를 다시 통과했다.

## 2026-07-21 런타임 품질 승격

첫 단계에서는 새 캐릭터를 재생성하지 않고, 이미 정체성·복장·8프레임 동작·피벗 검증을
통과한 소프트 3D 토이 세트를 프로덕션 런타임으로 승격했다. 256×256 원본은 실제 최대 112px
표시 크기에 맞춰 사용하며, 플랫 스티커보다 머리카락·옷감·신발의 재질과 입체감이 잘 드러난다.
화면에서는 채도·대비와 밝은 가장자리 및 바닥 그림자를 소폭 보강했다. 물리 판정, 발 피벗,
액션 타이밍은 변경하지 않았고 프로덕션 번들도 동일하게 22개 파일만 포함한다.

첫 승격본은 작은 화면에서 기존과 차이가 충분히 드러나지 않아 4×4 원화 시트 4장을 다시
제작했다. 캐릭터가 각 셀을 더 크게 채우고 머리카락·직물·안경과 신발 재질의 국부 대비가
선명하게 보이도록 했다. 추가 피드백에 따라 두 캐릭터의 발목, 신발 앞코, 밑창 홈과 좌우 발
겹침도 별도 이미지 편집으로 재보정했다. 게임 캐릭터는 모바일 92px, 최대 112px로 키우고
선택 미리보기는 모바일 62px로 확대했다. 생성 원본은
`output/imagegen/endless-runner-8frame-2026-07-21/`, 프로젝트 원화는
`endless-runner/assets/characters/frame-sheets/`에 보존한다.

### 최종 생성 입력 SHA-256

| 파일 | SHA-256 |
|---|---|
| `checkered-vest-boy-flat-sticker-action-sheet-v1.png` | `015f7cfc093a8524eeb6094720c93314f00c2ed1f1de1f60c3ffeac152c956f7` |
| `checkered-vest-boy-flat-sticker-run-jump-8frame-sheet.png` | `b53b107b561762c0dcd2243da7ea023d98a5af8c6c52219874690f2a7c1e8fc8` |
| `checkered-vest-boy-flat-sticker-slide-fall-8frame-sheet.png` | `78044b8f6dd900500b6d589b793e8617630c28fc884bedfd46588273d8d21789` |
| `checkered-vest-boy-storybook-paper-action-sheet-v1.png` | `e8de11bd245e409afa16c1a1f20f32d3e2375c68005527606182277ae2a3d3de` |
| `checkered-vest-boy-storybook-paper-run-jump-8frame-sheet.png` | `e122bae553401cfa5a897d0bb0ee91939765059504e30e46b449c970857e71da` |
| `checkered-vest-boy-storybook-paper-slide-fall-8frame-sheet.png` | `926ce8355ba8c3aee3fd83f2991b49caf7557160b6a0baebdd09f549c3911fb6` |
| `checkered-vest-boy-soft-3d-toy-action-sheet-v1.png` | `d590a3623d44bd474a35b7b19d378617748f92da057921e2a1d996364db6436d` |
| `checkered-vest-boy-soft-3d-toy-run-jump-8frame-sheet.png` | `2248e12cace38608d2336474510e03109fc0716728e2a015c7ecd391cc5beaf0` |
| `checkered-vest-boy-soft-3d-toy-slide-fall-8frame-sheet.png` | `ecb643aa1690965cdc3b79ea6ea049ce45fe43ee97b97de456aa1a36569204b4` |

### 2026-07-21 품질 보정 시트 SHA-256

| 파일 | SHA-256 |
|---|---|
| `pink-glasses-girl-soft-3d-toy-run-jump-8frame-sheet.png` | `1e49c61a1fe8bd07551fa53771400ed04e40f83815cc3224c9858e14488a0608` |
| `pink-glasses-girl-soft-3d-toy-slide-fall-8frame-sheet.png` | `554fafe92c5a27b192aa33c92884429dc7a1e631d0bce076c4e8772d2868e080` |
| `checkered-vest-boy-soft-3d-toy-run-jump-8frame-sheet.png` | `06950465b6ac3dc5d583e06142194de20f604568facbd8e86461df35978db9bd` |
| `checkered-vest-boy-soft-3d-toy-slide-fall-8frame-sheet.png` | `eea318db93e856e16ea20d3d15f9022115bb861970a1dc3cc92446d7662410d8` |

## Git 상태

- 2026-07-15 생성 작업의 Git 상태 기록은 당시 시점의 이력이다.
- 2026-07-21 소프트 3D 런타임 품질 승격은 검증 후 별도 커밋으로 `master`에 푸시한다.

## 2026-07-23 이안이 달리기 주기 전면 교체

달리는 동안 머리와 몸통이 좌우로 흔들린다는 피드백에 따라 이안이의 소프트 3D 달리기
8프레임을 새로 제작했다. 기존 프레임은 포즈마다 머리 크기와 카메라 각도가 달랐고, 머리의
수평 중심 편차가 17.2px까지 벌어졌다. 새 프레임은 같은 크기와 시점에서
`오른발 접지 → 하강 → 통과 → 상승 → 왼발 접지 → 하강 → 통과 → 상승` 순서로 구성했다.
머리의 수평 중심 편차는 9.7px로 줄었으며, 남은 상하 움직임은 달리기 착지와 도약에 필요한
반동으로 유지했다.

- 생성 방식: Codex 내장 `image_gen` 사용, CLI/API 폴백 미사용
- 프롬프트 핵심: 기존 이안이의 얼굴·체크 조끼·비율을 고정하고, 카메라 이동·확대·몸통
  좌우 흔들림 없이 8단계 러닝 사이클을 제작
- 생성 원본: `output/imagegen/endless-runner-8frame-2026-07-23/`
- 프로젝트 원화:
  `endless-runner/assets/characters/frame-sheets/checkered-vest-boy-soft-3d-toy-run-jump-8frame-sheet.png`
- 프로젝트 원화 SHA-256:
  `3ce411539aa2c4c5425cf80ff7278abcdf9ad5aeecba16bab50bf064843db258`
- 런타임 결과:
  `endless-runner/assets/characters/checkered-vest-boy-soft-3d-toy/checkered-vest-boy-soft-3d-toy-run.gif`
- 변경 범위: 이안이 달리기 원화·8개 투명 프레임·대표 PNG·GIF만 교체하고 점프·슬라이드·
  넘어짐 프레임과 게임 물리·판정·타이밍은 유지

## 2026-07-24 이안이 달리기 상하 흔들림·다리 주기 안정화

2026-07-23 교체본의 좌우 흔들림은 줄었지만, 실제 플레이에서 머리와 몸통이 프레임마다
위아래로 크게 이동해 통통 튀는 느낌이 남았다. 달리기 8프레임의 상체 높이와 카메라를 다시
고정하고 팔·다리만 달리기 순서에 맞게 교차하도록 이미지를 재제작했다. 첫 안정화본은 다리를
크게 벌린 포즈와 두 발을 한꺼번에 접은 포즈가 반복돼 연결이 부자연스러웠다. 최종본은
`접지 → 하강/회수 → 반대발 통과 → 공중` 4단계를 좌우 다리로 대칭 구성하고, 공중 프레임에서만
발을 지면 기준선 위로 올렸다.

| 측정 항목 | 2026-07-23 교체본 | 2026-07-24 최종본 |
|---|---:|---:|
| 전체 실루엣 상단 편차 | 23px | 7px |
| 머리 수평 중심 편차 | 9.7px | 0.9px |
| 머리 수직 중심 편차 | 20.1px | 5.5px |
| 공중 프레임 발 높이 | 지면 고정 | 지면 위 4~9px |

- 생성 방식: Codex 내장 `image_gen` 사용, CLI/API 폴백 미사용
- 프롬프트 핵심: 승인된 이안이의 얼굴·보울컷·체크 조끼·체형·화풍을 유지하고, 카메라와
  머리·어깨·몸통 높이를 고정한 채 다리를 좌우 접지·회수·통과·공중 8단계로 자연스럽게 연결.
  다리 길이·무릎 방향·신발 크기를 동일하게 유지하고 반복 포즈와 양발 동시 접기를 금지
- 생성 최종본:
  `output/imagegen/endless-runner-8frame-2026-07-24/checkered-vest-boy-soft-3d-toy-run-jump-8frame-sheet.png`
- 생성 최종본 SHA-256:
  `42eb849de0f2b2faf2a9f333fa5241936ad5ab3801e08e3e5ffc008623283539`
- 프로젝트 원화 SHA-256:
  `46fa914483986a4f9733f7b85eb4188d492f6c46c16a5ce3fa15411acbc3083b`
- 런타임 결과:
  `endless-runner/assets/characters/checkered-vest-boy-soft-3d-toy/checkered-vest-boy-soft-3d-toy-run.gif`
- 런타임 GIF SHA-256:
  `2f59a0a9109918cc4fd6803a85487ccb8b5e1836addb4bbcc16c0f01e7071924`
- 재발 방지: 머리 수평 중심 9px, 수직 중심 8px, 실루엣 상단 9px 상한과 4·8번 공중
  프레임의 발 기준선 이격 3~14px 검사를 적용
- 변경 범위: `--only-character`와 `--only-action` 부분 빌드로 이안이 `run`만 다시 만들고,
  점프·슬라이드·넘어짐 및 다른 캐릭터 에셋은 바이트 단위로 보존
- 정적 자산 검증: PASS — 디자인 6장, 프레임 시트 18장, PNG 288장, 액션 GIF 36개,
  슬라이드 단계 GIF 27개
- `npm run build`: PASS — Vite 7.3.6, 222 modules transformed
- 안엘런 Playwright: PASS — 13/13, 캐릭터 선택·액션 동기화·연속 입력·안전 코인·발판·
  장애물·모바일 리사이즈·충돌·2단 점프 회귀 확인
