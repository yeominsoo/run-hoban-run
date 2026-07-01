# Repository Rules

## Project Overview

`run-hoban-run`은 Vite + TypeScript + Three.js 기반의 3D 레이스 시뮬레이션 + 행사 추첨/토너먼트 웹게임이다.
말이 주자이며, 운영자가 참가자 명단을 입력하면 3D 레이스가 자동 진행된다.

## 디렉토리 구조

```
src/
  main.ts          # 경기 상태, 카메라, 말 애니메이션, 렌더 루프 조립
  rules.ts         # 공통 상수 및 규칙
  game/            # 토너먼트/경주 룰, 확률 계산, 시드 기반 엔진
  render/          # Three.js 렌더 보조 모듈, 헬기 모델, 이펙트
    scene-utils.ts
    helicopter.ts
  ui/              # DOM 화면 골격 및 쿼리 헬퍼
    app-shell.ts
  assets/          # 코드에서 참조하는 정적 에셋 메타데이터
public/assets/     # 브라우저에 직접 제공되는 GLB 등 정적 파일
tests/             # Playwright 룰/렌더 검증
docs/              # 기획 및 설계 문서
```

## 개발 명령어

```bash
npm run dev           # 개발 서버 실행
npm run build         # TypeScript 컴파일 + Vite 빌드
npm run test:render   # Playwright 렌더 검증
npm run deploy:firebase  # Firebase Hosting 배포
```

## GitHub SSH 규칙

WSL2에서 `fetch`, `pull`, `push` 등 GitHub SSH 원격 작업을 수행할 때는 기본 SSH 키를 가정하지 않는다.
다음 키를 명시해서 실행한다:

```bash
GIT_SSH_COMMAND='ssh -i /home/msyeo/.ssh/yeominsoo_ed25519 -o IdentitiesOnly=yes' git fetch origin --prune
GIT_SSH_COMMAND='ssh -i /home/msyeo/.ssh/yeominsoo_ed25519 -o IdentitiesOnly=yes' git push origin master
```

## 핵심 설계 원칙

### 레이스 엔진
- 참가자별 능력치(속도/체력/파워 등)는 없다. 모든 말은 동일한 기본 완주 시간에서 시작한다.
- 승부는 **말마다 배정된 20개 논리 주행 구간의 시드 기반 랜덤 속도 배율**로만 결정된다.
- 스킬은 시각 연출 전용이며 완주 시간 보정은 하지 않는다.
- 시드 + 라운드 + 조 + 참가자 ID 조합으로 결과가 항상 재현 가능해야 한다.

### 토너먼트 규칙
- 전체 참가자 최대 500명, 한 레이스 최대 20마리
- 21명 이상이면 `ceil(참가자 수 / 20)` 개 조로 자동 분리
- 각 조의 상위 N마리가 다음 라운드 진출, 진출자가 20명 이하가 되면 결승 진행

### 스킬 시스템
- 경기 시작 시 출전 말마다 숨김 스킬 1개 자동 배정 (경기 전 공개 금지)
- 발동 확률 3%, 경기당 최대 1회, 5초 지속
- 발동하지 않은 스킬은 경기 종료 후에도 공개하지 않는다

### 헬리콥터 탈락 이벤트
- 4명 이상 레이스에서만 발동, 출전자의 약 1/3이 랜덤 탈락
- 헬리콥터 모델은 **외부 GLB 없이 절차형 Three.js**로 구성한다
- 선두가 1/3 지점 통과 시 골인지점 쪽에서 등장, 1/2 지점 통과 시 탈락 연출 시작
- 탈락 연출 중 카메라 대상 변경 UI는 잠긴다

### 렌더링 및 모델
- 말 모델은 캐주얼 마스코트형 저폴리 절차적 모델 우선
- GLB/GLTF는 필요한 경우에만 `public/assets/`에 추가, 기본 런타임은 에셋 다운로드 없이 실행
- 우마무스메의 캐릭터/세계관/명칭/UI/음원/모델/애니메이션을 복제하지 않는다
- 주자는 사람이 아닌 말이어야 한다

## 기술 스택

| 항목 | 선택 |
|------|------|
| 번들러 | Vite |
| 언어 | TypeScript |
| 3D | Three.js |
| UI | 순수 DOM (React 미도입) |
| 테스트 | Playwright |
| 배포 | Firebase Hosting (`hoban-lakepark-ab19`) |

## Context Compaction 후 재개 시

이전 세션이 컨텍스트 압축으로 종료된 경우 다음을 먼저 확인한다:

1. `git status --short` — 미완성 변경사항 확인
2. `docs/` 내 최근 기획/작업 문서 확인
3. 확인 전까지 커밋·푸시·배포를 진행하지 않는다
