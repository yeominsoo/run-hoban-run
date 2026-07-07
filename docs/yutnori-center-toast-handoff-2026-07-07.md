# 윷놀이 중앙 토스트 + P1 버그 수정 인수인계 (2026-07-07)

## 한 줄 요약

작업(코드 변경)은 **전부 끝났고 검증도 통과**했지만, `.git`/`dist`/`test-results`가
root 소유로 오염되어 **커밋만 못 한 상태**다. root 세션에서 소유권 복구 후 커밋·푸시하면 된다.

## 지금 당장 할 일 (root 세션)

1. 소유권 복구:
   ```bash
   sudo chown -R msyeo:msyeo /home/msyeo/workspace/run-hoban-run
   ```
   (`.git` 내부의 `config`·`index`·`packed-refs`·`ORIG_HEAD`와 여러 `objects/XX`,
   그리고 `dist`·`test-results` 디렉토리가 root 소유라 msyeo가 커밋/빌드/테스트를 못 한다.)

2. 현재 브랜치 확인: **`feat/center-toasts-and-yut-fix`** (커밋 전, 워킹트리에 변경만 있음).

3. 아래 "커밋 절차"대로 커밋 후 푸시.

## 현재 상태

- 브랜치 `feat/center-toasts-and-yut-fix`에 **다른 세션의 윷놀이 보드 개편 작업**
  (정사각형 판·대각선 코너당 2칸·기본 윷놀이 팀전·채팅/리액션)과
  **이번 세션 작업**(P1 버그 수정 + 중앙 토스트)이 **같은 워킹트리에 미커밋으로 섞여** 있다.
- 같은 파일(예: `yutnori-rules.ts`)에 두 작업이 겹쳐 있어 분리 커밋은 어렵다 —
  한 커밋으로 통째로 올리기로 사용자와 합의됨.
- `master`/`origin/master`는 이 브랜치 직전 상태(`b6bbfb3 deploy(firebase)…`)로 동기화돼 있다.

## 이번 세션에서 한 작업 (커밋 대상)

### 1. P1 룰 버그 수정 — 중앙 재통과 시 지름길 재진입 오작동

- `walkForward`의 대각선 진행 판정이 `path.lastIndexOf(CENTER)` (경로 전체에 center가
  있었는지)로 돼 있어, **중앙을 한 번 지난 말이 이후 지름길을 다시 타면 안쪽으로 못 가고
  코너로 튕겨 나가는** 버그가 있었다. 이를 **직전 칸 기준 판정**으로 바로잡았다:
  ```js
  } else if (node.kind === 'diagonal') {
    const prevId = path.length >= 2 ? path[path.length - 2] : undefined;
    const returningFromCenter =
      prevId === CENTER_NODE_ID ||
      (prevId !== undefined &&
        graph[prevId]?.kind === 'diagonal' &&
        cornerIndexOfDiagonal(prevId) === cornerIndexOfDiagonal(currentId) &&
        diagonalStepOf(prevId) > diagonalStepOf(currentId));
    nextId = returningFromCenter ? getDiagonalOuterNext(currentId) : node.next;
  }
  ```
- 죽은 코드(`else if (currentId === ownCornerId)` 안의 `remaining -= 1;`)도 제거.
- `diagonalStepOf` import 추가.
- **4개 파일 동기 수정** (src ↔ ws-server 로직 일치 규칙 준수):
  - `src/game/yutnori-rules.ts`, `src/game/strategy-yutnori-rules.ts`
  - `ws-server/yutnori-rules.mjs`, `ws-server/strategy-yutnori-rules.mjs`
- 회귀 테스트 추가: `tests/yutnori-rules.spec.ts`의
  `a piece that already passed the center can take a shortcut again on a later lap`
  (수정 전이면 실패, 수정 후 통과).

### 2. 모든 게임 일시 알림 → 화면 중앙 토스트

- **신규 공용 모듈**: `src/shared/center-toast.ts` + `src/shared/center-toast.css`
  - `showCenterToast(content, { kind, html, duration })`, `clearCenterToast()`
  - 화면 중앙 상단 고정, 텍스트/HTML 모두 지원, 이전 토스트 자동 대체.
- 적용: `yutnori`·`strategy-yutnori`·`halligalli`의 `showToast`를 중앙 토스트로 전환.
- **rps·liar·mafia는 대상 아님** — 자동으로 사라지는 일시 알림이 없고, 결과 배너가
  페이즈 종속 지속 표시라 토스트로 바꾸면 게임 흐름을 깨뜨린다.

### 3. 윷 던지기 윷가락 이미지 → 화면 중앙 토스트

- `yutnori`: 하단 `yn-yut-sticks` 패널 제거, 던지기 흔들림→결과 윷가락을 중앙 토스트로
  (`yutSticksHtml()` + `showCenterToast(..., { html:true, kind:'throw' })`).
- `strategy-yutnori`: 라운드 확정(`round_resolved`) 시 4명 제출 윷가락을 중앙 토스트로
  (`throwToastHtml()`). "누가 앞/뒤 냈는지" 참고용 하단 `sy-revealed-faces` 패널은 **유지**.
- 공용 CSS의 `.ct-yut-stick`(round/flat/baekdo/tossing) 사용.

### 4. 미사용 CSS 정리

- `yutnori.css`: `.yn-toast`, `.yn-yut-sticks`/`.yut-stick*`/`.yut-throw-value`,
  `@keyframes yut-toss/yut-land/yn-toast-in` 제거.
- `strategy-yutnori.css`: `.sy-toast*`, `@keyframes yn-toast-in` 제거
  (하단 패널용 `.sy-yut-stick`/`.sy-revealed-faces`는 유지).
- `halligalli.css`: `.hg-toast*`, `@keyframes hg-toast-in` 제거.
- 던지기 버튼의 `.mini-yut-stick`/`.throw-yut-set`은 **유지**(다른 세션 작업).

## 검증 상태 (모두 통과)

- 타입: `npx tsc --noEmit` → 0 에러.
- 룰 테스트: **24개 통과** (신규 회귀 테스트 포함).
  - ⚠️ `test-results/` root 오염 때문에 기본 실행이 리포터에서 EACCES로 죽는다.
    권한 복구 전에는 `--output`으로 우회: 
    ```bash
    npx playwright test tests/yutnori-rules.spec.ts tests/strategy-yutnori-rules.spec.ts \
      --reporter=line --output=/tmp/pw-out
    ```
- 빌드: `dist/` root 오염으로 기본 `npm run build`가 rimraf에서 죽는다.
  권한 복구 전에는 `--outDir`로 우회: 
  ```bash
  npx vite build --outDir /tmp/dist-check --emptyOutDir
  ```
  → 정상 빌드 확인함.
- e2e 플레이 테스트(Playwright, 실제 WS+Vite 구동):
  - yutnori 2인: 던지기 중앙 토스트 윷가락 표시, 게임 진행, **콘솔/런타임 에러 없음**.
  - strategy 4인: 카드 제출·라운드 확정 중앙 토스트 윷가락, 게임 진행, **에러 없음**.

## 커밋 절차 (소유권 복구 후)

```bash
cd /home/msyeo/workspace/run-hoban-run
git add src ws-server tests           # .claude/ 와 docs/의 handoff 문서는 제외
git commit -F - <<'MSG'
fix(yutnori): 중앙 재통과 지름길 버그 수정 + 모든 게임 중앙 토스트 통일

- walkForward의 대각선 진행 판정을 path 전체의 center 유무가 아니라 직전 칸
  기준으로 바로잡음(중앙을 지난 말이 지름길을 다시 타도 정상 진입). src/game·
  ws-server 4개 파일 동기 수정 + 회귀 테스트 추가. 죽은 코드도 제거.
- 공용 중앙 토스트 모듈(shared/center-toast) 신설. yutnori·strategy-yutnori·
  halligalli의 일시 알림을 화면 중앙 토스트로 통일.
- 윷 던지기 윷가락 이미지를 화면 중앙 토스트로 표시(yutnori는 하단 패널 대체,
  strategy는 라운드 확정 시 중앙 토스트 + 이동 참고용 하단 패널 유지).
- 미사용 토스트/윷가락 CSS 정리.

주의: 이 브랜치에는 다른 세션의 윷놀이 보드 개편(정사각형 판·대각선 2칸·
팀전·채팅) 미커밋 작업이 함께 포함되어 있다.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG

# 푸시 (AGENTS.md 규칙: 지정 SSH 키 명시)
GIT_SSH_COMMAND='ssh -i /home/msyeo/.ssh/yeominsoo_ed25519 -o IdentitiesOnly=yes' \
  git push -u origin feat/center-toasts-and-yut-fix
```

- `git add src ws-server tests`에는 신규 `src/shared/center-toast.{ts,css}`가 포함된다.
- 제외 대상: `.claude/`(로컬 MCP 설정), `docs/yutnori-graphics-ux-handoff-2026-07-07.md`,
  `docs/yutnori-center-toast-handoff-2026-07-07.md`(이 문서). 필요하면 별도로 커밋.

## 로컬 서버 실행 / e2e 재현 메모

- **포트 8787이 다른(정체불명, PID 안 보임=권한) 프로세스에 점유**되어 있어 재기동이 막힌다.
  이번엔 **8788**로 우회했다:
  ```bash
  cd ws-server && PORT=8788 node server.mjs        # WS
  # Vite에 WS URL 주입
  VITE_YUTNORI_WS_URL=ws://127.0.0.1:8788/yutnori \
  VITE_STRATEGY_YUTNORI_WS_URL=ws://127.0.0.1:8788/strategy-yutnori \
    npm run dev -- --host 127.0.0.1 --port 5176
  ```
  root 세션에서 8787 점유 프로세스를 정리할 수 있으면 기본 포트로 돌려도 된다.
- e2e 스모크 스크립트(임시, git 추적 아님)는 스크래치패드에 있었다(세션 종료 시 사라짐).
  Playwright는 `@playwright/test`를 CJS default import로 써야 한다:
  `import pw from 'file://…/@playwright/test/index.js'; const { chromium } = pw;`

## 남은 후속 / 열린 항목

- **기본 윷놀이 팀전 도입은 기획 확인 권장**: 다른 세션이 4인=2:2, 3인=1:2(비대칭),
  팀원 말 업기를 넣었다. 원래 개인전이던 게임의 게임성이 바뀌므로 의도인지 확인 필요.
- 커밋·푸시 후 필요 시 `npm run deploy:firebase`로 배포(사용자 확인 후).
