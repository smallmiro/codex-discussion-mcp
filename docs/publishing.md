# GitHub Actions → npm 공개 배포

- GitHub: `smallmiro/codex-discussion-mcp`
- npm 조직: `mirolab`
- 패키지: `@mirolab/codex-discussion-mcp`
- 라이선스: MIT
- 게시 워크플로: `.github/workflows/publish.yml`

빌드와 검증은 GitHub-hosted runner에서 실행합니다. 정규 배포는 npm Trusted
Publishing(OIDC)을 사용하며 저장소에 `NPM_TOKEN`을 등록할 필요가 없습니다.
npm 조직의 게시 권한은 조직에 속한 개인 npm 계정으로 행사합니다.

## CI와 패키지 받기

`main` 푸시, PR, 수동 실행에서 `CI` 워크플로가 Node.js 22와 24로 검증합니다.
Node.js 24 작업은 빌드된 `.tgz`를 `npm-package` artifact로 올립니다.

GitHub 저장소의 Actions → CI → 성공한 실행 → Artifacts에서 다운로드하세요.
CLI로 받을 수도 있습니다.

```bash
gh run list --repo smallmiro/codex-discussion-mcp --workflow ci.yml --branch main --status success
gh run download RUN_ID --repo smallmiro/codex-discussion-mcp --name npm-package --dir release-artifacts
```

`RUN_ID`는 위 목록의 실제 실행 ID로 바꿉니다. 다운로드한 패키지는 npm 게시 전에도
로컬에 설치해 확인할 수 있습니다.

```bash
npm install -g ./release-artifacts/mirolab-codex-discussion-mcp-0.1.0.tgz
codex-discussion-mcp --help
```

## 첫 게시

이 프로젝트는 첫 버전을 GitHub에서 빌드한 뒤, `mirolab` 조직에 게시 권한이 있는
사용자가 그 tarball을 게시하는 절차를 사용합니다. 이후 패키지 설정에서
Trusted Publishing을 연결합니다.

먼저 해당 개인 npm 계정에서 **2FA를 활성화**하세요. 로그인과 조직 owner 권한이
있어도 2FA가 비활성화되어 있으면 직접 게시가 `E403`으로 거절됩니다.
npm 프로필 메뉴 → Account → Two-Factor Authentication → Enable 2FA에서
설정하고, 게시 시 나타나는 인증 절차를 브라우저에서 완료합니다.
[npm 2FA 설정 안내](https://docs.npmjs.com/configuring-two-factor-authentication/)

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./release-artifacts/mirolab-codex-discussion-mcp-0.1.0.tgz --access public
```

로그인한 사용자 이름이 조직 이름과 같을 필요는 없습니다. 해당 사용자가
`mirolab` 조직에 패키지를 게시할 권한이 있어야 합니다. npm의 웹 로그인과
2FA 인증은 사용자 본인이 진행합니다. 비밀번호, 토큰, OTP를 저장소나 채팅에
복사할 필요는 없습니다.

게시 후 실제 공개 패키지와 버전을 확인합니다.

```bash
npm view @mirolab/codex-discussion-mcp version --registry=https://registry.npmjs.org/
```

이미 게시한 버전은 다시 게시할 수 없습니다. 최초 `0.1.0`을 수동 게시한 뒤
같은 버전의 GitHub Release로 게시 워크플로를 실행하지 마세요.

## npm Trusted Publisher 연결

패키지의 npm Settings → Trusted publishing에서 GitHub Actions를 추가합니다.

| 필드 | 값 |
|---|---|
| Organization or user | `smallmiro` |
| Repository | `codex-discussion-mcp` |
| Workflow filename | `publish.yml` |
| Environment name | 비워두기 |
| Allowed actions | 직접 배포하려면 `npm publish` 허용 |

Organization or user에는 **GitHub 소유자인 `smallmiro`**를 입력합니다.
npm 조직명 `mirolab`과 구분하세요. 워크플로 파일 이름은 경로 전체가 아닌
`publish.yml`이며, 실제 워크플로 이름과 대소문자가 일치해야 합니다.

현재 워크플로는 GitHub Environment를 사용하지 않습니다. npm 설정에 Environment를
입력하려면 워크플로의 `environment`도 동일하게 변경해야 합니다.

새 Trusted Publisher는 생성 후 2일 안에 첫 게시에 성공해야 합니다. 다음 버전을
배포할 준비가 되었을 때 연결하세요. 만료되면 삭제 후 새로 추가합니다.

## 이후 버전 게시

버전 변경과 태그를 저장소에 반영하고, **패키지 버전과 같은 `v` 태그**로
GitHub Release를 게시합니다. 예를 들어 다음 버전이 `0.1.1`이면 태그는 `v0.1.1`입니다.

```bash
npm version patch
git push origin main --follow-tags
gh release create v0.1.1 --repo smallmiro/codex-discussion-mcp --generate-notes
```

워크플로는 해당 태그를 체크아웃하고 이름/버전 검사, 테스트, 빌드, tarball 설치
검증을 모두 통과한 **동일 tarball**을 `npm publish --access public`로 게시합니다.
게시 작업에만 `id-token: write`를 부여합니다. 실패한 미게시 버전은 Actions의
`Publish npm package`를 수동 실행하고 기존 태그를 입력해 다시 시도할 수 있습니다.

npm 계정 설정이 완료되기 전에도 CI의 빌드와 artifact 다운로드는 사용할 수 있습니다.

## 로컬 게시 전 검증

```bash
npm ci
npm run check
npm run verify:package
npm pack --dry-run
```

공식 참고:

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm 공개 scoped 패키지 게시](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
