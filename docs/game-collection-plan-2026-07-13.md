# 게임 모음집 개발 계획서

> **주의**: 이 문서는 `docs/game-plan-for-master`, `docs/game-collection-plan` 브랜치에서 가져온
> 초안으로, Vanilla JS + Canvas 기반 단일 허브(`games/{name}/`) 구조를 전제로 작성되었다.
> 실제 현재 저장소는 Vite + TypeScript + Three.js이며, `race/team/dice/rps/liar/mafia/halligalli`
> 멀티페이지 구조와 `ws-server/` 실시간 서버를 이미 갖추고 있다(`AGENTS.md` 참고).
>
> **→ 현재 아키텍처에 맞게 다시 짠 버전은 [`docs/game-collection-plan-v2-2026-07-13.md`](./game-collection-plan-v2-2026-07-13.md)를
> 참고할 것.** 이 문서는 게임 아이디어/룰 명세의 원본 레퍼런스로만 남겨둔다.

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [전체 아키텍처](#전체-아키텍처)
3. [디렉터리 구조](#디렉터리-구조)
4. [공통 시스템](#공통-시스템)
5. [게임별 명세](#게임별-명세)
6. [개발 단계](#개발-단계)
7. [모바일 대응](#모바일-대응)
8. [Google Play 출품](#google-play-출품)
9. [세션 간 협업 규칙](#세션-간-협업-규칙)

---

## 프로젝트 개요

- **프로젝트명**: run-hoban-run 게임 모음집
- **목표**: 웹 + 모바일 겸용 미니게임 허브를 만들어 Google Play에 출품
- **기술 스택**: Vanilla JS + Canvas API (외부 라이브러리 없음)
- **모바일 변환**: Capacitor (코드 수정 없이 APK 래핑)
- **작성일**: 2026-07-13

### 포함 게임 (총 11개)

| # | 게임 | 난이도 | 상태 |
|---|------|--------|------|
| 0 | 경마 추첨 (달려라 호반써밋) | 완성 | ✅ 기존 |
| 1 | 에임 트레이너 | 쉬움 | ⬜ 미개발 |
| 2 | 색 맞추기 슬라이더 | 쉬움 | ⬜ 미개발 |
| 3 | 볼 피하기 + 수집 | 쉬움 | ⬜ 미개발 |
| 4 | 타워 쌓기 | 쉬움 | ⬜ 미개발 |
| 5 | 스네이크 비틀기 | 쉬움 | ⬜ 미개발 |
| 6 | 타이핑 생존 | 쉬움 | ⬜ 미개발 |
| 7 | 2048 변형 (육각형) | 중간 | ⬜ 미개발 |
| 8 | 무한 러너 | 중간 | ⬜ 미개발 |
| 9 | 방치형 농장 | 중간 | ⬜ 미개발 |
| 10 | 핀볼 로그라이크 | 어려움 | ⬜ 미개발 |

---

## 전체 아키텍처

```
허브 홈 (index.html)
  └── 게임 선택 카드 그리드
        ├── games/race/index.html        ← 기존 경마 추첨 (이동)
        ├── games/aim-trainer/index.html
        ├── games/color-slider/index.html
        ├── games/ball-dodge/index.html
        ├── games/tower-stack/index.html
        ├── games/snake/index.html
        ├── games/typing-survival/index.html
        ├── games/2048-hex/index.html
        ├── games/endless-runner/index.html
        ├── games/idle-farm/index.html
        └── games/pinball-rogue/index.html
```

**각 게임 페이지 구조**

```
games/{name}/index.html   ← 게임 HTML
games/{name}/game.js      ← 게임 로직 (Canvas 또는 DOM)
games/{name}/style.css    ← 게임별 스타일 (최소화)
```

**공유 자원**

```
shared/
  ├── hub.css             ← 허브 홈 스타일
  ├── game-shell.css      ← 게임 공통 쉘 (헤더, 뒤로가기, 점수판)
  └── utils.js            ← 공통 유틸 (터치/마우스 통합, 점수 저장)
```

---

## 디렉터리 구조

```
run-hoban-run/
├── index.html                    ← 허브 홈 (새로 작성)
├── shared/
│   ├── hub.css
│   ├── game-shell.css
│   └── utils.js
├── games/
│   ├── race/                     ← 기존 경마 추첨 파일 이동
│   │   ├── index.html
│   │   ├── style.css
│   │   └── src/
│   ├── aim-trainer/
│   ├── color-slider/
│   ├── ball-dodge/
│   ├── tower-stack/
│   ├── snake/
│   ├── typing-survival/
│   ├── 2048-hex/
│   ├── endless-runner/
│   ├── idle-farm/
│   └── pinball-rogue/
├── assets/
│   ├── horse.svg                 ← 기존
│   └── icons/                   ← 게임 아이콘 (SVG)
├── src/                          ← 기존 경마 엔진 (이동 전 임시 유지)
├── docs/
├── .ai-work/
└── package.json
```

---

## 공통 시스템

### 게임 쉘 (game-shell.css + utils.js)

모든 게임 페이지는 동일한 쉘을 사용합니다.

```
┌─────────────────────────────────┐
│ ← 뒤로   [게임 이름]   최고: 0  │  ← 공통 헤더
├─────────────────────────────────┤
│                                 │
│         게임 영역 (Canvas)       │
│                                 │
└─────────────────────────────────┘
```

### 점수 저장

- `localStorage` 사용 (`rhh_{gameName}_best` 키)
- Capacitor 환경에서도 동일하게 동작

### 터치/마우스 통합 (`utils.js`)

```js
// utils.js 에서 제공하는 공통 함수
getPointerPos(e)       // touch / mouse 통합 좌표
onTap(el, callback)    // touchstart + click 통합
onDrag(el, callback)   // touchmove + mousemove 통합
onSwipe(el, callback)  // 스와이프 방향 감지
```

---

## 게임별 명세

### 1. 에임 트레이너 (`aim-trainer`)

**목표**: 화면에 원이 나타나면 빠르게 탭/클릭

- 입력: 탭 / 클릭
- 판정: 원 안을 탭하면 명중 / 밖이면 미스
- 원 크기: 레벨 올라갈수록 작아짐 (80px → 30px)
- 시간: 30초 제한
- 점수: 명중 +100, 빠를수록 보너스
- Canvas 사용: 예
- 모바일 주의사항: 없음

---

### 2. 색 맞추기 슬라이더 (`color-slider`)

**목표**: R/G/B 슬라이더를 드래그해 목표 색과 최대한 가깝게 맞추기

- 입력: 슬라이더 드래그 (touch / mouse)
- 판정: 목표 색과 현재 색의 RGB 오차 계산 → 정확도 % 표시
- 라운드: 10라운드, 라운드당 15초
- 점수: 정확도 × 100 (라운드당 최대 100점)
- Canvas 사용: 부분 (색상 미리보기 rect만)
- 모바일 주의사항: 슬라이더 터치 영역 최소 44px

---

### 3. 볼 피하기 + 수집 (`ball-dodge`)

**목표**: 플레이어를 움직여 빨간 볼 피하고 초록 볼 수집

- 입력: 터치 드래그 / 마우스 드래그 (플레이어 위치 직접 이동)
- 규칙: 빨간 볼 닿으면 HP -1 (HP 3), 초록 볼 먹으면 +10점
- 난이도: 30초마다 볼 속도 +20%, 볼 수 +2
- Canvas 사용: 예
- 모바일 주의사항: 없음

---

### 4. 타워 쌓기 (`tower-stack`)

**목표**: 왔다갔다 움직이는 블록을 탭해서 정확하게 쌓기

- 입력: 탭 / 클릭 1회
- 규칙: 이전 블록과 겹치는 부분만 남음, 삐진 부분 잘림
- 종료 조건: 블록 너비가 10px 미만이면 게임 오버
- 점수: 층 수
- Canvas 사용: 예
- 모바일 주의사항: 없음

---

### 5. 스네이크 비틀기 (`snake`)

**목표**: 뱀이 먹이를 먹으며 성장, 자기 몸에 부딪히면 게임 오버

**비틀기 요소**:
- 벽 없음 (반대편으로 통과)
- 시간 갈수록 속도 업
- 속도 업 구간마다 색깔 테마 변경

- 입력: 방향키 / WASD / 스와이프 (모바일)
- Canvas 사용: 예
- 모바일 주의사항: 스와이프 방향 감지 필요

---

### 6. 타이핑 생존 (`typing-survival`)

**목표**: 화면 상단에서 떨어지는 단어를 바닥에 닿기 전에 타이핑

- 입력: 키보드 타이핑
- 단어 소스: 내장 단어 목록 (영어 100개 + 한국어 100개)
- 레벨: 10초마다 속도 업, 동시 단어 수 증가
- 종료 조건: 단어가 바닥에 닿으면 HP -1 (HP 3)
- 점수: 단어 제거 수 × 레벨 배수
- Canvas 사용: 단어 애니메이션 (Canvas), 입력 필드 (DOM input)
- **모바일 주의사항**: 소프트 키보드 팝업으로 화면 축소 → Canvas 높이를 `window.visualViewport` 기준으로 재계산해야 함. 모바일에서는 영어 단어 전용 모드 자동 전환 권장.

---

### 7. 2048 변형 — 육각형 (`2048-hex`)

**목표**: 육각형 그리드에서 같은 숫자 타일을 합쳐 2048 달성

- 입력: 스와이프 6방향 / 키보드 6방향 (q/w/e/a/s/d)
- 그리드: 반지름 2짜리 육각형 격자 (총 19칸)
- 합치기 규칙: 이동 방향으로 같은 숫자 타일이 만나면 합산
- 점수: 합산된 타일 값의 합
- Canvas 사용: 예 (육각형 렌더링)
- 모바일 주의사항: 스와이프 6방향 감지, 각도 기반 판별

---

### 8. 무한 러너 (`endless-runner`)

**목표**: 자동으로 달리는 캐릭터가 장애물을 피하며 최대한 오래 달리기

- 입력: 탭/클릭 = 점프, 스와이프 다운 / 빠른 탭2 = 슬라이드
- 규칙: 속도 지속 상승, 코인 수집 시 +10점
- 장애물: 낮은 장애물(점프), 높은 장애물(슬라이드), 구덩이(타이밍 점프)
- 점수: 달린 거리 (1m = 1점) + 코인
- Canvas 사용: 예
- 모바일 주의사항: 없음

---

### 9. 방치형 농장 (`idle-farm`)

**목표**: 씨앗 심기 → 타이머 → 수확 → 업그레이드 반복

- 입력: 탭 (심기 / 수확), 버튼 (업그레이드 구매)
- 작물 종류: 3가지 (성장 시간 / 수익 다름)
- 업그레이드: 수확량 증가, 성장 속도 증가, 자동 수확기
- 저장: `localStorage`에 농장 상태 저장 (앱 종료 후 재진입 시 복구)
- 오프라인 수익: 마지막 접속 시간 기준으로 경과 시간만큼 수익 계산
- Canvas 사용: 아니오 (DOM + CSS 애니메이션)
- 모바일 주의사항: 없음

---

### 10. 핀볼 로그라이크 (`pinball-rogue`)

**목표**: 핀볼 + 런마다 업그레이드 선택. Peglin 스타일.

- 입력: 탭/클릭으로 플리퍼 조작 (왼쪽 절반 = 왼쪽 플리퍼, 오른쪽 = 오른쪽)
- 물리 구현: 자체 원형 충돌 물리 (Matter.js 없이 벡터 계산)
- 구성요소: 공, 플리퍼 2개, 원형 범퍼, 삼각 범퍼, 드레인(아래)
- 로그라이크: 라운드 클리어마다 업그레이드 3개 중 1개 선택
  - 멀티볼 (공 +1)
  - 범퍼 강화 (점수 ×2)
  - 플리퍼 연장
  - 자석 효과 (공이 범퍼에 끌림)
  - 관통 볼 (범퍼 통과)
- 라운드 목표: 목표 점수 달성 시 다음 라운드
- 목숨: 볼 3개, 드레인 시 -1
- Canvas 사용: 예
- 모바일 주의사항: 플리퍼 좌우 분할 탭 처리

---

## 개발 단계

### Phase 0 — 리팩터링 + 허브 구축

**브랜치**: `feature/hub-home`

작업:
1. `index.html` → 허브 홈으로 교체
2. 기존 경마 게임 → `games/race/` 로 이동
3. `shared/` 디렉터리 생성 및 공통 CSS/JS 작성
4. 각 게임 슬롯 카드 표시 (미개발 = 회색 잠금)

---

### Phase 1 — 쉬운 게임 (5개)

추천 개발 순서 (독립적이므로 브랜치 별도 분리 가능):

| 브랜치 | 게임 |
|--------|------|
| `feature/aim-trainer` | 에임 트레이너 |
| `feature/color-slider` | 색 맞추기 슬라이더 |
| `feature/ball-dodge` | 볼 피하기 + 수집 |
| `feature/tower-stack` | 타워 쌓기 |
| `feature/snake` | 스네이크 비틀기 |

각 게임 완료 기준:
- [ ] 게임 루프 동작 (시작 → 플레이 → 게임오버 → 재시작)
- [ ] 점수 `localStorage` 저장
- [ ] 모바일 터치 동작 확인
- [ ] 허브에서 진입/복귀 동작

---

### Phase 2 — 중간 게임 (3개)

| 브랜치 | 게임 |
|--------|------|
| `feature/typing-survival` | 타이핑 생존 |
| `feature/2048-hex` | 2048 변형 |
| `feature/endless-runner` | 무한 러너 |
| `feature/idle-farm` | 방치형 농장 |

---

### Phase 3 — 핀볼 로그라이크

**브랜치**: `feature/pinball-rogue`

- 물리 엔진 자체 구현이 핵심 난관
- 플리퍼 회전 충돌, 원형 범퍼 반사 벡터 계산 필요
- 로그라이크 업그레이드 시스템은 물리 검증 후 추가

---

### Phase 4 — 마무리 + 배포 준비

**브랜치**: `feature/release-prep`

- 전체 게임 최고 점수 리더보드 (로컬)
- 앱 아이콘 / 스플래시 화면 제작
- Capacitor 프로젝트 초기화 및 APK 빌드
- Google Play 콘솔 등록

---

## 모바일 대응

### viewport 설정 (모든 게임 페이지 공통)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

### Canvas 반응형 크기

```js
function resizeCanvas(canvas) {
  const size = Math.min(window.innerWidth, window.innerHeight - 56); // 56 = 헤더
  canvas.width = size;
  canvas.height = size;
}
window.addEventListener('resize', () => resizeCanvas(canvas));
```

### 터치 이벤트 처리 원칙

- `touchstart` + `touchmove` + `touchend` 모두 `preventDefault()` 호출 (스크롤 방지)
- `shared/utils.js`의 `getPointerPos()` 로 좌표 통일
- 탭 영역 최소 44×44px 확보

---

## Google Play 출품

### Capacitor 세팅

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "게임 모음집" "com.runhobanrun.games"
npx cap add android
npx cap sync
npx cap open android    # Android Studio 열기
```

### 빌드 흐름

```
웹 파일 (HTML/JS/CSS)
  → npx cap sync
  → Android Studio에서 서명된 APK/AAB 생성
  → Google Play Console 업로드
```

### 출품 전 체크리스트

- [ ] 앱 아이콘 512×512 PNG
- [ ] 피처드 이미지 1024×500 PNG
- [ ] 스크린샷 최소 2장 (전화 / 태블릿)
- [ ] 개인정보처리방침 URL (필수)
- [ ] 콘텐츠 등급 설문 완료
- [ ] 앱 서명 키스토어 생성 및 안전한 곳에 백업

---

## 세션 간 협업 규칙

다른 Claude 세션에서 이 계획서를 참조해 개발할 때 지켜야 할 규칙입니다.

### 브랜치 전략

- `master`: 완성된 기능만 PR 병합
- `feature/{game-name}`: 게임별 독립 브랜치
- PR 머지 전 기준:
  - 게임 루프 완전 동작
  - 모바일 터치 동작 확인
  - `shared/utils.js` 의존성 외 외부 라이브러리 금지

### 코딩 규칙

- 외부 라이브러리 사용 금지 (Vanilla JS + Canvas API만)
- 각 게임은 `games/{name}/game.js` 한 파일에 자기완결적으로 작성
- `shared/utils.js` 함수를 적극 활용해 중복 코드 방지
- 주석 금지 (코드로 의도가 명확히 드러나야 함)

### 게임 상태 업데이트

게임 하나 완료할 때마다 이 파일의 포함 게임 표에서 상태를 업데이트하세요:

```
⬜ 미개발 → 🚧 개발 중 → ✅ 완료
```

### 참조 문서

- `.ai-work/HANDOFF.md` — 기존 경마 게임 핸드오프
- `.ai-work/03-architecture.md` — 기존 경마 게임 아키텍처
- `.ai-work/01-game-rules.md` — 경마 게임 룰
