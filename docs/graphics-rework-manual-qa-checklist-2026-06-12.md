# 그래픽 리워크 수동 QA 체크리스트 - 2026-06-12

이 문서는 `docs/graphics-rework-phase-index-2026-06-12.md`의 P5B 운영 체크리스트다. 자동 render suite가 만드는 증거 이미지와 별개로, 현장 디스플레이/공유 이미지 관점에서 사람이 짧게 확인할 항목만 둔다.

## 실행 기준

- 서버: `http://localhost:30000/`
- 자동 검증: `PLAYWRIGHT_BASE_URL=http://localhost:30000 npm run test:render`
- 권장 viewport:
  - desktop: 1440x900
  - mobile: 390x844
- 기준 캡처:
  - `test-results/p2c-gallop-grounding-desktop.png`
  - `test-results/p2c-gallop-grounding-mobile.png`
  - `test-results/p3a-camera-sequence-early.png`
  - `test-results/p3a-camera-sequence-mid.png`
  - `test-results/p3b-final-stretch.png`
  - `test-results/p3b-finish.png`
  - `test-results/p3c-frenzy-brief-cut.png`
  - `test-results/p3c-frenzy-return.png`
  - `test-results/p3c-helicopter-return.png`
  - `test-results/p4a-winner-presentation.png`
  - `test-results/p4b-result-capture.png`

## 수동 점검 항목

### 1. 일반 경주 장면

- 말/기수가 화면의 주요 피사체로 보인다.
- 캔버스가 이름표 구름처럼 보이지 않는다.
- leaderboard가 이름/순위의 기준 소스로 읽힌다.
- 레일, 결승 포스트, 거리 표지, 관중석이 경마장 문법으로 읽힌다.
- desktop과 mobile 모두 leaderboard, minimap, callout이 주요 피사체를 가리지 않는다.

### 2. 모델과 움직임

- 절차형 horse/rider 스타일이 참가자 전체에서 일관된다.
- saddlecloth 번호가 말 구분에 도움이 된다.
- gallop bob, 다리 움직임, 꼬리, 먼지가 접지감을 만든다.
- 스킬 이펙트가 말/기수를 완전히 덮지 않는다.

### 3. 중계 흐름

- `early -> mid -> final-stretch -> finish -> winner` 흐름이 갑작스럽게 끊기지 않는다.
- final-stretch에서 결승선과 선두권이 함께 읽힌다.
- frenzy/헬리콥터 컷 이후 일반 카메라로 자연스럽게 돌아온다.
- 컷신 중 leaderboard lock이 끝난 뒤 해제된다.

### 4. 우승/결과 장면

- `p4a-winner-presentation.png`에서 우승마가 잘리지 않는다.
- 우승 배너가 말과 완전히 겹쳐 핵심 피사체를 가리지 않는다.
- `p4b-result-capture.png`에 우승 배너와 결과 패널이 함께 들어간다.
- 결과 다운로드 이미지는 공유해도 우승자, seed, 결과 순위가 읽힌다.

### 5. 녹화/다운로드

- 결과 스크린샷 버튼은 최종 우승 장면에서 정상 다운로드된다.
- 녹화 버튼은 시작/중지 상태가 명확하고 다운로드 파일이 생성된다.
- 캡처 파일에서 runner label과 winner banner가 필요한 경우 합성된다.

## 이슈 분류

수동 QA에서 발견한 문제는 아래 셋 중 하나로 분류한다.

- 화면 품질 문제: 테스트는 통과하지만 실제로 보기 나쁘거나 경마처럼 읽히지 않는다.
- 테스트 기대값 문제: 제품은 정상인데 캡처 타이밍이나 assertion이 장면 의도와 맞지 않는다.
- 제품 결함: 사용자 조작, 레이스 진행, 다운로드, 녹화, 카메라 복귀가 실제로 깨진다.

## 보고 형식

```md
## 그래픽 QA 보고

- 날짜:
- 브랜치/커밋:
- 서버:
- 자동 검증:
- viewport:
- seed:

### 결과

- 일반 경주:
- 모델/움직임:
- 중계 흐름:
- 우승/결과:
- 녹화/다운로드:

### 발견 이슈

- 분류:
- 재현 단계:
- 기대 결과:
- 실제 결과:
- 증거 파일:
```
