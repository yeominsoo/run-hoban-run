# WebSocket Server (RPS + 라이어게임)

가위바위보 대결(`/rps`)과 라이어게임(`/liar`)이 함께 쓰는 실시간 서버. 이 저장소의 나머지
게임(레이스/주사위/팀배분)과 달리 정적 파일만으로는 동작하지 않고, 항상 켜져 있는 Node 프로세스 +
WAS 배포가 필요하다. 두 게임 모두 **같은 Node 프로세스, 같은 컨테이너, 같은 포트/TLS/도메인**을
공유하고, 서로 다른 WebSocket 경로(`/rps`, `/liar`)와 완전히 독립된 room 상태(`server.mjs` vs
`liar.mjs`)로만 나뉜다 — 새 게임을 추가할 때마다 서버/포트/인증서를 새로 만들 필요 없이 이 패턴을
반복하면 된다.

⚠️ **이 파일은 실제 배포 상태를 반영하는 단일 진실 공급원(source of truth)이다.** 다른 세션/환경에서
`/rps`, `/liar`나 WAS를 건드리기 전에 반드시 이 파일을 먼저 읽을 것. 이 저장소는 **동시에 여러 Claude Code
세션이 `/rps`를 병렬로 작업한 적이 있다** (2026-07-02~03에 두 세션이 서로 다른 방향으로 완전히
다시 작성해서 나중에 사용자가 한쪽을 골라야 했음). 작업 전에 항상:

```bash
git fetch origin && git log origin/master --oneline -10
```

로 CI의 `deploy(firebase): ... [skip ci]` 봇 커밋 말고 다른 사람의 실제 기능 커밋이 없는지 먼저 확인한다.

## 아키텍처 한눈에 보기

```
사용자 브라우저
   │  https://hoban-lakepark-ab19.web.app/{rps,liar}/   (Firebase Hosting, 정적 프론트엔드)
   │  wss://toris-arcade.duckdns.org:30080/{rps,liar}   (VITE_RPS_WS_URL / VITE_LIAR_WS_URL로 빌드 시점에 주입됨)
   ▼
공유기 (58.228.188.17, WAN) ── 포트 30080 포워딩 ──▶ WAS 내부(192.168.75.194)
   ▼
rps-tls 컨테이너 (nginx, --network host, 30080에서 TLS 종료, Let's Encrypt 정식 인증서)
   │  proxy_pass http://127.0.0.1:30081/{rps,liar,healthz,ranking}
   ▼
rps-server 컨테이너 (Node, 8787→30081 포워딩)
   │  server.mjs가 /rps를, server.mjs가 import하는 liar.mjs가 /liar를 같은 httpServer에서 서비스
   │  랭킹(rps 전용)은 파일 기반: /app/data/ranking.json (named volume rps-server-data)
   │  라이어게임은 인메모리 상태만 사용 — 랭킹/영속화 없음, 방이 끝나면 소멸
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

### 재배포 절차 (server.mjs/liar.mjs/Dockerfile/package.json 변경 시)

```bash
SSH="ssh -p 10022 -i /home/msyeo/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes msyeo@58.228.188.17"

# 1. 소스 동기화 (data/ 는 로컬 테스트 산출물이라 제외) — liar.mjs 등 .mjs 전부 함께 동기화됨
rsync -av -e "ssh -p 10022 -i /home/msyeo/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes" \
  --exclude node_modules --exclude data \
  ws-server/ msyeo@58.228.188.17:~/run-hoban-run-ws-server/

# 2. 이미지 재빌드 (Dockerfile이 *.mjs를 글롭으로 COPY하므로 liar.mjs도 자동 포함됨)
$SSH 'cd ~/run-hoban-run-ws-server && docker build -t run-hoban-run-rps-server:latest .'

# 3. 컨테이너 교체 (같은 named volume을 재사용해야 랭킹 데이터가 안 날아간다!)
$SSH 'docker rm -f rps-server 2>/dev/null; docker run -d --name rps-server --restart unless-stopped \
  -p 30081:8787 -v rps-server-data:/app/data run-hoban-run-rps-server:latest'

# 4. 확인
$SSH 'curl -s http://localhost:30081/healthz; curl -s http://localhost:30081/ranking'
curl -sk https://toris-arcade.duckdns.org:30080/healthz
```

`nginx.conf`만 바꿨다면 3~4단계 대신 `~/rps-tls/nginx.conf`를 갱신하고 `docker restart rps-tls`.
**`/liar` location을 처음 추가할 때는 WAS의 `~/rps-tls/nginx.conf`(저장소의 `ws-server/nginx.conf`와는
별개 사본)에 수동으로 반영해야 한다** — 안 하면 저장소 파일만 바뀌고 실제 서비스는 여전히 `/rps`만
프록시해서 `/liar` 접속이 404/연결거부로 조용히 실패한다.

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
npm run build
npx firebase-tools deploy --only hosting --project hoban-lakepark-ab19
```

`VITE_RPS_WS_URL`/`VITE_LIAR_WS_URL` 둘 다 `.env`(gitignore됨)에도 저장돼 있지 않다 — **빌드할
때마다 명시적으로 지정해야 한다.** 안 하면 각각 `ws://<hostname>:8787/{rps,liar}`로 조용히
fallback해서 프로덕션에서 연결이 깨진다. (참고: `deploy/k8s/base/firebase-deploy-job.yaml`에는
ArgoCD가 자동 배포할 때 쓰는 두 값이 이미 들어있지만, 로컬에서 수동으로 `firebase deploy`할
때는 별개로 챙겨야 한다.)

## 검증 방법

- 서버 로직: 로컬 WebSocket 클라이언트 스크립트로 직접 연결해 방 생성 → 참가 → 대결(rps) 또는
  로비 → 역할배정 → 설명 → 투표 → 결과(라이어게임) → 재연결까지.
- 화면 레이스 컨디션류 버그: Playwright로 여러 페이지를 동시에 띄워 실제 타이밍대로 재현
  (rps 그룹전/토너먼트는 4명 이상, 라이어게임은 3명 이상으로 테스트해야 대기/타이밍 케이스가 나온다).
- **라이어게임 전용 안티치트 검증**: 라이어 역할로 접속한 클라이언트가 받는 `role_assigned`/
  `rejoined` WS 프레임(JSON 문자열)에 `word` 키가 문자 그대로 존재하지 않는지 브라우저
  DevTools의 Network→WS 탭 또는 raw 클라이언트 스크립트로 직접 확인 — 값이 비어있는 게
  아니라 키 자체가 없어야 한다.
- 인증서 신뢰 여부: `rejectUnauthorized`를 끄지 않은 기본 WebSocket 클라이언트, 그리고
  Playwright에서 `ignoreHTTPSErrors` 옵션 없이 접속 — 둘 다 정상 연결되면 브라우저도 경고 없이 신뢰한다는 뜻.
- 항상 실제 WAS(`wss://toris-arcade.duckdns.org:30080/{rps,liar}`)까지 왕복하는 e2e로 마무리
  확인하고, Firebase에 배포된 실제 프로덕션 페이지에서도 한 번 더 확인한다.
