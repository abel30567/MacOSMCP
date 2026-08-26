import { afterAll, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { hashArgs, measureResultBytes, writeAudit } from '../../src/logger.js'

describe('hashArgs', () => {
	test('returns a hex string', () => {
		const hash = hashArgs({ command: 'echo hello' })
		expect(hash).toMatch(/^[0-9a-f]{16}$/)
	})

	test('same input produces same hash', () => {
		const a = hashArgs({ foo: 'bar' })
		const b = hashArgs({ foo: 'bar' })
		expect(a).toBe(b)
	})

	test('different input produces different hash', () => {
		const a = hashArgs({ foo: 'bar' })
		const b = hashArgs({ foo: 'baz' })
		expect(a).not.toBe(b)
	})

	test('handles null/undefined', () => {
		expect(hashArgs(null)).toMatch(/^[0-9a-f]{16}$/)
		expect(hashArgs(undefined)).toMatch(/^[0-9a-f]{16}$/)
	})
})

describe('measureResultBytes', () => {
	test('returns byte length of JSON', () => {
		const result = measureResultBytes({ content: [{ type: 'text', text: 'hello' }] })
		expect(result).toBeGreaterThan(0)
		expect(typeof result).toBe('number')
	})

	test('returns undefined for null/undefined', () => {
		expect(measureResultBytes(null)).toBeUndefined()
		expect(measureResultBytes(undefined)).toBeUndefined()
	})

	test('handles empty objects', () => {
		expect(measureResultBytes({})).toBe(2) // "{}"
	})
})

describe('writeAudit', () => {
	const logDir = process.env.LOG_DIR ?? join(process.env.HOME ?? '/tmp', '.macos-mcp')
	const logPath = join(logDir, 'audit.log')

	afterAll(async () => {
		// Clean up test entries by removing the audit log
		await rm(logPath, { force: true })
	})

	test('writes JSONL entries to the configured log file', async () => {
		const marker = `test-${Date.now()}`
		const entry = {
			ts: Date.now(),
			tool: marker,
			args_hash: 'abc123',
			outcome: 'ok' as const,
			risk: 'low',
			duration_ms: 42,
		}

		await writeAudit(entry)

		const content = await readFile(logPath, 'utf8')
		const lines = content.trim().split('\n')
		const lastLine = JSON.parse(lines[lines.length - 1])
		expect(lastLine.tool).toBe(marker)
		expect(lastLine.outcome).toBe('ok')
		expect(lastLine.duration_ms).toBe(42)
	})
})
