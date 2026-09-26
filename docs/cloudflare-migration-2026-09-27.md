# Cloudflare 백엔드 이전 기록 (2026-09-27)

## 배포

- 프론트엔드: https://hoban-lakepark-ab19.web.app (Firebase Hosting 유지)
- 백엔드: https://toris-arcade-games.line-nori-yeominsoo.workers.dev
- Worker: `toris-arcade-games`, SQLite Durable Object: `GameService`, binding: `GAMES`
- 최초 코드 버전: `54a80ac3-dc68-4b5a-a2ec-bf9be9627823` (이후 임시 secret 추가/삭제 배포)
- Workers Free 사용. 유료 플랜 변경이나 Containers 생성은 하지 않았다.

미니 PC Node 서버의 멀티 18종과 싱글 점수 API 10종을 옮겼다. 게임별로 하나의 Object에 여러
방을 보관한다. 기존 게임 모듈에 WebSocket/저장소/이름 있는 타이머를 주입해 Node와 Worker가
동일한 규칙을 실행한다. Maps/Sets/공유 참조/소켓 참조를 보존한 스냅샷으로 재접속과 타이머를
복원한다. 결과는 저장 후 전송하며, 기존 UTC 주간 랭킹 기준과 비공개 역할 정보 정책을 유지한다.

WebSocket Hibernation과 durable alarm을 사용한다. 짧은 연출용 2초 이하 타이머는 실행 중
런타임 타이머도 쓰므로 플레이 중 실행 시간이 발생한다. 참가자 동작 없이 30분이 지난 방은
정리한다. 연결/방/메시지 제한과 정확한 운영 명령은 `ws-server/README.md`에 있다.

## 데이터 이전

원본 `rps-server:/app/data`를 아래 디렉터리에 복사하고 SHA-256 manifest를 저장했다.

`output/cloudflare-migration-20260927-tfd3qa56/`

복사한 파일은 6개, 합계 2,574바이트다. 개인 닉네임과 임시 인증정보는 Git에 포함하지 않는다.

| 파일 | 바이트 |
| --- | ---: |
| ranking.json | 1,222 |
| ranking-memory-sequence.json | 79 |
| ranking-mole-hunt.json | 82 |
| ranking-multiplication-sprint.json | 82 |
| score-ranking-aim-trainer.json | 63 |
| score-ranking-endless-runner.json | 1,046 |

이전 직전 기존 서버의 연결 수는 0이었다. 임시 `MIGRATION_TOKEN`으로만 인증되는 이전 API로
파일을 전송했다. 전체 과거 주차/싱글 점수의 응답 8개가 원본에서 계산한 랭킹과 일치함을
확인했고, 원본 파일이 백업 이후 바뀌지 않았음도 비교했다. 이전 후 secret을 삭제했다.
기존 랭킹이 있는 Object는 이전 API가 409로 덮어쓰기를 거부한다.

## 검증

- 기존 Node 테스트 3개 통과: 재접속 정책, 파일 기반 점수 저장/HTTP.
- Cloudflare 상태 복원/게임 규칙 테스트 24개 통과: 18개 게임 타이머 진행, 비공개 정보,
  순위 저장, 소켓 교체, 카드 보존, 특수 객체 키.
- workerd 통합 테스트 3개 통과: 실제 WebSocket, 서버 재시작 후 복구, 클라이언트 메시지
  없이 3초 카운트다운 실행, 랭킹/점수 HTTP, 이전 API 인증 및 덮어쓰기 방지.
- 윷놀이/전략윷놀이 Playwright 규칙 테스트 28개 통과.
- Worker dry-run 빌드, 프론트엔드 TypeScript/Vite 빌드 통과.
- 프론트엔드 빌드 결과에 Cloudflare 공개 주소 19개가 포함되고 이전 DuckDNS 주소가 없음을 확인.
- 실제 Cloudflare 서버에서 18개 게임의 생성/참가/소켓 교체 재입장/퇴장 통과.
- Firebase Hosting 배포 완료. 공개 사이트의 독립 브라우저 2개에서 가위바위보 참가,
  새로고침 후 재입장 버튼을 통한 복구, 대결 결과 표시 통과. 모든 WebSocket이 Cloudflare로
  연결되고 브라우저 오류가 없음을 확인했다. 무승부로 진행해 점검 닉네임의 랭킹을 만들지 않았다.

프로덕션 접속 점검은 `node ws-server/cloudflare/smoke.mjs <backend URL>`로 재현할 수 있다.
이 스크립트는 순위가 기록되기 전에 퇴장한다. 모바일/브라우저 전체 게임 플레이와 행사 규모의
장시간 부하 테스트를 대체하지는 않는다.

## 무료 사용량과 API 토큰

토큰을 앱마다 발급할 필요는 없다. 해당 계정의 Worker 배포 권한이 있는 하나의 토큰으로 여러
앱을 배포할 수 있다. 별도 토큰은 담당자/권한/폐기 주기를 나눌 때 사용한다. 토큰 수를 늘려도
계정의 무료 사용량은 늘지 않는다. 토큰은 ignored `.env`나 배포 환경에만 두고, `VITE_` 변수에는
공개 URL만 넣는다.

일일 무료 한도는 UTC 00:00, 한국 시간 09:00에 초기화된다. Durable Objects의 요청/실행 시간/
SQLite 읽기·쓰기를 각각 확인해야 하며, 저장 용량은 매일 비워지는 한도가 아니다. 동시 인원과
접속 시간만으로 사용량이 정해지지 않으므로 첫 행사 이후 대시보드의 실제 사용량을 확인한다.
현재 유료 구독을 추가하지 않았으며, 이 기록은 무료 한도 안에서 항상 동작한다는 보장은 아니다.

- [Cloudflare 토큰 생성과 권한](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Durable Objects 요금/무료 한도](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## 재배포와 롤백

백엔드 변경은 `ws-server/README.md`의 Wrangler 배포 절차로 반영한다. 프론트엔드
`.env.production`과 `deploy/k8s/base/firebase-deploy-job.yaml` 모두 Cloudflare 주소로 전환했다.
Firebase 자동 배포 Job이 이전 DuckDNS 주소를 다시 주입하지 않도록 두 파일을 함께 관리한다.

미니 PC의 `rps-server`, `rps-tls`, `rps-server-data` 볼륨은 그대로 남겨 두었다. 긴급 접속 복구가
필요하면 두 프론트엔드 설정 파일의 호스트를 `toris-arcade.duckdns.org:30080`으로 되돌리고
빌드/배포한다. **Cloudflare 전환 후 추가된 랭킹은 기존 서버에 자동 복제되지 않으며**, 롤백 시
양쪽 기록을 별도로 보존·병합해야 한다. Cloudflare Object나 기존 볼륨을 삭제하지 않는다.
