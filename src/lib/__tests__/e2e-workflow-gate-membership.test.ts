/**
 * Guards per-PR gate membership for the gated e2e families in
 * `.github/workflows/e2e.yml`: `OG Meta Tags`, `Test listing labels —
 * auctions`, `Auction Claim Dialog`, and the isolated `self-hosted instance`
 * spec.
 *
 * The `e2e-grep` job runs one single-quoted `--grep` alternation of
 * deterministic test families on every pull request / push; that gate is the
 * only place the `OG Meta Tags` specs are exercised on a PR (the scheduled
 * `e2e-full` job also runs them, but it is not a merge gate). It is the only
 * merge gate for the `Test listing labels — auctions` spec. The self-hosted
 * config spec has a dedicated server process because its instance identity
 * must not leak into the shared test server.
 *
 * A family that is renamed or added to `e2e/tests/og-meta-tags.spec.ts`,
 * `e2e/tests/test-labels-auctions.spec.ts`, the `Auction Claim Dialog` family
 * in `e2e/tests/auction-settlement.spec.ts`, or `e2e/tests/self-hosted-config.spec.ts`
 * without a matching entry in the gate pattern (or, for the self-hosted spec,
 * the isolated test:e2e:self-hosted command) silently drops out of CI. This
 * guard ties the specs and the workflow together: every guarded
 * `test.describe` title must be matched, so removing an alternation term (or
 * renaming a describe) fails a unit test instead of quietly narrowing CI
 * coverage.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'e2e.yml')
const OG_SPEC_PATH = join(REPO_ROOT, 'e2e', 'tests', 'og-meta-tags.spec.ts')
const AUCTIONS_LABEL_SPEC_PATH = join(REPO_ROOT, 'e2e', 'tests', 'test-labels-auctions.spec.ts')
const SELF_HOSTED_CONFIG_SPEC_PATH = join(REPO_ROOT, 'e2e', 'tests', 'self-hosted-config.spec.ts')
const AUCTION_SETTLEMENT_SPEC_PATH = join(REPO_ROOT, 'e2e', 'tests', 'auction-settlement.spec.ts')

/**
 * The single-quoted `--grep '<pattern>'` used by the per-PR `e2e-grep` gate.
 *
 * The other two `--grep` call sites in the workflow are not single-quoted
 * literals: the `e2e-full` job uses `--grep "$TEST_GREP"` and
 * `--grep-invert '...'`, so this pattern stays anchored to the gate.
 */
async function gatePattern(): Promise<string> {
	const yaml = await readFile(WORKFLOW_PATH, 'utf8')
	const match = yaml.match(/run: bun run test:e2e -- --grep '([^']+)'/)
	expect(match).not.toBeNull()
	return match![1]
}

/** Every `test.describe('<title>'` title in the spec at `specPath`. */
async function describeTitles(specPath: string): Promise<string[]> {
	const spec = await readFile(specPath, 'utf8')
	return [...spec.matchAll(/test\.describe\(\s*'([^']+)'/g)].map((match) => match[1])
}

describe('e2e-grep gate membership (OG Meta Tags family)', () => {
	test('the per-PR gate has a bounded alternation, not a run-everything wildcard', async () => {
		const pattern = (await gatePattern()).trim()
		expect(pattern.length).toBeGreaterThan(0)
		// A bare `.*` / `*` / empty pattern would silently run the whole suite.
		expect(pattern).not.toMatch(/^(\.?\*|\.\*)$/)
		expect(pattern.split('|').length).toBeGreaterThan(1)
	})

	test('every OG Meta Tags describe title is matched by the per-PR gate pattern', async () => {
		const [pattern, titles] = await Promise.all([gatePattern(), describeTitles(OG_SPEC_PATH)])
		expect(titles.length).toBeGreaterThan(0)
		const gate = new RegExp(pattern)
		const ungated = titles.filter((title) => !gate.test(title))
		expect(ungated).toEqual([])
	})
})

describe('e2e-grep gate membership (auctions test-listing family)', () => {
	test('every Test listing labels — auctions describe title is matched by the per-PR gate pattern', async () => {
		const [pattern, titles] = await Promise.all([gatePattern(), describeTitles(AUCTIONS_LABEL_SPEC_PATH)])
		expect(titles.length).toBeGreaterThan(0)
		const gate = new RegExp(pattern)
		const ungated = titles.filter((title) => !gate.test(title))
		// Removing the `|Test listing labels — auctions` term, or renaming a
		// describe in that spec, fails here with the ungated title named.
		expect(ungated).toEqual([])
	})
})

/**
 * The `e2e-full` job runs everything the gate does NOT match, via
 * `--grep-invert '<invert pattern>'`, so a family named in that list is skipped
 * there. That is only safe while the per-PR gate still runs it; a family that
 * drops out of the gate but stays in the invert list runs in NO workflow at
 * all. That is how `Collection Management` (`e2e/tests/collections.spec.ts`)
 * lost its coverage: it was added to the invert list and never to the gate.
 * The invariant this pins is `invert ⊆ gate` — the gate may be broader (a
 * family in the gate and not in the invert list simply runs in both jobs).
 */
async function invertPattern(): Promise<string> {
	const yaml = await readFile(WORKFLOW_PATH, 'utf8')
	const match = yaml.match(/--grep-invert '([^']+)'/)
	expect(match).not.toBeNull()
	return match![1]
}

describe('e2e-full exclusion list stays inside the per-PR gate', () => {
	test('every --grep-invert term is also a term of the per-PR gate pattern', async () => {
		const [gate, invert] = await Promise.all([gatePattern(), invertPattern()])
		const gateTerms = new Set(gate.split('|').map((term) => term.trim()))
		const excludedOnlyWhenGated = invert
			.split('|')
			.map((term) => term.trim())
			.filter((term) => !gateTerms.has(term))
		// A term that fails here is skipped by the `e2e-full` job and not run on
		// any pull request: either add it to the gate or take it out of the
		// invert list (and say why in this file).
		expect(excludedOnlyWhenGated).toEqual([])
	})
})

describe('e2e-grep gate membership (self-hosted instance family)', () => {
	test('the per-PR gate runs the isolated self-hosted-config spec', async () => {
		const [yaml, spec] = await Promise.all([readFile(WORKFLOW_PATH, 'utf8'), readFile(SELF_HOSTED_CONFIG_SPEC_PATH, 'utf8')])
		// Two describes: instance-config discovery/branding, and the ADR-018
		// browse/cart/checkout completion criterion.
		expect([...spec.matchAll(/test\.describe\(\s*'([^']+)'/g)]).toHaveLength(2)
		// The command enables the isolated project mode, which accepts only this
		// spec and starts an app process with the self-hosted handler ID.
		expect(yaml).toContain('E2E_TEST_PORT=34569 bun run test:e2e:self-hosted -- --repeat-each=2')
	})
})

describe('e2e-grep gate membership (auction claim dialog family)', () => {
	test('Auction Claim Dialog is matched by the per-PR gate pattern', async () => {
		const [pattern, titles] = await Promise.all([gatePattern(), describeTitles(AUCTION_SETTLEMENT_SPEC_PATH)])
		expect(titles).toContain('Auction Claim Dialog')
		const gate = new RegExp(pattern)
		expect(gate.test('Auction Claim Dialog')).toBe(true)
	})
})
