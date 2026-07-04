# 파티게임 3종 확장 — 인수인계 문서 (2026-07-03)

## 배경 / 목표

사용자가 새 파티게임 3종을 순서대로 추가하고 싶어 함: **라이어게임 → 마피아게임 → 할리갈리**.
리스크를 낮추기 위해 한 개씩 순서대로 구현·배포하기로 확정(한 번에 다 설계하지 않음).
이 문서는 **라이어게임·마피아게임까지 완료된 시점**에서, 다음 세션이 할리갈리부터 이어받을 수
있도록 남기는 인수인계 문서다.

## 진행 상황

| 게임 | 상태 | 커밋 |
|---|---|---|
| 라이어게임 (`/liar`) | ✅ 완료, WAS+Firebase 배포 완료 | 푸시된 해시 `7251621` |
| 마피아게임 (`/mafia`) | ✅ 완료, WAS+Firebase 배포 완료 | 푸시된 해시 `cd45e89` |
| 할리갈리 (`/halligalli`) | ✅ 구현 완료(로컬 검증 완료) — WAS/Firebase 배포는 미실행 | 이 브랜치 |

**파티게임 3종 확장이 전부 구현 완료됐다.** 할리갈리는 `ws-server/halligalli.mjs`(서버) +
`src/pages/halligalli/main.ts`+`halligalli.css`(클라이언트)로 구현했고, raw WS 스크립트로
생성→참가→시작→순서대로 뒤집기→오답/정답 종치기→재접속→이탈 시 카드 재분배→카드 독식 종료까지
전체 시퀀스를 검증했다(아래 "할리갈리 구현 노트" 참고). **WAS 실서버 반영과 Firebase 배포는 이
세션에서 수행하지 않았다** — 샌드박스 환경이라 실제 WAS(`58.228.188.17`)에 SSH 접근이 불가능하기
때문. `ws-server/README.md`의 "재배포 절차"를 그대로 따라 WAS에 `halligalli.mjs` 반영 + WAS의
`~/rps-tls/nginx.conf`에 `/halligalli` location 수동 추가 + `docker restart rps-tls`까지 해야
실제 서비스에 반영된다.

허브 페이지(`src/pages/hub/main.ts`)에는 이제 할리갈리 카드도 추가되어 있다.

## 라이어게임에서 확립한 재사용 패턴 (마피아/할리갈리도 그대로 따를 것)

### 1. 새 WS 게임을 추가하는 정확한 절차

같은 `ws-server` Node 프로세스, 같은 포트(8787/컨테이너, 30081/WAS 호스트), 같은 TLS/도메인을
재사용하고 새 WebSocket 경로만 추가한다. **주의**: `ws` 라이브러리는 같은 `httpServer`에
`new WebSocketServer({ server, path })`를 여러 개 붙이는 것을 지원하지 않는다 — 먼저 등록된
인스턴스가 자기 path와 안 맞으면 그 자리에서 즉시 HTTP 400을 응답해버려서, 나중에 등록된
서버(예: `/liar`)가 처리할 기회조차 없이 연결이 끊긴다(라이어게임 구현 중 실제로 겪은 버그).
그래서 **모든 게임 서버 모듈은 `noServer: true`로 생성**하고, `ws-server/server.mjs` 하단의
공용 `httpServer.on('upgrade', ...)` 라우터가 `req.url`을 보고 해당 wss의 `handleUpgrade`를
수동으로 호출하는 구조를 쓴다. 새 게임(예: 마피아 `/mafia`)을 추가할 때:

1. `ws-server/mafia.mjs` 신규 작성 — `export function registerMafiaServer() { const wss = new WebSocketServer({ noServer: true }); wss.on('connection', ...); return wss; }` (raw `WebSocketServer` 생성자에 `server`/`path` 옵션을 주지 않는다 — `ws-server/liar.mjs`를 그대로 템플릿으로 복사해서 프로토콜만 새로 짜면 됨)
2. `ws-server/server.mjs` 상단에 `import { registerMafiaServer } from './mafia.mjs';` 추가
3. `server.mjs`의 `httpServer.on('upgrade', ...)` 라우터에 분기 추가:
   ```js
   const mafiaWss = registerMafiaServer();
   httpServer.on('upgrade', (req, socket, head) => {
     const pathname = req.url.split('?')[0];
     if (pathname === '/rps') { wss.handleUpgrade(...); }
     else if (pathname === '/liar') { liarWss.handleUpgrade(...); }
     else if (pathname === '/mafia') { mafiaWss.handleUpgrade(req, socket, head, (ws) => mafiaWss.emit('connection', ws, req)); }
     else { socket.destroy(); }
   });
   ```
4. `ws-server/Dockerfile`은 이미 `COPY *.mjs ./`로 글롭 처리돼 있어 새 `.mjs` 파일 추가 시 별도 수정 불필요
5. `ws-server/nginx.conf`(저장소 사본)에 `/mafia` location 블록 추가 (기존 `/rps`, `/liar` 블록과 동일 패턴 복붙)
6. **WAS 배포 시 `~/rps-tls/nginx.conf`(실제 서비스 중인 사본, 저장소 파일과 별개)에도 수동으로 반영**하고 `docker restart rps-tls` — 이걸 빼먹으면 저장소 파일만 바뀌고 실제로는 여전히 404/연결거부
7. `ws-server/README.md`에 새 게임 섹션 추가

### 2. 새 정적 페이지(entry)를 추가하는 체크리스트

라이어게임 추가 시 다음 5곳을 전부 고쳐야 했다 — 마피아/할리갈리도 동일:

1. `<game>/index.html` 신규 (저장소 루트, `race/team/dice/rps/liar`와 동일 패턴)
2. `src/pages/<game>/main.ts` + `<game>.css` 신규
3. `vite.config.ts`의 `rollupOptions.input`에 항목 추가
4. `firebase.json`의 `hosting.headers`(no-cache) + `hosting.rewrites`(`/​<game>`, `/​<game>/**`) 양쪽에 추가
5. `src/pages/hub/main.ts`에 카드 추가 + `src/pages/hub/hub.css`에 아이콘(`.​<game>-mark`) 추가
6. `.env.example`에 `VITE_<GAME>_WS_URL=` 항목 추가 (WS 서버가 필요한 게임만)
7. `deploy/k8s/base/firebase-deploy-job.yaml`에 ArgoCD 자동배포용 `VITE_<GAME>_WS_URL` env 추가 (WS 서버가 필요한 게임만)

### 3. 클라이언트 골격 재사용

`src/pages/liar/main.ts`가 `src/pages/rps/main.ts`에서 가져온 재사용 가능한 뼈대(그대로 복붙해서
프로토콜만 바꾸면 됨):
- `setPhase`/`messageGeneration` 카운터 가드 패턴
- `localStorage` 세션 저장(`SESSION_KEY`) + 재입장 배너 + `rejoin` 흐름
- `connect()`/`beginReconnect()`/재접속 유예 UX
- entry 화면(닉네임 + 방만들기/참가하기 탭), 로비 화면(참가자 리스트 + 호스트 시작 버튼)

### 4. 서버 측 재사용 패턴 (`ws-server/liar.mjs`가 템플릿)

- `rooms = new Map()`, `wsIdentity = new Map()` — 게임마다 완전히 독립된 상태(다른 게임 모듈과 공유하지 않음)
- 토큰 발급(`randomUUID()`), 방 코드 생성(`genRoomCode`, sha256 해시 앞 6자리)
- `RECONNECT_GRACE_MS = 45000` 유예 후 `finalizeLeave`
- `broadcastLobbyUpdate` (참가자 이름/호스트여부/연결상태)
- **서버 권위 원칙**: 비공개 정보(라이어의 제시어, 마피아의 팀 명단 등)는 "값을 숨기는" 게 아니라
  해당 필드 자체를 payload에 만들지 않는 방식으로 전송한다. 재접속 스냅샷에도 동일하게 적용 —
  가장 실수하기 쉬운 지점이니 구현 후 반드시 raw WS 프레임(JSON 문자열)에 그 키가 문자 그대로
  없는지 직접 확인할 것.

### 5. 검증 방법 (라이어게임에서 실제로 사용, 재사용 가능)

- **서버 프로토콜 정밀 검증**: `ws` 패키지로 raw 클라이언트 여러 개를 스크립트에서 직접 접속시켜
  전체 시퀀스(생성→참가→시작→진행→종료)를 수동으로 왕복. 타이밍이 빠른 메시지를 놓치지 않도록
  "메시지 큐 + `waitFor(queue, type)`로 큐에서 찾아 소비" 패턴을 쓸 것(`onNextOfType`처럼 매번
  새 리스너를 등록하는 방식은 빠르게 연달아 오는 메시지를 놓치는 레이스 컨디션이 있었음 — rps
  배틀로얄 검증 때 실제로 겪음).
- **안티치트 검증**: 비공개 정보를 가진 역할로 접속한 클라이언트가 받는 프레임의 raw JSON
  문자열에 해당 키가 없는지 `!raw.includes('"word"')` 같은 방식으로 직접 확인.
- **Playwright 다중탭 통합 테스트**: 로컬 `npm run dev` + 로컬 ws 서버로 여러 탭을 띄워 전체
  플로우가 크래시 없이 끝까지 진행되는지 확인.
- **프로덕션 마무리**: WAS 배포 후 실제 `wss://toris-arcade.duckdns.org:30080/<game>`으로 raw
  클라이언트 왕복 확인 → Firebase 배포 후 라이브 번들 해시 확인 → Playwright로 실제 프로덕션
  URL에서 스모크 테스트.

## 다음 작업: 마피아게임 — 사용자가 확정한 요구사항

**(2026-07-04 업데이트: 아래는 실제로 구현·배포 완료됨. 확정된 최종 규칙만 남긴다.)**

- **역할 구성**: 인원수별 자동 배치 — 4명(마피아1+시민3) → 5~6명(+경찰1) → 7~9명(+의사1) →
  10~12명(마피아 2명으로 증가). 최소 인원 4명, 최대 12명.
- **진행 사이클**: 밤(30초, 마피아 살해/경찰 조사/의사 보호) → 낮(60초, 자유채팅과 처형투표를
  하나의 `day` phase 안에서 동시 진행) 반복, 전원 행동 완료 시 타이머보다 먼저 조기 종료.
- **동률 처리**: 라이어게임과 동일하게 1회 재투표, 재투표도 동률이면(또는 투표가 아예 없으면)
  처형 없이 다음 밤으로 자동 진행.
- **종료 조건**: 생존 마피아 0명 → 시민 승리, 생존 마피아 수 ≥ 생존 시민(경찰+의사+일반시민 합)
  수 → 마피아 승리.
- **안티치트**: 마피아에게만 `role_assigned.teammates`(다른 마피아 명단)를 보내고, 그 외 역할은
  이 필드 자체가 없음. 경찰의 조사 결과(`police_result`)는 본인에게만 개별 전송.
- 구현체: `ws-server/mafia.mjs`(서버), `src/pages/mafia/main.ts`+`mafia.css`(클라이언트).

### 구현 중 발견한 중요한 설계 교훈 (할리갈리에도 적용할 것)

**생존자/대상 목록은 이름 문자열 배열이 아니라 `{token, name}` 쌍의 배열로 보내라.** 처음에
`night_start`/`day_start`에 `aliveNames: string[]`만 보냈다가, 클라이언트가 "이름으로 화면에
버튼을 그리고 → 그 버튼 클릭 시 서버에 토큰으로 지목 메시지를 보내야 하는" 구조에서 이름→토큰
역매핑을 할 방법이 없어 완전히 죽은 기능이 되는 버그를 만들었다(`findTokenByName`가 항상 null
반환). 이후 `alive: [{token, name}]` 형태로 바꿔서 해결했다 — **동명이인 처리, 클릭 대상 지목이
필요한 모든 메시지는 처음부터 `{token, name}` 쌍으로 설계할 것.** 할리갈리의 "누가 먼저 종
쳤는지" 같은 판정 결과도 이름이 아니라 토큰 기반으로 식별해야 동일한 함정을 피할 수 있다.

## 할리갈리 — 완료 (구현 노트)

**(2026-07-04 업데이트: 아래는 실제로 구현·로컬 검증 완료됨. 확정된 최종 규칙과 교훈만 남긴다.)**

- **규칙**: 2~6명, 4종 과일(딸기/라임/바나나/포도, 카운트 1~5) 56장을 라운드로빈으로 균등 분배.
  정해진 순서대로 한 명씩만 `submit_flip`(20초 미행동 시 자동 스킵), 아무나 언제든 `submit_ring`
  가능. 전원의 "현재 앞면 맨 위 카드"만 합산해 특정 과일 합이 정확히 5가 되는 순간 종을 치면 정답
  (전원의 앞면 카드를 전부 획득), 아니면 오답(자기 뒷면 카드에서 한 장씩 다른 전원에게 지급).
  승리 조건은 카드 56장 전부 독식.
- **서버 수신 순서 기반 판정** 확정: 클라이언트 타임스탬프는 신뢰하지 않고 Node 이벤트 루프의
  메시지 수신(=처리) 순서를 그대로 판정 기준으로 쓴다.
- **구현 중 발견한 버그 (중요)**: 처음에는 "첫 종치기 처리 중 유예(`resolvingRing`)"를 오답이든
  정답이든 모든 종치기 시도에 걸었다. 그 결과 한 명이 실수로 오답 종을 치면, 그 직후
  `RING_RESOLUTION_WINDOW_MS`(350ms) 동안 **진짜 정답 조건이 떠도 아무도 종을 칠 수 없게 막혀버리는**
  회귀가 생겼다(로컬에서 5개 이상의 빠른 뒤집기가 350ms 안에 몰릴 수 있어 실제로 재현됨). 고쳐서
  **유예는 "정답이 처리된 직후"에만 걸고, 오답끼리는 서로를 막지 않도록** 했다(`ws-server/halligalli.mjs`의
  `submitRing` 참고) — 이 유예의 목적은 오직 "정답 직후 아주 살짝 늦게 도착한 다른 사람의 종치기가
  이미 비워진 보드를 보고 억울하게 오답 벌칙을 받는 것"을 막는 것뿐이며, 그 외의 모든 종치기 판정을
  지연시키면 안 된다는 게 핵심 교훈이다.
- 카드 셔플/뒤집기 애니메이션은 Three.js 없이 순수 CSS(`hg-flip-in` 3D rotateY 트랜지션, 종치기
  버튼 흔들림 애니메이션)로 구현.
- **검증**: raw `ws` 스크립트로 오답/정답 종치기, 재접속, 이탈 시 카드 재분배(카드 총량 보존 확인),
  최소 인원 미만 시 즉시 종료, 5000턴 가까이 자동 진행시켜 카드 총량 불변 확인, 68턴 만에 카드
  독식으로 종료되는 경로까지 확인. Playwright로 로비→게임 화면→뒤집기→오답 토스트까지 시각 확인.
  **WAS 실서버/Firebase 배포 자체는 미실행** — 다음에 배포할 세션은 `ws-server/README.md`의
  재배포 절차를 그대로 따르면 된다.

## 참고: 이번 라이어게임 작업의 전체 계획 원본

`/root/.claude/plans/kind-rolling-honey.md` (이 세션의 plan mode 산출물, 아직 로컬에만 존재 —
필요하면 이 문서에 내용을 병합해도 됨). 라이어게임 룰 설계, 파일 목록, 프로토콜 메시지 표,
동률 처리 규칙 등 상세 설계가 들어있다.
