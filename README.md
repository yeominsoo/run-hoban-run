# run-hoban-run

3D 웹 레이싱 게임으로 새로 시작합니다.

Vite, TypeScript, Three.js 기반의 프론트엔드 전용 3D 경주 게임입니다.

## 프로젝트 구조

- `src/main.ts`: 경기 상태, 카메라, 말 애니메이션, 렌더 루프 조립
- `src/game/`: 토너먼트/경주 룰과 확률 계산
- `src/render/`: Three.js 렌더 보조 모듈과 헬기 모델/이펙트
- `src/ui/`: 화면 골격과 DOM query 헬퍼
- `src/assets/`: 코드에서 참조하는 정적 에셋 메타데이터
- `public/assets/`: 브라우저에 그대로 제공되는 GLB 등 정적 파일
- `tests/`: Playwright 룰/렌더 검증
- `docs/`: 기획 및 설계 문서

## 실행

- `npm run build`
- `npm run test:render`

## MCP imagegen

이 저장소는 `runHobanImageGen` MCP 서버를 `.mcp.json`에 연결해 둡니다.
참조 프로젝트와 동일하게 `.env`의 `OPENAI_API_KEY`, `OPENAI_API`, `OPENAPI`,
`APIKEY` 중 하나를 읽어 Codex imagegen CLI에 전달합니다.

```bash
cp .env.example .env
# .env에 실제 키 입력
node tools/image_gen_mcp_server.mjs
```

## 문서

- [3D 웹게임 기획서](./docs/3d-webgame-plan.md)
