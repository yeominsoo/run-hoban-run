# 안엘런 지형·장애물 그래픽 개선 (2026-07-21)

## 적용 결과

- 지면 기준을 화면 높이의 `72% → 82%`로 내려 바닥 점유 영역을 `28% → 18%`로 줄였다.
- 하늘 그라데이션, 구름, 태양, 2중 원경 언덕과 장식용 공중섬을 패럴랙스로 구성했다.
- 바닥은 장애물과 같은 소프트 3D 화풍의 반복형 잔디·흙 단면 텍스처로 교체했다. 잔디층,
  뿌리, 지층, 자갈, 암석과 공동이 함께 이동하며 기존 잔디 잎과 꽃 장식을 위에 유지한다.
- 구덩이는 초원 지형이 끊긴 절벽과 어두운 암벽 균열로 표현한다.
- 프로덕션 장애물은 그루터기, 이끼 바위, 가시밭, 공중 잔디 지형, 벌, 파랑새 6종이다.

특정 상용 게임의 캐릭터·블록·파이프·코인·지형을 복제하지 않고 밝고 읽기 쉬운 횡스크롤
플랫포머의 공간감만 참고한 오리지널 그래픽이다.

## 라운드별 난이도

| 라운드 | 신규 요소 | 기본 회피 |
|---|---|---|
| 1 | 그루터기, 공중 잔디 지형 | 장애물 점프, 공중 지형 위 착지 |
| 2 | 이끼 바위, 가시밭, 벌, 구덩이 | 점프, 슬라이드 |
| 3 이상 | 파랑새와 기존 장애물 혼합 증가 | 슬라이드 또는 높은 2단 점프 |

기존처럼 15초마다 라운드가 오르고 속도는 단계 및 라운드 내 경과 시간에 따라 증가한다.
장애물 최소 간격은 라운드마다 감소하되 `270px` 아래로 줄지 않는다. 코인은 가장 가까운
장애물이 지상·구덩이면 점프 높이, 벌·파랑새면 슬라이드 높이로 정렬한다. 공중 잔디 지형
주변 코인은 발판 윗면 위로 배치해 점프·착지 동선을 안내한다.

공중 잔디 지형은 위에서 내려올 때 발 위치를 윗면에 고정하는 착지형 발판이다. 발판이 화면
왼쪽으로 빠져나가면 캐릭터는 자연스럽게 낙하하며, 옆면·아랫면 접촉은 사망 판정에서 제외한다.
벌·파랑새의 충돌 하단은 달리는 캐릭터 머리와 겹치고 슬라이드 캐릭터 위에는 여유가 생기게
설정한다. 비행 생물은 작은 상하 움직임과 날갯짓 연출을 가지지만 안전 통로는 유지한다.

## 그래픽 에셋

- 생성 모드: Codex 내장 `image_gen`; CLI/API 폴백 미사용
- 생성 원본: `output/imagegen/endless-runner-obstacles-2026-07-21/`
- 프로젝트 원본: `endless-runner/assets/obstacles/source/endless-runner-obstacle-atlas.png`
- 투명 런타임 PNG: `endless-runner/assets/obstacles/*.png`
- 자산 계약: `endless-runner/assets/obstacles/manifest.json`
- 지면 생성 원본: `output/imagegen/endless-runner-terrain-2026-07-21/meadow-ground-source.png`
- 지면 프로젝트 원본: `endless-runner/assets/terrain/source/meadow-ground-source.webp`
- 지면 런타임 PNG: `endless-runner/assets/terrain/meadow-ground.png`
- 지면 자산 계약: `endless-runner/assets/terrain/manifest.json`

최종 프롬프트는 현재 소프트 3D 캐릭터 시트를 렌더링 화풍 참조로 사용하고, 2열×3행에
그루터기·가시밭·공중 잔디 지형·벌·파랑새·이끼 바위를 하나씩 배치하도록 작성했다. 각 항목은
작은 모바일 크기에서도 읽히는 굵은 실루엣, 높은 국부 대비, 재질 디테일을 요구했다. 배경은
제거 가능한 평면 `#00ff00`으로 제한하고 특정 게임 프랜차이즈를 연상시키는 파이프·블록·코인·
버섯·성 등의 요소를 금지했다.

이미지 생성기가 만든 미세한 초록 배경 편차는 공식 크로마 제거 도구로 투명화하고, 빌더가
각 셀을 256×256 RGBA로 정규화한다. 원본 아틀라스는 정확한 `#00ff00` 배경으로 보존한다.

지면 최종 프롬프트는 장애물 아틀라스를 화풍 참조로만 사용하고, 화면 전체를 채우는 정측면
초원 단면을 요청했다. 윗부분 10~14%의 잔디층과 아래의 흙 지층·뿌리·돌·작은 공동을 요구하고,
하늘·원근·분리된 발판·캐릭터·동물·텍스트·프랜차이즈 요소는 금지했다. 빌더는 좌우 56px을
대칭 블렌딩해 양 끝 픽셀을 일치시키므로 스크롤 반복 경계가 드러나지 않는다.

## 빌드와 검증

```bash
python3 tools/build_endless_runner_obstacle_assets.py
python3 tools/verify_endless_runner_obstacle_assets.py
python3 tools/build_endless_runner_terrain_assets.py
python3 tools/verify_endless_runner_terrain_assets.py
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/render.spec.ts --grep "endless runner" --workers=1
```

검증 항목은 아틀라스 그리드·SHA-256, 6개 투명 PNG의 크기·투명 모서리·가시 영역, 런타임
에셋 프리로드, 지면 비율, 장애물 카탈로그, 코인 안전 동선, 점프·슬라이드 자동 회피, 충돌 종료,
2단 점프와 캐릭터 GIF 동기화다.

## 검증 결과

| 검증 | 결과 |
|---|---|
| 장애물 에셋 정적 검증 | PASS — 아틀라스 1장, 256×256 투명 PNG 6장 |
| 지면 에셋 정적 검증 | PASS — 프로젝트 원본 1장, 좌우 무봉합 512×512 PNG 1장 |
| `npm run build` | PASS — Vite 7.3.6, 204 modules transformed |
| 무한 러너 Playwright | PASS — 7/7, 공중 발판 하단 통과·윗면 착지 포함 |
| 결정론적 자동 플레이 | PASS — 2라운드 생존, 코인 안전 동선 유지, 실제 장애물 화풍 2종 이상 조우 |
| 모바일 2배 픽셀 시각 QA | PASS — 축소된 바닥, 잔디·흙 지층, 원경, 그루터기·공중 지형·벌 확인 |
