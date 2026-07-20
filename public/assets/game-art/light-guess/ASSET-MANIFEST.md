# 라이트 게스 그래픽 에셋

## `playground.webp`

- 제작일: 2026-07-20
- 제작 도구: OpenAI 이미지 생성
- 형식: WebP, 1024×1024, 불투명 배경
- 용도: 빨간불·초록불 판정 화면의 저대비 운동장 배경
- 프롬프트:
  `Square casual mobile game background illustration for a red-light green-light tapping game, a cheerful Korean school sports field with an oval running track receding toward a simple finish line, tiny generic animal mascot runners far in the background only, soft bleachers and bunting at the horizon, warm morning sky, polished friendly 2D game art, very low contrast pastel mint cream peach palette, wide quiet uncluttered central area and lower foreground reserved for overlaid game controls, safe crop on all sides, background scenery only, no traffic light, no red or green signal circles, no text, no numbers, no logos, no interface, no watermark.`
- 후처리: 원본 PNG를 1024×1024 WebP로 변환

판정에 쓰이는 빨강/초록 신호와 안내 문구는 이미지가 아니라 기존 DOM/CSS로 유지한다. 이미지 로드
실패 시에도 신호·생존자·탭 버튼이 그대로 동작하도록 CSS 트랙 배경으로 전환한다.
