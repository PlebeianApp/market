/**
 * assumptions.test.ts — **the register has to be a register, not a paragraph**.
 *
 * The maintainer asked for the module's assumptions to be documented and surfaced.
 * A prose list decays the moment it is not read; this file makes three facts
 * checkable instead:
 *
 * 1. **The set is exact.** The ids are asserted as a list, so adding or removing an
 *    assumption is a deliberate edit to a test rather than a silent drift of a
 *    document.
 * 2. **Each one carries a falsifier.** An assumption with no observation that would
 *    falsify it is a disclaimer, not an assumption.
 * 3. **Each one is reachable from the code.** Every id must appear somewhere in this
 *    directory, so an assumption nothing leans on cannot accumulate.
 *
 * **The mutations that turn each case red:** delete an entry from
 * `CURRENCY_ASSUMPTIONS` → arm 1; blank a `falsifiedBy`, or shorten one below the
 * floor → arm 2; add an entry with an id nothing in the directory cites → arm 3;
 * give two entries the same id → arm 2's uniqueness check.
 */
import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CURRENCY_ASSUMPTIONS } from './assumptions'

const HERE = import.meta.dir

/** The assumptions `sdk/commerce/currency` makes. Adding one is an edit here too, on purpose. */
const EXPECTED_IDS = [
	'cvm-rate-is-truth',
	'cvm-endpoint-identifies-the-server',
	'cvm-tool-shape',
	'stale-rate-is-not-judged',
	'currency-precision-is-declared-not-assumed',
	'one-btc-per-100m-sats',
	'docs-prepare-the-amount-for-a-human-to-render',
]

/**
 * Every `.ts` file in this directory **except the register and this test** — the source
 * an assumption has to be cited from.
 *
 * The two exclusions are the point: the register contains every id by construction and
 * this file contains the expected list, so counting either would make the third arm
 * vacuously true and let an assumption nothing leans on accumulate unnoticed.
 */
async function listedSource(): Promise<string> {
	const entries = await readdir(HERE, { withFileTypes: true })
	const EXCLUDED = new Set(['assumptions.ts', 'assumptions.test.ts'])
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !EXCLUDED.has(entry.name))
		.map((entry) => entry.name)
	const contents = await Promise.all(files.map((file) => readFile(join(HERE, file), 'utf8')))
	return contents.join('\n')
}

describe('the currency assumptions register', () => {
	test('names exactly the assumptions the module makes', () => {
		expect(CURRENCY_ASSUMPTIONS.map((assumption) => assumption.id)).toEqual(EXPECTED_IDS)
		expect(new Set(CURRENCY_ASSUMPTIONS.map((assumption) => assumption.id)).size).toBe(CURRENCY_ASSUMPTIONS.length)
		expect(Object.isFrozen(CURRENCY_ASSUMPTIONS)).toBe(true)
	})

	test('every assumption carries a falsifier, not a disclaimer', () => {
		for (const assumption of CURRENCY_ASSUMPTIONS) {
			expect(assumption.statement.trim().length).toBeGreaterThan(30)
			expect(assumption.falsifiedBy.trim().length).toBeGreaterThan(30)
			expect(assumption.falsifiedBy.toLowerCase()).not.toContain('might be wrong')
		}
	})

	test('every assumption is cited from the code that leans on it', async () => {
		const source = await listedSource()
		for (const assumption of CURRENCY_ASSUMPTIONS) expect(source).toContain(assumption.id)
	})
})
