# Codex Discussion MCP

Claude Code, Antigravity CLI, Kiro CLI 등에서 **Codex를 독립적인 토론 상대**로
호출하는 로컬 MCP 서버입니다. 호출 에이전트가 토론을 진행하며, 질문마다
모델과 reasoning effort를 선택할 수 있습니다.

- 모델 목록·설명·지원 effort를 Codex에서 조회
- 대화 맥락을 유지하며 질문, 반론, 추가 근거 전달
- 오래 걸리는 응답의 비동기 조회와 정확한 발언 중단
- Codex가 저장한 대화 ID로 후속 세션에서 재개
- 읽기 전용 프로젝트 탐색과 공개 발언 전달

패키지 이름은 `@mirolab/codex-discussion-mcp`입니다. npm에 게시된 버전은 아래
설치 명령으로 사용합니다. 게시 전 버전은 GitHub Actions의 `npm-package`
artifact에 포함된 `.tgz`를 설치하거나 로컬에서 빌드해 사용할 수 있습니다.
[게시 절차](docs/publishing.md)

## 실행 환경

- Node.js **22.14 이상**과 npm
- 설치되고 로그인된 [Codex CLI](https://developers.openai.com/codex/cli/)
- Codex CLI **0.164.0**의 app-server 프로토콜을 기준으로 검증

기존 Codex CLI의 로그인과 모델 provider 설정을 사용합니다. MCP 서버용으로
별도의 OpenAI API 키를 입력할 필요가 없습니다. 사용 중인 provider가 요구하는
계정 권한과 사용량 제한은 그대로 적용됩니다.

Codex 프로젝트 탐색은 읽기 전용이며, 상속된 MCP 연결과 플러그인은 토론용
자식 프로세스에서 비활성화합니다. 외부 에이전트의 대화 내용은 자동 공유되지
않으므로 질문에 필요한 코드, 설명, 가정을 직접 포함하세요.

## 설치

게시 후 전역 설치:

```bash
npm install -g @mirolab/codex-discussion-mcp
codex-discussion-mcp --help
```

전역 설치 없이 실행할 수도 있습니다. MCP 설정에서 다음 명령을 등록하세요.

```bash
npx -y @mirolab/codex-discussion-mcp@0.1.0
```

이 명령은 stdio MCP 서버로 대기합니다. 일반 채팅용 터미널 명령처럼 질문을
입력하는 방식은 아니며, MCP 호스트가 서버에 연결해 도구를 호출합니다.

## Claude Code 등록

전역 설치 후 모든 프로젝트에서 사용:

```bash
claude mcp add --transport stdio --scope user codex-discussion -- codex-discussion-mcp
claude mcp get codex-discussion
```

전역 설치 없이 등록:

```bash
claude mcp add --transport stdio --scope user codex-discussion -- \
  npx -y @mirolab/codex-discussion-mcp@0.1.0
```

프로젝트 범위로 공유하려면 `--scope user`를 `--scope project`로 바꿉니다.
Claude Code의 `/mcp`에서도 연결 상태를 확인할 수 있습니다.

## Kiro CLI · Antigravity CLI 등록

해당 설정 파일의 기존 `mcpServers`에 아래 서버 항목을 병합하세요.

| 호스트 | 사용자 전체 설정 | 프로젝트별 설정 |
|---|---|---|
| Kiro CLI | `~/.kiro/settings/mcp.json` | `.kiro/settings/mcp.json` |
| Antigravity CLI | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |

```json
{
  "mcpServers": {
    "codex-discussion": {
      "command": "npx",
      "args": ["-y", "@mirolab/codex-discussion-mcp@0.1.0"]
    }
  }
}
```

전역 설치했다면 서버 항목을 다음처럼 바꿀 수 있습니다.

```json
{ "command": "codex-discussion-mcp", "args": [] }
```

호스트 설정 형식은 설치 버전에 따라 다를 수 있습니다.
[Claude Code 공식 문서](https://code.claude.com/docs/en/mcp),
[Kiro 공식 문서](https://kiro.dev/docs/mcp/configuration/),
[Antigravity 공식 문서](https://www.antigravity.google/docs/mcp)를 참고하세요.

## 프로젝트 경로와 Codex 실행 파일

`discussion_start.cwd`에 프로젝트의 **절대 경로**를 전달하는 것을 권장합니다.
생략하면 `--cwd` 값, 그마저 없으면 MCP 프로세스의 작업 디렉터리를 사용합니다.
호스트가 MCP 프로세스를 프로젝트 밖에서 시작할 수도 있습니다.

```json
{
  "command": "codex-discussion-mcp",
  "args": ["--cwd", "/absolute/path/to/project", "--codex-command", "/absolute/path/to/codex"]
}
```

`--codex-command`는 기본적으로 환경 변수 `CODEX_DISCUSSION_CODEX_PATH`, 그다음
PATH의 `codex`를 사용합니다. 고급 실행 환경에서는 `--codex-arg`를 반복해 기본
app-server 실행 인수를 대체할 수 있습니다. `-`로 시작하는 값은
`--codex-arg=--some-option`처럼 `=`로 연결하세요.

## 에이전트에게 요청하기

> codex-discussion에서 모델 목록과 지원 effort를 먼저 조회해줘.
> 질문의 복잡도에 맞는 모델과 effort를 고르고, 현재 설계의 장단점에 대해
> Codex와 토론해줘. 반론을 주고받은 뒤 합의점과 남은 이견을 정리해줘.

항상 특정 상황에서 토론하게 하려면 각 에이전트의 프로젝트 지침에 다음과 같은
조건을 추가할 수 있습니다.

> 주요 아키텍처 결정 전에 codex-discussion으로 독립 검토를 받는다.
> 먼저 models_list를 조회하고, 해당 질문에 맞는 model과 지원 effort를 선택한다.
> 내 의견과 근거를 전달하고 반론을 검토한 뒤 최종 결정의 이유를 설명한다.

## MCP 도구

| 도구 | 입력 | 결과 |
|---|---|---|
| `models_list` | `includeHidden?` | 모델·effort 카탈로그, 조회 시각 |
| `discussion_start` | `message`, `cwd?`, `model?`, `effort?` | 새 `discussionId`, `turnId`, 선택 설정, 현재 상태 |
| `discussion_reply` | `discussionId`, `message`, `model?`, `effort?` | 같은 대화의 새 발언 |
| `discussion_read` | `discussionId`, `turnId?`, `cursor?`, `limit?`, `waitMs?` | 상태, 공개 메시지, `nextCursor`, 오류 |
| `discussion_cancel` | `discussionId`, `turnId` | 특정 발언의 중단 요청 상태 |

모델 ID와 effort는 하드코딩하지 않습니다. `models_list`의 각 항목에는
`model`, `displayName`, `description`, `isDefault`, `defaultReasoningEffort`,
`supportedReasoningEfforts`가 포함됩니다. 선택에는 picker ID인 `id`가 아닌
**`model` 값**을 사용하세요. 카탈로그 조회는 추론 접근 권한을 검증하지 않으며
`accessVerified: false`로 표시합니다.

선택 규칙:

1. 첫 질문에서 생략하면 카탈로그의 기본 모델과 그 모델의 기본 effort를 사용합니다.
2. 후속 질문에서 생략하면 직전 선택을 유지합니다.
3. 모델을 변경하고 effort를 생략하면 새 모델의 기본 effort를 사용합니다.
4. 지원하지 않는 조합은 허용값을 포함한 오류로 반환합니다.

`discussion_start`와 `discussion_reply`는 생성 완료를 기다리지 않습니다.
다음 순서로 호출합니다.

```text
models_list({})
discussion_start({message: "설계를 검토해줘", cwd: "/absolute/project", model: 조회한_모델, effort: 지원_effort})
discussion_read({discussionId: 반환된_ID, waitMs: 20000})
… 상태가 inProgress이면 다시 조회 …
discussion_reply({discussionId: 같은_ID, message: "이 반례는 어떻게 생각해?"})
```

`waitMs`는 0~20000, `limit`는 1~100입니다. 새 출력이 생기면 완료 전에도
조회가 반환될 수 있습니다. 상태는 `inProgress`, `completed`, `failed`,
`interrupted`, `connectionLost`입니다. **`completed`만 정상 완료**입니다.

`nextCursor`로 메시지를 페이지 조회할 수 있습니다. 메시지가 길면 동일 ID의
여러 조각으로 나뉘며 `textOffset`을 포함합니다. 조각당 최대 8000자, 응답당
최대 64000자를 반환합니다. 생성 중의 수정된 텍스트를 받으려면 커서 없이
다시 조회하세요. 커서는 특정 프로세스·대화·발언에 연결되며, MCP 재시작 뒤에는
커서를 생략해 다시 조회해야 합니다.

대화 ID는 Codex thread ID입니다. 같은 Codex 저장소를 사용하는 후속 프로세스에서
재개할 수 있습니다. 저장 이력의 발언별 모델·effort를 확인할 수 없으면 `null`로
반환하고, 현재 저장된 대화 기본값은 `threadDefaults`에 별도로 표시합니다.
저장된 effort가 없으면 후속 질문에 명시적인 effort를 요청합니다.

같은 대화는 한 번에 하나의 발언을 처리합니다. 실행 중 추가 질문은
`DISCUSSION_BUSY` 오류를 반환합니다. 다른 대화는 독립 실행할 수 있으며,
같은 대화를 여러 MCP 프로세스에서 동시에 수정하는 사용은 지원하지 않습니다.
연결 종료나 요청 타임아웃 시 추론을 자동 재실행하지 않습니다.

## 개발과 검증

```bash
npm ci
npm run check
npm run verify:package
npm run smoke -- --models-only
```

`verify:package`는 tarball을 별도 임시 폴더에 프로덕션 의존성만 설치한 뒤,
설치된 실행 명령으로 MCP 탐색과 두 번의 토론을 시뮬레이션합니다.
자동 테스트는 실제 모델 사용량을 발생시키지 않습니다.

로그인된 실제 Codex로 짧은 2회 발언을 검증하려면:

```bash
npm run smoke -- --inference
```

이 명령은 실제 추론을 실행하며 계정 사용량을 사용합니다. CI는 실제 추론 없이
Node.js 22와 24에서 타입 검사, 테스트, 빌드, 설치 검증을 실행합니다.
현재 기본 검증 대상 플랫폼은 macOS와 GitHub-hosted Ubuntu입니다.

## 배포 및 설계

[GitHub 빌드와 npm 게시](docs/publishing.md) ·
[설계](docs/superpowers/specs/2026-10-25-codex-discussion-mcp-design.md) ·
[개발 계획](docs/superpowers/plans/2026-10-25-codex-discussion-mcp.md)

## 라이선스

[MIT](LICENSE)
