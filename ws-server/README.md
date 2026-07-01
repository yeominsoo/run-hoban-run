# RPS WebSocket Server

가위바위보 1:1 대결(`/rps` 페이지)이 사용하는 실시간 매칭 서버. 이 저장소의 나머지 게임과 달리
정적 파일만으로는 동작하지 않으며, 항상 켜져 있는 Node 프로세스가 필요하다.

## 프로토콜

- `ws(s)://<host>:<port>/rps` 로 연결
- 클라이언트 → 서버
  - `{"type":"join","name":"닉네임"}` — 매칭 대기열 등록 (1:1로 즉시 매칭)
  - `{"type":"choice","choice":"rock"|"paper"|"scissors"}` — 이번 판 선택
  - `{"type":"leave"}` — 대기열/방에서 나가기
- 서버 → 클라이언트
  - `{"type":"waiting"}`
  - `{"type":"matched","opponentName":"...","roomId":"..."}`
  - `{"type":"opponent_choice_made"}`
  - `{"type":"result","you":"rock","opponent":"paper","outcome":"lose","score":{"you":0,"opponent":1}}`
  - `{"type":"opponent_left"}`

방(room)은 두 플레이어 중 한쪽이 나가거나 연결이 끊길 때까지 유지되며, 점수는 방 안에서 누적된다.

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

## WAS(58.228.188.17) 배포 절차 — 아직 미수행

이 세션에서는 원격 서버 접근 권한이 없어 **실제 설치는 진행하지 않았다.**
아래는 이후 담당자가 그대로 따라 하면 되는 절차다.

1. 이미지 빌드 및 전송
   ```bash
   docker build -t run-hoban-run-rps-server ws-server/
   # 이미 쓰고 있는 ghcr 계정이 있다면 그쪽으로 push 후 서버에서 pull 해도 된다.
   ```
2. WAS(58.228.188.17)에서 컨테이너 실행 (예: 8787 포트)
   ```bash
   docker run -d --name rps-server --restart unless-stopped \
     -p 8787:8787 \
     run-hoban-run-rps-server
   ```
3. **포트 포워딩**: 공유기/방화벽에서 외부 → `58.228.188.17:8787` 로 TCP 포트포워딩을 설정해야
   외부(Firebase에 배포된 FE)에서 접속할 수 있다. 이 작업은 네트워크 장비에 대한 접근이
   필요해 이번 세션에서는 수행하지 못했다.
4. HTTPS로 배포된 Firebase Hosting 페이지에서는 브라우저가 `wss://` (암호화 WebSocket)만
   허용한다. 평문 `ws://58.228.188.17:8787`는 mixed-content로 차단되므로, 다음 중 하나가 필요하다.
   - WAS 앞단에 TLS 종료용 리버스 프록시(nginx/caddy)를 두고 `wss://<도메인>/rps` 로 노출, 또는
   - Cloudflare Tunnel 등으로 `wss://` 엔드포인트를 발급받기
5. 최종 접속 주소가 정해지면 프론트엔드 빌드 시 아래 환경변수를 지정한다.
   ```bash
   VITE_RPS_WS_URL="wss://<확정된 도메인 또는 IP>/rps" npm run build
   npm run deploy:firebase
   ```
   (`.env.example` 참고)

## 이번 세션에서 로컬로 검증한 범위

- `ws-server/server.mjs` 매칭/판정 로직을 로컬에서 두 개의 WebSocket 클라이언트로 직접 연결해
  매칭 → 선택 → 결과 → 재대결 → 상대 이탈 처리까지 확인.
- 프론트엔드(`/rps`)는 `VITE_RPS_WS_URL`을 로컬 서버(`ws://localhost:8787/rps`)로 두고
  두 브라우저 탭으로 실제 대결 플로우 확인.
- WAS 설치, 포트포워딩, TLS 종료는 위에 정리된 대로 아직 미수행.
