import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { createBearerAuth } from '../../src/auth.js'
import { registerAllTools } from '../../src/tools/index.js'

const TEST_PORT = 13847
const TEST_TOKEN = 'test-token-for-integration'
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

let server: Server
const transports = new Map<string, StreamableHTTPServerTransport>()

function createMcpServer(): McpServer {
	const s = new McpServer(
		{ name: 'macos-mcp-test', version: '0.1.0' },
		{ capabilities: { tools: {} } },
	)
	registerAllTools(s)
	return s
}

beforeAll(async () => {
	const app = createMcpExpressApp({ host: '127.0.0.1' })
	const bearerAuth = createBearerAuth(TEST_TOKEN)

	app.get('/health', (_req: Request, res: Response) => {
		res.json({ ok: true })
	})

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
				clientInfo: { name: 'test', version: '1.0' },
			},
		}),
	})

	const sessionId = res.headers.get('mcp-session-id')
	if (!sessionId) throw new Error('No session ID returned')

	// Send initialized notification
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

describe('Health check', () => {
	test('GET /health returns ok', async () => {
		const res = await fetch(`${BASE_URL}/health`)
		const body = await res.json()
		expect(res.status).toBe(200)
		expect(body.ok).toBe(true)
	})
})

describe('Auth', () => {
	test('rejects request without token', async () => {
		const res = await fetch(`${BASE_URL}/mcp`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		})
		expect(res.status).toBe(401)
	})

	test('rejects request with wrong token', async () => {
		const res = await fetch(`${BASE_URL}/mcp`, {
			method: 'POST',
			headers: {
				...headers(),
				Authorization: 'Bearer wrong',
			},
			body: '{}',
		})
		expect(res.status).toBe(401)
	})
})

describe('MCP Protocol', () => {
	test('initializes session successfully', async () => {
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
					clientInfo: { name: 'test', version: '1.0' },
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(res.headers.get('mcp-session-id')).toBeTruthy()

		const data = parseSSE(await res.text())
		expect(data.result.serverInfo.name).toBe('macos-mcp-test')
		expect(data.result.capabilities.tools).toBeDefined()
	})

	test('lists all registered tools', async () => {
		const sessionId = await initSession()
		const res = await fetch(`${BASE_URL}/mcp`, {
			method: 'POST',
			headers: headers(sessionId),
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list',
				params: {},
			}),
		})

		const data = parseSSE(await res.text())
		// biome-ignore lint/suspicious/noExplicitAny: dynamic MCP tool list
		const toolNames = data.result.tools.map((t: any) => t.name)

		expect(toolNames).toContain('mac_shell')
		expect(toolNames).toContain('mac_applescript')
		expect(toolNames).toContain('mac_jxa')
		expect(toolNames).toContain('mac_file_read')
		expect(toolNames).toContain('mac_file_write')
		expect(toolNames).toContain('mac_file_list')
		expect(toolNames).toContain('mac_file_search')
		expect(toolNames).toContain('mac_file_move')
		expect(toolNames).toContain('mac_file_delete')
		expect(toolNames).toContain('mac_file_info')
		expect(toolNames).toContain('mac_system_info')
		expect(toolNames).toContain('mac_browser_launch')
		expect(toolNames).toContain('mac_browser_action')
		expect(toolNames).toContain('mac_browser_close')
		expect(toolNames).toContain('mac_browser_list')
		expect(toolNames).toContain('mac_screenshot')
		expect(toolNames).toContain('mac_screen_ocr')
		expect(toolNames).toContain('mac_clipboard_get')
		expect(toolNames).toContain('mac_clipboard_set')
		expect(toolNames).toContain('mac_notification')
		expect(toolNames).toContain('mac_open')
		expect(toolNames).toContain('mac_chrome_open')
		expect(toolNames).toContain('mac_keystroke')
		expect(toolNames).toContain('mac_click')
		expect(toolNames).toContain('mac_app_list')
		expect(toolNames).toContain('mac_app_activate')
		expect(toolNames.length).toBe(26)
	})
})

describe('mac_system_info', () => {
	test('returns system information', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_system_info', {})

		const info = JSON.parse(data.result.content[0].text)
		expect(info.hostname).toBeTruthy()
		expect(info.macos_version).toBeTruthy()
		expect(info.cpu.cores).toBeGreaterThan(0)
		expect(info.memory.total_gb).toBeGreaterThan(0)
		expect(info.uptime_hours).toBeGreaterThanOrEqual(0)
	})
})

describe('mac_shell', () => {
	test('executes simple commands', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_shell', { command: 'echo hello-test' })

		const result = JSON.parse(data.result.content[0].text)
		expect(result.stdout).toContain('hello-test')
		expect(result.exitCode).toBe(0)
	})

	test('returns exit code for failing commands', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_shell', { command: 'false' })

		const result = JSON.parse(data.result.content[0].text)
		expect(result.exitCode).not.toBe(0)
	})

	test('captures stderr', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_shell', {
			command: 'echo error-msg >&2',
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.stderr).toContain('error-msg')
	})

	test('blocks sudo commands', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_shell', { command: 'sudo whoami' })

		const result = JSON.parse(data.result.content[0].text)
		expect(result.error).toBe('blocked')
		expect(result.rule).toContain('sudo')
	})

	test('blocks rm -rf /', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_shell', { command: 'rm -rf / ' })

		const result = JSON.parse(data.result.content[0].text)
		expect(result.error).toBe('blocked')
	})

	test('respects cwd parameter', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_shell', {
			command: 'pwd',
			cwd: '/tmp',
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.stdout.trim()).toMatch(/tmp/)
	})

	test('rejects cwd outside allowed paths', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_shell', {
			command: 'ls',
			cwd: '/System',
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.error).toBe('path_denied')
	})
})

describe('mac_applescript', () => {
	test('executes simple AppleScript', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_applescript', {
			script: 'return "hello from applescript"',
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.stdout).toContain('hello from applescript')
		expect(result.exitCode).toBe(0)
	})

	test('returns error for invalid AppleScript', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_applescript', {
			script: 'this is not valid applescript %%%',
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toBeTruthy()
	})
})

describe('mac_jxa', () => {
	test('executes JXA code', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_jxa', {
			script: 'JSON.stringify({answer: 42})',
		})

		const result = JSON.parse(data.result.content[0].text)
		expect(result.stdout).toContain('42')
	})
})

describe('mac_file_read', () => {
	test('reads a file', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_file_read', {
			path: '/tmp/macos-mcp-test-read.txt',
		})

		// File may not exist, so we just verify the tool responds without crashing
		expect(data.result.content[0].type).toBe('text')
	})
})

describe('mac_file_write + mac_file_read', () => {
	const testPath = '/tmp/macos-mcp-test-write.txt'
	const testContent = `test-${Date.now()}`

	test('writes and reads back a file', async () => {
		const sessionId = await initSession()

		const writeData = await callTool(sessionId, 'mac_file_write', {
			path: testPath,
			content: testContent,
		})
		const writeResult = JSON.parse(writeData.result.content[0].text)
		expect(writeResult.ok).toBe(true)

		const readData = await callTool(sessionId, 'mac_file_read', { path: testPath }, 3)
		expect(readData.result.content[0].text).toBe(testContent)
	})
})

describe('mac_file_list', () => {
	test('lists directory contents', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_file_list', { path: '/tmp' })

		const entries = JSON.parse(data.result.content[0].text)
		expect(Array.isArray(entries)).toBe(true)
		expect(entries.length).toBeGreaterThan(0)
		expect(entries[0]).toHaveProperty('name')
		expect(entries[0]).toHaveProperty('type')
	})

	test('rejects paths outside allowlist', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_file_list', { path: '/System' })

		const result = JSON.parse(data.result.content[0].text)
		expect(result.error).toBe('path_denied')
	})
})

describe('mac_file_info', () => {
	test('returns file metadata', async () => {
		const sessionId = await initSession()
		const data = await callTool(sessionId, 'mac_file_info', { path: '/tmp' })

		const info = JSON.parse(data.result.content[0].text)
		expect(info.type).toBe('directory')
		expect(info.size).toBeDefined()
		expect(info.created).toBeTruthy()
		expect(info.modified).toBeTruthy()
	})
})
