import { randomUUID } from 'node:crypto'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { createBearerAuth } from './auth.js'
import { registerAllTools } from './tools/index.js'

function createServer(): McpServer {
	const server = new McpServer(
		{ name: 'macos-mcp', version: '0.1.0' },
		{ capabilities: { tools: {} } },
	)
	registerAllTools(server)
	return server
}

const isStdio = process.argv.includes('--stdio')

if (isStdio) {
	const server = createServer()
	const transport = new StdioServerTransport()
	await server.connect(transport)
} else {
	const PORT = Number(process.env.PORT ?? 3847)
	const TOKEN = process.env.AGENT_TOKEN

	if (!TOKEN) {
		console.error('AGENT_TOKEN environment variable is required. See .env.example')
		process.exit(1)
	}

	const tunnelHost = process.env.TUNNEL_HOSTNAME
	if (!tunnelHost) {
		console.error('TUNNEL_HOSTNAME environment variable is required. See .env.example')
		process.exit(1)
	}
	const app = createMcpExpressApp({
		host: '127.0.0.1',
		allowedHosts: ['127.0.0.1', tunnelHost],
	})
	const bearerAuth = createBearerAuth(TOKEN)

	const transports = new Map<string, StreamableHTTPServerTransport | SSEServerTransport>()

	app.get('/health', (_req: Request, res: Response) => {
		res.json({
			ok: true,
			version: '0.1.0',
			uptime: process.uptime(),
			tools: 26,
		})
	})

	app.post('/mcp', bearerAuth, async (req: Request, res: Response) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined

		const existing = sessionId ? transports.get(sessionId) : undefined
		if (existing) {
			await (existing as StreamableHTTPServerTransport).handleRequest(req, res, req.body)
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

		const server = createServer()
		await server.connect(transport)
		await transport.handleRequest(req, res, req.body)
	})

	app.get('/mcp', bearerAuth, async (req: Request, res: Response) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined
		const transport = sessionId ? transports.get(sessionId) : undefined
		if (!transport) {
			res.status(400).json({ error: 'Invalid or missing session ID' })
			return
		}
		await (transport as StreamableHTTPServerTransport).handleRequest(req, res)
	})

	app.delete('/mcp', bearerAuth, async (req: Request, res: Response) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined
		const transport = sessionId ? transports.get(sessionId) : undefined
		if (!transport) {
			res.status(400).json({ error: 'Invalid or missing session ID' })
			return
		}
		await (transport as StreamableHTTPServerTransport).handleRequest(req, res)
	})

	app.get('/sse', bearerAuth, async (_req: Request, res: Response) => {
		const transport = new SSEServerTransport('/messages', res)
		transports.set(transport.sessionId, transport)

		transport.onclose = () => {
			transports.delete(transport.sessionId)
		}

		const server = createServer()
		await server.connect(transport)
		await transport.start()
	})

	app.post('/messages', bearerAuth, async (req: Request, res: Response) => {
		const sessionId = req.query.sessionId as string | undefined
		const transport = sessionId ? transports.get(sessionId) : undefined
		if (!transport) {
			res.status(400).json({ error: 'Invalid or missing session ID' })
			return
		}
		await (transport as SSEServerTransport).handlePostMessage(req, res, req.body)
	})

	app.listen(PORT, '127.0.0.1', () => {
		console.log(`MacOSMCP server running at http://127.0.0.1:${PORT}`)
		console.log('  Streamable HTTP: POST/GET/DELETE /mcp')
		console.log('  Legacy SSE:      GET /sse, POST /messages')
		console.log('  Health:          GET /health')
	})
}
