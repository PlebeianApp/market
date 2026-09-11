/**
 * ADR citation integrity (`docs/adr/README.md` is the numbering source of
 * truth, and "never reuse a number" applies to citations too).
 *
 * Guards two failures raised in review of the signer migration (PR #1252):
 *
 *  1. Citing a folded ADR number. The signer-migration draft was numbered
 *     0022, then renumbered 0008, and was finally folded into the ADR-0002
 *     amendment without ever merging as a standalone document. Citing those
 *     numbers as ADRs points readers at a file that does not exist — and the
 *     index reserves 0008 for a different open conflict.
 *  2. Citing a 4-digit ADR from code that has no document in `docs/adr/`.
 *
 * Cite `the ADR-0002 amendment (2026-09)` instead.
 */
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const ADR_DIR = join(REPO_ROOT, 'docs', 'adr')

/** Numbers folded into another ADR — never citable as standalone ADRs. */
const FOLDED_NUMBERS = ['0008', '0022'].map((number) => `ADR-${number}`)
/** The document that records the fold is the only place the number may appear. */
const FOLD_RECORD = join('docs', 'adr', 'ADR-0002-nostr-io-migration-ndk-to-applesauce.md')

/** Directories scanned for citations. */
const SCAN_DIRS = ['src', 'e2e', 'docs', '.github']
/** Second check (must resolve to a document) applies to code only. */
const RESOLUTION_SCOPE = ['src', 'e2e']
const SCAN_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|md|yml|yaml|json|sh)$/
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report'])

function walk(dir: string): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) out.push(...walk(full))
		else out.push(full)
	}
	return out
}

function citationsIn(file: string): { line: number; text: string }[] {
	const found: { line: number; text: string }[] = []
	readFileSync(file, 'utf8')
		.split('\n')
		.forEach((text, index) => {
			if (/ADR-\d{4}/.test(text)) found.push({ line: index + 1, text })
		})
	return found
}

const ADR_DOCUMENTS = new Set(
	readdirSync(ADR_DIR)
		.map((name) => /^ADR-(\d{4})-/.exec(name)?.[1])
		.filter((num): num is string => Boolean(num)),
)

test('no file cites a folded ADR number', () => {
	const offenders: string[] = []
	for (const dir of SCAN_DIRS) {
		for (const file of walk(join(REPO_ROOT, dir))) {
			if (!SCAN_EXTENSIONS.test(file)) continue
			const rel = relative(REPO_ROOT, file)
			if (rel === FOLD_RECORD) continue
			for (const citation of citationsIn(file)) {
				for (const folded of FOLDED_NUMBERS) {
					if (citation.text.includes(folded)) {
						offenders.push(`${rel}:${citation.line}: cites folded ${folded}`)
					}
				}
			}
		}
	}
	expect(offenders).toEqual([])
})

test('every ADR number cited from code resolves to a document in docs/adr/', () => {
	const offenders: string[] = []
	for (const dir of RESOLUTION_SCOPE) {
		for (const file of walk(join(REPO_ROOT, dir))) {
			if (!SCAN_EXTENSIONS.test(file)) continue
			const rel = relative(REPO_ROOT, file)
			for (const citation of citationsIn(file)) {
				const numbers = citation.text.match(/ADR-\d{4}/g) ?? []
				for (const number of numbers) {
					if (!ADR_DOCUMENTS.has(number.slice(4))) {
						offenders.push(`${rel}:${citation.line}: cites missing ${number}`)
					}
				}
			}
		}
	}
	expect(offenders).toEqual([])
})
