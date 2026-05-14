# 검증 및 체크리스트

## 목차

1. [자동 검증](#자동-검증)
2. [수동 검증](#수동-검증)
3. [요구사항 대응표](#요구사항-대응표)
4. [남은 운영 확인 항목](#남은-운영-확인-항목)

## 자동 검증

실행 명령:

```bash
npm test
```

Docker 실행 명령:

```bash
npm run test:docker
```

현재 테스트 파일:

- `tests/raceEngine.test.js`

검증 내용:

- 최대 참가자 수가 800명인지 확인
- 레이스 시간이 60초인지 확인
- 장애물 수가 10회인지 확인
- 장애물 통과 확률이 49%인지 확인
- 스킬 발동 확률이 5%인지 확인
- 스킬 지속 시간이 10초인지 확인
- 트랙 유형이 3가지인지 확인
- 55등부터 155등까지 통과하면 101명이 통과하는지 확인
- 동일 시드로 같은 최종 순위가 재현되는지 확인
- 800명 레이스에서 장애물 판정 총합이 `800명 x 10회`인지 확인

## 수동 검증

로컬 실행:

```bash
npm run start
```

브라우저 확인:

```text
http://localhost:5174
```

수동 확인 항목:

- 앱 제목이 `달려라 검단호수공원 호반써밋`으로 표시되는지 확인
- 참가자 입력 카운터가 `현재 인원/800`으로 표시되는지 확인
- 800명 샘플 생성이 동작하는지 확인
- 트랙 3가지가 모두 선택 가능한지 확인
- 트랙 화면에 경기장 그래픽, 출발선, 결승선이 표시되는지 확인
- 움직이는 참가자 표시가 이름 왼쪽, 말 이미지 오른쪽 구조인지 확인
- 참가자별 색상이 다양하게 배정되어 선두권 구분이 쉬운지 확인
- 설정과 결과가 좌우 고정 패널이 아니라 레이어 패널로 열리는지 확인
- 시드 입력값이 화면에 보이지 않는지 확인
- `규칙 갱신` 버튼이 상단 조작 바에 유지되는지 확인
- 통과 순위 범위를 바꾸면 통과자 수가 달라지는지 확인
- 레이스 시작 시 60초 진행률이 움직이는지 확인
- 장애물 마커가 레이스 중 상태 변경되는지 확인
- 스킬 발동 참가자가 화면에서 강조되는지 확인
- 종료 후 통과자 목록과 최종 순위가 표시되는지 확인
- CSV 버튼으로 결과 파일을 받을 수 있는지 확인

## 요구사항 대응표

| 요구사항 | 구현 위치 | 검증 위치 |
| --- | --- | --- |
| 웹 기반 경마 추첨 게임 | `index.html`, `src/app.js` | 브라우저 수동 확인 |
| 제목 지정 | `index.html`, `src/raceEngine.js` | 수동 확인 |
| 최대 800명 참가 | `src/raceEngine.js` | `tests/raceEngine.test.js` |
| 트랙 3가지 유형 | `src/raceEngine.js`, `src/app.js` | `tests/raceEngine.test.js` |
| 랜덤 장애물 10회 | `src/raceEngine.js` | `tests/raceEngine.test.js` |
| 장애물 통과 확률 49% | `src/raceEngine.js` | `tests/raceEngine.test.js` |
| 스킬 발동 확률 5% | `src/raceEngine.js` | `tests/raceEngine.test.js` |
| 스킬 지속 10초 | `src/raceEngine.js` | `tests/raceEngine.test.js` |
| 총 1분 레이스 | `src/raceEngine.js`, `src/app.js` | `tests/raceEngine.test.js` |
| 지정 순위 범위 통과 | `src/raceEngine.js`, `src/app.js` | `tests/raceEngine.test.js` |
| 예시 55등부터 155등 | `index.html`, `src/app.js` | `tests/raceEngine.test.js` |
| 설계 문서 | `docs/game-design.md`, `.ai-work/` | 문서 확인 |
| 새 브랜치 작업 | Git 브랜치 `feature/race-lottery-game` | `git branch --show-current` |

## 남은 운영 확인 항목

- 실제 행사 참가자 명단 형식을 정하면 입력 전처리 규칙을 추가할 수 있습니다.
- 통과자 발표 방식을 더 극적으로 보여줄 필요가 있으면 결과 패널에 발표 모드를 추가할 수 있습니다.
- 현장 화면 비율이 정해지면 레이스 라인 수와 글자 크기를 조정하는 것이 좋습니다.
