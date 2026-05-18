# 리얼 3D 경마게임 전환 제안서

## 결론

현재 구현은 React Three Fiber 기반 3D 씬이며, 말은 리깅 GLB 모델을 쓰고 기수는 말 그룹 하위 procedural mesh로 붙어 움직인다. 더 리얼해지려면 `리깅된 말 GLB 모델 + 골격 애니메이션 + 전용 기수 애셋 + 물리 기반 소품/이벤트` 파이프라인으로 고도화해야 한다.

추천 방향은 `Vite + React + TypeScript + three/@react-three/fiber`를 유지하되, 렌더링 계층을 전면 재작성하는 것이다. 현재 UI, 추첨 규칙, 시드 기반 결과, 조별 레이스 구조는 유지하고, 3D 레이스 씬만 새 아키텍처로 교체한다.

## 현재 구현 상태

- `src/game/horseModelManifest.ts`에서 Quaternius/Poly Pizza CC0 리깅 말 GLB 출처, 라이선스, 런타임 URL, 애니메이션 클립 매핑을 관리한다.
- `RaceScene`은 `useGLTF`, `useAnimations`, `Clone`으로 20마리 조별 리깅 말을 렌더링한다.
- 말 상태는 `idle`, `walk`, `gallop`, `jump`, `brake` 클립으로 전환된다.
- 기존 코드 도형 말은 삭제하지 않고 Suspense 로딩 fallback으로만 남겨 두었다.
- 장애물은 현재 비활성화했고, Rapier는 바닥/소품/추후 센서 레이어에만 남긴다.
- 순위, 속도, 헬기 탈락, 통과자 선정은 여전히 `src/game/raceEngine.ts`의 deterministic TypeScript 엔진이 결정한다.

## 남은 품질 한계

- 말은 GLB 골격 애니메이션으로 교체됐고, 기수는 말 transform 하위에 붙어 이동한다. 다음 품질 단계에서는 전용 rider GLB가 필요하다.
- 주행은 의도대로 엔진 프레임 위치 보간을 쓰며, 말 동작만 골격 애니메이션으로 재생한다.
- 헬기 사격 컷신은 들어갔지만, 전용 전투헬기/저격수 애니메이션과 카메라 셰이크는 더 보강할 수 있다.
- 카메라와 트랙은 정리됐지만, 기수/헬기 이펙트 일부가 코드 메쉬 중심이라 “게임 엔진으로 만든 3D” 느낌이 부족하다.
- 트랙/환경은 아직 절차적 메쉬 중심이라 전용 stadium/forest/cliff GLB 세트까지 가면 더 좋아진다.

## 엔진 선택

### 권장: 현재 웹 스택 유지 + 3D 씬 재작성

사용:

- `Vite`
- `React`
- `TypeScript`
- `three`
- `@react-three/fiber`
- `@react-three/drei`
- `@react-three/rapier`
- `zustand`

이 선택이 맞는 이유:

- 현재 프로젝트의 UI/상태/테스트 구조를 보존할 수 있다.
- React Three Fiber는 React용 three.js 렌더러라, three.js 기능을 그대로 쓸 수 있다.
- three.js는 glTF 로더와 애니메이션 시스템을 지원한다.
- Rapier는 3D rigid body, collision, sensor, joint 등을 제공하므로 장애물/소품 물리에 적합하다.

### 대안: Babylon.js로 3D 계층 교체

장점:

- 자체 게임 엔진 성격이 강하고, Havok 기반 물리/캐릭터 컨트롤러/인스펙터/툴링이 잘 묶여 있다.
- glTF import/export, animation, particle, material tooling이 통합적이다.

단점:

- React Three Fiber로 만든 현재 씬은 거의 버리고 Babylon 렌더러를 새로 붙여야 한다.
- 현재 테스트/컴포넌트 구조와 맞추는 비용이 있다.

판단:

- “완전히 새 3D 엔진 중심으로 다시 만든다”면 Babylon도 가능하다.
- 단, 이 프로젝트는 운영 UI와 추첨/레이스 로직이 React에 이미 붙어 있으므로, 우선은 R3F 재작성 쪽이 비용 대비 효과가 더 크다.

### 대안: PlayCanvas

장점:

- 웹 게임 엔진으로 더 완성된 툴/에디터/엔티티 컴포넌트 구조를 제공한다.
- WebGPU/WebGL2, 에디터, 물리, 애니메이션, 오디오, 입력 등을 게임 엔진 방식으로 다룰 수 있다.

단점:

- React 앱 안에 통합하기보다 PlayCanvas 프로젝트를 별도로 운영하는 성격이 강해질 수 있다.
- 현재 추첨 UI와 결과 패널을 PlayCanvas UI로 옮길지, React와 iframe/canvas로 연동할지 설계가 필요하다.

판단:

- 3D 툴 기반으로 거의 새 게임을 만들겠다면 후보.
- 현재 앱을 점진 개선하려면 과하다.

### 비권장: Unity/Godot Web Export로 전면 이전

Unity/Godot은 리얼한 3D 제작에는 강하지만, 이 프로젝트가 “웹 운영 화면 + 많은 참가자 + 빠른 로딩 + React UI”라는 점을 고려하면 첫 선택으로는 무겁다. Web export는 빌드 크기, 브라우저 호환성, UI 연동, 배포 파이프라인 부담이 커진다.

## 새 3D 아키텍처

### 1. 게임 규칙 엔진은 유지

`src/game/raceEngine.ts`는 계속 결과와 프레임을 계산한다.

- 최종 순위
- 속도
- 헬기 탈락 판정
- 스킬 발동
- 조별 표시

물리엔진이 최종 순위를 결정하면 추첨 결과 재현성과 운영 신뢰성이 흔들릴 수 있으므로, 순위 계산은 지금처럼 deterministic TypeScript 엔진에 둔다.

### 2. 3D 레이스 씬만 교체

새 구조:

- `RaceScene`: 캔버스/카메라/조명/후처리 루트
- `RaceTrack`: 트랙 메시, 레일, 게이트, 바닥, 관중석
- `HorseActor`: GLB 말 모델, AnimationMixer, 상태별 애니메이션
- `RiderActor`: 기수 모델 또는 말 GLB에 포함된 rider submesh
- `HelicopterEventActor`: 헬기 등장/조준/사격 컷신
- `PropActor`: 물리 소품/센서/폭발성 이벤트 소품
- `RaceCameraDirector`: 줌인/추적/리플레이 카메라
- `EffectsLayer`: 먼지, 땀, 콧김, 충돌 파편, 별/느낌표 UI

### 3. 말은 GLB 스키닝 모델로 교체

필수 애셋:

- rigged horse model `.glb`
- horse animation clips:
  - idle
  - walk
  - canter
  - gallop
  - jump
  - stumble
  - brake
  - victory
- rider model 또는 saddle/rider 포함 horse variant
- horse material variants:
  - 털색
  - 갈기색
  - 안장
  - 번호판
  - 기수 유니폼

구현 방식:

- 말 위치는 엔진 프레임의 `progress`를 따른다.
- 실제 말 움직임은 GLB 애니메이션 클립을 `AnimationMixer`로 재생한다.
- 속도에 따라 `walk/canter/gallop` 재생 속도를 조정한다.
- 점프/탈락/충돌은 cross-fade 애니메이션으로 전환한다.

### 4. 물리엔진은 소품과 센서에 집중

Rapier 적용 대상:

- 이벤트 센서
- 교통사고 소품 충돌
- 바퀴/표지판/박스/콘이 튀는 연출
- 충돌 이벤트 트리거
- 카메라 흔들림 트리거

Rapier를 쓰지 말아야 할 대상:

- 최종 순위 계산
- 말의 기본 주행 거리
- 통과자 선정

즉, 주행 결과는 기존 엔진이 결정하고, 물리는 “보이는 사건”을 더 리얼하게 만든다.

## 이벤트 소품 재설계

현재 주행 방해 장애물은 비활성화되어 있으며, 이후에는 결과를 바꾸지 않는 이벤트 소품으로만 확장한다.

### 기본 소품

- 넘어진 안전콘
- 낮은 허들
- 물웅덩이
- 진흙 구간
- 굴러오는 타이어

### 코미디 소품

- 교통사고 차량
- 갑자기 열리는 공사장 바리케이드
- 풍선 인형
- 튀어나오는 표지판

### 연출 규칙

- 소품은 미리 고정 배치한다.
- 색으로 상태를 바꾸지 않는다.
- 가까워지면 카메라/음향/파티클로 알려준다.
- 통과 성공: 점프, 먼지, “휘익”
- 실패: 급정지, 소품 튐, 기수 흔들림, 말 표정/이모트

## 마이그레이션 단계

### 1단계: GLB 말 모델 로더 도입

목표:

- 코드 도형 말 제거
- GLB 말 1종 로드
- idle/gallop/jump 애니메이션 재생

완료 기준:

- 같은 프레임 데이터로 말이 트랙을 달린다.
- 말이 실제 골격 애니메이션으로 움직인다.
- 기존 테스트와 빌드가 통과한다.

### 2단계: 20마리 조 렌더링 최적화

목표:

- 20마리 GLB를 동시에 렌더링한다.
- material variant와 LOD를 적용한다.
- 화면 밖 말/먼 말은 저품질 모델로 전환한다.

완료 기준:

- 데스크톱에서 20마리 조가 안정적으로 돌아간다.
- 모바일에서는 품질 옵션 또는 낮은 LOD로 유지된다.

### 3단계: 물리 소품 시스템

목표:

- Rapier world 추가
- event sensor 추가
- 충돌 소품 rigid body 추가
- 실패/성공 이벤트와 엔진 프레임을 연결

완료 기준:

- 이벤트 발생 시 물리 소품이 튄다.
- 성공 시 말이 애니메이션으로 점프한다.
- 순위 결과는 변하지 않는다.

### 4단계: 카메라와 연출 고도화

목표:

- 스킬/헬기/소품 이벤트별 카메라 컷
- 줌인 시간은 배속과 무관하게 유지
- 모션 블러 느낌, dust trail, nose steam, sweat particles 추가

완료 기준:

- 이벤트 발생 시 “왜 줌인됐는지” 화면만 봐도 이해된다.
- 기존 운영 UI를 가리지 않는다.

### 5단계: 트랙/환경 리빌드

목표:

- 현재 단순 트랙을 stadium/forest/cliff/lake 테마 GLB 또는 procedural mesh로 교체
- 트랙 폭은 현재 조 말 수에 맞춰 유지
- 레일, 관중석, 표지판, 조명, 배경 레이어 추가

완료 기준:

- 맵 깨짐 없이 각 테마가 명확히 다르다.
- 말보다 트랙이 과하게 넓거나 비어 보이지 않는다.

## 개발 환경 변경 여부

현재로서는 전체 프레임워크 전환보다 `3D asset pipeline` 도입이 우선이다.

바꿀 것:

- `RaceScene` 내부 구조
- 말/이벤트 소품 구현 방식
- GLB 애셋 관리
- 물리 소품 시스템
- 렌더링 성능 최적화

유지할 것:

- Vite
- React
- TypeScript
- Zustand
- Vitest
- Playwright
- 기존 race engine
- 기존 운영 UI

추가 후보:

- `gltfjsx`: GLB를 React 컴포넌트로 변환
- `meshopt`/`draco`: GLB 압축
- `@react-three/postprocessing`: bloom, depth of field, vignette
- `leva` 또는 debug UI: 카메라/조명/트랙 튜닝

## 현실적인 품질 기준

리얼한 말은 코드 몇 줄로 해결되지 않는다. 최소 기준은 다음이다.

- 말은 primitive mesh가 아니라 리깅된 GLB여야 한다.
- 최소 5개 이상 애니메이션 클립이 있어야 한다.
- 기수는 말 위에 붙어 있거나 같은 skeleton/attachment 기준으로 움직여야 한다.
- 이벤트 소품은 위치만 있는 점이 아니라 물리 반응 소품이어야 한다.
- 카메라는 이벤트를 설명해야 하고, 단순 확대가 아니라 컷신처럼 보여야 한다.
- 20마리 조에서도 프레임이 버텨야 하므로 LOD와 material 최적화가 필요하다.

## 참고한 공식 자료

- React Three Fiber docs: https://r3f.docs.pmnd.rs/getting-started/introduction
- three.js model loading docs: https://threejs.org/manual/en/loading-3d-models.html
- three.js animation docs: https://threejs.org/manual/en/animation-system.html
- Rapier docs: https://rapier.rs/docs/
- Babylon.js specifications: https://www.babylonjs.com/specifications/
- PlayCanvas official site: https://playcanvas.com/
- MDN PlayCanvas overview: https://developer.mozilla.org/en-US/docs/Games/Techniques/3D_on_the_web/Building_up_a_basic_demo_with_PlayCanvas
- Godot web export docs: https://docs.godotengine.org/en/3.3/getting_started/workflow/export/exporting_for_web.html
