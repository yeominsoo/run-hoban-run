# Ball Dodge asset manifest

- 생성일: 2026-07-20
- 플레이어 최종 교체: 2026-07-21
- 생성 경로: Codex 내장 `image_gen`
- 용도: `볼 피하기 + 수집` Canvas 플레이 오브젝트
- 후처리: 단색 크로마키 제거 후 알파 WebP 변환

## Files

| 파일 | 역할 | 런타임 표시 |
|---|---|---|
| `player-star-collector.webp` | 청록색 별 수집 호버크래프트 플레이어 | 64×64 CSS px |
| `hazard-meteor.webp` | 코랄색 가시 운석 | 34×34 CSS px |
| `collectible-star.webp` | 골드색 별 수집물 | 34×34 CSS px |

`player-star-collector.webp`는 512×512 RGBA WebP이며, 나머지 두 파일은 1254×1254 RGBA WebP로
제공한다. 세 파일 모두 투명 모서리와 알파 채널을 확인했다. 플레이어 원본은 크로마키 제거 후
투명 경계 기준 정사각 크롭과 Lanczos 축소를 거쳐 48,058바이트로 최적화했다. 브라우저가 이미지를
불러오지 못하면 기존 Canvas 원형 렌더러를 대체 경로로 사용한다.

## Prompts

### Player

> One polished non-animal star-collector hovercraft, compact round turquoise-and-navy body with a clear glass
> cockpit, small gold star-energy core, two short side thrusters, subtle forward-facing nose and bright cyan
> protective rim, three-quarter top-down view, crisp premium 2D arcade sprite with a strong dark navy outline,
> readable at 48–64 pixels, centered on a flat solid magenta chroma-key background.

### Hazard

> One coral-red spiky meteor with a mischievous angry face, compact round body, unmistakably dangerous and
> readable at 32 pixels, polished 2D sticker illustration with thick dark plum outline, centered on a flat
> solid green chroma-key background.

### Collectible

> One cheerful golden five-point star collectible with a tiny friendly face and a mint sparkle accent,
> unmistakably rewarding and readable at 28 pixels, polished 2D sticker illustration with thick dark plum
> outline, centered on a flat solid green chroma-key background.

세 프롬프트 모두 문자·로고·워터마크·바닥 그림자를 금지하고 피사체 내부에 크로마키 색을 사용하지
않도록 지정했다. 플레이어 교체본은 토끼·동물·사람 얼굴을 제외하고, 위험 운석과 수집 별에서 즉시
구분되는 조종 가능한 기체 실루엣을 우선했다.
