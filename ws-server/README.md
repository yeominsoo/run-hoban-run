# RPS WebSocket Server

가위바위보 1:1 대결(`/rps` 페이지)이 사용하는 방(room) 기반 서버. 자동 매칭이 아니라
한 명이 방을 만들고 코드를 공유하면 상대가 그 코드로 들어오는 방식이다. 이 저장소의
나머지 게임과 달리 정적 파일만으로는 동작하지 않으며, 항상 켜져 있는 Node 프로세스가 필요하다.

## 프로토콜

- `ws(s)://<host>:<port>/rps` 로 연결
- 클라이언트 → 서버
  - `{"type":"create","name":"닉네임"}` — 새 방 생성, 상대 대기
  - `{"type":"join","name":"닉네임","roomCode":"3F9A2C"}` — 방 코드로 참가
  - `{"type":"choice","choice":"rock"|"paper"|"scissors"}` — 이번 판 선택
  - `{"type":"leave"}` — 방에서 나가기
- 서버 → 클라이언트
  - `{"type":"room_created","roomCode":"3F9A2C"}` — 방 생성 완료, 상대 대기 중
  - `{"type":"matched","opponentName":"...","roomCode":"3F9A2C"}` — 두 번째 플레이어 입장 완료
  - `{"type":"opponent_choice_made"}`
  - `{"type":"result","you":"rock","opponent":"paper","outcome":"lose","score":{"you":0,"opponent":1}}`
  - `{"type":"opponent_left"}`
  - `{"type":"error","message":"방을 찾을 수 없습니다. ..."}` — 잘못된/가득 찬 방 코드로 참가 시도

방(room)은 두 플레이어 중 한쪽이 나가거나 연결이 끊길 때까지 유지되며, 점수는 방 안에서 누적된다.
방 코드는 생성 시각(년/월/일/시/분/초/밀리초)을 SHA-256으로 해시한 값에서 앞 6자리를 사용한다
(`genRoomCode()` in `server.mjs`). 프론트엔드는 `/rps/?room=<코드>` 형태의 초대 링크도 지원해
링크를 열면 방 코드가 자동으로 채워진다.

## 로컬 실행 (테스트용)

```bash
cd ws-server
npm install
PORT=8787 npm start
# 헬스체크: curl http://localhost:8787/healthz
```

프론트엔드 개발 서버(`npm run dev`)는 `VITE_RPS_WS_URL` 환경변수가 없으면
`ws://<현재 접속 호스트>:8787/rps` 로 자동 접속을 시도한다. 로컬 개발 중에는
이 서버를 `8787` 포트로 띄워두면 별도 설정 없이 바로 테스트할 수 있다.

## WAS(58.228.188.17) 배포 상태 — 완료

`toris-arcade.duckdns.org:30080` (wss, TLS 종료) → `127.0.0.1:30081` (평문 ws, 컨테이너) 구조로
실제 배포되어 있다.

- WAS는 공인 IP 58.228.188.17을 가진 공유기 뒤의 내부 호스트(192.168.75.194)이며, k8s(단일 노드,
  ArgoCD로 다른 앱들 관리) + 독립 Docker 컨테이너가 함께 떠 있다.
- `rps-server` 컨테이너: `docker run -d --name rps-server --restart unless-stopped -p 30081:8787 run-hoban-run-rps-server:latest`
  (평문 ws, 30081은 라우터에서 외부로 포워딩되어 있던 포트를 재사용 — 원래 `mongtorydiary` 앱의
  backend NodePort였고, 그 앱을 ArgoCD 관리에서 제외 후 서비스만 정리하고 재사용했다.)
- `rps-tls` 컨테이너: nginx(`--network host`)가 30080(마찬가지로 기존에 열려있던 포트 재사용,
  원래 `mongtorydiary` frontend) 에서 TLS를 종료해 `/rps`, `/healthz`를 `127.0.0.1:30081`로
  프록시한다. 인증서는 `~/rps-tls/selfsigned/`의 **자체 서명 인증서**(CN/SAN에
  `toris-arcade.duckdns.org`와 `58.228.188.17` 포함, 10년 유효).
- 도메인은 [DuckDNS](https://www.duckdns.org) 무료 서브도메인 `toris-arcade.duckdns.org` →
  `58.228.188.17`. Let's Encrypt DNS-01(HTTP-01은 80/443이 다른 NAS로 이미 포워딩돼 있어 사용 불가)로
  정식 인증서 발급을 시도했으나 DuckDNS 네임서버가 그 시점에 SERVFAIL을 반복해 실패, 자체 서명
  인증서로 대체했다. `~/rps-tls/hooks/duckdns-auth-hook.py`에 DNS-01 자동화 스크립트가 이미
  준비되어 있으니, DuckDNS 상태가 안정되면 아래로 재시도해서 정식 인증서로 교체할 수 있다.
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
  성공하면 `~/rps-tls/certbot-etc/live/toris-arcade.duckdns.org/{fullchain,privkey}.pem`을
  `~/rps-tls/nginx.conf`가 가리키도록 바꾸고 `rps-tls` 컨테이너를 재시작하면 된다(자체 서명 경고 사라짐).
- 프론트엔드는 `VITE_RPS_WS_URL="wss://toris-arcade.duckdns.org:30080/rps"`로 빌드되어
  Firebase Hosting에 배포되어 있다 (`npm run build` 전에 이 환경변수를 지정해야 함).
- **자체 서명 인증서라서 처음 접속하는 사용자는 브라우저가 wss 연결을 조용히 차단한다.**
  최초 1회 `https://toris-arcade.duckdns.org:30080/`에 직접 접속해 인증서 경고를 수락해야
  그 브라우저에서 게임의 wss 연결이 정상 동작한다.

## 검증 범위

- `ws-server/server.mjs` 방 생성/참가/판정 로직을 로컬 WebSocket 클라이언트 2개로 직접 연결해
  방 생성 → 코드로 참가 → 선택 → 결과 → 재대결 → 상대 이탈 처리까지 확인.
- `wss://toris-arcade.duckdns.org:30080/rps`로 실제 WAS까지 왕복하는 e2e 스크립트로
  방 생성 → 참가 → 대결 확인.
- Firebase Hosting에 배포된 실제 프로덕션 페이지(`https://hoban-lakepark-ab19.web.app/rps/`)에서
  Playwright 두 탭으로 방 생성 → 딥링크 참가 → 대결까지 실제 WAS 서버를 통해 확인.
