import { execFile } from 'node:child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { defineTool } from './define-tool.js'

function execScript(
	lang: 'AppleScript' | 'JavaScript',
	script: string,
	timeoutMs: number,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
	const args = lang === 'JavaScript' ? ['-l', 'JavaScript', '-e', script] : ['-e', script]

	return new Promise((resolve) => {
		execFile(
			'/usr/bin/osascript',
			args,
			{ timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error?.killed) {
					resolve({
						content: [
							{
								type: 'text',
								text: JSON.stringify({
									error: 'timeout',
									message: `Script timed out after ${timeoutMs}ms`,
								}),
							},
						],
					})
					return
				}

				resolve({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								stdout: stdout.trim(),
								stderr: stderr.trim(),
								exitCode: error ? 1 : 0,
							}),
						},
					],
				})
			},
		)
	})
}

export function registerAppleScriptTools(server: McpServer): void {
	defineTool(server, {
		name: 'mac_applescript',
		description: 'Execute an AppleScript via osascript on macOS. Returns the script output.',
		schema: {
			script: z.string().describe('The AppleScript code to execute'),
			timeout_ms: z
				.number()
				.optional()
				.default(30000)
				.describe('Timeout in milliseconds (default: 30000)'),
		},
		scope: ['system'],
		risk: 'high',
		handler: async (args) => execScript('AppleScript', args.script, args.timeout_ms),
	})

	defineTool(server, {
		name: 'mac_jxa',
		description:
			'Execute JavaScript for Automation (JXA) via osascript on macOS. Returns the script output.',
		schema: {
			script: z.string().describe('The JXA code to execute'),
			timeout_ms: z
				.number()
				.optional()
				.default(30000)
				.describe('Timeout in milliseconds (default: 30000)'),
		},
		scope: ['system'],
		risk: 'high',
		handler: async (args) => execScript('JavaScript', args.script, args.timeout_ms),
	})
}
