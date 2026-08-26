import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { hashArgs, measureResultBytes, writeAudit } from '../logger.js'

export type ToolScope = 'read' | 'write' | 'shell' | 'system'
export type RiskLevel = 'low' | 'med' | 'high'

export type ContentItem =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string }

export interface ToolDef<T extends Record<string, z.ZodType>> {
	name: string
	description: string
	schema: T
	scope: ToolScope[]
	risk: RiskLevel
	handler: (args: z.infer<z.ZodObject<T>>) => Promise<{
		content: ContentItem[]
	}>
}

export function defineTool<T extends Record<string, z.ZodType>>(
	server: McpServer,
	def: ToolDef<T>,
): void {
	const isReadOnly = def.scope.every((s) => s === 'read')

	const wrappedHandler = async (args: Record<string, unknown>) => {
		const startedAt = Date.now()
		const argsHash = hashArgs(args)

		try {
			const result = await def.handler(args as z.infer<z.ZodObject<T>>)
			writeAudit({
				ts: Date.now(),
				tool: def.name,
				args_hash: argsHash,
				outcome: 'ok',
				risk: def.risk,
				duration_ms: Date.now() - startedAt,
				result_bytes: measureResultBytes(result),
			}).catch(() => {})
			return result
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			writeAudit({
				ts: Date.now(),
				tool: def.name,
				args_hash: argsHash,
				outcome: 'error',
				risk: def.risk,
				duration_ms: Date.now() - startedAt,
				error: message,
			}).catch(() => {})
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
			}
		}
	}

	server.registerTool(
		def.name,
		{
			description: def.description,
			inputSchema: def.schema,
			annotations: {
				readOnlyHint: isReadOnly,
				destructiveHint: def.risk === 'high',
			},
		},
		// biome-ignore lint/suspicious/noExplicitAny: generic MCP callback bridge
		wrappedHandler as any,
	)
}
