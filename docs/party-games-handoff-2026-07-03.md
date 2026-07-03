# 파티게임 3종 확장 — 인수인계 문서 (2026-07-03)

## 배경 / 목표

사용자가 새 파티게임 3종을 순서대로 추가하고 싶어 함: **라이어게임 → 마피아게임 → 할리갈리**.
리스크를 낮추기 위해 한 개씩 순서대로 구현·배포하기로 확정(한 번에 다 설계하지 않음).
이 문서는 **라이어게임까지 완료된 시점**에서, 다음 세션이 마피아게임부터 이어받을 수 있도록
남기는 인수인계 문서다.

## 진행 상황

| 게임 | 상태 | 커밋 |
|---|---|---|
| 라이어게임 (`/liar`) | ✅ 완료, WAS+Firebase 배포 완료 | `f7adcef`(로컬, rebase 후 해시 변경됨) → 푸시된 해시 `7251621` |
| 마피아게임 | ⬜ 미착수 — 이 문서가 시작점 | — |
| 할리갈리 | ⬜ 미착수 | — |

허브 페이지(`src/pages/hub/main.ts`)에는 완료된 게임만 카드(진입 버튼)가 보인다 — 마피아/할리갈리
카드가 안 보이는 게 정상이며, 만들어야 카드가 생긴다.

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

- **역할 구성**: 기본형 확정 — 마피아 / 시민 / 경찰(조사) / 의사(보호) 4역할, **인원수에 맞게 자동 배치**
  (정확한 배분 비율은 다음 세션에서 설계 시 결정 — 통상적으로 마피아 비율은 전체 인원의 1/4~1/3 수준,
  경찰·의사는 인원이 일정 수 이상일 때만 1명씩 포함하는 방식이 흔함).
- **진행 사이클**: 낮(전체 토론·투표로 처형 대상 지목) → 밤(마피아는 살해 대상 지목, 경찰은 조사,
  의사는 보호 대상 지목) 반복. **밤/낮 전환은 타임아웃 기반으로 자동 진행** — 호스트가 수동으로
  다음 단계를 넘기는 버튼 없이, 정해진 시간이 지나면(또는 전원이 행동을 마치면) 서버가 자동으로
  다음 페이즈로 넘어간다.
- **종료 조건**: 마피아 전멸 시 시민 승리, 마피아 수가 시민 수 이상이 되면 마피아 승리 (표준 규칙,
  필요시 세부 조율).
- 라이어게임보다 **비공개 정보가 많다**(각자 자기 역할 + 마피아는 팀원끼리만 서로를 앎) —
  `role_assigned`류 메시지 설계 시 "마피아에게는 다른 마피아 팀원 명단도 함께 보내되, 시민/경찰/
  의사에게는 절대 안 보낸다"는 팀 단위 공개 규칙을 명확히 설계할 것.
- 낮 투표(처형 지목)와 밤 행동(마피아 살해/경찰 조사/의사 보호)은 서로 다른 메시지 타입으로
  분리하고, 밤 행동은 역할별로 유효한 사람만 보낼 수 있게 서버에서 검증.

## 다음 작업: 할리갈리 — 사용자가 확정한 요구사항

- **온라인 멀티, 서버 판정 방식** 확정 (로컬 한 화면 공유 방식이 아님) — 각자 폰/PC로 접속.
- 핵심 메커니즘은 "같은 과일이 5개가 되면 먼저 종 치기" — **네트워크 지연을 감안한 공정한 판정**이
  필요하다. 클라이언트가 "종 쳤다"고 보낸 타임스탬프를 그대로 신뢰하면 지연시간이 짧은 사용자가
  유리해지므로, 서버가 각 클라이언트로부터 받은 메시지의 **서버 수신 시각 기준으로 선착순 판정**하는
  것이 가장 단순하고 공정한 1차 접근(클라이언트 타임스탬프 신뢰 방식은 조작 위험이 있어 지양).
  다음 세션에서 설계 시 이 판정 방식부터 먼저 정하고 시작할 것.
- 카드 셔플/뒤집기 애니메이션 등 연출은 라이어게임보다 그래픽 요소가 필요할 수 있음(단, `race`처럼
  Three.js까지는 필요 없고 순수 DOM/CSS 애니메이션으로 충분할 것으로 예상).

## 참고: 이번 라이어게임 작업의 전체 계획 원본

`/root/.claude/plans/kind-rolling-honey.md` (이 세션의 plan mode 산출물, 아직 로컬에만 존재 —
필요하면 이 문서에 내용을 병합해도 됨). 라이어게임 룰 설계, 파일 목록, 프로토콜 메시지 표,
동률 처리 규칙 등 상세 설계가 들어있다.
