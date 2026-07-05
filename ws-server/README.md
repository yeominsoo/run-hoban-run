# WebSocket Server (RPS + 라이어게임 + 마피아게임 + 할리갈리 + 윷놀이 + 전략윷놀이)

가위바위보 대결(`/rps`)·라이어게임(`/liar`)·마피아게임(`/mafia`)·할리갈리(`/halligalli`)·
윷놀이(`/yutnori`)·전략윷놀이(`/strategy-yutnori`)가 함께 쓰는 실시간 서버. 이 저장소의 나머지
게임(레이스/주사위/팀배분)과 달리 정적 파일만으로는 동작하지 않고, 항상 켜져 있는 Node 프로세스
+ WAS 배포가 필요하다. 여섯 게임 모두 **같은 Node 프로세스, 같은 컨테이너, 같은 포트/TLS/도메인**을
공유하고, 서로 다른 WebSocket 경로(`/rps`, `/liar`, `/mafia`, `/halligalli`, `/yutnori`,
`/strategy-yutnori`)와 완전히 독립된 room 상태(`server.mjs` vs `liar.mjs` vs `mafia.mjs` vs
`halligalli.mjs` vs `yutnori.mjs`+`yutnori-rules.mjs`+`yutnori-board.mjs` vs
`strategy-yutnori.mjs`+`strategy-yutnori-rules.mjs`, 보드 그래프 `yutnori-board.mjs`는 두 윷놀이가
공유)로만 나뉜다 — 새 게임을 추가할 때마다 서버/포트/인증서를 새로 만들 필요 없이 이 패턴을
반복하면 된다.

⚠️ **이 파일은 실제 배포 상태를 반영하는 단일 진실 공급원(source of truth)이다.** 다른 세션/환경에서
`/rps`, `/liar`, `/mafia`, `/halligalli`, `/yutnori`, `/strategy-yutnori`나 WAS를 건드리기 전에
반드시 이 파일을 먼저 읽을 것. 이
저장소는 **동시에 여러 Claude Code 세션이 `/rps`를 병렬로 작업한 적이 있다** (2026-07-02~03에 두
세션이 서로 다른 방향으로 완전히 다시 작성해서 나중에 사용자가 한쪽을 골라야 했음). 작업 전에 항상:

```bash
git fetch origin && git log origin/master --oneline -10
```

로 CI의 `deploy(firebase): ... [skip ci]` 봇 커밋 말고 다른 사람의 실제 기능 커밋이 없는지 먼저 확인한다.

## 아키텍처 한눈에 보기

```
사용자 브라우저
   │  https://hoban-lakepark-ab19.web.app/{rps,liar,mafia,halligalli,yutnori,strategy-yutnori}/   (Firebase Hosting, 정적 프론트엔드)
   │  wss://toris-arcade.duckdns.org:30080/{rps,liar,mafia,halligalli,yutnori,strategy-yutnori}   (VITE_RPS_WS_URL / VITE_LIAR_WS_URL / VITE_MAFIA_WS_URL / VITE_HALLIGALLI_WS_URL / VITE_YUTNORI_WS_URL / VITE_STRATEGY_YUTNORI_WS_URL로 빌드 시점에 주입됨)
   ▼
공유기 (58.228.188.17, WAN) ── 포트 30080 포워딩 ──▶ WAS 내부(192.168.75.194)
   ▼
rps-tls 컨테이너 (nginx, --network host, 30080에서 TLS 종료, Let's Encrypt 정식 인증서)
   │  proxy_pass http://127.0.0.1:30081/{rps,liar,mafia,halligalli,yutnori,strategy-yutnori,healthz,ranking}
   ▼
rps-server 컨테이너 (Node, 8787→30081 포워딩)
   │  server.mjs가 /rps를 직접, import한 liar.mjs가 /liar를, mafia.mjs가 /mafia를,
   │  halligalli.mjs가 /halligalli를, yutnori.mjs가 /yutnori를, strategy-yutnori.mjs가 /strategy-yutnori를
   │  같은 httpServer의 noServer 모드 WebSocketServer 6개로 서비스 (수동 upgrade 라우팅)
   │  랭킹(rps 전용)은 파일 기반: /app/data/ranking.json (named volume rps-server-data)
   │  라이어게임/마피아게임/할리갈리/윷놀이/전략윷놀이는 인메모리 상태만 사용 — 랭킹/영속화 없음, 방이 끝나면 소멸
```

WAS 자체는 공인 IP를 가진 공유기 뒤의 홈서버이고, k8s(ArgoCD가 다른 앱들 관리) +
독립 Docker 컨테이너가 같이 떠 있다. `run-hoban-run` 프론트엔드 자체는 k8s에도 배포되지만
그건 ClusterIP뿐이라 외부에 안 열려있고, **실제 서비스되는 프론트엔드는 Firebase Hosting**이다.
`/rps`의 백엔드만 이 WAS에서 plain `docker run`으로 직접 운영 중이며, k8s로 배포하려던 시도는
있었지만(`ws-deployment.yaml`/`ws-service.yaml`) 되돌려졌다 — **지금은 k8s로 관리되지 않는다.**
`.github/workflows/build-ws-server.yml`이 `ws-server/**` 변경 시 GHCR에 이미지를 자동으로
빌드·푸시하긴 하지만, 그 이미지를 실제로 당겨서 배포하는 자동화는 없다 — 아래 "배포/재배포 절차"를
수동으로 실행해야 반영된다.

## 로컬 실행 (테스트용)

```bash
cd ws-server
npm install
PORT=8787 npm start
# 헬스체크: curl http://localhost:8787/healthz
# 랭킹은 DATA_DIR(기본값: ws-server/data/, .gitignore 처리됨)에 저장된다.
```

프론트엔드 개발 서버(`npm run dev`)는 `VITE_RPS_WS_URL` 환경변수가 없으면
`ws://<현재 접속 호스트>:8787/rps`로 자동 접속을 시도한다. 로컬 개발 중에는
이 서버를 `8787` 포트로 띄워두면 별도 설정 없이 바로 테스트할 수 있다.

> **주의**: `pkill -f "PORT=8787 node server.mjs"` 같은 패턴은 매칭되지 않는다(환경변수 대입은
> 자식 프로세스의 argv에 남지 않음). 재시작할 땐 `ss -tlnp | grep 8787`로 PID를 찾아서
> `kill -9`하거나 `pkill -f "node server.mjs"`(argv만 매칭)를 쓸 것. "재시작"했다고 생각했는데
> 실제로는 `EADDRINUSE`로 새 프로세스가 죽고 옛날 프로세스가 계속 서비스 중이었던 적이 있다 —
> 로그 파일에서 에러 여부를 꼭 확인한다.

## 게임 모드

- **1v1**: 방 생성 → 코드 공유 → 상대 참가 → 즉시 대결 시작. 3판2선승(WINS_TO_SET=2) 세트를
  계속 이어감("다음 세트" 버튼).
- **그룹전(group)**: 4~8명 정도, 매 라운드 랜덤 매칭(홀수면 한 명 부전승), 세트 승수(setScores)로
  누적 순위. 한 명이 목표 승수(WINS_TO_GROUP)에 도달하면 종료.
- **토너먼트(tournament)**: 싱글 엘리미네이션 브래킷, 매 라운드 랜덤 매칭(홀수면 부전승),
  세트 패자는 탈락. 마지막 한 명 남을 때까지.

그룹전/토너먼트 둘 다 "세트가 끝나지 않은 개별 판" 이후에는 결과 화면을 잠깐 보여주고
**클라이언트가 자동으로 다음 판 선택 화면으로 넘어간다** (`AUTO_ADVANCE_MS`, 1.8초). 세트가
끝나서 `set_over`/다음 라운드 `match_start`가 먼저 도착했다면 되돌리지 않는다 — 이 부분은
`messageGeneration`(setPhase가 호출될 때마다 증가) 기반 가드로 처리한다. 이 가드를 손볼 때는
"화면을 안 바꾸는 정보성 브로드캐스트(tournament_state/group_scores)까지 세대를 올리면
정상적인 다음 판 진행이 막힌다"는 점을 유의할 것 — 실제로 한 번 이 회귀가 있었다
(git log에서 "세트 종료 애니메이션 경쟁 상태 수정" 커밋들 참고).

그룹전/토너먼트 둘 다 세트를 끝내고 다음 라운드를 기다리는 동안, 아직 진행 중인 다른
대진의 실시간 스코어와 대기 인원을 보여주는 "진행 현황판"이 있다(`group_scores`/
`tournament_state` 메시지의 `activeMatches`/`waiting` 필드, `set_over`/`bye` 화면에 렌더링).

## 라이어게임 (`/liar`, `ws-server/liar.mjs`)

방 코드 기반 로비(최소 3명, 최대 12명) → 호스트가 시작하면 카테고리+제시어를 랜덤 배정하고
참가자 중 1명을 라이어로 선정. 라이어에게는 카테고리만 보내고 제시어(`word`) 필드 자체를
만들지 않는다 — **서버 권위 원칙**: 값을 숨기는 게 아니라 그 키를 아예 생성하지 않는 방식으로
부정행위를 원천 차단한다(재접속 스냅샷에도 동일하게 적용됨, 코드 수정 시 가장 조심할 지점).

진행 순서: 랜덤 발언 순서대로 텍스트 설명 제출(`describe`) → 전원 투표로 지목(`vote`) →
최다 득표 동률이면 1회 재투표(`revote`, 두 번째도 동률이면 무승부로 즉시 종료) → 지목된 사람이
실제 라이어면 마지막으로 제시어 맞히기 기회(`liar_guess`, 맞히면 라이어 승) → 아니면 즉시 라이어 승.
라운드가 끝나면(`round_result`) 전원에게 제시어/라이어가 공개되고, 호스트가 다시 `start`를
보내면 같은 방·인원으로 새 라운드가 시작된다.

랭킹 시스템은 없음(인메모리 전용, 방이 비면 소멸) — rps처럼 파일 기반 영속화가 필요해지면
이후 과제로 남겨둔다.

## 마피아게임 (`/mafia`, `ws-server/mafia.mjs`)

방 코드 기반 로비(최소 4명, 최대 12명) → 호스트가 시작하면 인원수에 따라 역할을 자동 배치한다:
4명(마피아1+시민3) → 5~6명(+경찰1) → 7~9명(+의사1) → 10~12명(마피아 2명으로 증가). 마피아에게만
`role_assigned`에 `teammates`(다른 마피아 명단)를 함께 보내고, 그 외 역할(경찰/의사/시민)은
서로의 정체를 전혀 모른다 — 라이어게임과 동일한 서버 권위 원칙(비공개 정보는 필드 자체를 안 만듦).

진행은 **밤(`night`, 30초) → 낮(`day`, 토론+투표 합쳐 60초)** 반복:
- 밤: 생존 마피아 전원이 살해 대상에 투표(최다 득표, 동률이면 서버가 랜덤 선택), 경찰은 조사 대상
  1명을 지목해 마피아 여부를 본인만 결과로 받음(`police_result`), 의사는 보호 대상 1명을 지목
  (자기 자신도 가능). 마피아의 살해 대상과 의사의 보호 대상이 일치하면 생존, 아니면 사망.
  일반 시민은 밤에 아무 행동도 하지 않고 대기 화면만 본다.
- 낮: 사망자 발표 후 자유 채팅(`submit_chat`)으로 토론하면서 동시에 처형 투표(`submit_day_vote`)도
  가능 — 별도 단계로 안 나누고 하나의 `day` phase 안에서 채팅과 투표가 동시에 열려있다. 최다 득표
  동률이면 라이어게임과 동일하게 1회 재투표, 재투표도 동률이거나 시간 내 투표가 하나도 없으면
  이번 낮은 "처형 없음"으로 넘어간다.

승패 판정은 매 밤/낮 직후 자동 확인: 생존 마피아가 0명이면 시민 승리, 생존 마피아 수가 생존
시민(경찰/의사/일반시민 합) 수 이상이 되면 마피아 승리. 그 외에는 다음 밤으로 계속 진행.

랭킹 시스템 없음(라이어게임과 동일하게 인메모리 전용).

## 할리갈리 (`/halligalli`, `ws-server/halligalli.mjs`)

방 코드 기반 로비(최소 2명, 최대 6명) → 호스트가 시작하면 4종 과일(딸기/라임/바나나/포도, 카운트
1~5) 56장 카드를 참가자에게 라운드로빈으로 균등 분배한다. 라이어게임/마피아게임과 달리 **숨길
정보가 전혀 없는 게임**이라(모두의 카드 수·앞면 카드가 항상 공개) 서버 권위 원칙이 적용될 지점이
없다 — 대신 핵심은 **공정한 종치기 판정**이다.

- 정해진 순서대로 한 명씩만 `submit_flip`(뒤집기) 가능. 20초(`FLIP_TIMEOUT_MS`) 안에 안 뒤집으면
  카드는 그대로 두고 다음 사람에게 차례가 넘어간다(`turn_skipped`).
- 아무나 언제든 `submit_ring`(종치기) 가능. 전원의 "현재 앞면 맨 위 카드"만 합산 대상이며, 특정
  과일의 합이 정확히 5가 되는 순간 종을 치면 정답 — 그 시점까지 모두의 앞면 카드를 전부 가져가
  자기 뒷면 카드 더미 맨 아래로 합친다(`ring_correct`). 조건이 안 맞는데 쳤으면 오답 — 자기 뒷면
  카드 더미에서 한 장씩 다른 전원에게 나눠준다(`ring_wrong`, 나눠줄 카드가 없으면 그냥 넘어감).
- **네트워크 지연 판정**: 클라이언트가 보낸 타임스탬프는 전혀 신뢰하지 않고, 서버가 메시지를
  받은 순서(Node 이벤트 루프는 단일 스레드라 수신 순서가 곧 처리 순서)로 선착순 판정한다. 첫
  종치기가 처리되는 동안(`RING_RESOLUTION_WINDOW_MS`, 350ms) 뒤이어 도착하는 종치기는 결과와
  무관하게 조용히 무시한다 — 그래야 근소한 차이로 늦은 사람이 "오답 벌칙"을 억울하게 받지 않는다.
- 승리 조건은 카드 56장을 한 명이 전부 독식하는 것. 게임 도중 누군가 이탈하면 그 사람의 카드는
  남은 참가자에게 재분배해 카드 총량(56장)을 항상 보존한다 — 남은 인원이 2명 미만이 되면 즉시
  남은 한 명의 승리로 종료.

랭킹 시스템 없음(라이어게임/마피아게임과 동일하게 인메모리 전용).

## 윷놀이 (`/yutnori`, `ws-server/yutnori.mjs` + `yutnori-rules.mjs` + `yutnori-board.mjs`)

방 코드 기반 로비(최소 2명, 최대 4명 — 보드에 코너가 4개뿐이라 인원 상한이 다른 게임과 다르다) →
호스트가 시작하면 참가자마다 말 4개, 보드는 외곽 20칸(그중 4개 코너) + 코너마다 중앙으로 꺾는
대각선 1칸 + 중앙 1칸(총 25칸)짜리 공유 그래프로 표현된다(`yutnori-board.mjs`). 할리갈리처럼
**숨길 정보가 전혀 없는 게임**이라 서버 권위 원칙이 적용될 지점은 없고, 핵심은 순수 규칙 엔진의
정확성이다(`yutnori-rules.mjs`, `src/game/yutnori-rules.ts`와 로직을 동일하게 유지해야 함 — 규칙을
고칠 때는 두 파일을 같이 고칠 것).

- 턴은 **던지기(`throw`) 단계 → 이동(`move`) 단계**로 나뉜다. `submit_throw`로 던진 결과가
  윷/모가 아니면 바로 이동 단계로 넘어가고, 윷/모면 이동 전에 한 번 더 던질 수 있다(`extraTurn`).
- `submit_move`로 대기 중인 던지기 하나를 골라 말을 옮긴다. 같은 편 말이 서 있는 칸에 도착하면
  업기(자동 스택 합류), 상대 말이 서 있는 칸에 도착하면 잡기(상대 말 전부 시작점으로 귀환 +
  보너스 던지기). 스택에서 말 하나만 떼어 옮기고 싶으면(갈라치기) `submit_move`에 `splitOff:true`.
  백도(`backdo`)는 온보드 말만 가능하고 정확히 한 칸 후진한다.
- 코너 칸을 **떠날 때마다**(처음 놓인 순간이 아니라 그 이후 매번) "그대로 vs 지름길" 분기가
  필요하면 서버가 그 이동을 확정하지 않고 이동한 사람에게만 `await_branch`를 보낸다 — 클라이언트는
  `branch: 'straight'|'shortcut'`를 채워 같은 `pendingThrowId`로 `submit_move`를 다시 보내야 한다.
- 차례인 사람이 20초(`TURN_TIMEOUT_MS`) 안에 아무 것도 안 하면 대기 중이던 던지기를 버리고 다음
  사람에게 순서가 넘어간다(`turn_skipped`).
- 승리 조건은 말 4개를 전부 완주(홈)시키는 것. 게임 도중 누군가 이탈하면 그 사람의 말은 즉시
  보드에서 제거되고(카드게임인 할리갈리와 달리 말의 위치는 재분배 대상이 아니다) 순번에서
  빠진다 — 남은 인원이 2명 미만이 되면 즉시 남은 한 명의 승리로 종료.

랭킹 시스템 없음(다른 파티게임들과 동일하게 인메모리 전용).

## 전략윷놀이 (`/strategy-yutnori`, `ws-server/strategy-yutnori.mjs` + `strategy-yutnori-rules.mjs`, 보드는 `yutnori-board.mjs` 재사용)

tvN <더 지니어스> 데스매치에서 쓰인 2:2 윷놀이 변형. 보드 그래프(25칸)는 표준 윷놀이와 **완전히
동일**하지만(같은 `yutnori-board.mjs`를 공유), 던지기 방식과 승패 단위가 다르다. 표준 윷놀이와 달리
**숨길 정보가 있는 게임**이라 서버 권위 원칙이 적용된다.

- **정확히 4명** 고정(코너 4개에 한 명씩 진입). join 순서대로 (0,1)조 / (2,3)조 두 팀이지만, 팀원
  말끼리도 서로 잡을 수 있다(배신 가능). 인당 말은 **2개**뿐.
- 던지기는 무작위가 아니다. 라운드마다 4명이 각자 자기 막대 1개를 **앞면/뒷면 중 골라 비공개로 동시
  제출**(`submit_face` `{face:'front'|'back'}`)한다. 4명이 다 낼 때까지 서버는 **누가 냈는지만**
  (`game_update` event `face_submitted` + `submittedTokens`) 알리고 **낸 값은 절대 브로드캐스트하지
  않는다**. 4명이 다 모이면 뒷면 개수로 도개걸윷모를 확정한다: 0=모(5), 2=개(2), 3=걸(3), 4=윷(4),
  **뒷면이 정확히 1개면 항상 백도(-1)로 강제**(원 방송 규칙 추정 — `strategy-yutnori-rules.ts` 상단
  주석 참고).
- **시그널 카드**(`submit_signal` `{suggestion:'front'|'back'|'free'}`): 자기 짝에게만 "앞면 내줘/뒷면
  내줘/자유롭게" 힌트를 보낸다. 서버는 이 프레임(`signal_received`)을 **오직 파트너 소켓 1개에만**
  보낸다 — 다른 세 명에게 새어나가면 안 된다.
- 던지기가 확정되면 `moving` 단계로 넘어가 `moveOrder`대로 각자 그 값으로 **한 번씩** 이동
  (`submit_move`). 보너스 던지기는 없다. 이동할 말이 없는 사람은 조용히 건너뛴다. 업기(같은 개인
  소유 말끼리만)·잡기(팀 무관 전원)·갈라치기(`splitOff:true`)·코너 이탈 시 `await_branch` 왕복은
  표준 윷놀이와 동일한 규칙 엔진 패턴을 따른다.
- **승리 조건은 개인전**: 자기 말 2개를 먼저 완주(홈)시킨 **사람**이 이긴다(파트너 상태 무관).
  `game_over`에 승자와 파트너를 함께 실어 보낸다.
- 타임아웃: 던지기 미제출 20초(`FACE_TIMEOUT_MS`)면 자동 `front` 제출, 자기 차례 20초
  (`MOVE_TIMEOUT_MS`)면 첫 번째 가능한 말을 straight 분기로 강제 이동.
- 4인 고정 게임이라 게임 도중 **누구든 한 명이라도 이탈하면 즉시 종료**(`abandonGame`, `opponentLeft`
  플래그). 로비 단계 이탈은 표준대로 자리만 비운다.

규칙 엔진은 표준 윷놀이처럼 `src/game/strategy-yutnori-rules.ts`와 `ws-server/strategy-yutnori-rules.mjs`
두 벌을 **로직 동일하게 유지**해야 한다(규칙 수정 시 두 파일 같이). 랭킹 없음(인메모리 전용).

## 재연결 / 재입장

- 소켓이 예기치 않게 끊기면(카카오톡 공유 등으로 탭이 백그라운드로 가는 경우 포함) 서버가
  45초(`RECONNECT_GRACE_MS`) 동안 자리를 유예하고, 상대에게는 바로 `opponent_left`가 아니라
  `opponent_disconnected`를 보낸다. 클라이언트는 같은 토큰으로 자동 `rejoin`을 시도한다.
- **페이지 새로고침처럼 JS 메모리 자체가 날아가는 경우**를 위해, 토큰/방코드/닉네임을
  `localStorage`(`run-hoban-run:rps-session`)에도 저장해둔다. 재방문 시 저장된 세션이 있으면
  엔트리 화면에 "재입장하기" 배너가 뜬다. 의도적으로 나가면(그만하기/나가기 버튼) 세션을 지운다.
- `rejoined`/재연결 시 재전송되는 `match_start`에는 진행 중이던 세트의 개별 승수(`matchWins`,
  핍 표시용)도 같이 담아 보낸다 — 안 그러면 재연결할 때마다 핍이 0으로 리셋된다.

## 랭킹

`GET /ranking` (nginx가 `/ranking`을 그대로 프록시) → `{"week":"2026-W27","entries":[...],"prevWeek":"..."}`.
`entries`는 `{name, byMode:{"1v1":n,"group":n,"tournament":n}, total}`, `total` 내림차순.
ISO 주 단위로 `DATA_DIR/ranking.json`에 파일로 영속된다(과거에 Postgres로 만든 적이 있었지만
폐기됨 — DB 컨테이너/네트워크 없음, 자격증명 관리 불필요). 세트 승리 시 자동 기록.

## WAS(58.228.188.17) 배포 상태 — 완료, `docker run` 두 개로 운영

두 컨테이너 모두 `--restart unless-stopped`로 상시 운영 중:

- **`rps-server`**: 이 디렉토리를 빌드한 이미지, 평문 `ws://`를 호스트 포트 `30081`에 노출.
  ```bash
  docker run -d --name rps-server --restart unless-stopped \
    -p 30081:8787 \
    -v rps-server-data:/app/data \
    run-hoban-run-rps-server:latest
  ```
- **`rps-tls`**: `nginx:alpine --network host`, 호스트 포트 `30080`에서 TLS 종료 후
  `/rps`, `/healthz`, `/ranking`을 `127.0.0.1:30081`로 프록시. 설정 파일은 WAS의
  `~/rps-tls/nginx.conf` (이 저장소의 `ws-server/nginx.conf`와 동일 — 바뀌면 양쪽 다 갱신할 것).
  인증서는 **정식 Let's Encrypt** (`~/rps-tls/certbot-etc/live/toris-arcade.duckdns.org/{fullchain,privkey}.pem`,
  2026-09-30까지 유효). 브라우저 경고 없이 바로 연결됨.

30080/30081 두 포트는 원래 `mongtorydiary`(별개 프로젝트)의 NodePort였다. 그 앱을 ArgoCD 관리에서
빼고 서비스만 정리한 뒤 재사용한 것 — 이미 라우터에 포워딩이 잡혀 있어서 새로 포트포워딩을
요청할 필요가 없었다. 도메인은 무료 [DuckDNS](https://www.duckdns.org) 서브도메인
`toris-arcade.duckdns.org` → `58.228.188.17`. 80/443 포트는 이 WAS가 아니라 사용자의 다른
장비(Synology NAS)로 이미 포워딩돼 있어서, 정식 인증서는 HTTP-01이 아니라 DNS-01로 발급했다
(`~/rps-tls/hooks/duckdns-auth-hook.py`, DuckDNS `txt=` 파라미터 사용, https://www.duckdns.org/spec.jsp 참고).

### 재배포 절차 (server.mjs/liar.mjs/mafia.mjs/halligalli.mjs/yutnori*.mjs/strategy-yutnori*.mjs/Dockerfile/package.json 변경 시)

> 할리갈리(`/halligalli`) 반영은 아래 절차 + nginx `/halligalli` location 추가까지 한 번에 실행하는
> `ws-server/deploy-halligalli-was.sh` 스크립트로 대체 가능(WSL2 등 SSH 키가 있는 로컬 머신에서
> 저장소 루트 기준으로 실행).

```bash
SSH="ssh -p 10022 -i /home/msyeo/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes msyeo@58.228.188.17"

# 1. 소스 동기화 (data/ 는 로컬 테스트 산출물이라 제외) — liar.mjs/mafia.mjs 등 .mjs 전부 함께 동기화됨
rsync -av -e "ssh -p 10022 -i /home/msyeo/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes" \
  --exclude node_modules --exclude data \
  ws-server/ msyeo@58.228.188.17:~/run-hoban-run-ws-server/

# 2. 이미지 재빌드 (Dockerfile이 *.mjs를 글롭으로 COPY하므로 새 모듈도 자동 포함됨)
$SSH 'cd ~/run-hoban-run-ws-server && docker build -t run-hoban-run-rps-server:latest .'

# 3. 컨테이너 교체 (같은 named volume을 재사용해야 랭킹 데이터가 안 날아간다!)
$SSH 'docker rm -f rps-server 2>/dev/null; docker run -d --name rps-server --restart unless-stopped \
  -p 30081:8787 -v rps-server-data:/app/data run-hoban-run-rps-server:latest'

# 4. 확인
$SSH 'curl -s http://localhost:30081/healthz; curl -s http://localhost:30081/ranking'
curl -sk https://toris-arcade.duckdns.org:30080/healthz
```

`nginx.conf`만 바꿨다면 3~4단계 대신 `~/rps-tls/nginx.conf`를 갱신하고 `docker restart rps-tls`.
**`/liar`, `/mafia`, `/halligalli`, `/yutnori`, `/strategy-yutnori` 같은 새 location을 처음 추가할 때는 WAS의 `~/rps-tls/nginx.conf`
(저장소의 `ws-server/nginx.conf`와는 별개 사본)에 수동으로 반영해야 한다** — 안 하면 저장소 파일만
바뀌고 실제 서비스는 여전히 기존 경로만 프록시해서 새 경로 접속이 404/연결거부로 조용히 실패한다.

인증서 갱신이 필요해지면:
```bash
docker run --rm \
  -v $HOME/rps-tls/certbot-etc:/etc/letsencrypt \
  -v $HOME/rps-tls/certbot-log:/var/log/letsencrypt \
  -v $HOME/rps-tls/hooks:/hooks \
  certbot/certbot certonly \
  --manual --preferred-challenges dns \
  --manual-auth-hook /hooks/duckdns-auth-hook.py \
  --agree-tos --register-unsafely-without-email --non-interactive \
  -d toris-arcade.duckdns.org
```
DuckDNS 네임서버가 가끔 SERVFAIL을 내는데, 몇 번 재시도하면 보통 성공한다.

### 프론트엔드 재배포 (FE 변경 시, 또는 WS URL이 바뀌었을 때)

```bash
VITE_RPS_WS_URL="wss://toris-arcade.duckdns.org:30080/rps" \
VITE_LIAR_WS_URL="wss://toris-arcade.duckdns.org:30080/liar" \
VITE_MAFIA_WS_URL="wss://toris-arcade.duckdns.org:30080/mafia" \
VITE_HALLIGALLI_WS_URL="wss://toris-arcade.duckdns.org:30080/halligalli" \
VITE_YUTNORI_WS_URL="wss://toris-arcade.duckdns.org:30080/yutnori" \
VITE_STRATEGY_YUTNORI_WS_URL="wss://toris-arcade.duckdns.org:30080/strategy-yutnori" \
npm run build
npx firebase-tools deploy --only hosting --project hoban-lakepark-ab19
```

`VITE_RPS_WS_URL`/`VITE_LIAR_WS_URL`/`VITE_MAFIA_WS_URL`/`VITE_HALLIGALLI_WS_URL`/`VITE_YUTNORI_WS_URL`/`VITE_STRATEGY_YUTNORI_WS_URL`
전부 `.env`(gitignore됨)에도 저장돼 있지 않다 — **빌드할 때마다 명시적으로 지정해야 한다.** 안 하면
각각 `ws://<hostname>:8787/{rps,liar,mafia,halligalli,yutnori,strategy-yutnori}`로 조용히 fallback해서 프로덕션에서
연결이 깨진다. (참고: `deploy/k8s/base/firebase-deploy-job.yaml`에는 ArgoCD가 자동 배포할 때 쓰는
값이 이미 들어있지만, 로컬에서 수동으로 `firebase deploy`할 때는 별개로 챙겨야 한다.)

## 검증 방법

- 서버 로직: 로컬 WebSocket 클라이언트 스크립트로 직접 연결해 방 생성 → 참가 → 대결(rps) 또는
  로비 → 역할배정 → 설명 → 투표 → 결과(라이어게임) 또는 로비 → 역할배정 → 밤행동 → 낮채팅/투표 →
  승패판정(마피아게임) 또는 로비 → 카드분배 → 순서대로 뒤집기 → 정답/오답 종치기 → 카드 독식
  종료(할리갈리) 또는 로비 → 던지기 → 이동(업기/갈라치기/잡기/지름길분기) → 4개 말 완주(윷놀이) 또는
  로비 → 앞/뒷면 비공개 제출 → 도개걸윷모 확정 → 순서대로 이동 → 개인 말 2개 완주(전략윷놀이)까지.
- 화면 레이스 컨디션류 버그: Playwright로 여러 페이지를 동시에 띄워 실제 타이밍대로 재현
  (rps 배틀로얄/토너먼트는 4명 이상, 라이어게임/마피아게임/할리갈리/윷놀이/전략윷놀이는 각각 최소
  인원(3명/4명/2명/2명/정확히 4명) 이상으로 테스트해야 대기/타이밍 케이스가 나온다).
- **안티치트 검증(라이어게임/마피아게임 공통 원칙)**: 비공개 정보를 가진 역할(라이어의 제시어,
  마피아 외 역할의 팀 구성)로 접속한 클라이언트가 받는 `role_assigned`/`rejoined` WS
  프레임(JSON 문자열)에 해당 키(`word`, `teammates` 등)가 문자 그대로 존재하지 않는지 브라우저
  DevTools의 Network→WS 탭 또는 raw 클라이언트 스크립트로 직접 확인 — 값이 비어있는 게 아니라
  키 자체가 없어야 한다. (할리갈리/윷놀이는 숨길 정보가 없어 이 검증은 해당 없음 — 대신 아래 판정
  검증을 참고. 단 **전략윷놀이는 비공개 앞/뒷면과 파트너 전용 시그널이 있어** 아래 별도 검증이 필요.)
- **전략윷놀이 비공개 정보 검증**: `collecting` 단계에서 4명이 다 내기 전까지 오는 `game_update`
  프레임에 개별 `face` 값이 문자 그대로 없어야 한다(`submittedTokens`/`face_submitted`에는 token/name만).
  또 한 명이 `submit_signal`을 보냈을 때 `signal_received` 프레임이 **오직 파트너 소켓에만** 도착하고
  나머지 두 명에게는 전달되지 않는지 raw 클라이언트 4개로 확인한다.
- **할리갈리 종치기 판정 검증**: 여러 raw 클라이언트를 동시에 접속시켜 같은 타이밍에 `submit_ring`을
  보내고, 서버가 먼저 수신한 클라이언트만 정답/오답 판정을 받고 나머지는 결과에 영향을 주지 않는지
  확인. 조건이 거짓일 때 친 오답 케이스(카드 분배 확인)와 정답 케이스(카드 독식 확인)를 모두
  검증한다.
- **윷놀이 규칙 엔진 검증**: `tests/yutnori-rules.spec.ts`의 순수 유닛테스트(던지기 확률 분포,
  업기/갈라치기/잡기/보너스턴/백도/지름길분기/승리조건)를 우선 신뢰하고, 서버 쪽은 raw 클라이언트로
  같은 시나리오(특히 잡기 시 보너스 던지기, 코너를 떠날 때의 `await_branch` 왕복, 이탈 시 말 제거)를
  재현해 `src/game/yutnori-rules.ts`와 `ws-server/yutnori-rules.mjs`의 동작이 어긋나지 않는지 확인한다.
- **전략윷놀이 규칙 엔진 검증**: `tests/strategy-yutnori-rules.spec.ts`의 순수 유닛테스트(뒷면 개수→
  도개걸윷모 매핑과 뒷면 1개=백도 강제, 업기/갈라치기/잡기(파트너 배신 포함)/백도/지름길분기, 개인
  말 2개 완주 승리)를 우선 신뢰하고, 서버 쪽은 raw 클라이언트 4개로 같은 시나리오를 재현해
  `src/game/strategy-yutnori-rules.ts`와 `ws-server/strategy-yutnori-rules.mjs`의 동작이 어긋나지
  않는지 확인한다.
- 인증서 신뢰 여부: `rejectUnauthorized`를 끄지 않은 기본 WebSocket 클라이언트, 그리고
  Playwright에서 `ignoreHTTPSErrors` 옵션 없이 접속 — 둘 다 정상 연결되면 브라우저도 경고 없이 신뢰한다는 뜻.
- 항상 실제 WAS(`wss://toris-arcade.duckdns.org:30080/{rps,liar,mafia,halligalli,yutnori,strategy-yutnori}`)까지
  왕복하는 e2e로 마무리 확인하고, Firebase에 배포된 실제 프로덕션 페이지에서도 한 번 더 확인한다.
