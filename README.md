# run-hoban-run

검단호수공원역 호반써밋 경마 추첨 웹게임입니다.

React, TypeScript, Vite, React Three Fiber 기반 3D 레이스 장면으로 FHD 화면에서 스크롤을 최소화해 운영할 수 있게 구성했습니다.

3D 말은 Quaternius/Poly Pizza의 CC0 리깅 GLB를 런타임 로딩합니다. 말 애니메이션은 `src/game/horseModelManifest.ts`의 클립 매핑을 기준으로 idle/walk/gallop/jump/brake 상태에 연결됩니다.

## 실행

```bash
npm install
npm run start
```

브라우저에서 `http://localhost:5174`를 엽니다.

## 테스트

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Docker로 테스트:

```bash
npm run test:docker
```

## 규칙

- 제목: 달려라 검단호수공원 호반써밋
- 참가자: 최대 800명
- 트랙: 3가지 유형
- 경기 시간: 시뮬레이션 기준 84초
- 조별 진행: 기본 10마리, 5/10/15/20마리 선택 가능
- 장애물: 현재 비활성화
- 헬기 이벤트: 조별 3회 등장, 타격 대상은 사격 순간까지 숨김
- 스킬: 참가자별 5% 확률 기반, 최소 2명은 10초간 발동
- 통과: 운영자가 지정한 순위 범위 안에 들어온 참가자

## 작업 룰

- 작업 완료 시 검증 후 `git commit`과 `git push`를 기본 완료 절차로 한다.
- 원격 인증 문제로 push가 막히면 커밋까지 완료하고 차단 원인을 기록한다.
