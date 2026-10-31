# Public npm publishing through GitHub Actions

The current public release is `0.1.3`. See the release records for
[0.1.0](releases/0.1.0.md), [0.1.1](releases/0.1.1.md),
[0.1.2](releases/0.1.2.md), and [0.1.3](releases/0.1.3.md).
Check the public registry for the published version:

```bash
npm view @mirolab/codex-discussion-mcp version --registry=https://registry.npmjs.org/
```

Published versions cannot be republished. All four versions used the existing
bootstrap token. The `v0.1.1`, `v0.1.2`, and `v0.1.3` OIDC runs were rejected with `E404`;
actual OIDC publication remains unverified. Configure the OIDC connection below
before relying on Trusted Publishing for another version.

- GitHub: `smallmiro/codex-discussion-mcp`
- npm organization: `mirolab`
- Package: `@mirolab/codex-discussion-mcp`
- License: MIT
- Publishing workflow: `.github/workflows/publish.yml`
- Initial token-based publishing workflow: `.github/workflows/bootstrap-publish.yml`

Builds and validation run on GitHub-hosted runners. Regular releases use npm
Trusted Publishing (OIDC), so the repository does not need an `NPM_TOKEN` secret.
An individual npm account belonging to the organization exercises its publishing
permissions.

## CI and package downloads

The `CI` workflow validates on Node.js 22 and 24 for pushes to `main`, pull
requests, and manual runs. The Node.js 24 job uploads the built `.tgz` as the
`npm-package` artifact.

Download it from the GitHub repository under Actions → CI → a successful run →
Artifacts. You can also use the CLI:

```bash
gh run list --repo smallmiro/codex-discussion-mcp --workflow ci.yml --branch main --status success
gh run download RUN_ID --repo smallmiro/codex-discussion-mcp --name npm-package --dir release-artifacts
```

Replace `RUN_ID` with an actual run ID from the list. You can install the
downloaded package locally to check it even before it is published to npm.

```bash
npm install -g ./release-artifacts/mirolab-codex-discussion-mcp-0.1.3.tgz
codex-discussion-mcp --help
```

## Initial publishing

For the first version, you can register an npm publishing token in GitHub
Actions to build and publish there, or publish a tarball built by GitHub from a
signed-in user terminal. Afterward, configure Trusted Publishing in the package
settings.

### Initial publishing with a GitHub Secret

1. In the npm profile menu → Access Tokens → Generate New Token, create a granular token.
2. Under Packages and scopes, set Permissions to **Read and write (publish and stage)**,
   then select the **`@mirolab` scope** under Only select packages and scopes.
3. Enable **Bypass two-factor authentication** for automated publishing and set a short expiration.
4. Organization administration permissions are separate from package publishing permissions. Organization administration access is not required.
5. In the GitHub repository, go to Settings → Secrets and variables → Actions → New repository secret.
   Use `NPM_TOKEN` as the name and the issued token as the value. Do not put the token in chat or source code.
6. Under Actions → **Bootstrap npm package (token)** → Run workflow, select `main` and version `0.1.0`.

You must complete any identity verification npm requires when issuing the token.
This workflow does not request OIDC permissions and passes the token only to the
publishing step. It publicly publishes the same `.tgz` that passed tests, build,
and tarball installation validation. You can also start it with the CLI:

```bash
gh workflow run bootstrap-publish.yml --repo smallmiro/codex-discussion-mcp --ref main -f version=0.1.0
```

npm has announced plans to restrict direct publishing with 2FA bypass tokens
starting in January 2027. After the initial publication and verification of the
OIDC connection, remove the bootstrap token and GitHub Secret.
[npm token settings](https://docs.npmjs.com/creating-and-viewing-access-tokens/) ·
[Policy change announcement](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)

### Initial publishing directly from a user terminal

First, **enable 2FA** on the individual npm account. Even if you are signed in
and have organization owner permissions, direct publishing is rejected with
`E403` when 2FA is disabled. Enable it under the npm profile menu → Account →
Two-Factor Authentication → Enable 2FA, then complete the browser authentication
prompt when publishing.
[npm 2FA setup guide](https://docs.npmjs.com/configuring-two-factor-authentication/)

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./release-artifacts/mirolab-codex-discussion-mcp-0.1.0.tgz --access public
```

The signed-in username does not need to match the organization name. The user
must have permission to publish packages in the `mirolab` organization. The user
completes npm web login and 2FA authentication directly. There is no need to copy
passwords, tokens, or OTPs into the repository or chat.

After publishing, verify the public package and version:

```bash
npm view @mirolab/codex-discussion-mcp version --registry=https://registry.npmjs.org/
```

An already published version cannot be published again. After manually
publishing the initial `0.1.0`, do not trigger the publishing workflow through a
GitHub Release for the same version.

## Configure the npm Trusted Publisher

Add GitHub Actions under the package's npm Settings → Trusted publishing.

| Field | Value |
|---|---|
| Organization or user | `smallmiro` |
| Repository | `codex-discussion-mcp` |
| Workflow filename | `publish.yml` |
| Environment name | Leave blank |
| Allowed actions | Allow `npm publish` for direct publishing |

Enter **`smallmiro`, the GitHub owner**, in Organization or user. This is distinct
from the npm organization name, `mirolab`. Use `publish.yml` as the workflow
filename, rather than its full path. It must match the actual workflow filename,
including case.

The current workflow does not use a GitHub Environment. If you specify an
Environment in the npm settings, update the workflow's `environment` to match.

A new Trusted Publisher must successfully publish for the first time within 2
days of creation. Configure it when you are ready to release the next version.
If it expires, delete it and add it again.

## Publishing subsequent versions

Commit the version change and tag to the repository, then publish a GitHub
Release using a **`v` tag matching the package version**. Derive the release tag
from the new version instead of reusing an already published version's tag.

```bash
npm version patch
git push origin main --follow-tags
release_tag="v$(node -p 'require("./package.json").version')"
gh release create "$release_tag" --repo smallmiro/codex-discussion-mcp --generate-notes
```

The workflow checks out the tag, validates the name and version, runs tests,
builds, and validates tarball installation. It then publishes the **same tarball**
using `npm publish --access public`. Only the publishing job receives
`id-token: write`. To retry a failed version that has not been published, manually
run `Publish npm package` in Actions and supply the existing tag.

CI builds and artifact downloads are available even before npm account setup is
complete.

## Local validation before publishing

```bash
npm ci
npm run check
npm run verify:package
npm pack --dry-run
```

Official references:

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [Publishing public scoped npm packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
