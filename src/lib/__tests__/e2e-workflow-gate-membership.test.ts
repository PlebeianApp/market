/**
 * Guards gate membership for the e2e specs that gate a change
 * (`.github/workflows/e2e.yml`, `.github/workflows/preview-deploy.yml`).
 *
 * LOCAL LANE — the `e2e-grep` job runs one single-quoted `--grep` alternation
 * of deterministic test families on every pull request / push; that gate is
 * the only place those specs are exercised on a PR (the scheduled `e2e-full`
 * job also runs them, but it is not a merge gate). A family that is renamed or
 * added to a spec without a matching entry in the gate pattern silently drops
 * out of CI: measured on `demo/preview-deploy-20260918-170527` before
 * `Preview relay content` was added, the gate selected 83 of the 186
 * collectable tests and none of them came from
 * `e2e/tests/preview-content-seed.spec.ts`. This guard ties each spec and the
 * workflow together: every `test.describe` title in a gated spec must be
 * matched by the gate pattern, so removing a family term (or renaming a
 * describe) fails a unit test instead of quietly narrowing CI coverage.
 *
 * PREVIEW LANE — the post-deploy step in `.github/workflows/preview-deploy.yml`
 * runs the preview-only specs by PATH (`E2E_BASE_URL` / `E2E_RELAY_URL` point
 * at the deployed preview), so its selection does not depend on the grep. The
 * last test keeps that file list and the expected list in lockstep, so a spec
 * cannot silently disappear from the preview lane either.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'e2e.yml')
const PREVIEW_WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'preview-deploy.yml')

/**
 * Specs whose `test.describe` titles must be matched by the per-PR gate
 * pattern, paired with the family term that is supposed to select them.
 *
 * `e2e/tests/login-nip46-relay.spec.ts` is deliberately NOT listed: its outer
 * describe is `Authentication`, which the gate already carries, and its inner
 * describe is only reachable through that outer one (adding the file would
 * demand a gate term for the inner title, which no gate term expresses).
 */
const GATED_SPECS = [
	{ family: 'OG Meta Tags', path: join(REPO_ROOT, 'e2e', 'tests', 'og-meta-tags.spec.ts') },
	{ family: 'Preview relay content', path: join(REPO_ROOT, 'e2e', 'tests', 'preview-content-seed.spec.ts') },
] as const

/**
 * The specs the preview-lane step is expected to run against a deployed
 * preview. `login-nip46-relay.spec.ts` is the login half of the preview claim
 * (relay-backed login + a terminal read on `/`), `preview-content-seed.spec.ts`
 * is the content half (the seeded listings actually render).
 */
const PREVIEW_LANE_SPECS = ['e2e/tests/login-nip46-relay.spec.ts', 'e2e/tests/preview-content-seed.spec.ts']

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

/** Every `test.describe('<title>'` title in a spec. */
async function describeTitles(specPath: string): Promise<string[]> {
	const spec = await readFile(specPath, 'utf8')
	return [...spec.matchAll(/test\.describe\(\s*'([^']+)'/g)].map((match) => match[1])
}

describe('e2e-grep gate membership', () => {
	test('the per-PR gate has a bounded alternation, not a run-everything wildcard', async () => {
		const pattern = (await gatePattern()).trim()
		expect(pattern.length).toBeGreaterThan(0)
		// A bare `.*` / `*` / empty pattern would silently run the whole suite.
		expect(pattern).not.toMatch(/^(\.?\*|\.\*)$/)
		expect(pattern.split('|').length).toBeGreaterThan(1)
	})

	for (const spec of GATED_SPECS) {
		test(`every ${spec.family} describe title is matched by the per-PR gate pattern`, async () => {
			const [pattern, titles] = await Promise.all([gatePattern(), describeTitles(spec.path)])
			expect(titles.length).toBeGreaterThan(0)
			const gate = new RegExp(pattern)
			const ungated = titles.filter((title) => !gate.test(title))
			expect(ungated).toEqual([])
		})
	}
})

describe('preview-lane gate membership', () => {
	test('the post-deploy preview lane runs the preview specs by path', async () => {
		const yaml = await readFile(PREVIEW_WORKFLOW_PATH, 'utf8')
		const referenced = new Set([...yaml.matchAll(/e2e\/tests\/[A-Za-z0-9_.-]+\.spec\.ts/g)].map((match) => match[0]))
		expect(referenced).toEqual(new Set(PREVIEW_LANE_SPECS))
	})

	test('the preview lane points the specs at the deployed preview, not at localhost', async () => {
		const yaml = await readFile(PREVIEW_WORKFLOW_PATH, 'utf8')
		// `test-config.ts` only reaches its preview-only assertions when
		// BASE_URL is non-loopback, so the lane has to set the base URL from the
		// same subdomain the health check already proved serving.
		expect(yaml).toContain('E2E_BASE_URL: https://${{ steps.ports.outputs.subdomain }}')
		expect(yaml).toContain('E2E_RELAY_URL: wss://${{ steps.ports.outputs.subdomain }}/relay')
	})
})
