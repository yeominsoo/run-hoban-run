# Graphics Reference Analysis - 2026-06-12

## Current Problem

The current race screen reads more like a debug simulation than a horse racing game.

- The camera is too high and too far away, so the horses are small and visually weak.
- The diagonal orange track and many white lane lines look closer to an athletics track than a horse racing course.
- Runner name tags overlap the horses and each other, turning the race into a label cloud.
- Horse and rider assets are not a cohesive racing pair. The seated rider and horse GLB combination does not sell gallop speed.
- The scene lacks racing context: starting gates, grandstand, crowd strips, distance boards, course rails, dust, shadows, and finish-line framing.
- The pre-race screen has too much empty white/blank scene area.

## Reference Findings

### Rival Stars Horse Racing / Phar Lap Direction

Sources:

- Rival Stars official site: https://www.rivalstarshorseracing.com/
- Rival Stars Steam page: https://store.steampowered.com/app/1166860/Rival_Stars_Horse_Racing_Desktop_Edition/
- Phar Lap PlayStation page: https://store.playstation.com/en-sg/concept/228806

Pattern:

- Uses realistic 3D horses and racing environments.
- Sells the race with motion-captured animation, commentary, and cinematic camera language.
- Common race camera is behind the jockey or low three-quarter view during the final stretch.
- Horses are large in frame. The track, rail, grandstand, and finish stretch support the racing fantasy.
- UI is secondary to the race view. Ranking/progress overlays do not bury every horse under text.

Implication for this project:

- Full realism is too expensive unless we obtain proper horse/rider animation assets.
- The useful lesson is camera and framing: make the focused horse and nearby pack large, readable, and fast.

### Starters Orders Direction

Sources:

- Starters Orders 7 Steam page: https://store.steampowered.com/app/978960/Starters_Orders_7_Horse_Racing/
- Starters Orders official site: https://www.startersorders.com/
- Starters Orders 8 notes: https://www.startersorders.com/so8.html

Pattern:

- Simulation-first, not beauty-first.
- Race presentation uses broad broadcast-style views, pack movement, commentary, form cards, and betting/racing context.
- Lower visual fidelity can still work when the race has clear racing grammar: pack position, rail, course, race cards, odds, photo finish, and commentary.

Implication for this project:

- If we stay simple, the scene still needs horse-racing grammar.
- It is better to show a convincing pack on a recognizable course than a high-poly but awkward asset mashup.

### Pocket Card Jockey / Stylized Direction

Sources:

- Pocket Card Jockey official site: https://www.gamefreak.co.jp/rideon/en/
- Pocket Card Jockey App Store page: https://apps.apple.com/us/app/pocket-card-jockey-ride-on/id1604577143

Pattern:

- Does not chase realism.
- Uses a consistent toy-like/cartoon style and makes the race readable through simple shapes, cute horses, and clear UI.
- The race is part of a larger playful loop, so simplified visuals feel intentional.

Implication for this project:

- This is the better direction for `run-hoban-run`.
- We should make the app look intentionally stylized instead of trying to look realistic with mismatched free GLBs.

### Uma Musume Direction

Sources:

- Umamusume official site: https://umamusume.com/
- Google Play page: https://play.google.com/store/apps/details?id=com.cygames.umamusume

Pattern:

- Strong race spectacle through camera cuts, commentary, crowd energy, and dramatic finish presentation.
- Not directly reusable because the project should remain horse-based and avoid copying characters/world/UI.

Implication for this project:

- Use it only as a pacing reference: opening shot, mid-race tracking, final stretch push, victory celebration.

## Recommended Direction

Use a stylized broadcast-race direction:

- Replace the current realism attempt with cohesive low-poly or mascot-style horse/rider models.
- Keep real horse-racing framing: oval/dirt/turf course, rails, grandstand, finish post, distance boards, dust, shadows.
- Use camera cuts instead of one distant overview:
  - pre-race gate or lineup shot
  - side/broadcast pan for early race
  - low three-quarter pack tracking for mid-race
  - behind/near-leader final-stretch camera
  - finish-line/photo-finish shot
  - winner-circle shot
- Show horse identity through saddlecloth number, color, and focused callout, not permanent labels above every runner.
- Keep the leaderboard as the stable source of names. On-canvas labels should only appear for leader, selected runner, skill event, and winner.
- Make gallop motion, hoof dust, contact shadows, and camera shake the first quality target. These matter more than raw model complexity.

## Do Not Do Next

- Do not keep adding random free GLB assets unless horse, rider, scale, rig, and animation style match.
- Do not add more labels or panels to compensate for unclear visuals.
- Do not tune only colors while leaving the camera and model readability unchanged.
- Do not treat Playwright nonblank canvas tests as visual-quality approval.

## Proposed Next Work

1. Define the target visual style in one screenshot-worthy spec.
2. Prototype one race camera sequence before touching tournament logic.
3. Replace the permanent runner tag cloud with focused callouts.
4. Rework the track into a recognizable horse-racing course.
5. Choose one model strategy:
   - procedural stylized horse/rider with controlled animation, or
   - sourced asset pack with matching horse, rider, and gallop animation.
6. Add visual regression screenshots that check framing:
   - pre-race
   - mid-race pack
   - final stretch
   - finish/winner
