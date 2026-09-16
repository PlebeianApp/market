/**
 * Guards per-PR gate membership for the e2e families the `e2e-grep` job gates
 * (`.github/workflows/e2e.yml`).
 *
 * The `e2e-grep` job runs one single-quoted `--grep` alternation of
 * deterministic test families on every pull request / push; that gate is the
 * only place a gated family's specs are exercised on a PR (the scheduled
 * `e2e-full` job also runs them, but it is not a merge gate).
 *
 * A family that is renamed or added to its spec without a matching entry in the
 * gate pattern silently drops out of CI. This guard ties each spec and the
 * workflow together: every `test.describe` title in a gated spec must be
 * matched by the gate pattern, so removing a family's term (or renaming a
 * describe) fails a unit test instead of quietly narrowing CI coverage.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'e2e.yml')

/**
 * Every family the per-PR gate is documented to run: the family term as it must
 * appear in the workflow's `--grep` alternation, and the spec that holds it.
 *
 * Add an entry in the same change that adds a family to the gate pattern. The
 * spec must exist on the tree: a family whose spec is missing is gated by
 * nothing, and this guard fails closed on that instead of skipping the entry.
 */
const GATED_FAMILIES: ReadonlyArray<{ family: string; spec: string }> = [
	{ family: 'OG Meta Tags', spec: 'og-meta-tags.spec.ts' },
	{ family: 'bounded author-relay reads', spec: 'author-relay-reads.spec.ts' },
]

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

/** Every `test.describe('<title>'` title in the named e2e spec. */
async function describeTitles(spec: string): Promise<string[]> {
	const source = await readFile(join(REPO_ROOT, 'e2e', 'tests', spec), 'utf8')
	return [...source.matchAll(/test\.describe\(\s*'([^']+)'/g)].map((match) => match[1])
}

describe('e2e-grep gate membership (gated families)', () => {
	test('the per-PR gate has a bounded alternation, not a run-everything wildcard', async () => {
		const pattern = (await gatePattern()).trim()
		expect(pattern.length).toBeGreaterThan(0)
		// A bare `.*` / `*` / empty pattern would silently run the whole suite.
		expect(pattern).not.toMatch(/^(\.?\*|\.\*)$/)
		expect(pattern.split('|').length).toBeGreaterThan(1)
	})

	for (const { family, spec } of GATED_FAMILIES) {
		test(`every ${family} describe title is matched by the per-PR gate pattern`, async () => {
			const [pattern, titles] = await Promise.all([gatePattern(), describeTitles(spec)])
			// The term itself must be on the gate, so removing it fails here with a
			// message naming the family even before the describe titles are compared.
			expect(pattern).toContain(family)
			expect(titles.length).toBeGreaterThan(0)
			const gate = new RegExp(pattern)
			const ungated = titles.filter((title) => !gate.test(title))
			expect(ungated).toEqual([])
		})
	}
})
