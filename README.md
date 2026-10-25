# Codex Discussion MCP

Claude Code, Antigravity CLI, Kiro CLI 등 MCP 클라이언트가 Codex app-server에
연결해 Codex와 질문과 반론을 주고받는 로컬 MCP 서버입니다.

현재는 설계 단계입니다. 실행 가능한 서버와 npm 패키지는 아직 제공하지 않습니다.

## 예정 기능

- 연결된 Codex의 모델 목록, 모델 설명, 지원 reasoning effort 조회
- 호출 에이전트가 질문별로 모델과 effort 선택
- 대화 맥락을 유지하는 후속 질문과 반론
- 긴 응답의 진행 상태 조회와 중단
- 프로젝트 읽기 전용 토론

## 배포 계획

- GitHub: <https://github.com/smallmiro/codex-discussion-mcp>
- npm 조직: `@mirolab`
- 제안 패키지명: `@mirolab/codex-discussion-mcp`
- 공개 npm 패키지로 배포하고 전역 설치와 `npx` 실행 지원
- GitHub Actions에서 빌드, 검증, npm 게시

사용 환경에는 Node.js와 로그인된 Codex CLI가 필요합니다.
각 MCP 호스트의 등록 방법은 구현 시 실제 실행 명령과 함께 안내할 예정입니다.

## 설계

[Codex 토론 MCP 설계](docs/superpowers/specs/2026-10-25-codex-discussion-mcp-design.md)

## 라이선스

[MIT](LICENSE)
