import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { createBearerAuth } from '../../src/auth.js'
import { registerAllTools } from '../../src/tools/index.js'

const TEST_PORT = 13849
const TEST_TOKEN = 'browser-test-token'
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

let server: Server
const transports = new Map<string, StreamableHTTPServerTransport>()

function createMcpServer(): McpServer {
	const s = new McpServer(
		{ name: 'macos-mcp-browser-test', version: '0.1.0' },
		{ capabilities: { tools: {} } },
	)
	registerAllTools(s)
	return s
}

beforeAll(async () => {
	const app = createMcpExpressApp({ host: '127.0.0.1' })
	const bearerAuth = createBearerAuth(TEST_TOKEN)

	app.post('/mcp', bearerAuth, async (req: Request, res: Response) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined
		const existing = sessionId ? transports.get(sessionId) : undefined
		if (existing) {
			await existing.handleRequest(req, res, req.body)
			return
		}

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				transports.set(id, transport)
			},
			onsessionclosed: (id) => {
				transports.delete(id)
			},
		})

		const mcpServer = createMcpServer()
		await mcpServer.connect(transport)
		await transport.handleRequest(req, res, req.body)
	})

	server = app.listen(TEST_PORT, '127.0.0.1')
	await new Promise((resolve) => server.on('listening', resolve))
})

afterAll(() => {
	for (const t of transports.values()) {
		t.close()
	}
	transports.clear()
	server?.close()
})

function headers(sessionId?: string) {
	const h: Record<string, string> = {
		Authorization: `Bearer ${TEST_TOKEN}`,
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
	}
	if (sessionId) h['mcp-session-id'] = sessionId
	return h
}

// biome-ignore lint/suspicious/noExplicitAny: dynamic JSON-RPC response
function parseSSE(raw: string): any {
	const dataLine = raw.split('\n').find((l) => l.startsWith('data: '))
	if (!dataLine) throw new Error(`No data line in SSE response: ${raw}`)
	return JSON.parse(dataLine.slice(6))
}

async function initSession(): Promise<string> {
	const res = await fetch(`${BASE_URL}/mcp`, {
		method: 'POST',
		headers: headers(),
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-03-26',
				capabilities: {},
				clientInfo: { name: 'browser-test', version: '1.0' },
			},
		}),
	})

	const sessionId = res.headers.get('mcp-session-id')
	if (!sessionId) throw new Error('No session ID returned')

	await fetch(`${BASE_URL}/mcp`, {
		method: 'POST',
		headers: headers(sessionId),
		body: JSON.stringify({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		}),
	})

	return sessionId
}

async function callTool(
	sessionId: string,
	name: string,
	args: Record<string, unknown>,
	id = 2,
	// biome-ignore lint/suspicious/noExplicitAny: dynamic JSON-RPC response
): Promise<any> {
	const res = await fetch(`${BASE_URL}/mcp`, {
		method: 'POST',
		headers: headers(sessionId),
		body: JSON.stringify({
			jsonrpc: '2.0',
			id,
			method: 'tools/call',
			params: { name, arguments: args },
		}),
	})
	const raw = await res.text()
	return parseSSE(raw)
}

describe('mac_browser_list', () => {
	test('returns empty session list', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_browser_list', {})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.count).toBe(0)
		expect(result.sessions).toEqual([])
	})
})

describe('mac_browser_action', () => {
	test('returns error for invalid session', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_browser_action', {
			session_id: 'nonexistent-session',
			actions: [{ type: 'goto', url: 'https://example.com' }],
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.error).toBe('session_not_found')
	})
})

describe('mac_browser_close', () => {
	test('returns error for invalid session', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_browser_close', {
			session_id: 'nonexistent-session',
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.error).toBe('session_not_found')
	})
})
