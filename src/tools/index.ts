import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAppleScriptTools } from './applescript.js'
import { registerBrowserTools } from './browser.js'
import { registerFileTools } from './filesystem.js'
import { registerScreenTools } from './screen.js'
import { registerShellTools } from './shell.js'
import { registerSystemTools } from './system.js'

export function registerAllTools(server: McpServer): void {
	registerShellTools(server)
	registerAppleScriptTools(server)
	registerFileTools(server)
	registerSystemTools(server)
	registerBrowserTools(server)
	registerScreenTools(server)
}
