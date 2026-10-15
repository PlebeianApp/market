/**
 * composition/ts/siblings.test.ts — **the rung's own independence criterion, as a checkable fact**.
 *
 * The composition root may name its siblings — that is its job (`design.md` §4.9) — but only the ones
 * its **implementation** declares. This case extracts every import specifier out of this directory and
 * asserts three things:
 *
 * 1. every relative specifier leaving the directory from an **implementation** file is on
 *    `COMPOSITION_SIBLINGS` (nothing smuggled in);
 * 2. every entry on `COMPOSITION_SIBLINGS` is actually used by an implementation file (no stale licence);
 * 3. across **every** file in the directory — tests included — no specifier is an app import or a
 *    framework import (`@/`, `@ui/`, `@apps/`, `react*`) and no relative specifier resolves outside
 *    `sdk/`.
 *
 * **The mutations that turn it red:** add a fourth relative sibling import to an implementation file
 * without listing it → arm 1; delete the `../../errors` import from `schema.ts` → arm 2; import
 * `@/lib/schemas/auction/auctionEvent` → arm 3; reach `../../../../src/lib/schemas/...` from a test →
 * arm 3's second half.
 */
import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { COMPOSITION_SIBLINGS } from './siblings'

const HERE = import.meta.dir
const SDK_ROOT = resolve(HERE, '..', '..', '..') // sdk/core/composition/ts -> sdk
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const TEST_FILE = /\.test\.ts$/
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g
const FORBIDDEN_MODULES = /^(?:react|react-dom|@tanstack\/|@\/|@ui\/|@apps\/)/

async function specifiers(): Promise<Map<string, string[]>> {
	const entries = await readdir(HERE, { withFileTypes: true })
	const files = entries
		.filter((entry) => entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.'))))
		.map((entry) => entry.name)
	const found = new Map<string, string[]>()
	for (const file of files) {
		const source = await readFile(join(HERE, file), 'utf8')
		const list: string[] = []
		for (const match of source.matchAll(IMPORT_SPECIFIER)) {
			const specifier = match[1] ?? match[2]
			if (specifier) list.push(specifier)
		}
		found.set(file, list)
	}
	return found
}

describe('the composition rung declares every sibling it composes', () => {
	test('every relative specifier an implementation file leaves the directory with is declared, and vice versa', async () => {
		const found = await specifiers()
		const leaving = new Set<string>()
		for (const [file, list] of found) {
			if (TEST_FILE.test(file)) continue
			for (const specifier of list) if (specifier.startsWith('../')) leaving.add(specifier)
		}
		const declared = new Set<string>(COMPOSITION_SIBLINGS)

		// Arm 1 — a sibling import nothing declares is exactly the violation the rung exists to prevent.
		expect([...leaving].filter((specifier) => !declared.has(specifier))).toEqual([])
		// Arm 2 — a declared sibling nothing imports is a stale licence, not a fact.
		expect([...declared].filter((specifier) => !leaving.has(specifier))).toEqual([])
	})

	test('no specifier anywhere in the directory is an app or framework import, or a path out of sdk/', async () => {
		const found = await specifiers()
		const violations: string[] = []
		for (const [file, list] of found) {
			for (const specifier of list) {
				if (FORBIDDEN_MODULES.test(specifier)) {
					violations.push(`${file} imports ${specifier}`)
					continue
				}
				if (specifier.startsWith('.')) {
					const resolved = resolve(HERE, specifier)
					if (resolved !== SDK_ROOT && !resolved.startsWith(`${SDK_ROOT}${sep}`)) {
						violations.push(`${file} escapes sdk/: ${specifier}`)
					}
				}
			}
		}
		expect(violations).toEqual([])
	})
})
