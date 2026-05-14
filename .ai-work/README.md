# AI 작업 문서 목차

`달려라 검단호수공원 호반써밋` 경마 추첨 웹게임의 개발 내용을 AI 협업 관점에서 유형별로 정리한 문서 모음입니다.

## 목차

1. [게임 룰](./01-game-rules.md)
   - 참가자 제한, 트랙 유형, 장애물, 스킬, 통과 판정 규칙
2. [개발환경](./02-development-environment.md)
   - 실행 방식, 테스트 명령, 브랜치와 저장소 정보
3. [구현 구조](./03-architecture.md)
   - 주요 파일, 엔진/UI 분리, 데이터 흐름
4. [화면 및 운영 흐름](./04-ui-flow.md)
   - 운영자 입력, 레이스 진행, 결과 확인 방식
5. [검증 및 체크리스트](./05-verification.md)
   - 자동 테스트, 수동 확인, 요구사항 대응표

## 빠른 요약

- 앱 유형: 정적 웹앱
- 실행 파일: `index.html`
- 핵심 엔진: `src/raceEngine.js`
- UI 제어: `src/app.js`
- 스타일: `styles.css`
- 테스트: `tests/raceEngine.test.js`
- 실행 명령: `npm run start`
- 테스트 명령: `npm test`
