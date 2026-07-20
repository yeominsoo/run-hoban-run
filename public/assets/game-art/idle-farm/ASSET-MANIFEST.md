# 방치형 농장 그래픽 에셋

## `farm-background.webp`

- 제작일: 2026-07-20
- 제작 도구: OpenAI 이미지 생성
- 형식: WebP, 1024×1024, 불투명 배경
- 용도: 6개 DOM 밭 뒤의 저대비 농장 장면
- 원본 프롬프트:
  `Square casual mobile idle-farm game background illustration, cheerful small Korean countryside farm at sunrise, cozy red barn and windmill in the upper third, wooden fence, distant hills, soft clouds and tiny flowers around the edges, broad quiet grassy and lightly tilled foreground reserved for six overlaid interactive plot cards, polished friendly 2D game art, low-contrast pastel cream mint sky-blue and warm earth palette, centered composition with safe crop on all sides, scenery only, no people, no animals, no crop icons, no separate UI panels, no text, no numbers, no logos, no interface, no watermark.`
- 수정 프롬프트:
  `Remove all six large rectangular soil planting beds from the foreground. Replace the entire area where those six beds are with a broad, quiet, low-detail grassy meadow and subtle light-earth texture suitable behind overlaid UI cards. Keep the red barn, windmill, sunrise, hills, fences, trees, flowers around the outer edges, square dimensions, lighting, art style, and every other detail unchanged. Do not add crops, people, animals, text, UI, logos, or new objects.`
- 후처리: 수정된 PNG를 1024×1024 WebP로 변환

밭 버튼, 작물 단계, 진행 바, 남은 시간은 기존 DOM/CSS를 그대로 사용한다. 이미지 로드 실패
시에는 CSS 하늘·초원 배경으로 전환하며 저장·오프라인 성장·자동 수확 계산에는 관여하지 않는다.
