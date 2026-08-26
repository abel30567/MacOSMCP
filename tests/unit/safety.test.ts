import { describe, expect, test } from 'bun:test'
import { isBlocked, isPathAllowed } from '../../src/safety.js'

describe('isBlocked', () => {
	test('blocks sudo commands', () => {
		expect(isBlocked('sudo rm -rf /').blocked).toBe(true)
		expect(isBlocked('sudo apt install foo').blocked).toBe(true)
		expect(isBlocked('echo sudo').blocked).toBe(true)
	})

	test('blocks rm -rf /', () => {
		expect(isBlocked('rm -rf / ').blocked).toBe(true)
		expect(isBlocked('rm -r / ').blocked).toBe(true)
	})

	test('blocks rm -rf ~', () => {
		expect(isBlocked('rm -rf ~ ').blocked).toBe(true)
	})

	test('blocks mkfs', () => {
		expect(isBlocked('mkfs.ext4 /dev/sda1').blocked).toBe(true)
	})

	test('blocks dd to device', () => {
		expect(isBlocked('dd if=/dev/zero of=/dev/sda').blocked).toBe(true)
	})

	test('blocks shutdown/reboot/halt', () => {
		expect(isBlocked('shutdown -h now').blocked).toBe(true)
		expect(isBlocked('reboot').blocked).toBe(true)
		expect(isBlocked('halt').blocked).toBe(true)
		expect(isBlocked('poweroff').blocked).toBe(true)
	})

	test('blocks diskutil erase', () => {
		expect(isBlocked('diskutil eraseDisk JHFS+ NewDisk disk2').blocked).toBe(true)
	})

	test('blocks csrutil', () => {
		expect(isBlocked('csrutil disable').blocked).toBe(true)
	})

	test('blocks writing to /System', () => {
		expect(isBlocked('echo foo > /System/Library/test').blocked).toBe(true)
	})

	test('blocks launchctl unload', () => {
		expect(isBlocked('launchctl unload /Library/LaunchDaemons/foo.plist').blocked).toBe(true)
	})

	test('blocks dscl', () => {
		expect(isBlocked('dscl . -create /Users/admin').blocked).toBe(true)
	})

	test('blocks nvram', () => {
		expect(isBlocked('nvram boot-args=""').blocked).toBe(true)
	})

	test('allows safe commands', () => {
		expect(isBlocked('echo hello').blocked).toBe(false)
		expect(isBlocked('ls -la').blocked).toBe(false)
		expect(isBlocked('cat /etc/hosts').blocked).toBe(false)
		expect(isBlocked('pwd').blocked).toBe(false)
		expect(isBlocked('which brew').blocked).toBe(false)
		expect(isBlocked('git status').blocked).toBe(false)
		expect(isBlocked('curl https://example.com').blocked).toBe(false)
	})

	test('returns the matching rule', () => {
		const result = isBlocked('sudo whoami')
		expect(result.blocked).toBe(true)
		expect(result.rule).toBe('sudo is not allowed')
	})
})

describe('isPathAllowed', () => {
	const home = process.env.HOME ?? '/Users/testuser'
	const allowed = [home, '/tmp']

	test('allows paths within allowed directories', () => {
		expect(isPathAllowed(`${home}/Documents/file.txt`, allowed).allowed).toBe(true)
		expect(isPathAllowed('/tmp/scratch.txt', allowed).allowed).toBe(true)
		expect(isPathAllowed(home, allowed).allowed).toBe(true)
	})

	test('denies paths outside allowed directories', () => {
		expect(isPathAllowed('/etc/passwd', allowed).allowed).toBe(false)
		expect(isPathAllowed('/var/log/syslog', allowed).allowed).toBe(false)
		expect(isPathAllowed('/System/Library/foo', allowed).allowed).toBe(false)
	})

	test('returns a reason when denied', () => {
		const result = isPathAllowed('/etc/passwd', allowed)
		expect(result.allowed).toBe(false)
		expect(result.reason).toContain('/etc/passwd')
		expect(result.reason).toContain('outside allowed directories')
	})

	test('handles relative paths by resolving them', () => {
		// Use an absolute path to avoid CWD-dependent resolution
		const result = isPathAllowed('/etc/passwd', allowed)
		expect(result.allowed).toBe(false)
	})

	test('resolves symlinks (macOS /tmp -> /private/tmp)', () => {
		expect(isPathAllowed('/tmp', allowed).allowed).toBe(true)
		expect(isPathAllowed('/private/tmp/test.txt', allowed).allowed).toBe(true)
	})
})
