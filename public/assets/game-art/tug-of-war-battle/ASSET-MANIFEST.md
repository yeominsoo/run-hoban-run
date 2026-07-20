# 줄다리기 배틀 그래픽 에셋

## `arena.webp`

- 제작일: 2026-07-20
- 제작 도구: OpenAI 이미지 생성
- 형식: WebP, 1024×1024, 불투명 배경
- 용도: 실시간 줄다리기 플레이 패널의 민트 팀 곰·코랄 팀 여우 경기장
- 원본 프롬프트:
  `Square 1:1 casual mobile game illustration, wide tug-of-war action centered across the middle, cute low-poly-inspired mascot bear on the left mint team and fox on the right coral team pulling one thick rope, Korean school festival sports field, soft crowd and flags in the far background, cheerful pastel mint coral cream palette, friendly rounded shapes, clean polished 2D game art, generous uncluttered sky above and grass below for UI safe areas, no text, no logos, no interface, no watermark.`
- 수정 프롬프트:
  `Remove only the small gold center flag or buckle attached to the middle of the rope. Continue the plain twisted rope cleanly through that exact area. Keep the bear, fox, rope position, field, crowd, flags, colors, composition, dimensions, and every other detail unchanged. Do not add text, UI, logos, or any new object.`
- 후처리: 원본 PNG를 1024×1024 WebP로 변환

줄 중앙의 금색 깃발은 서버의 실시간 진행 값과 연결된 DOM/CSS 요소다. 이미지 로드 실패 시에는
동일한 팀 구분을 유지하는 CSS 경기장 배경으로 전환한다.
