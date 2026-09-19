import { execFile } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { defineTool } from './define-tool.js'
import { type OcrBox, buildKeystrokeCommand, ocrCenter } from './keys.js'

const exec = promisify(execFile)

const MAX_WIDTH = 1568

async function resizeIfNeeded(pngPath: string): Promise<void> {
	try {
		const { stdout } = await exec('sips', ['-g', 'pixelWidth', pngPath])
		const match = stdout.match(/pixelWidth:\s*(\d+)/)
		if (!match) return
		const width = Number.parseInt(match[1], 10)
		if (width > MAX_WIDTH) {
			await exec('sips', ['--resampleWidth', String(MAX_WIDTH), pngPath])
		}
	} catch {
		// sips not available or failed — skip resize
	}
}

export function registerScreenTools(server: McpServer): void {
	defineTool(server, {
		name: 'mac_screenshot',
		description: 'Capture a screenshot on macOS. Returns base64 PNG. Resized to max 1568px wide.',
		schema: {
			region: z.string().optional().describe('Region as "x,y,width,height" (e.g. "0,0,800,600")'),
			app: z.string().optional().describe('App name to capture its frontmost window'),
		},
		scope: ['read'],
		risk: 'low',
		handler: async (args) => {
			const tmpPath = join(tmpdir(), `macos-mcp-screenshot-${Date.now()}.png`)

			try {
				const captureArgs: string[] = ['-x', tmpPath]

				if (args.region) {
					captureArgs.unshift('-R', args.region)
				} else if (args.app) {
					const { stdout } = await exec('osascript', [
						'-e',
						`tell application "System Events" to get id of first window of (first process whose name is "${args.app}")`,
					])
					const windowId = stdout.trim()
					if (windowId) {
						captureArgs.unshift('-l', windowId)
					}
				}

				await exec('screencapture', captureArgs, { timeout: 10000 })
				await resizeIfNeeded(tmpPath)

				const data = await readFile(tmpPath)
				return {
					content: [
						{
							type: 'image' as const,
							data: data.toString('base64'),
							mimeType: 'image/png',
						},
					],
				}
			} finally {
				unlink(tmpPath).catch(() => {})
			}
		},
	})

	defineTool(server, {
		name: 'mac_screen_ocr',
		description:
			'Capture a screenshot and perform OCR using macOS Vision framework. Returns each text line with the screen-point x,y of its center (usable directly with mac_click).',
		schema: {
			region: z.string().optional().describe('Region as "x,y,width,height" (e.g. "0,0,800,600")'),
		},
		scope: ['read'],
		risk: 'low',
		handler: async (args) => {
			const tmpPath = join(tmpdir(), `macos-mcp-ocr-${Date.now()}.png`)

			try {
				const captureArgs: string[] = ['-x', tmpPath]
				if (args.region) captureArgs.unshift('-R', args.region)

				await exec('screencapture', captureArgs, { timeout: 10000 })

				const jxaScript = `
					ObjC.import('Vision')
					ObjC.import('AppKit')
					const img = $.NSImage.alloc.initWithContentsOfFile('${tmpPath}')
					// $() is nil — a JS null would be bridged as NSNull and crash Vision
					const cgImg = img.CGImageForProposedRectContextHints(null, $(), $())
					const req = $.VNRecognizeTextRequest.alloc.init
					req.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate
					const handler = $.VNImageRequestHandler.alloc.initWithCGImageOptions(cgImg, $.NSDictionary.dictionary)
					handler.performRequestsError($.NSArray.arrayWithObject(req), null)
					const results = req.results
					const boxes = []
					for (let i = 0; i < results.count; i++) {
						const obs = results.objectAtIndex(i)
						const b = obs.boundingBox
						boxes.push({
							text: obs.topCandidates(1).objectAtIndex(0).string.js,
							x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height,
						})
					}
					const f = $.NSScreen.mainScreen.frame
					JSON.stringify({ boxes, screen: { w: f.size.width, h: f.size.height } })
				`

				const { stdout } = await exec('osascript', ['-l', 'JavaScript', '-e', jxaScript], {
					timeout: 30000,
				})

				const { boxes, screen } = JSON.parse(stdout.trim()) as {
					boxes: OcrBox[]
					screen: { w: number; h: number }
				}
				const [rx, ry, rw, rh] = args.region?.split(',').map(Number) ?? []
				const region = args.region
					? { x: rx, y: ry, w: rw, h: rh }
					: { x: 0, y: 0, w: screen.w, h: screen.h }
				const lines = boxes.map((b) => ({ text: b.text, ...ocrCenter(b, region) }))
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								lines,
								full_text: lines.map((l) => l.text).join('\n'),
							}),
						},
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'ocr_failed',
								message: err instanceof Error ? err.message : String(err),
							}),
						},
					],
				}
			} finally {
				unlink(tmpPath).catch(() => {})
			}
		},
	})

	defineTool(server, {
		name: 'mac_clipboard_get',
		description: 'Read the macOS clipboard contents. Text or image (as base64 PNG).',
		schema: {
			format: z
				.enum(['text', 'image'])
				.optional()
				.default('text')
				.describe('Format to read (default: text)'),
		},
		scope: ['read'],
		risk: 'low',
		handler: async (args) => {
			if (args.format === 'image') {
				const tmpPath = join(tmpdir(), `macos-mcp-clipboard-${Date.now()}.png`)
				try {
					const jxa = `
						ObjC.import('AppKit')
						const pb = $.NSPasteboard.generalPasteboard
						const img = $.NSImage.alloc.initWithPasteboardData(pb)
						if (img.isNil()) { 'no_image' } else {
							const rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation)
							const png = rep.representationUsingTypeProperties($.NSBitmapImageRepPNGFileType, null)
							png.writeToFileAtomically('${tmpPath}', true)
							'ok'
						}
					`
					const { stdout } = await exec('osascript', ['-l', 'JavaScript', '-e', jxa])
					if (stdout.trim() === 'no_image') {
						return {
							content: [{ type: 'text', text: JSON.stringify({ error: 'no_image_on_clipboard' }) }],
						}
					}
					const data = await readFile(tmpPath)
					return {
						content: [
							{ type: 'image' as const, data: data.toString('base64'), mimeType: 'image/png' },
						],
					}
				} finally {
					unlink(tmpPath).catch(() => {})
				}
			}

			const { stdout } = await exec('pbpaste', [], { timeout: 5000 })
			return { content: [{ type: 'text', text: stdout }] }
		},
	})

	defineTool(server, {
		name: 'mac_clipboard_set',
		description: 'Set the macOS clipboard to the given text.',
		schema: {
			text: z.string().describe('Text to copy to clipboard'),
		},
		scope: ['write'],
		risk: 'low',
		handler: async (args) => {
			const child = require('node:child_process').spawn('pbcopy')
			child.stdin.write(args.text)
			child.stdin.end()
			await new Promise<void>((resolve) => child.on('close', resolve))
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ ok: true, length: args.text.length }),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_notification',
		description: 'Display a native macOS notification.',
		schema: {
			title: z.string().describe('Notification title'),
			message: z.string().describe('Notification message'),
			sound: z.boolean().optional().default(false).describe('Play notification sound'),
		},
		scope: ['system'],
		risk: 'low',
		handler: async (args) => {
			const soundClause = args.sound ? ' sound name "default"' : ''
			const script = `display notification "${args.message.replace(/"/g, '\\"')}" with title "${args.title.replace(/"/g, '\\"')}"${soundClause}`
			await exec('osascript', ['-e', script], { timeout: 5000 })
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ ok: true, title: args.title }),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_open',
		description: 'Open a file, URL, or application using the macOS open command.',
		schema: {
			target: z.string().describe('File path, URL, or app name to open'),
			app: z.string().optional().describe('Specific app to open with (e.g. "Safari")'),
		},
		scope: ['system'],
		risk: 'med',
		handler: async (args) => {
			const openArgs = args.app ? ['-a', args.app, args.target] : [args.target]
			await exec('open', openArgs, { timeout: 10000 })
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ ok: true, target: args.target }),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_chrome_open',
		description:
			'Open a URL in a plain Google Chrome window on a named persistent profile — no debug port, no automation flags. Shares profiles with mac_browser_launch labels. Drive it with mac_click / mac_keystroke / mac_screen_ocr. Use for sites whose bot detection flags CDP-driven browsers.',
		schema: {
			label: z
				.string()
				.regex(/^[a-zA-Z0-9_-]+$/)
				.describe('Profile label (same namespace as mac_browser_launch)'),
			url: z.string().url().describe('URL to open'),
		},
		scope: ['system'],
		risk: 'med',
		handler: async (args) => {
			const userDataDir = `${process.env.HOME}/.macos-mcp/browser-profiles/${args.label}`
			const findMain = async () => {
				const { stdout } = await exec('ps', ['-axo', 'pid=,command='])
				return stdout
					.split('\n')
					.filter(
						(l) =>
							l.includes(`--user-data-dir=${userDataDir} `) ||
							l.endsWith(`--user-data-dir=${userDataDir}`),
					)
					.filter((l) => !l.includes('Helper'))
			}

			if ((await findMain()).some((l) => l.includes('--remote-debugging'))) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'profile_in_cdp_session',
								message: `Profile "${args.label}" is open under mac_browser_launch. Close it with mac_browser_close first.`,
							}),
						},
					],
				}
			}

			await exec(
				'open',
				[
					'-na',
					'Google Chrome',
					'--args',
					`--user-data-dir=${userDataDir}`,
					'--no-first-run',
					'--no-default-browser-check',
					args.url,
				],
				{ timeout: 10000 },
			)

			// Two Chrome instances share one app name, so focus this one by pid.
			await new Promise((r) => setTimeout(r, 1500))
			const pid = (await findMain())[0]?.trim().split(/\s+/)[0]
			if (pid) {
				await exec('osascript', [
					'-e',
					`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
				])
			}

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ ok: true, label: args.label, url: args.url, pid: pid ?? null }),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_keystroke',
		description: 'Simulate keyboard input on macOS via AppleScript System Events.',
		schema: {
			keys: z
				.string()
				.describe(
					'Text to type, or a named key sent as a key code: return, enter, tab, space, delete, forwarddelete, escape, left, right, up, down, home, end, pageup, pagedown',
				),
			modifiers: z
				.array(z.enum(['command', 'option', 'control', 'shift']))
				.optional()
				.describe('Modifier keys to hold'),
			app: z.string().optional().describe('Target application name'),
			human: z
				.boolean()
				.optional()
				.default(false)
				.describe('Type text one character at a time with randomized human-like delays'),
		},
		scope: ['system'],
		risk: 'high',
		handler: async (args) => {
			const keystrokeCmd = buildKeystrokeCommand(args.keys, args.modifiers, args.human)
			const events = `tell application "System Events"\n${keystrokeCmd}\nend tell`
			const script = args.app
				? `tell application "${args.app}" to activate\ndelay 0.3\n${events}`
				: events

			await exec('osascript', ['-e', script], { timeout: 60000 })
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ ok: true, keys: args.keys, app: args.app ?? null }),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_click',
		description: 'Click at screen coordinates using cliclick.',
		schema: {
			x: z.number().describe('X coordinate'),
			y: z.number().describe('Y coordinate'),
			button: z
				.enum(['left', 'right', 'middle'])
				.optional()
				.default('left')
				.describe('Mouse button'),
			double: z.boolean().optional().default(false).describe('Double click'),
			human: z
				.boolean()
				.optional()
				.default(false)
				.describe('Glide the pointer to the target with easing and pause before clicking'),
		},
		scope: ['system'],
		risk: 'high',
		handler: async (args) => {
			const action = args.double ? 'dc' : args.button === 'right' ? 'rc' : 'c'
			try {
				const at = `${args.x},${args.y}`
				const cliArgs = args.human
					? ['-e', '400', `m:${at}`, 'w:300', `${action}:${at}`]
					: [`${action}:${at}`]
				await exec('cliclick', cliArgs, { timeout: 10000 })
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ ok: true, x: args.x, y: args.y, button: args.button }),
						},
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'click_failed',
								message: err instanceof Error ? err.message : String(err),
								hint: 'Install cliclick: brew install cliclick',
							}),
						},
					],
				}
			}
		},
	})

	defineTool(server, {
		name: 'mac_app_list',
		description: 'List currently running applications on macOS.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		handler: async () => {
			const { stdout } = await exec('osascript', [
				'-e',
				'tell application "System Events" to get name of every application process whose background only is false',
			])
			const apps = stdout.trim().split(', ').filter(Boolean)
			return {
				content: [{ type: 'text', text: JSON.stringify({ apps, count: apps.length }) }],
			}
		},
	})

	defineTool(server, {
		name: 'mac_app_activate',
		description: 'Bring an application to the foreground on macOS.',
		schema: {
			name: z.string().describe('Application name to activate'),
		},
		scope: ['system'],
		risk: 'low',
		handler: async (args) => {
			await exec('osascript', ['-e', `tell application "${args.name}" to activate`], {
				timeout: 5000,
			})
			return {
				content: [{ type: 'text', text: JSON.stringify({ ok: true, app: args.name }) }],
			}
		},
	})
}
