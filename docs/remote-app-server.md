# Set up a remote Codex app-server

The standalone [setup script](../scripts/setup-remote-app-server.sh) creates a
256-bit transport token when no token exists, restricts its permissions to `600`,
and starts a token-authenticated app-server in the foreground. Repeated runs keep
the existing token. The script supports macOS and Linux with Bash and OpenSSL;
Codex must already be installed and authenticated.

This configures Codex app-server itself. The current `codex-discussion-mcp`
package still uses local stdio and does not have a WebSocket client. A listening
app-server does not add remote WebSocket support to the MCP package.

## Run on the remote machine

Copy the script from this checkout to the remote host:

```bash
scp scripts/setup-remote-app-server.sh user@remote-host:~/setup-remote-app-server.sh
```

In the remote user's terminal, run:

```bash
bash "$HOME/setup-remote-app-server.sh" --host 192.168.20.45 --port 4500
```

Use the server's actual IPv4 address. The default host is `127.0.0.1`, which is
appropriate for a local TLS reverse proxy or SSH forwarding. `--host 0.0.0.0`
listens on all IPv4 interfaces. Stop the foreground server with Ctrl-C; the
script does not install a service or configure automatic restarts.

If Codex is not on PATH, pass `--codex-command /absolute/path/to/codex`.
Use `--token-file /absolute/path/to/token` to choose another token file.
Existing empty files, symbolic links and files owned by another user are rejected.
The script does not read or change Codex authentication files or `config.toml`.
It disables apps and plugins for the launched app-server, as the MCP launcher does.

## Transport security and client setup

The script starts a plain `ws://` backend with capability-token authentication.
For direct remote use, configure a TLS reverse proxy and connect using `wss://`.
TLS certificates, the proxy, firewall rules and background service management
are outside this script. WebSocket transport is experimental; see the
[official app-server documentation](https://learn.chatgpt.com/docs/app-server).

The token is a transport credential shared by server and client. It is separate
from the account's Codex login. Do not print it or include it in URLs, command
arguments, logs or commits.

On the client machine, load the same token over SSH:

```bash
export CODEX_REMOTE_TOKEN="$(
  ssh user@remote-host 'cat "$HOME/.codex/app-server-token"'
)"
```

After configuring a trusted TLS endpoint for the backend:

```bash
codex --remote wss://codex.example.com \
  --remote-auth-token-env CODEX_REMOTE_TOKEN
```

Using `wss://` requires a working TLS endpoint; changing the URL scheme alone
does not enable TLS on app-server.

## Check readiness

From the remote machine, check the address used with `--host`:

```bash
curl --fail --show-error http://192.168.20.45:4500/readyz
```

HTTP `200` confirms the listener is ready. It does not verify WebSocket
authentication, account entitlement or successful inference. If the configured
address or port is already in use, app-server exits; the script does not stop
an existing process.
