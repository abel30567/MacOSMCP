import { execFile } from 'node:child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getAllowedPaths, isBlocked, isPathAllowed } from '../safety.js'
import { defineTool } from './define-tool.js'

export function registerShellTools(server: McpServer): void {
	defineTool(server, {
		name: 'mac_shell',
		description:
			'Execute a shell command via /bin/zsh on macOS. Returns stdout, stderr, and exit code.',
		schema: {
			command: z.string().describe('The shell command to execute'),
			cwd: z.string().optional().describe('Working directory for the command'),
			timeout_ms: z
				.number()
				.optional()
				.default(30000)
				.describe('Timeout in milliseconds (default: 30000)'),
			env: z
				.record(z.string())
				.optional()
				.describe('Additional environment variables for the command'),
		},
		scope: ['shell'],
		risk: 'high',
		handler: async (args) => {
			const blockCheck = isBlocked(args.command)
			if (blockCheck.blocked) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'blocked',
								rule: blockCheck.rule,
							}),
						},
					],
				}
			}

			if (args.cwd) {
				const pathCheck = isPathAllowed(args.cwd, getAllowedPaths())
				if (!pathCheck.allowed) {
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify({ error: 'path_denied', reason: pathCheck.reason }),
							},
						],
					}
				}
			}

			return new Promise((resolve) => {
				const child = execFile(
					'/bin/zsh',
					['-c', args.command],
					{
						cwd: args.cwd,
						timeout: args.timeout_ms,
						maxBuffer: 10 * 1024 * 1024,
						env: args.env ? { ...process.env, ...args.env } : undefined,
					},
					(error, stdout, stderr) => {
						const exitCode =
							error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
								? 1
								: (child.exitCode ?? (error ? 1 : 0))

						resolve({
							content: [
								{
									type: 'text',
									text: JSON.stringify({ stdout, stderr, exitCode }),
								},
							],
						})
					},
				)
			})
		},
	})
}
