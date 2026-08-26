import { describe, expect, mock, test } from 'bun:test'
import { createBearerAuth } from '../../src/auth.js'

function createMockReqRes(authHeader?: string) {
	// biome-ignore lint/suspicious/noExplicitAny: mock Express objects
	const req = { headers: { authorization: authHeader } } as any

	const statusCode = { value: 200 }
	// biome-ignore lint/suspicious/noExplicitAny: mock state
	const jsonBody = { value: null as any }
	const res = {
		status(code: number) {
			statusCode.value = code
			return res
		},
		// biome-ignore lint/suspicious/noExplicitAny: mock Express json
		json(body: any) {
			jsonBody.value = body
		},
		// biome-ignore lint/suspicious/noExplicitAny: mock Express Response
	} as any

	return { req, res, statusCode, jsonBody }
}

describe('createBearerAuth', () => {
	const TOKEN = 'test-secret-token-12345'
	const middleware = createBearerAuth(TOKEN)

	test('calls next() with valid token', () => {
		const { req, res } = createMockReqRes(`Bearer ${TOKEN}`)
		const next = mock(() => {})

		middleware(req, res, next)
		expect(next).toHaveBeenCalledTimes(1)
	})

	test('returns 401 with wrong token', () => {
		const { req, res, statusCode, jsonBody } = createMockReqRes('Bearer wrong-token')
		const next = mock(() => {})

		middleware(req, res, next)
		expect(next).not.toHaveBeenCalled()
		expect(statusCode.value).toBe(401)
		expect(jsonBody.value.error).toBe('Invalid token')
	})

	test('returns 401 with missing Authorization header', () => {
		const { req, res, statusCode, jsonBody } = createMockReqRes(undefined)
		const next = mock(() => {})

		middleware(req, res, next)
		expect(next).not.toHaveBeenCalled()
		expect(statusCode.value).toBe(401)
		expect(jsonBody.value.error).toContain('Missing')
	})

	test('returns 401 with non-Bearer scheme', () => {
		const { req, res, statusCode } = createMockReqRes('Basic dXNlcjpwYXNz')
		const next = mock(() => {})

		middleware(req, res, next)
		expect(next).not.toHaveBeenCalled()
		expect(statusCode.value).toBe(401)
	})

	test('returns 401 with empty Bearer value', () => {
		const { req, res, statusCode } = createMockReqRes('Bearer ')
		const next = mock(() => {})

		middleware(req, res, next)
		expect(next).not.toHaveBeenCalled()
		expect(statusCode.value).toBe(401)
	})

	test('rejects tokens of different length (timing-safe)', () => {
		const { req, res, statusCode } = createMockReqRes('Bearer short')
		const next = mock(() => {})

		middleware(req, res, next)
		expect(next).not.toHaveBeenCalled()
		expect(statusCode.value).toBe(401)
	})
})
