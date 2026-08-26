import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getAllowedPaths, isPathAllowed } from '../safety.js'
import { defineTool } from './define-tool.js'

const exec = promisify(execFile)

function checkPath(filepath: string): string | null {
	const check = isPathAllowed(filepath, getAllowedPaths())
	if (!check.allowed) {
		return JSON.stringify({ error: 'path_denied', reason: check.reason })
	}
	return null
}

export function registerFileTools(server: McpServer): void {
	defineTool(server, {
		name: 'mac_file_read',
		description: 'Read a file from the macOS filesystem. Binary files are returned as base64.',
		schema: {
			path: z.string().describe('Absolute path to the file'),
			encoding: z
				.enum(['utf8', 'base64'])
				.optional()
				.default('utf8')
				.describe('Encoding for the output (default: utf8)'),
		},
		scope: ['read'],
		risk: 'low',
		handler: async (args) => {
			const denied = checkPath(args.path)
			if (denied) return { content: [{ type: 'text', text: denied }] }

			const content = await readFile(args.path)
			const text =
				args.encoding === 'base64' ? content.toString('base64') : content.toString('utf8')

			return { content: [{ type: 'text', text }] }
		},
	})

	defineTool(server, {
		name: 'mac_file_write',
		description: 'Write content to a file on the macOS filesystem.',
		schema: {
			path: z.string().describe('Absolute path to the file'),
			content: z.string().describe('Content to write'),
			encoding: z
				.enum(['utf8', 'base64'])
				.optional()
				.default('utf8')
				.describe('Encoding of the content (default: utf8)'),
			append: z.boolean().optional().default(false).describe('Append instead of overwrite'),
		},
		scope: ['write'],
		risk: 'med',
		handler: async (args) => {
			const denied = checkPath(args.path)
			if (denied) return { content: [{ type: 'text', text: denied }] }

			await mkdir(dirname(args.path), { recursive: true })

			const data = args.encoding === 'base64' ? Buffer.from(args.content, 'base64') : args.content

			if (args.append) {
				await appendFile(args.path, data)
			} else {
				await writeFile(args.path, data)
			}

			return {
				content: [{ type: 'text', text: JSON.stringify({ ok: true, path: args.path }) }],
			}
		},
	})

	defineTool(server, {
		name: 'mac_file_list',
		description: 'List contents of a directory on the macOS filesystem.',
		schema: {
			path: z.string().describe('Absolute path to the directory'),
			recursive: z.boolean().optional().default(false).describe('List recursively'),
			pattern: z.string().optional().describe('Glob pattern to filter results'),
		},
		scope: ['read'],
		risk: 'low',
		handler: async (args) => {
			const denied = checkPath(args.path)
			if (denied) return { content: [{ type: 'text', text: denied }] }

			const entries = await readdir(args.path, {
				withFileTypes: true,
				recursive: args.recursive,
			})

			const results = await Promise.all(
				entries
					.filter((e) => {
						if (!args.pattern) return true
						const regex = new RegExp(args.pattern.replace(/\*/g, '.*').replace(/\?/g, '.'))
						return regex.test(e.name)
					})
					.slice(0, 1000)
					.map(async (entry) => {
						const fullPath = join(entry.parentPath ?? args.path, entry.name)
						try {
							const s = await stat(fullPath)
							return {
								name: entry.name,
								type: entry.isDirectory() ? 'directory' : 'file',
								size: s.size,
								modified: s.mtime.toISOString(),
							}
						} catch {
							return {
								name: entry.name,
								type: entry.isDirectory() ? 'directory' : 'file',
							}
						}
					}),
			)

			return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
		},
	})

	defineTool(server, {
		name: 'mac_file_search',
		description: 'Search for files using macOS Spotlight (mdfind).',
		schema: {
			query: z.string().describe('Search query for Spotlight'),
			path: z.string().optional().describe('Limit search to this directory'),
		},
		scope: ['read'],
		risk: 'low',
		handler: async (args) => {
			const execArgs = args.path ? ['-onlyin', args.path, args.query] : [args.query]

			try {
				const { stdout } = await exec('mdfind', execArgs, { timeout: 15000 })
				const files = stdout.trim().split('\n').filter(Boolean).slice(0, 100)
				return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] }
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'search_failed',
								message: err instanceof Error ? err.message : String(err),
							}),
						},
					],
				}
			}
		},
	})

	defineTool(server, {
		name: 'mac_file_move',
		description: 'Move or rename a file on the macOS filesystem.',
		schema: {
			source: z.string().describe('Source path'),
			destination: z.string().describe('Destination path'),
		},
		scope: ['write'],
		risk: 'med',
		handler: async (args) => {
			const srcDenied = checkPath(args.source)
			if (srcDenied) return { content: [{ type: 'text', text: srcDenied }] }
			const dstDenied = checkPath(args.destination)
			if (dstDenied) return { content: [{ type: 'text', text: dstDenied }] }

			await mkdir(dirname(args.destination), { recursive: true })
			await rename(args.source, args.destination)

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							ok: true,
							from: args.source,
							to: args.destination,
						}),
					},
				],
			}
		},
	})

	defineTool(server, {
		name: 'mac_file_delete',
		description: 'Delete a file by moving it to the macOS Trash (not permanent deletion).',
		schema: {
			path: z.string().describe('Absolute path to the file to delete'),
		},
		scope: ['write'],
		risk: 'med',
		handler: async (args) => {
			const denied = checkPath(args.path)
			if (denied) return { content: [{ type: 'text', text: denied }] }

			try {
				await exec('/usr/bin/osascript', [
					'-e',
					`tell application "Finder" to delete POSIX file "${args.path}"`,
				])
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ ok: true, path: args.path, action: 'moved_to_trash' }),
						},
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: 'delete_failed',
								message: err instanceof Error ? err.message : String(err),
							}),
						},
					],
				}
			}
		},
	})

	defineTool(server, {
		name: 'mac_file_info',
		description: 'Get metadata about a file on the macOS filesystem.',
		schema: {
			path: z.string().describe('Absolute path to the file'),
		},
		scope: ['read'],
		risk: 'low',
		handler: async (args) => {
			const denied = checkPath(args.path)
			if (denied) return { content: [{ type: 'text', text: denied }] }

			const s = await stat(args.path)
			const info = {
				size: s.size,
				type: s.isDirectory() ? 'directory' : s.isSymbolicLink() ? 'symlink' : 'file',
				created: s.birthtime.toISOString(),
				modified: s.mtime.toISOString(),
				accessed: s.atime.toISOString(),
				permissions: s.mode.toString(8),
				uid: s.uid,
				gid: s.gid,
			}

			return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
		},
	})
}
