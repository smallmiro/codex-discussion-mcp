#!/usr/bin/env bash
# Standalone setup and foreground launcher for a token-authenticated Codex app-server.
set +x
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: bash setup-remote-app-server.sh [options]

Create or reuse a private transport token, then run Codex app-server in the
foreground. Stop it with Ctrl-C. Requires Bash, OpenSSL and an authenticated
Codex CLI with WebSocket authentication support.

  --host <IPv4-address>     Listening address (default: 127.0.0.1)
  --port <1-65535>          Listening port (default: 4500)
  --token-file <path>      Absolute token path (default: ~/.codex/app-server-token)
  --codex-command <path>   Codex executable (default: codex on PATH)
  --help, -h               Show this help without changing files

Example on the remote machine:
  bash setup-remote-app-server.sh --host 192.168.20.45 --port 4500

This starts a ws:// backend. For direct remote use, terminate TLS in front of
it and connect using wss://. It does not install a background service.
HELP
}

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

host=127.0.0.1
port=4500
token_file="$HOME/.codex/app-server-token"
codex_command=codex

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --host|--port|--token-file|--codex-command)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 requires a value."
      case "$1" in
        --host) host=$2 ;;
        --port) port=$2 ;;
        --token-file) token_file=$2 ;;
        --codex-command) codex_command=$2 ;;
      esac
      shift 2
      ;;
    *) fail "Unknown option: $1. Use --help." ;;
  esac
done

[[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "--host must be an IPv4 address."
IFS=. read -r octet1 octet2 octet3 octet4 <<< "$host"
for octet in "$octet1" "$octet2" "$octet3" "$octet4"; do
  (( 10#$octet <= 255 )) || fail "--host must be an IPv4 address."
done
[[ "$port" =~ ^[0-9]{1,5}$ ]] || fail "--port must be an integer from 1 to 65535."
port=$((10#$port))
(( port >= 1 && port <= 65535 )) || fail "--port must be an integer from 1 to 65535."
[[ "$token_file" = /* ]] || fail "--token-file must be an absolute path."
command -v "$codex_command" >/dev/null 2>&1 || fail "Codex executable not found. Set --codex-command."

help_text=$("$codex_command" app-server --help) || fail "Cannot read Codex app-server options."
for option in --listen --ws-auth --ws-token-file; do
  [[ "$help_text" == *"$option"* ]] || fail "This Codex CLI does not support WebSocket authentication. Update Codex first."
done
unset help_text

validate_token_file() {
  [[ ! -L "$token_file" && -f "$token_file" && -s "$token_file" && -O "$token_file" ]] ||
    fail "Token must be a nonempty regular file owned by the current user; symbolic links are not accepted."
}

if [[ -e "$token_file" || -L "$token_file" ]]; then
  validate_token_file
else
  command -v openssl >/dev/null 2>&1 || fail "OpenSSL is required to create the transport token."
  token_dir=$(dirname "$token_file")
  umask 077
  mkdir -p "$token_dir"
  token_temp=$(mktemp "$token_dir/.app-server-token.XXXXXX")
  trap 'rm -f -- "$token_temp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  openssl rand -hex 32 > "$token_temp"
  # Publish a complete token without overwriting another setup process's token.
  if ! ln "$token_temp" "$token_file" 2>/dev/null; then
    validate_token_file
  fi
  rm -f -- "$token_temp"
  trap - EXIT INT TERM
fi
validate_token_file
chmod 600 "$token_file"

printf 'Token file ready: %s (contents hidden, permissions 600)\n' "$token_file" >&2
printf 'Starting authenticated Codex app-server at ws://%s:%s\n' "$host" "$port" >&2
if [[ "$host" != 127.* ]]; then
  printf 'Direct remote clients should use a TLS endpoint (wss://) in front of this ws:// backend.\n' >&2
fi
exec "$codex_command" app-server --listen "ws://$host:$port" \
  --ws-auth capability-token --ws-token-file "$token_file" \
  -c features.plugins=false -c features.apps=false
