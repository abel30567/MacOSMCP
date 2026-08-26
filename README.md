# MacOSMCP

MacOSMCP is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server
that exposes macOS control tools over authenticated HTTP. It lets an MCP client
(such as an AI agent) drive a Mac remotely through a single bearer-token-protected
endpoint.

## Tools

The server registers tools spanning the following capabilities:

- **Shell** — run shell commands.
- **AppleScript / JXA** — run AppleScript and JavaScript for Automation.
- **Filesystem** — read, write, list, move, and delete files (scoped to `ALLOWED_PATHS`).
- **Screen capture** — screenshots and on-screen OCR.
- **Clipboard** — read and write the system clipboard.
- **System info** — query host and system details.
- **Browser** — a persistent [puppeteer-real-browser](https://www.npmjs.com/package/puppeteer-real-browser)
  Chrome session for automating web pages you own or are authorized to use.

## Requirements

- macOS
- [Bun](https://bun.sh) (>= 1.1)
- [Homebrew](https://brew.sh) (for the helper scripts)

## Install

```bash
bun install
cp .env.example .env
```

Or run the bootstrap script, which installs system dependencies
(`cliclick`, `cloudflared`), generates a `.env` with a random `AGENT_TOKEN`,
and installs Node dependencies:

```bash
./scripts/install.sh
```

Then edit `.env` and set:

- `AGENT_TOKEN` — a strong bearer token (e.g. `openssl rand -hex 32`). Required.
- `TUNNEL_HOSTNAME` — the public hostname you will serve from (e.g. `mac.example.com`). Required.
- `PORT` — local port (default `3847`).
- `ALLOWED_PATHS` — comma-separated filesystem roots the file tools may touch.
- `LOG_DIR` — where logs are written.

The server refuses to start over HTTP unless both `AGENT_TOKEN` and
`TUNNEL_HOSTNAME` are set.

## Running locally

```bash
bun run dev     # watch mode
# or
bun run start   # single run
```

The server binds to `127.0.0.1` and only accepts requests whose Host header is
`127.0.0.1` or your configured `TUNNEL_HOSTNAME`. A stdio transport is also
available for direct MCP clients:

```bash
bun src/index.ts --stdio
```

### Health check

`GET /health` returns liveness/version info and is intentionally
**unauthenticated**. It reveals only that the process is up — no secrets, no data.

## Exposing via Cloudflare Tunnel

The recommended way to reach the server from outside the machine is a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
so the port is never opened directly to the internet.

```bash
export TUNNEL_HOSTNAME=mac.example.com
./scripts/tunnel-setup.sh       # creates the tunnel + DNS route
./scripts/launchd-install.sh    # installs launchd services to keep it running
```

## ⚠️ Security

**Read this before exposing the server anywhere.**

This server grants a remote caller, over the network, the ability to:

- run arbitrary **shell commands**,
- run arbitrary **AppleScript / JXA**,
- **read and write files** anywhere under `ALLOWED_PATHS`,
- **capture the screen** and read on-screen text,
- **read and write the clipboard**, and
- **control a real browser** session.

Anyone who holds the bearer `AGENT_TOKEN` has this level of control over the
machine. Treat the token like a root password.

- **Never** expose the server without both the Cloudflare Tunnel **and** a
  strong, unguessable `AGENT_TOKEN`.
- **Never** commit your `.env` or share the token.
- Scope `ALLOWED_PATHS` as narrowly as your use case permits.
- The `/health` endpoint is unauthenticated by design; it exposes only liveness
  and version, never data.
- The browser tool must only target sites you own or are explicitly authorized
  to automate.

Running this server is entirely at your own risk. See [LICENSE](./LICENSE).

## License

MIT — see [LICENSE](./LICENSE).
