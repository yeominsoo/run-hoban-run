# 멀티게임 승패+점수 누적 기록 구현 노트 (2026-07-14)

## 요청 원문

> 멀티게임 승패기록 및 기록 이미지공유 기능 추가를 우선하자

`docs/game-collection-plan-v2-2026-07-13.md`에 "멀티게임 6종 승패+점수 누적 기록"으로
이미 잡혀있던 과제(rps/liar/mafia/halligalli/yutnori/strategy-yutnori)를, 방금 추가된
"기록 이미지 공유"까지 포함해 진행한다. 저장 방식(이 기기 로컬 vs 서버 영속)을
AskUserQuestion으로 확인한 결과 **서버 영속 + 전체 통합 랭킹**을 선택했다 — RPS처럼
전체 참가자가 같은 순위표를 보는 방식이다.

## 결정과 이유

1. **RPS의 기존 랭킹(`ranking.json`, 모드별 승수)은 손대지 않는다.** 이미 실제 서비스
   중이고 몇 주치 실사용자 데이터가 쌓여있는 유일한 기존 시스템이다 — 스키마를
   `{wins, losses}`로 통일하려고 이걸 건드리면 기존 데이터 손실/마이그레이션 리스크가
   생긴다. 대신 RPS는 **이미지 저장/공유 버튼만 추가**하고, 나머지 5개 게임에 새 파일
   기반 랭킹을 별도로 만든다.
2. **5개 게임 공용 저장소 모듈(`ws-server/ranking-store.mjs`)을 새로 뽑았다.** RPS의
   기존 `server.mjs` 안에 있던 "주 단위 키 + 디바운스 저장 + 파일 영속" 패턴을 그대로
   재사용하되, 게임마다 로직을 5번 복붙하지 않도록 `createRankingStore(gameKey)` 팩토리로
   일반화했다. 각 게임은 `ranking-<gameKey>.json`이라는 **별도 파일**에 저장되므로(기존
   `ranking.json`과 파일명이 겹치지 않음), 같은 named volume(`rps-server-data`)을 그대로
   재사용해도 서로 덮어쓸 위험이 없다 — 재배포 때 새 볼륨을 만들 필요가 없다.
3. **승/패 판정 기준을 게임마다 다르게 정의했다** (전부 서버의 `game_over`/`round_result`
   판정 지점에서 그대로 파생):
   - **라이어게임**: 매 라운드가 끝날 때(`finishRound`) 기록한다. 무승부(`winner==='draw'`,
     동률 재투표까지 갔는데도 또 동률)는 승패 어느 쪽도 아니므로 기록하지 않는다. 라이어
     역할이었던 사람은 `winner==='liar'`일 때 승, 시민이었던 사람은 `winner==='citizens'`일
     때 승.
   - **마피아게임**: 게임 전체가 끝날 때(`checkGameOver`, 라운드 단위가 아님) 1회 기록.
     역할이 `mafia`였는지로 팀을 나누고, 승리 팀과 일치하면 승.
   - **할리갈리 / 윷놀이 / 전략윷놀이**: 승자가 정해지는 순간(카드 독식/말 4개 완주/개인
     말 2개 완주, 또는 인원 부족으로 조기 종료) 1회 기록. 승자 토큰과 일치하면 승, 그 방에
     남아있던 나머지 전원은 패.
   - **공통**: 게임 도중 이탈해서 `finalizeLeave`로 조기 종료된 경우, 이탈한 사람은 이미
     `room.players`에서 제거된 뒤라 패로 집계되지 않는다(의도적 단순화 — "이탈 페널티"는
     이번 스코프가 아니다, 남아서 승리를 챙긴 사람의 승만 확실히 기록되면 충분하다고 판단).
4. **"점수"는 별도 필드를 만들지 않고 승수(`wins`)를 그대로 랭킹 정렬 키로 쓴다.** RPS의
   기존 방식(모드별 승수 합계 `total`로 정렬)과 일관되게, 이 5개 게임도 임의의 점수 공식을
   새로 발명하지 않고 "승수"를 점수로 취급했다 — 게임마다 라운드 길이·난이도가 달라
   자체적인 점수 배점을 만들면 게임 간 비교 기준이 애매해지기 때문에, "이겼는지"만 세는
   RPS의 검증된 접근을 그대로 따르는 게 더 방어 가능한 설계라고 판단했다.
5. **`/ranking/<game>` 경로로 노출, `nginx.conf` 변경 불필요.** 기존
   `location /ranking { proxy_pass http://127.0.0.1:30081/ranking; }`이 접미사 없는
   prefix location이라 `/ranking/liar`, `/ranking/mafia` 등도 그대로 같은 백엔드로
   프록시된다(nginx가 매치된 prefix를 동일한 proxy_pass 경로로 치환하기 때문에 URI 전체가
   그대로 전달됨) — WAS의 `~/rps-tls/nginx.conf`를 건드리거나 `rps-tls` 컨테이너를
   재시작할 필요가 없고, `rps-server` 컨테이너 재배포만으로 충분하다. 배포 리스크를 크게
   줄여주는 발견이라 별도로 기록해둔다.
6. **클라이언트 공용 모듈(`src/shared/ws-ranking.ts`)로 5개 게임의 랭킹 UI(조회·렌더·
   이미지 저장/공유)를 통일했다.** RPS의 기존 랭킹 UI(`src/pages/rps/main.ts`)가 이미
   증명된 패턴(주간 탭, 로딩 스피너, 이미지 배지)을 가지고 있어서 그 구조를 그대로
   일반화했다. RPS 자신은 `byMode` 스키마가 달라 이 공용 모듈을 쓰지 않고 자체 코드에
   이미지 저장/공유만 추가했다.

## 서버 파일 변경 요약

- `ws-server/ranking-store.mjs` (신규): `isoWeekKey()`, `createRankingStore(gameKey)`.
- `ws-server/{liar,mafia,halligalli,yutnori,strategy-yutnori}.mjs`: 각 게임오버 지점에
  기록 호출 추가, `registerXServer()`가 `{ wss, getRanking }`을 반환하도록 변경.
- `ws-server/server.mjs`: 5개 게임의 `getRanking`을 구조분해로 받아 `/ranking/<game>`
  라우트 5개 추가. RPS 자체 랭킹 로직(`recordSetWin`/`getRanking`/`/ranking`)은 그대로.

## 배포

`ws-server/README.md`의 "재배포 절차"를 그대로 따른다 — rsync로 `.mjs` 전체 동기화 →
`docker build` → `rps-server` 컨테이너만 교체(같은 named volume 재사용, RPS 기존 랭킹
데이터 보존). `nginx`/`rps-tls`는 위 5번 결정 때문에 손대지 않는다.
