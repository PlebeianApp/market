/**
 * appBoundary.test.ts — the app's **own** import wall, the mirror of
 * `sdk/boundary.test.ts`.
 *
 * The SDK's wall keeps the SDK unable to reach the app. This is the other
 * direction: it keeps the app composing `sdk/` and `ui/` through the declared
 * aliases rather than through relative paths that happen to resolve today. A
 * relative `../../sdk/...` import works exactly as well as `@sdk/...` until
 * someone moves a folder — at which point it silently means a different module,
 * and the alias rename that ADR-0021's revision had to do (v`@platform/*` →
 * `@apps/*`) is the precedent for how that goes wrong.
 *
 * Two facts, both checkable:
 *
 * 1. **No relative specifier leaves `apps/demo-shop`.** SDK and UI are reached as
 *    `@sdk/*` and `@ui/*`; `src/` as `@/*`.
 * 2. **The app's legacy `src/` surface is exactly one import, named.** A new
 *    `@/...` import is a new transitional dependency on the layer this app is
 *    supposed to be replacing, so it has to be declared here on purpose.
 *
 * The mutations that turn these red: change `@ui/index` to `../../ui/index` in
 * `ProductList.tsx` → arm 1. Add `import { z } from '@/lib/schemas/common'` to
 * `productAdmission.ts` → arm 2.
 */

import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const APP_ROOT = resolve(import.meta.dir, '..')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const TEST_FILE = /\.test\.(?:ts|tsx)$/
const SKIP_DIRECTORIES = new Set(['node_modules', '.capture', 'dist'])
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g

/** The one legacy `src/` module this app is allowed to depend on, and why. */
const ADMITTED_SRC_IMPORTS = new Set(['@/lib/schemas/productListing'])

async function listSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (entry) => {
			if (SKIP_DIRECTORIES.has(entry.name)) return []
			const fullPath = join(directory, entry.name)
			if (entry.isDirectory()) return listSourceFiles(fullPath)
			const extension = entry.name.slice(entry.name.lastIndexOf('.'))
			return SOURCE_EXTENSIONS.has(extension) && !TEST_FILE.test(entry.name) ? [fullPath] : []
		}),
	)
	return nested.flat()
}

async function specifiersByFile(): Promise<Map<string, string[]>> {
	const found = new Map<string, string[]>()
	for (const file of await listSourceFiles(APP_ROOT)) {
		const source = await readFile(file, 'utf8')
		const list: string[] = []
		for (const match of source.matchAll(IMPORT_SPECIFIER)) {
			const specifier = match[1] ?? match[2]
			if (specifier) list.push(specifier)
		}
		found.set(relative(APP_ROOT, file), list)
	}
	return found
}

describe('the app reaches its siblings through the declared aliases', () => {
	test('no relative specifier leaves apps/demo-shop', async () => {
		const violations: string[] = []

		for (const [file, list] of await specifiersByFile()) {
			for (const specifier of list) {
				if (!specifier.startsWith('.')) continue
				const resolved = resolve(APP_ROOT, file, '..', specifier)
				if (resolved !== APP_ROOT && !resolved.startsWith(`${APP_ROOT}${sep}`)) {
					violations.push(`${file} escapes apps/demo-shop: ${specifier}`)
				}
			}
		}

		expect(violations).toEqual([])
	})

	test('the legacy src/ surface is exactly the declared one', async () => {
		const undeclared: string[] = []

		for (const [file, list] of await specifiersByFile()) {
			for (const specifier of list) {
				if (specifier.startsWith('@/') && !ADMITTED_SRC_IMPORTS.has(specifier)) {
					undeclared.push(`${file} imports ${specifier}`)
				}
			}
		}

		expect(undeclared).toEqual([])
	})

	test('the app imports the SDK and the UI, and does so by name', async () => {
		const byFile = await specifiersByFile()
		const all = [...byFile.values()].flat()

		expect(all).toContain('@ui/index')
		expect(all.some((specifier) => specifier.startsWith('@sdk/commerce/'))).toBe(true)
		expect(all.some((specifier) => specifier.startsWith('@sdk/core/nostr-io/'))).toBe(true)
	})
})