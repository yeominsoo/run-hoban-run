# 개발환경

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [저장소 및 브랜치](#저장소-및-브랜치)
3. [기술 스택](#기술-스택)
4. [실행 방법](#실행-방법)
5. [테스트 방법](#테스트-방법)
6. [파일 구성](#파일-구성)

## 프로젝트 개요

- 프로젝트명: `run-hoban-run`
- 앱 이름: `달려라 검단호수공원 호반써밋`
- 형태: 브라우저에서 동작하는 정적 웹앱
- 패키지 타입: ES Module

## 저장소 및 브랜치

- 원격 저장소: `https://github.com/yeominsoo/run-hoban-run`
- 기준 브랜치: `master`
- 작업 브랜치: `feature/race-lottery-game`

## 기술 스택

- HTML: `index.html`
- CSS: `styles.css`
- JavaScript: 순수 ES Module
- 테스트: Node.js 내장 테스트 러너
- 로컬 서버: Python 내장 HTTP 서버

외부 프레임워크나 번들러 없이 실행되도록 구성했습니다.

## 실행 방법

```bash
npm run start
```

기본 실행 주소:

```text
http://localhost:5174
```

`package.json`의 `start` 스크립트는 다음 명령을 실행합니다.

```bash
python3 -m http.server 5174
```

## 테스트 방법

```bash
npm test
```

Docker로 동일 테스트를 실행할 때는 다음 명령을 사용합니다.

```bash
npm run test:docker
```

`package.json`의 `test` 스크립트는 다음 명령을 실행합니다.

```bash
node --test
```

`package.json`의 `test:docker` 스크립트는 `Dockerfile.test`로 테스트 이미지를 빌드한 뒤 컨테이너 안에서 `npm test`를 실행합니다.

주요 검증 대상:

- 핵심 룰 상수
- 800명 참가 제한
- 장애물 10회 생성
- 55등부터 155등까지 통과 예시
- 동일 시드 결과 재현성
- 800명 레이스 처리

## 파일 구성

| 경로 | 역할 |
| --- | --- |
| `index.html` | 앱 진입점과 화면 구조 |
| `styles.css` | 레이아웃, 레이스 트랙, 반응형 스타일 |
| `src/raceEngine.js` | 게임 룰과 시뮬레이션 엔진 |
| `src/app.js` | UI 이벤트, 상태 관리, 애니메이션 렌더링 |
| `tests/raceEngine.test.js` | 엔진 규칙 테스트 |
| `docs/game-design.md` | 사용자용 게임 설계 문서 |
| `.ai-work/` | AI 협업용 개발 정리 문서 |
