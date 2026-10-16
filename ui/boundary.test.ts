import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const UI_ROOT = resolve(import.meta.dir)
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|tsx|mts|cts)$/
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g
// UI may use React, SDK, and presentation libraries; app routing, stores, queries, relay clients, and Platform stay in the host.
const FORBIDDEN_MODULES = /^(?:@\/|@platform\/|@tanstack\/|@nostr-dev-kit\/|applesauce-|nostr-tools)/

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

describe('UI dependency boundary', () => {
	test('production UI modules depend only on React, SDK, and presentation libraries', async () => {
		const files = await listSourceFiles(UI_ROOT)
		const violations: string[] = []

		for (const file of files) {
			const source = await readFile(file, 'utf8')
			for (const match of source.matchAll(IMPORT_SPECIFIER)) {
				const specifier = match[1] ?? match[2]
				if (!specifier) continue
				if (FORBIDDEN_MODULES.test(specifier)) {
					violations.push(`${relative(UI_ROOT, file)} imports ${specifier}`)
					continue
				}
				if (specifier.startsWith('.')) {
					const rel = relative(UI_ROOT, resolve(file, '..', specifier))
					if (rel === '..' || rel.startsWith(`..${sep}`)) {
						violations.push(`${relative(UI_ROOT, file)} escapes ui/: ${specifier}`)
					}
				}
			}
		}

		expect(violations).toEqual([])
	})
})
