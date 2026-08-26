# MacOSMCP

macOS MCP server that provides shell, AppleScript, file, and system tools.

## Stack
- Bun runtime
- @modelcontextprotocol/sdk v1.29.0+
- Express 5 (via SDK's createMcpExpressApp)
- TypeScript strict mode
- Biome for formatting (tabs, single quotes, no semicolons)

## Architecture
- `src/index.ts` — server entrypoint, dual transport (streamable HTTP + SSE)
- `src/auth.ts` — Bearer token middleware
- `src/safety.ts` — command blocklist + path allowlist
- `src/logger.ts` — JSONL audit logger
- `src/tools/define-tool.ts` — tool definition helper wrapping McpServer.registerTool
- `src/tools/index.ts` — tool registry
- `src/tools/*.ts` — tool implementations

## Commands
- `bun run dev` — start with hot reload
- `bun run start` — production start
- `bun run check` — lint
- `bun run typecheck` — type check

## Conventions
- Follow Fermi patterns where applicable
- All tools return `{ content: [{ type: 'text', text: string }] }`
- All file tools check path allowlist before disk access
- All shell tools check command blocklist before execution
- Audit log every tool invocation
