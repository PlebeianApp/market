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
			// Skip installed dependencies: a local `node_modules` contains third-party
			// type stubs whose own documentation comments mention React, which would
			// otherwise be reported as a boundary violation by this module's code.
			if (entry.name === 'node_modules') return []
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
})
