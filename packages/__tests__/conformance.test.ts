/**
 * Conformance checks — the structural rules of `MODULARIZATION.md` §6, as tests rather than as prose.
 *
 * These are deliberately crude static checks. A static scan is hygiene, not a security boundary (that
 * point is made at length in the module trust model), but *these* rules are about the shape of our own
 * source tree, where a crude check is exactly strong enough: an import either exists in the text or it
 * does not.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGES = new URL('..', import.meta.url).pathname

const sourceFiles = (root: string): string[] => {
	const out: string[] = []
	for (const entry of readdirSync(root)) {
		if (entry === 'node_modules') continue
		const full = join(root, entry)
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
		else if (/\.(ts|tsx|css)$/.test(entry)) out.push(full)
	}
	return out
}

const files = sourceFiles(PACKAGES)
const imports = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1] as string)
const rel = (file: string) => file.replace(PACKAGES, '')

describe('import direction', () => {
	test('there are package files to check (the check is not vacuous)', () => {
		expect(files.length).toBeGreaterThan(15)
	})

	test('no module imports an implementation', () => {
		// The whole point of the split: a module must not know which implementation it runs under.
		const violations: string[] = []
		for (const file of files) {
			if (!file.includes('/product/') && !file.includes('/browse/')) continue
			for (const source of imports(file)) {
				if (source === '@plebeian/web' || source === '@plebeian/napplet') violations.push(`${rel(file)} -> ${source}`)
			}
		}
		expect(violations).toEqual([])
	})

	test('the contract imports no other plebeian package', () => {
		const violations: string[] = []
		for (const file of files) {
			if (!file.includes('/contract/')) continue
			for (const source of imports(file)) {
				if (source.startsWith('@plebeian/') && source !== '@plebeian/contract') violations.push(`${rel(file)} -> ${source}`)
			}
		}
		expect(violations).toEqual([])
	})

	test('no package imports the application or reaches outside the tree', () => {
		const violations: string[] = []
		for (const file of files) {
			for (const source of imports(file)) {
				if (source.includes('/src/') && !source.startsWith('.')) violations.push(`${rel(file)} -> ${source}`)
				if (/\.\.\/\.\.\/(src|apps)/.test(source)) violations.push(`${rel(file)} -> ${source}`)
			}
		}
		expect(violations).toEqual([])
	})
})

describe('no policy literals in modules', () => {
	test('only the contract package owns colour values', () => {
		// A colour literal anywhere outside the contract is a value duplicated by hand across hosts
		// (alignment review drift D-3). Inside it, the two encodings are held together by tokens.test.ts.
		const violations: string[] = []
		for (const file of files) {
			if (file.includes('/contract/')) continue
			if (/\.test\.(ts|tsx)$/.test(file)) continue
			const hexes = [...readFileSync(file, 'utf8').matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0])
			if (hexes.length) violations.push(`${rel(file)}: ${hexes.join(' ')}`)
		}
		expect(violations).toEqual([])
	})

	test('no component module defines its own token values', () => {
		const styles = files.find((file) => file.endsWith('browse/src/styles.css'))
		expect(styles).toBeDefined()
		const declarations = [...readFileSync(styles as string, 'utf8').matchAll(/--pb-[a-z0-9-]+:\s*[^;]+;/g)]
		expect(declarations).toEqual([])
	})
})
