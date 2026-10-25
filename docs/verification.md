# 구현 검증 기록

검증일: 2026-10-25. 버전: `@mirolab/codex-discussion-mcp@0.1.0`.

## 자동 검증

- `npm run check`: 타입 검사, **48개 테스트**, TypeScript 빌드 통과.
- `npm run verify:package`: 소스 checkout 밖 임시 prefix에 production dependency만
  설치하고 설치된 binary의 help/version, MCP discovery, 모델 목록, 모델/effort를
  선택하는 2회 발언을 검증.
- `npm pack --dry-run`: `dist`, README, MIT LICENSE, 게시 가이드, package metadata만
  포함. 소스/테스트/개발 환경/인증 설정은 배포 tarball에서 제외.
- `actionlint 1.7.12`: CI와 npm 게시 workflow 검사 통과.
- [GitHub CI 실행 40177781421](https://github.com/smallmiro/codex-discussion-mcp/actions/runs/40177781421):
  구현 커밋 `e875ef2`를 Node.js 22와 24에서 check와 tarball 설치 검증, 모두 통과.
- 해당 GitHub 실행의 `npm-package` artifact를 다운로드해 macOS에서 별도 설치 후
  같은 binary/MCP 검증을 다시 통과했다. 로컬 경로:
  `artifacts/mirolab-codex-discussion-mcp-0.1.0.tgz`.

## 실제 Codex 검증

macOS, Node.js 26.0.0, Codex CLI 0.164.0에서
`npm run smoke -- --inference` 전체 시나리오 통과:

1. 실제 app-server 모델 카탈로그 7개와 모델별 effort 조회.
2. `gpt-6.1-sol` / `low`로 첫 발언 수행, `completed` 및 공개 응답 확인.
3. 같은 대화에서 `gpt-6-luna` / `medium`으로 변경해 후속 발언 수행.
4. MCP와 app-server 종료 후 새 프로세스로 대화 재개, 저장된 공개 이력과
   모델/effort 기본값 복원 확인.

이 기록은 실행한 모델/effort 조합의 접근 성공을 나타냅니다. 카탈로그의 모든 모델이나
다른 계정/provider의 추론 권한을 보장하지 않습니다.

## 독립 리뷰와 회귀 수정

별도 리뷰 에이전트가 전체 변경 사항을 검토하고 당시 45개 테스트를 재실행했다.
캐시된 완료 대화를 읽을 때 다른 연결의 새 작업을 감지하지 못한다는 Important
지적 1건을 받았다. 실패 테스트로 재현한 뒤 연결 중 최신 상태를 조회하도록 수정했다.
외부 작업 완료 후 최신 이력을 읽는 경우와 연결 종료 후 기존 출력을 읽는 경우도 검증했다.

최신 상태 조회 중 도착한 출력의 long-poll 깨우기를 놓치는 경우와, 새 live thread의
history API가 아직 준비되지 않은 경우도 각각 실패 테스트 후 수정했다.
수정 후 전체 48개 테스트와 설치 검증, 실제 Codex smoke를 다시 통과했다.
리뷰의 Critical/Minor 지적은 없었다.

## 구현 판단과 검증 범위

- 현행 stable MCP SDK v2를 사용하고 legacy `2025-03-26` 연결을 통합 테스트했다.
  호스트별 도구 UI까지 실제 Claude/Antigravity/Kiro 계정에서 실행한 검증은 아니다.
- 한 세션에서 구현하고 마지막에 독립 리뷰를 받는 방식으로 진행했다.
- 읽기 전용 로컬 stdio 서비스가 범위다. 같은 대화에 대한 동시 다중 프로세스
  작성과 서비스 규모의 메모리 수명 관리는 제공하지 않는다. 완료 출력 캐시는
  해당 MCP 프로세스 수명 동안 유지한다.
- 생성 중 업데이트된 메시지는 커서 없이 재조회하는 계약이다. 메시지 페이지
  커서는 프로세스·대화·발언에 연결되며 재시작 후에는 재사용하지 않는다.
- npm OIDC 게시 workflow와 설정 가이드를 제공했다. npm 조직의 첫 게시와
  Trusted Publisher 연결은 계정 관리자가 수행해야 하며 실제 npm 게시는 실행하지 않았다.

향후 검증 실행과 artifact는 [GitHub Actions](https://github.com/smallmiro/codex-discussion-mcp/actions)에서 확인할 수 있다.
