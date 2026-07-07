# 윷놀이/전략윷놀이 그래픽 UX 인수인계 (2026-07-07)

## 목적

사용자가 지적한 핵심 문제는 **윷놀이와 전략윷놀이가 지나치게 텍스트 버튼 중심이라 재미가 약하다**는 점이다.
현재 화면은 파스텔 톤과 3D 윷판까지는 적용되어 있지만, 실제 플레이 조작은 아직 "윷 던지기", "말 이동",
"그대로/지름길" 같은 텍스트 UI에 크게 의존한다. 다음 세션은 룰을 다시 크게 건드리기보다, 사용자 관점에서
윷을 던지고 말을 고르는 순간을 그래픽 중심으로 바꾸는 작업부터 이어가면 된다.

## 현재 상태

현재 `master`/`origin/master`는 동기화되어 있고, 최근 관련 커밋은 다음과 같다.

| 커밋 | 내용 |
|---|---|
| `dbe1dbc` | 파스텔 아케이드 UI 적용, 윷놀이/전략윷놀이 보드 프레이밍 개선 |
| `15e8e5d` | 재입장 배너 문구 대비 개선 |
| `5e6d2b1` | 윷놀이/전략윷놀이 룰 수정: 윷/모 보너스, 자동 던지기/자동 이동, 공통 시작점/도착점 |
| `e9ec6ab` | Firebase deploy revision 자동 커밋 |

구현되어 있는 그래픽 요소:

- `src/render/yutnori-board.ts`
  - Three.js 기반 원형 윷판 판/칸 마커 생성.
  - 외곽/코너/대각선/중앙 칸 색상 구분.
  - `YUTNORI_BOARD_SCALE = 1.6`, 카메라를 멀리 잡아 모바일에서 보드가 잘리지 않게 조정.
- `src/render/yutnori-piece.ts`
  - 색상별 저폴리 말 피스 생성.
  - 현재는 작은 토큰형 말에 가깝고, 캐릭터성은 약하다.
- `src/pages/yutnori/yutnori.css`, `src/pages/strategy-yutnori/strategy-yutnori.css`
  - 어두운 네이비 톤에서 파스텔 톤으로 변경.
  - 3D 보드 캔버스와 플레이어 pips, 토스트, 버튼 스타일 정리.
- `src/pages/yutnori/main.ts`, `src/pages/strategy-yutnori/main.ts`
  - 보드/말 렌더링, 말 위치 보간 이동, 시작점 주변 스테이징 배치.

아직 미완료인 그래픽 UX:

- 윷가락 자체가 화면에 없고, 던지기 애니메이션도 없다.
- 던지기 결과가 텍스트 토스트/칩 중심이다.
- 말 선택이 보드 위 피스 클릭이 아니라 하단 텍스트 버튼으로만 이뤄진다.
- 이동 가능한 말/이동 경로/도착 예상 칸 하이라이트가 없다.
- 잡기, 업기, 홈인, 윷/모 보너스 턴의 시각 효과가 없다.
- 전략윷놀이의 앞면/뒷면 제출도 카드/윷가락 그래픽보다는 버튼 중심이다.

## 중요한 룰/배포 주의사항

- 윷놀이 룰은 방금 크게 바로잡은 상태다. 그래픽 UX 작업 중에는 가능하면 룰 엔진을 건드리지 않는다.
- 그래픽 작업만 한다면 `ws-server/` 재배포는 필요 없다.
- WS 프로토콜이나 서버 파일을 건드릴 경우에는 반드시 먼저 `ws-server/README.md`를 읽는다.
- `src/game/yutnori-rules.ts`와 `ws-server/yutnori-rules.mjs`,
  `src/game/strategy-yutnori-rules.ts`와 `ws-server/strategy-yutnori-rules.mjs`는 로직을 같이 유지해야 한다.
- 운영 빌드 시 WS URL은 README처럼 명시해야 한다.

## 추천 작업 순서

### 1. 윷 던지기 그래픽화

대상 파일:

- `src/pages/yutnori/main.ts`
- `src/pages/yutnori/yutnori.css`
- `src/pages/strategy-yutnori/main.ts`
- `src/pages/strategy-yutnori/strategy-yutnori.css`

구현 방향:

- `throwBtn`을 단순 텍스트 버튼에서 큰 윷가락 4개 버튼/패널로 변경.
- 던지기 직후 `pendingThrows` 또는 `lastThrow`를 받아 윷가락 앞/뒤 상태를 그래픽으로 보여준다.
- 기본 윷놀이는 랜덤 결과이므로 결과 표시 전 짧은 흔들림/튀는 애니메이션을 넣는다.
- 전략윷놀이는 앞면/뒷면 선택 자체를 카드/윷가락 토글처럼 보이게 만든다.

주의:

- 기본 윷놀이는 서버가 결과를 정하므로 클라이언트 애니메이션은 장식이어야 한다.
- 테스트 편의를 위해 결과를 클라이언트에서 임의 결정하면 안 된다.

### 2. 말 선택을 보드 피스 중심으로 변경

대상 파일:

- `src/pages/yutnori/main.ts`
- `src/pages/strategy-yutnori/main.ts`
- `src/render/yutnori-piece.ts`

구현 방향:

- 이동 단계에서 내 말 피스에 hover/click 가능한 히트 영역을 만든다.
- Three.js raycaster를 사용해 피스 클릭 시 기존 `submit_move` 메시지를 보내게 한다.
- 텍스트 버튼은 접근성/대체 조작으로 남기되, 시각 우선순위는 낮춘다.
- 선택 가능한 말에는 반짝이는 링/바운스 애니메이션을 붙인다.
- 선택 불가능한 말은 opacity를 낮추거나 idle 상태로 둔다.

주의:

- 업힌 말/갈라치기는 그래픽으로 전부 대체하기 어렵다. 첫 단계에서는 스택 전체 이동을 보드 클릭으로 처리하고,
  갈라치기는 작은 보조 메뉴로 남기는 방식이 현실적이다.

### 3. 이동 경로와 분기 UX 시각화

대상 파일:

- `src/render/yutnori-board.ts`
- `src/pages/yutnori/main.ts`
- `src/pages/strategy-yutnori/main.ts`

구현 방향:

- 이동할 말을 선택하면 가능한 경로 칸을 점선/발자국/글로우로 표시한다.
- 분기 상태(`await_branch`)에서는 코너에서 외곽 방향과 지름길 방향을 시각적으로 강조한다.
- `그대로 외곽으로`, `지름길로` 텍스트 버튼은 보드 위의 두 방향 선택 버튼/화살표처럼 보이게 만든다.

주의:

- 경로 계산을 프론트에서 새로 중복 구현하면 룰과 어긋날 수 있다. 첫 단계에서는 현재 위치와 서버의
  `await_branch` 정보만 사용해 분기 방향을 표시하고, 전체 예상 경로 하이라이트는 별도 후속으로 분리해도 된다.

### 4. 이벤트 효과 추가

대상 파일:

- `src/render/yutnori-piece.ts`
- `src/pages/yutnori/main.ts`
- `src/pages/strategy-yutnori/main.ts`
- 각 CSS

우선순위:

1. 윷/모 보너스: 작은 별/리본/한번 더 배지.
2. 잡기: 잡힌 말이 통통 튀며 시작점으로 돌아가는 효과.
3. 업기: 말이 스택으로 합쳐질 때 살짝 점프.
4. 홈인: 도착점에서 축하 파티클.

## 검증 기준

최소 검증:

```bash
npm run build
npx playwright test tests/yutnori-rules.spec.ts tests/strategy-yutnori-rules.spec.ts
```

그래픽 작업 후 권장 수동/브라우저 검증:

- 로컬 WS 서버 실행: `cd ws-server && PORT=8787 npm start`
- 로컬 Vite 실행: `npm run dev -- --host 127.0.0.1 --port 5176`
- `/yutnori/` 2인 방 생성 후:
  - 던지기 그래픽이 보이는지.
  - 이동 단계에서 내 말이 시각적으로 선택 가능해 보이는지.
  - 윷/모 보너스 턴이 그래픽/문구 모두 자연스러운지.
  - 모바일 390x844에서 윷판/버튼/문구가 잘리지 않는지.
- `/strategy-yutnori/` 4인 방 생성 후:
  - 앞면/뒷면 제출이 카드/윷가락 선택처럼 보이는지.
  - 현재 플레이어의 던지기라는 맥락이 명확한지.
  - 윷/모 보너스가 같은 플레이어에게 이어지는 것이 화면상 자연스러운지.

기존 참고 스크린샷(로컬 임시 산출물, git 추적 아님):

- `/tmp/run-hoban-qa/yut-fix/yut-desktop-host.png`
- `/tmp/run-hoban-qa/yut-fix/yut-mobile-host.png`
- `/tmp/run-hoban-qa/yut-rule-fix/yut-start.png`

## 다음 세션 시작 체크리스트

1. `git status --short --branch`로 현재 작업트리 확인.
2. 이 문서와 `CLAUDE.md`, `AGENTS.md` 확인.
3. WS/서버를 만질 계획이면 `ws-server/README.md` 먼저 확인.
4. 실제 페이지 스크린샷을 한 번 보고, "현재 텍스트 버튼 중심 UX"를 기준 상태로 잡는다.
5. 첫 PR/커밋은 룰 변경 없이 `윷 던지기 그래픽 + 말 선택 시각 표시` 정도로 좁게 시작한다.

## 현재 작업트리 메모

2026-07-07 확인 시점:

- `master...origin/master` 동기화됨.
- 추적되지 않은 `.claude/settings.local.json`이 있음. 내용은 MCP 설정(`runHobanImageGen`)뿐이며,
  UI/UX 구현 작업물은 아니다. 필요 없으면 건드리지 않아도 된다.
