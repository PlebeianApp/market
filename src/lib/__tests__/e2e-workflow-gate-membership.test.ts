/**
 * Guards per-PR gate membership for the `OG Meta Tags` e2e family
 * (`.github/workflows/e2e.yml`).
 *
 * The `e2e-grep` job runs one single-quoted `--grep` alternation of
 * deterministic test families on every pull request / push; that gate is the
 * only place the `OG Meta Tags` specs are exercised on a PR (the scheduled
 * `e2e-full` job also runs them, but it is not a merge gate).
 *
 * A family that is renamed or added to `e2e/tests/og-meta-tags.spec.ts`
 * without a matching entry in the gate pattern silently drops out of CI. This
 * guard ties the spec and the workflow together: every `test.describe` title
 * in the OG spec must be matched by the gate pattern, so removing the
 * `|OG Meta Tags` term (or renaming a describe) fails a unit test instead of
 * quietly narrowing CI coverage.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'e2e.yml')
const OG_SPEC_PATH = join(REPO_ROOT, 'e2e', 'tests', 'og-meta-tags.spec.ts')

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

/** Every `test.describe('<title>'` title in the OG spec. */
async function ogDescribeTitles(): Promise<string[]> {
	const spec = await readFile(OG_SPEC_PATH, 'utf8')
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
		const [pattern, titles] = await Promise.all([gatePattern(), ogDescribeTitles()])
		expect(titles.length).toBeGreaterThan(0)
		const gate = new RegExp(pattern)
		const ungated = titles.filter((title) => !gate.test(title))
		expect(ungated).toEqual([])
	})
})
