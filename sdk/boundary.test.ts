import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const SDK_ROOT = resolve(import.meta.dir)
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|tsx|mts|cts)$/
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g
const FORBIDDEN_MODULES = /^(?:react|react-dom|@tanstack\/|@\/|@ui\/|@platform\/)/

async function listSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name)
			if (entry.isDirectory()) return listSourceFiles(fullPath)
			const extension = entry.name.slice(entry.name.lastIndexOf('.'))
			return SOURCE_EXTENSIONS.has(extension) && !TEST_FILE.test(entry.name) ? [fullPath] : []
		}),
	)
	return nested.flat()
}

describe('SDK dependency boundary', () => {
	test('production SDK modules do not depend on UI, Platform, React, or TanStack React', async () => {
		const files = await listSourceFiles(SDK_ROOT)
		const violations: string[] = []

		for (const file of files) {
			const source = await readFile(file, 'utf8')
			for (const match of source.matchAll(IMPORT_SPECIFIER)) {
				const specifier = match[1] ?? match[2]
				if (!specifier) continue
				if (FORBIDDEN_MODULES.test(specifier)) {
					violations.push(`${relative(SDK_ROOT, file)} imports ${specifier}`)
					continue
				}
				if (specifier.startsWith('.')) {
					const importedPath = resolve(file, '..', specifier)
					const rel = relative(SDK_ROOT, importedPath)
					if (rel === '..' || rel.startsWith(`..${sep}`)) {
						violations.push(`${relative(SDK_ROOT, file)} escapes sdk/: ${specifier}`)
					}
				}
			}
		}

		expect(violations).toEqual([])
	})

	// ADR-0023: extensions reach the outside world only through host ports injected by Platform.
	test('extension modules use host ports instead of relay clients, ambient fetch, or app state', async () => {
		const extensionsRoot = join(SDK_ROOT, 'extensions')
		const files = await listSourceFiles(extensionsRoot).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [] as string[]
			throw error
		})
		const violations: string[] = []

		for (const file of files) {
			const source = await readFile(file, 'utf8')
			for (const match of source.matchAll(IMPORT_SPECIFIER)) {
				const specifier = match[1] ?? match[2]
				if (!specifier) continue
				if (EXTENSION_FORBIDDEN_MODULES.test(specifier)) violations.push(`${relative(SDK_ROOT, file)} imports ${specifier}`)
				if (specifier.startsWith('.')) {
					const rel = relative(SDK_ROOT, resolve(file, '..', specifier))
					if (EXTENSION_FORBIDDEN_SDK_PATHS.some((path) => rel === path || rel.startsWith(`${path}${sep}`))) {
						violations.push(`${relative(SDK_ROOT, file)} imports relay internals: ${specifier}`)
					}
				}
			}
			for (const pattern of EXTENSION_FORBIDDEN_GLOBALS) {
				if (pattern.test(source)) violations.push(`${relative(SDK_ROOT, file)} uses ${pattern.source}`)
			}
		}

		expect(violations).toEqual([])
	})
})

const EXTENSION_FORBIDDEN_MODULES =
	/^(?:@nostr-dev-kit\/|applesauce-relay|nostr-tools\/(?:relay|pool|abstract-relay|abstract-pool)|@contextvm\/|@sdk\/core\/nostr-io)/
const EXTENSION_FORBIDDEN_SDK_PATHS = [join('core', 'nostr-io'), join('core', 'ports', 'poolRelayPort')]
const EXTENSION_FORBIDDEN_GLOBALS = [
	/\bfetch\s*\(/,
	/\bnew\s+WebSocket\b/,
	/\bprocess\.env\b/,
	/\bBun\./,
	/import\s*\{[^}]*\b(?:SimplePool|Relay|AbstractRelay|AbstractSimplePool)\b[^}]*\}\s*from\s*['"]nostr-tools['"]/,
]
