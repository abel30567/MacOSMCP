import { execFile } from 'node:child_process'
import { cpus, freemem, hostname, totalmem, uptime } from 'node:os'
import { promisify } from 'node:util'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './define-tool.js'

const exec = promisify(execFile)

export function registerSystemTools(server: McpServer): void {
	defineTool(server, {
		name: 'mac_system_info',
		description: 'Get macOS system information: hostname, OS version, CPU, memory, disk, uptime',
		schema: {},
		scope: ['read'],
		risk: 'low',
		handler: async () => {
			const cpuInfo = cpus()
			let macosVersion = 'unknown'
			try {
				const { stdout } = await exec('sw_vers', ['-productVersion'])
				macosVersion = stdout.trim()
			} catch {}

			let diskInfo = 'unknown'
			try {
				const { stdout } = await exec('df', ['-h', '/'])
				diskInfo = stdout.trim()
			} catch {}

			const info = {
				hostname: hostname(),
				macos_version: macosVersion,
				cpu: {
					model: cpuInfo[0]?.model ?? 'unknown',
					cores: cpuInfo.length,
				},
				memory: {
					total_gb: +(totalmem() / 1073741824).toFixed(1),
					free_gb: +(freemem() / 1073741824).toFixed(1),
				},
				disk: diskInfo,
				uptime_hours: +(uptime() / 3600).toFixed(1),
			}

			return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
		},
	})
}
