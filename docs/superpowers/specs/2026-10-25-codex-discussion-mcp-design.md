# Codex 토론 MCP 설계

상태: 2026-10-25 구현 및 로컬 검증 완료. npm 첫 게시 전.
별도 검토 에이전트는 구현 계획을 막는 미확정 사항이 없음을 확인했다.

## 목적과 확인된 요구사항

Claude Code, 안티그래비티 CLI 등 MCP를 지원하는 코딩 에이전트가 Codex와
질문, 반론, 재검토를 주고받는다. 호출 에이전트가 질문의 복잡도에 따라
모델과 reasoning effort를 선택한다. 처음 사용하는 에이전트도 모델 목록과
각 모델의 지원 effort를 도구로 조회할 수 있어야 한다.

토론 순서, 추가 질문, 종료 판단은 호출 에이전트가 담당한다.
호출 에이전트의 대화 이력이 Codex에 자동 전달되지는 않으므로 필요한 맥락을
메시지에 명시적으로 제공한다. 프로젝트 경로도 지정할 수 있다.

설치와 배포는 사용자의 추가 요구에 따라 npm 패키지로 제공한다.
배포 namespace는 사용자 소유 조직인 `@mirolab`이며 공개 패키지로 배포한다.
GitHub 저장소는 `https://github.com/smallmiro/codex-discussion-mcp`다.
기존 원격 저장소의 MIT LICENSE를 따른다.
사용자는 GitHub에서 빌드해 npm에 게시하는 배포 흐름을 요청했다.

## 검토한 접근

1. 호출 에이전트가 진행하는 토론: MCP는 Codex 대화와 실행 상태를 관리한다.
   외부 에이전트를 역으로 호출할 필요가 없고 다양한 MCP 호스트와 연결하기 쉽다.
2. 서버가 자동 진행하는 토론: 서버가 외부 에이전트도 실행하고 라운드를 관리한다.
   에이전트별 실행 어댑터와 추가 수명주기 관리가 필요하다.

사용자의 후속 요구사항을 1번 방향으로 구체화했다. 2번은 이번 범위에 포함하지 않는다.

## 제안하는 구현 선택

다음은 사용자가 지정한 사항이 아니라 구현을 위한 제안이다.

- Node.js >=22.14와 TypeScript, 공식 MCP SDK v2 사용. 기존 MCP 호스트와의
  호환성은 SDK의 legacy protocol 지원과 통합 테스트로 검증한다.
- 외부 호스트와 MCP 서버 사이에는 stdio MCP 사용.
- MCP 서버는 전용 `codex app-server --listen stdio://` 자식 프로세스를 실행한다.
- 기존 Codex CLI의 로그인과 provider 설정을 사용하며 인증 파일을 직접 읽지 않는다.
- stdout은 MCP 프로토콜 전용, 진단 로그는 stderr로 출력한다.
- Codex는 프로젝트를 읽고 토론하는 read-only 모드로 시작한다.
- 자식 Codex가 동일 토론 MCP를 다시 호출하는 재귀를 막도록 해당 MCP 연결을
  자식 프로세스의 설정에서 비활성화한다. 다른 MCP 구성도 기본적으로 비활성화한다.
- Codex의 개발자 지침에 토론 상대 역할을 명시한다. 근거, 가정, 반례, 미해결
  쟁점을 설명하고, 호출자의 의견을 독립적으로 평가하도록 한다.

## MCP 도구

### `models_list({ includeHidden? })`

`model/list`의 모든 페이지를 조회해 반환한다. 기본 `includeHidden`은 false다.
모델과 effort 값을 소스 코드의 고정 목록으로 관리하지 않는다.

각 항목은 `id`, 호출에 사용할 `model`, `displayName`, `description`, `isDefault`,
`defaultReasoningEffort`, `supportedReasoningEfforts`를 포함한다. effort 설명도
원본 그대로 보존한다. 조회 시각을 함께 반환한다.

이 목록은 연결된 Codex가 제공하는 카탈로그다. 실제 계정/provider의 추론 접근
성공을 검증한 목록으로 표현하지 않는다. 이 도구는 추론 요청을 보내지 않는다.

### `discussion_start({ message, cwd?, model?, effort? })`

새 스레드를 생성하고 첫 발언을 실행한다. `cwd`는 존재하는 절대 디렉터리로
검증하며, 생략하면 MCP 서버 시작 시의 작업 디렉터리를 사용한다.

즉시 `discussionId`, `turnId`, `status`, `model`, `effort`를 반환한다.
`discussionId`는 Codex의 thread ID를 사용한다.

### `discussion_reply({ discussionId, message, model?, effort? })`

기존 스레드에 새 발언을 실행한다. 모델과 effort를 매 발언마다 바꿀 수 있다.
실행 중인 발언이 있으면 busy 오류와 현재 turn ID를 반환한다.
동일 대화에서 발언을 조용히 대기열에 넣거나 진행 중인 발언에 끼워 넣지 않는다.
서로 다른 대화는 독립적으로 실행할 수 있다.

### `discussion_read({ discussionId, turnId?, cursor?, limit?, waitMs? })`

최신 실행 또는 지정 실행의 상태와 공개 메시지를 조회한다.
`waitMs`는 기본 0, 최대 20초의 bounded long poll이다. 완료되거나 새 공개
메시지가 생기면 일찍 반환할 수 있다. 오래 걸리는 추론이 MCP 호출 제한에
묶이지 않도록 start/reply와 결과 수신을 분리한다.

상태, 모델/effort, 발언, 공개된 진행 정보, 다음 커서, 오류를 반환한다.
최종 메시지는 delta와 item 완료 이벤트를 중복 집계하지 않고 보존한다.
비공개 reasoning을 수집하거나 노출하지 않는다. 누적 이력은 페이지로 조회한다.

### `discussion_cancel({ discussionId, turnId })`

지정 발언에 `turn/interrupt`를 보낸다. 중단 요청의 수락과 실제 중단 완료를
구분한다. 최종 상태는 `discussion_read`로 확인한다. 이미 완료된 발언에는
완료 상태를 반환하며, 다른 발언을 잘못 중단하지 않는다.

## 모델과 effort 선택 규칙

1. 새 대화에서 model 생략: 카탈로그의 `isDefault` 모델을 선택한다. 기본 모델이
   모호하거나 없으면 목록 조회와 명시적 선택을 안내하는 오류를 반환한다.
2. 새 대화에서 effort 생략: 선택 모델의 `defaultReasoningEffort`를 사용한다.
3. 후속 발언에서 둘 다 생략: 마지막으로 수락된 모델과 effort를 유지한다.
4. 후속 발언에서 모델 변경, effort 생략: 새 모델의 기본 effort를 사용한다.
5. 후속 발언에서 effort만 지정: 유지 중인 모델에 대해 검증한다.
6. model은 반환된 `model` 값을 사용한다. effort는 해당 모델의 지원 목록에서
   검증한다. 잘못된 조합이면 허용값과 함께 오류를 반환한다.
7. 카탈로그는 짧게 캐시할 수 있지만 `models_list`는 명시적 최신 조회를 한다.
   검증 실패 시 한 번 최신 조회 후 재검증한다. 다른 모델로 자동 대체하지 않는다.
8. 응답에는 선택해 전달한 model/effort를 항상 포함한다. 실제 provider의 접근
   거절은 별도 실행 오류로 드러낸다.

도구 설명과 README에는 '처음에는 models_list로 모델 설명과 지원 effort를
확인하고, 질문의 난이도에 따라 선택한다'는 사용 흐름을 명시한다.
모델 순위, 가격, 속도에 대한 고정 추정으로 서버가 선택을 덮어쓰지 않는다.

## 프로토콜과 실행 수명주기

- 연결별 `initialize` 응답을 받은 뒤 `initialized`를 보내고 요청을 시작한다.
- JSONL을 프레임 단위로 파싱하고 RPC ID, thread ID, turn ID로 라우팅한다.
- 이벤트 수신기는 turn 시작 요청 전부터 등록해 빠른 완료 이벤트도 보존한다.
- JSON-RPC 응답 수락과 추론 완료를 구분한다. `turn/completed`의 최종 status를
  확인하며 `failed`, `interrupted`를 성공으로 취급하지 않는다.
- 사용자가 대화 ID로 재접속하면 `thread/resume`으로 대화를 복원한다.
  스레드의 선택 설정은 resume 응답의 `model`과 `reasoningEffort`를 기준으로
  복원한다. 이 필드는 로컬 0.164.0 스키마에서 확인했다. effort가 null이어서
  복원할 수 없으면 다음 reply에 명시적 effort를 요구한다. 재개 시에도 읽기 전용
  실행 정책과 토론 역할을 명시적으로 적용한다.
- 완료된 공개 이력은 app-server의 저장 이력 API로 페이지 조회한다.
  MCP 프로세스 재시작 전후에 동일한 커서 형식을 보장할 필요는 없으며, 이전
  커서는 명확한 오류와 커서 없이 다시 조회하라는 안내를 반환할 수 있다.
- 연결 중 조회는 최신 thread 상태와 마지막 발언을 확인해 외부 연결의 활성 작업을
  감지한다. 새 live thread의 paginated history가 아직 준비되지 않은 경우에만
  지원되는 `thread/read(includeTurns: true)`로 최신 상태를 확인한다.
- 실행 중 프로세스가 종료되면 진행 중인 호출을 connection-lost 상태로 노출한다.
  추론 요청은 중복 과금/중복 발언을 피하기 위해 자동 재실행하지 않는다.
- 읽기 전용 토론에서 발생하는 실행 승인 요청과 사용자 입력 요청은 지원되는
  프로토콜 응답으로 거절/취소하고 이유를 공개 진행 상태에 남겨 무한 대기를 막는다.
- MCP 종료 시 자식 프로세스와 대기 중 RPC/long poll을 정리한다.

## 범위와 한계

이번 버전은 로컬 stdio MCP이며 다중 사용자 서비스, 웹 UI, 자동 다자 토론,
외부 에이전트 실행, 파일 수정, 자동 합의 판정은 포함하지 않는다.
각 MCP 호스트 프로세스는 자신의 app-server 프로세스를 갖는다.
같은 대화를 여러 MCP 프로세스가 동시에 수정하는 사용은 지원하지 않는다.
읽기와 새 발언 시작 전 app-server의 활성 발언 상태를 확인하고 충돌을 오류로 알린다.

## 검증과 인수 조건

- 가짜 app-server를 통한 RPC와 MCP 통합 테스트로 초기화 순서, JSONL 분할,
  응답/이벤트 라우팅, 페이지 처리, 빠른 완료 이벤트, 오류/중단, 프로세스 종료 검증.
- 모델별로 다른 effort, 기본값, 변경 시 재선택, 잘못된 조합, 카탈로그 갱신 검증.
- 같은 스레드의 동시 reply 거부와 서로 다른 스레드의 독립 실행 검증.
- 모델 목록을 처음 조회하고 선택한 model/effort가 실제 `turn/start`에 전달되며,
  같은 대화에서 모델/effort를 바꾸는 시나리오를 MCP 클라이언트로 검증.
- 로컬 Codex와 추론 없는 모델 목록 조회 검증.
- 실제 추론 smoke test는 짧은 토론으로 시작/조회/후속 발언을 확인하고, 실행한
  범위를 결과에 명시한다. 연결 실패나 접근 권한 거절은 테스트 성공으로 표시하지 않는다.
- README에 빌드/실행, CLI 로그인 전제, 범용 MCP 설정 JSON, 도구 사용 예시,
  장시간 발언 조회와 취소 방법을 제공한다. 호스트별 설정 경로를 추정하지 않는다.
- `npm pack` 결과를 별도 임시 디렉터리에 설치하고 설치된 실행 명령으로 MCP
  초기화와 도구 목록 조회를 검증한다. 소스 체크아웃이나 개발 의존성 없이 동작해야 한다.
- 배포 tarball에 빌드 결과와 README를 포함하고 테스트, 로컬 설정, 인증 정보는
  포함하지 않는다. 버전과 실행 파일 경로를 `npm pack --dry-run`으로 확인한다.
- GitHub Actions에서 테스트, 빌드, 패키지 검증을 수행하고 npm 공개 게시를 지원한다.
  npm 조직의 trusted publishing/인증 구성에 맞춰 게시 권한을 연결한다.

테스트 러너, 모듈 구분, 제한값의 세부 조정, 캐시 TTL 등은 구현자가 결정한다.

## MCP 호스트 등록 안내

사용자 요구에 따라 npm 설치를 기본 배포 방식으로 한다. 조직 scope는
`@mirolab`, 공개 여부는 public으로 확정됐다. 패키지명은
`@mirolab/codex-discussion-mcp`를 제안하며 실제 게시 전 이름과 권한을 확인한다.
2026-10-25 공개 레지스트리에서 이 이름은 조회되지 않았다.
실행 명령은 `codex-discussion-mcp`, MCP 등록 이름은 `codex-discussion`으로 제안한다.
`package.json`의 `bin`이 `dist/index.js`를 가리키고 실행 파일에 Node shebang을 둔다.
빌드는 게시 전에 수행하며 설치하는 사용자는 저장소 복제나 TypeScript 빌드가 필요 없다.

게시 후 사용자 설치와 등록 예시:

```sh
npm install -g @mirolab/codex-discussion-mcp
claude mcp add --transport stdio --scope user codex-discussion -- codex-discussion-mcp
```

전역 설치 없이 `npx -y @mirolab/codex-discussion-mcp@<version>`로 실행하는 방법도
제공한다. 게시된 버전으로 확인하기 전에는 이 명령이 현재 설치 가능하다고 표현하지 않는다.
Node.js와 로그인된 Codex CLI를 실행 환경의 전제조건으로 문서화한다.

- Claude Code: 위 stdio 등록 명령을 사용한다.
- Kiro CLI: `~/.kiro/settings/mcp.json`의 `mcpServers`에 command/args 추가.
  프로젝트 범위는 `.kiro/settings/mcp.json`.
- Antigravity CLI: `~/.gemini/config/mcp_config.json`의 `mcpServers`에 동일한
  command/args 추가. 프로젝트 범위는 `.agents/mcp_config.json`.
- 기존 설정에는 새 항목을 병합하며 다른 서버 설정을 덮어쓰지 않도록 설명한다.
- README에는 실제 빌드 결과와 Node/Codex 경로, 등록 확인, 첫 `models_list`
  호출까지의 예시를 제공한다. 등록만으로 항상 Codex와 토론하는 것은 아니며,
  호출 에이전트에 토론 요청을 하거나 별도 프로젝트 지침을 추가하는 방법을 설명한다.

Kiro/Antigravity 공통 서버 항목은 전역 설치 시
`{"command":"codex-discussion-mcp","args":[]}`, npx 사용 시
`{"command":"npx","args":["-y","@mirolab/codex-discussion-mcp@<version>"]}` 형태다.
실제 README에는 확정된 패키지명과 버전을 사용한다.

위 경로와 명령은 2026-10-25 각 제품 공식 문서에서 확인했다.
등록 안내는 설치된 호스트 버전에 따라 확인한 범위를 명시한다.

## 확인 근거

- [공식 app-server 문서](https://learn.chatgpt.com/docs/app-server)
- [Claude Code MCP 등록](https://code.claude.com/docs/en/mcp)
- [Kiro MCP 설정](https://kiro.dev/docs/mcp/configuration/)
- [Antigravity MCP 설정](https://www.antigravity.google/docs/mcp)
- [npm package.json의 bin 설정](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
- [npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
- 로컬 `codex-cli 0.164.0`의 `generate-json-schema` 결과에서 `model/list`,
  `turn/start.model`, `turn/start.effort` 확인.
- 2026-10-25 로컬 app-server에서 초기화와 전체 `model/list` 조회 성공.
  이 확인에서는 추론 요청을 실행하지 않았다.
