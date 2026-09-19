// Named keys that must be sent as key codes — `keystroke "return"` would type the word.
export const KEY_CODES: Record<string, number> = {
	return: 36,
	enter: 76,
	tab: 48,
	space: 49,
	delete: 51,
	forwarddelete: 117,
	escape: 53,
	left: 123,
	right: 124,
	down: 125,
	up: 126,
	home: 115,
	end: 119,
	pageup: 116,
	pagedown: 121,
}

const escapeAppleScript = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Build the System Events command(s) for mac_keystroke. */
export function buildKeystrokeCommand(keys: string, modifiers?: string[], human = false): string {
	const modStr = modifiers?.length ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}` : ''

	const code = KEY_CODES[keys.toLowerCase()]
	if (code !== undefined) return `key code ${code}${modStr}`

	if (human && !modStr) {
		return [
			`repeat with ch in characters of "${escapeAppleScript(keys)}"`,
			'keystroke ch',
			'delay (0.07 + (random number from 0 to 13) / 100)',
			'end repeat',
		].join('\n')
	}

	return `keystroke "${escapeAppleScript(keys)}"${modStr}`
}

export interface OcrBox {
	text: string
	x: number
	y: number
	w: number
	h: number
}

/**
 * Convert a Vision bounding box (normalized, origin bottom-left) into the screen-point
 * center of the text, given the captured region in points.
 */
export function ocrCenter(
	box: OcrBox,
	region: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
	return {
		x: Math.round(region.x + (box.x + box.w / 2) * region.w),
		y: Math.round(region.y + (1 - box.y - box.h / 2) * region.h),
	}
}
