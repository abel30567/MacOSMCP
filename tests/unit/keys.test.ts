import { describe, expect, test } from 'bun:test'
import { buildKeystrokeCommand, ocrCenter } from '../../src/tools/keys.js'

describe('buildKeystrokeCommand', () => {
	test('named keys become key codes instead of typed text', () => {
		expect(buildKeystrokeCommand('return')).toBe('key code 36')
		expect(buildKeystrokeCommand('Down')).toBe('key code 125')
	})

	test('named keys keep modifiers', () => {
		expect(buildKeystrokeCommand('tab', ['command', 'shift'])).toBe(
			'key code 48 using {command down, shift down}',
		)
	})

	test('plain text is typed and escaped', () => {
		expect(buildKeystrokeCommand('say "hi"\\')).toBe('keystroke "say \\"hi\\"\\\\"')
		expect(buildKeystrokeCommand('l', ['command'])).toBe('keystroke "l" using {command down}')
	})

	test('human mode types character by character with random delays', () => {
		const cmd = buildKeystrokeCommand('milk', undefined, true)
		expect(cmd).toContain('repeat with ch in characters of "milk"')
		expect(cmd).toContain('random number')
	})

	test('human mode is ignored for shortcuts', () => {
		expect(buildKeystrokeCommand('a', ['command'], true)).toBe('keystroke "a" using {command down}')
	})
})

describe('ocrCenter', () => {
	test('flips the bottom-left origin and scales to full-screen points', () => {
		const box = { text: 'Add', x: 0.25, y: 0.5, w: 0.5, h: 0.1 }
		expect(ocrCenter(box, { x: 0, y: 0, w: 1000, h: 500 })).toEqual({ x: 500, y: 225 })
	})

	test('offsets by the captured region', () => {
		const box = { text: 'Add', x: 0, y: 0, w: 1, h: 1 }
		expect(ocrCenter(box, { x: 100, y: 200, w: 50, h: 20 })).toEqual({ x: 125, y: 210 })
	})
})
