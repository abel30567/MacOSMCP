import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Browser, Page } from 'rebrowser-puppeteer-core'
import { z } from 'zod'
import { defineTool } from './define-tool.js'

interface BrowserSession {
	id: string
	browser: Browser
	page: Page
	label: string
	createdAt: number
}

const sessions = new Map<string, BrowserSession>()

const SESSION_TIMEOUT_MS = 30 * 60 * 1000

function cleanupStaleSessions() {
	const now = Date.now()
	for (const [id, session] of sessions) {
		if (now - session.createdAt > SESSION_TIMEOUT_MS) {
			session.browser.close().catch(() => {})
			sessions.delete(id)
		}
	}
}

function getSession(sessionId: string): BrowserSession | null {
	return sessions.get(sessionId) ?? null
}

const ActionSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('goto'),
		url: z.string(),
		waitUntil: z
			.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2'])
			.optional()
			.default('domcontentloaded'),
	}),
	z.object({
		type: z.literal('click'),
		selector: z.string(),
	}),
	z.object({
		type: z.literal('type'),
		selector: z.string(),
		text: z.string(),
		delay: z.number().optional().default(50),
	}),
	z.object({
		type: z.literal('select'),
		selector: z.string(),
		values: z.array(z.string()),
	}),
	z.object({
		type: z.literal('hover'),
		selector: z.string(),
	}),
	z.object({
		type: z.literal('scrollTo'),
		x: z.number().optional().default(0),
		y: z.number(),
	}),
	z.object({
		type: z.literal('waitFor'),
		selector: z.string().optional(),
		timeout: z.number().optional().default(10000),
	}),
	z.object({
		type: z.literal('screenshot'),
		fullPage: z.boolean().optional().default(false),
		selector: z.string().optional(),
	}),
	z.object({
		type: z.literal('extract'),
		selector: z.string(),
		attribute: z.string().optional(),
	}),
	z.object({
		type: z.literal('evaluate'),
		script: z.string(),
	}),
	z.object({
		type: z.literal('getCookies'),
	}),
	z.object({
		type: z.literal('setCookies'),
		cookies: z.array(
			z.object({
				name: z.string(),
				value: z.string(),
				domain: z.string().optional(),
				path: z.string().optional(),
				httpOnly: z.boolean().optional(),
				secure: z.boolean().optional(),
			}),
		),
	}),
	z.object({
		type: z.literal('wait'),
		ms: z.number(),
	}),
])

type BrowserAction = z.infer<typeof ActionSchema>

async function executeAction(
	page: Page,
	action: BrowserAction,
): Promise<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
	switch (action.type) {
		case 'goto': {
			const response = await page.goto(action.url, { waitUntil: action.waitUntil })
			return {
				type: 'text',
				text: JSON.stringify({
					action: 'goto',
					url: action.url,
					status: response?.status() ?? null,
				}),
			}
		}

		case 'click': {
			await page.click(action.selector)
			return {
				type: 'text',
				text: JSON.stringify({ action: 'click', selector: action.selector }),
			}
		}

		case 'type': {
			await page.type(action.selector, action.text, { delay: action.delay })
			return {
				type: 'text',
				text: JSON.stringify({ action: 'type', selector: action.selector }),
			}
		}

		case 'select': {
			const selected = await page.select(action.selector, ...action.values)
			return {
				type: 'text',
				text: JSON.stringify({ action: 'select', selector: action.selector, selected }),
			}
		}

		case 'hover': {
			await page.hover(action.selector)
			return {
				type: 'text',
				text: JSON.stringify({ action: 'hover', selector: action.selector }),
			}
		}

		case 'scrollTo': {
			await page.evaluate((x: number, y: number) => window.scrollTo(x, y), action.x, action.y)
			return {
				type: 'text',
				text: JSON.stringify({ action: 'scrollTo', x: action.x, y: action.y }),
			}
		}

		case 'waitFor': {
			if (action.selector) {
				await page.waitForSelector(action.selector, { timeout: action.timeout })
			} else {
				await new Promise((r) => setTimeout(r, action.timeout))
			}
			return {
				type: 'text',
				text: JSON.stringify({
					action: 'waitFor',
					selector: action.selector ?? null,
					timeout: action.timeout,
				}),
			}
		}

		case 'screenshot': {
			let screenshot: string
			if (action.selector) {
				const el = await page.$(action.selector)
				if (!el) throw new Error(`Element not found: ${action.selector}`)
				screenshot = (await el.screenshot({ encoding: 'base64' })) as string
			} else {
				screenshot = (await page.screenshot({
					encoding: 'base64',
					fullPage: action.fullPage,
				})) as string
			}
			return { type: 'image', data: screenshot, mimeType: 'image/png' }
		}

		case 'extract': {
			const elements = await page.$$(action.selector)
			const results = await Promise.all(
				elements.slice(0, 100).map(async (el) => {
					if (action.attribute) {
						return page.evaluate(
							(e: Element, attr: string) => e.getAttribute(attr),
							el,
							action.attribute,
						)
					}
					return page.evaluate((e: Element) => e.textContent?.trim() ?? '', el)
				}),
			)
			return {
				type: 'text',
				text: JSON.stringify({ action: 'extract', selector: action.selector, results }),
			}
		}

		case 'evaluate': {
			const result = await page.evaluate(action.script)
			return {
				type: 'text',
				text: JSON.stringify({ action: 'evaluate', result }),
			}
		}

		case 'getCookies': {
			const cookies = await page.cookies()
			return {
				type: 'text',
				text: JSON.stringify({ action: 'getCookies', cookies }),
			}
		}

		case 'setCookies': {
			await page.setCookie(...action.cookies)
			return {
				type: 'text',
				text: JSON.stringify({ action: 'setCookies', count: action.cookies.length }),
			}
		}

		case 'wait': {
			await new Promise((r) => setTimeout(r, action.ms))
			return {
				type: 'text',
				text: JSON.stringify({ action: 'wait', ms: action.ms }),
			}
		}
	}
}

export function registerBrowserTools(server: McpServer): void {
	defineTool(server, {
		name: 'mac_browser_launch',
		description:
			'Launches a real (non-headless) Chrome session with a persistent profile; handles Cloudflare Turnstile interactive challenges via puppeteer-real-browser. Intended for automating sites you own or are authorized to use. Returns a session_id for use with other browser tools.',
		schema: {
			label: z
				.string()
				.optional()
				.default('default')
				.describe('Label for this session (used for userDataDir persistence)'),
			headless: z
				.boolean()
				.optional()
				.default(false)
				.describe('Run in headless mode (default: false, recommended for interactive challenge handling)'),
			proxy: z.string().optional().describe('Proxy URL (e.g. socks5://127.0.0.1:1080)'),
		},
		scope: ['system'],
		risk: 'high',
		handler: async (args) => {
			cleanupStaleSessions()

			const { connect } = await import('puppeteer-real-browser')
			const userDataDir = `${process.env.HOME}/.macos-mcp/browser-profiles/${args.label}`
			await mkdir(userDataDir, { recursive: true })

			const connectOpts: Record<string, unknown> = {
				headless: args.headless,
				turnstile: true,
				customConfig: { userDataDir },
				args: ['--no-first-run', '--disable-default-apps'],
			}

			if (args.proxy) {
				connectOpts.proxy = { host: args.proxy }
			}

			const { browser, page } = await connect(connectOpts)

			const id = randomUUID()
			sessions.set(id, {
				id,
				browser: browser as Browser,
				page: page as Page,
				label: args.label,
				createdAt: Date.now(),
			})

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							session_id: id,
							label: args.label,
							headless: args.headless,
							userDataDir,
						}),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_browser_action',
		description:
			'Execute one or more actions in a browser session. Actions run sequentially. Supported: goto, click, type, select, hover, scrollTo, waitFor, screenshot, extract, evaluate, getCookies, setCookies, wait.',
		schema: {
			session_id: z.string().describe('Browser session ID from mac_browser_launch'),
			actions: z.array(ActionSchema).min(1).describe('Array of actions to execute sequentially'),
		},
		scope: ['shell'],
		risk: 'high',
		handler: async (args) => {
			const session = getSession(args.session_id)
			if (!session) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'session_not_found',
								session_id: args.session_id,
							}),
						},
					],
				}
			}

			const results: Array<
				{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
			> = []

			for (const action of args.actions) {
				try {
					const result = await executeAction(session.page, action)
					results.push(result)
				} catch (err) {
					results.push({
						type: 'text',
						text: JSON.stringify({
							action: action.type,
							error: err instanceof Error ? err.message : String(err),
						}),
					})
					break
				}
			}

			return { content: results }
		},
	})

	defineTool(server, {
		name: 'mac_browser_close',
		description: 'Close a browser session and clean up resources.',
		schema: {
			session_id: z.string().describe('Browser session ID to close'),
		},
		scope: ['system'],
		risk: 'med',
		handler: async (args) => {
			const session = getSession(args.session_id)
			if (!session) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'session_not_found',
								session_id: args.session_id,
							}),
						},
					],
				}
			}

			await session.browser.close()
			sessions.delete(args.session_id)

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							ok: true,
							session_id: args.session_id,
							label: session.label,
						}),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_browser_list',
		description: 'List all active browser sessions.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		handler: async () => {
			cleanupStaleSessions()

			const list = Array.from(sessions.values()).map((s) => ({
				session_id: s.id,
				label: s.label,
				createdAt: new Date(s.createdAt).toISOString(),
				age_minutes: Math.round((Date.now() - s.createdAt) / 60000),
				url: '',
			}))

			for (const entry of list) {
				const session = sessions.get(entry.session_id)
				if (session) {
					try {
						entry.url = session.page.url()
					} catch {
						entry.url = 'unknown'
					}
				}
			}

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ sessions: list, count: list.length }),
					},
				],
			}
		},
	})
}
