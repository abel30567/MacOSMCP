import { realpathSync } from 'node:fs'
import { basename, dirname, join, normalize, resolve } from 'node:path'

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
	{ pattern: /\bsudo\b/, rule: 'sudo is not allowed' },
	{ pattern: /\brm\s+(-[^\s]*\s+)*-rf?\s+\/\s*$/, rule: 'rm -rf / is not allowed' },
	{ pattern: /\brm\s+(-[^\s]*\s+)*-rf?\s+~\s*$/, rule: 'rm -rf ~ is not allowed' },
	{ pattern: /\bmkfs\b/, rule: 'mkfs is not allowed' },
	{ pattern: /\bdd\b.*\bof=\/dev\//, rule: 'dd to device is not allowed' },
	{ pattern: />\s*\/dev\/sd/, rule: 'writing to raw device is not allowed' },
	{ pattern: /\bshutdown\b/, rule: 'shutdown is not allowed' },
	{ pattern: /\breboot\b/, rule: 'reboot is not allowed' },
	{ pattern: /\bhalt\b/, rule: 'halt is not allowed' },
	{ pattern: /\bpoweroff\b/, rule: 'poweroff is not allowed' },
	{ pattern: /\bdiskutil\s+erase/, rule: 'diskutil erase is not allowed' },
	{ pattern: /\bcsrutil\b/, rule: 'csrutil is not allowed' },
	{ pattern: />\s*\/System\//, rule: 'writing to /System is not allowed' },
	{ pattern: /\blaunchctl\s+unload\b/, rule: 'launchctl unload is not allowed' },
	{ pattern: /\bdscl\b/, rule: 'dscl is not allowed' },
	{ pattern: /\bnvram\b/, rule: 'nvram is not allowed' },
	{ pattern: /\bkextunload\b/, rule: 'kextunload is not allowed' },
	{ pattern: /\bsystemsetup\b/, rule: 'systemsetup is not allowed' },
]

export function isBlocked(command: string): { blocked: boolean; rule?: string } {
	for (const { pattern, rule } of BLOCKED_PATTERNS) {
		if (pattern.test(command)) {
			return { blocked: true, rule }
		}
	}
	return { blocked: false }
}

export function isPathAllowed(
	filepath: string,
	allowedPaths: string[],
): { allowed: boolean; reason?: string } {
	let resolved: string
	try {
		resolved = realpathSync(resolve(filepath))
	} catch {
		// File doesn't exist — resolve parent dir through symlinks, append filename
		try {
			const dir = realpathSync(resolve(dirname(filepath)))
			resolved = join(dir, basename(filepath))
		} catch {
			resolved = normalize(resolve(filepath))
		}
	}

	for (const allowed of allowedPaths) {
		let normalizedAllowed: string
		try {
			normalizedAllowed = realpathSync(resolve(allowed))
		} catch {
			normalizedAllowed = normalize(resolve(allowed))
		}
		if (resolved.startsWith(normalizedAllowed)) {
			return { allowed: true }
		}
	}

	return {
		allowed: false,
		reason: `Path "${filepath}" is outside allowed directories: ${allowedPaths.join(', ')}`,
	}
}

export function getAllowedPaths(): string[] {
	const raw = process.env.ALLOWED_PATHS ?? `${process.env.HOME},/tmp`
	return raw
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean)
}
