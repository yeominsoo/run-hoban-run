# Mole Hunt asset manifest

- 생성일: 2026-07-20
- 생성 경로: Codex 내장 `image_gen`
- 용도: `두더지 사냥` 활성 타깃
- 후처리: 단색 크로마키 제거 후 알파 WebP 변환

## File

| 파일 | 규격 | 역할 |
|---|---|---|
| `mole.webp` | 1254×1254 RGBA WebP, 약 40KB | 9개 홀에서 공용으로 사용하는 두더지 |

브라우저가 이미지를 불러오지 못하면 CSS로 그린 갈색 두더지 얼굴을 표시한다. `active`, `hit`,
`miss` 상태는 같은 파일에 기존 CSS 이동·회전 애니메이션을 적용한다.

## Prompt

> One adorable brown mole popping up from the waist, front-facing, two small paws raised, round pink nose,
> cheerful surprised expression, compact silhouette readable at 48 pixels, polished 2D sticker illustration
> with thick dark plum outline and two-step cel shading, centered on a flat solid green chroma-key background.

문자·로고·워터마크·바닥·구멍·흙·그림자를 제외하고 피사체 내부에는 크로마키 색을 사용하지 않도록
지정했다.
