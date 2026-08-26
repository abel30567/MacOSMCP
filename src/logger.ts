import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface AuditEntry {
	ts: number
	tool: string
	args_hash: string
	outcome: 'ok' | 'denied' | 'error'
	risk: string
	duration_ms?: number
	result_bytes?: number
	error?: string
}

const logDir = process.env.LOG_DIR ?? join(process.env.HOME ?? '/tmp', '.macos-mcp')
const logPath = join(logDir, 'audit.log')

let dirReady = false

async function ensureDir() {
	if (dirReady) return
	await mkdir(logDir, { recursive: true })
	dirReady = true
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
	await ensureDir()
	await appendFile(logPath, `${JSON.stringify(entry)}\n`)
}

export function hashArgs(args: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(args ?? {}))
		.digest('hex')
		.slice(0, 16)
}

export function measureResultBytes(value: unknown): number | undefined {
	if (value == null) return undefined
	try {
		return Buffer.byteLength(JSON.stringify(value))
	} catch {
		return undefined
	}
}
