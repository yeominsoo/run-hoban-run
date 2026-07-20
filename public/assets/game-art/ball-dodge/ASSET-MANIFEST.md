# Ball Dodge asset manifest

- 생성일: 2026-07-20
- 생성 경로: Codex 내장 `image_gen`
- 용도: `볼 피하기 + 수집` Canvas 플레이 오브젝트
- 후처리: 단색 크로마키 제거 후 알파 WebP 변환

## Files

| 파일 | 역할 | 런타임 표시 |
|---|---|---|
| `player-rabbit.webp` | 민트색 토끼 비행선 플레이어 | 64×64 CSS px |
| `hazard-meteor.webp` | 코랄색 가시 운석 | 34×34 CSS px |
| `collectible-star.webp` | 골드색 별 수집물 | 34×34 CSS px |

세 파일 모두 1254×1254 RGBA WebP이며 투명 모서리와 알파 채널을 확인했다. 브라우저가 이미지를
불러오지 못하면 기존 Canvas 원형 렌더러를 대체 경로로 사용한다.

## Prompts

### Player

> One adorable mint-colored flying rabbit mascot piloting a tiny round star pod, front-facing three-quarter
> view, energetic but readable at 48 pixels, polished 2D sticker illustration with thick dark plum outline,
> simple two-step cel shading, centered on a flat solid green chroma-key background.

### Hazard

> One coral-red spiky meteor with a mischievous angry face, compact round body, unmistakably dangerous and
> readable at 32 pixels, polished 2D sticker illustration with thick dark plum outline, centered on a flat
> solid green chroma-key background.

### Collectible

> One cheerful golden five-point star collectible with a tiny friendly face and a mint sparkle accent,
> unmistakably rewarding and readable at 28 pixels, polished 2D sticker illustration with thick dark plum
> outline, centered on a flat solid green chroma-key background.

세 프롬프트 모두 문자·로고·워터마크·바닥 그림자를 금지하고 피사체 내부에 크로마키 색을 사용하지
않도록 지정했다.
