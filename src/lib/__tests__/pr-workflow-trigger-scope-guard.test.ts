/**
 * Guards the trigger scope of the four PR-gated workflows
 * (`.github/workflows/ci-ndk-guard.yml`, `ci-unit.yml`, `e2e.yml`,
 * `prettier.yml`).
 *
 * `pull_request.branches` filters on the **base ref** of the PR. While those
 * four workflows carried `branches: [main, master]` (e2e additionally
 * `'auctions/**'`), a PR whose base was anything else — the stacked `auctions`,
 * `security/**` and `pr/**` children — received **no check-suite at all**: not a
 * failed run, not a skipped run, zero runs (`#1324` at `8c384eef`,
 * `check-runs total_count: 0`; `#1322` at `551e8af7`; `#1355` live at
 * `04d46651` still reads 0 today). Dropping the filter is what makes a PR get
 * checked regardless of the branch it targets.
 *
 * Nothing in CI asserted that. The three-line comment in each workflow was the
 * only thing standing between that fix and a silent revert, and a comment does
 * not fail a build: dropping the **pre-PR** `e2e.yml` back into the tree leaves
 * the three existing workflow guards green (34 pass / 0 fail). This guard ties
 * the trigger line to its consequence, so re-adding a base filter fails a unit
 * test instead of quietly re-narrowing CI coverage.
 *
 * What this guard catches: a `branches:` **or `branches-ignore:`** key under
 * `pull_request:` — both filter on the PR's **base ref**, so either one
 * re-narrows CI on the base — declared in any of the four PR-gated workflows
 * (the per-workflow tests) and in **any** `*.yml`/`*.yaml` file under
 * `.github/workflows`, including ones written later (the sweep test). Both the
 * block form (`branches:` on its own child line, the house convention) and the
 * inline flow-mapping form (`pull_request: { branches: [main] }`, which puts
 * the whole mapping on the `pull_request:` line) are read, so neither shape
 * can pass this guard while CI is re-narrowed.
 *
 * What this guard does not catch: a base filter hidden behind a YAML anchor /
 * alias or any indirection this text-level reader cannot follow, and a future
 * base predicate under a key other than `branches`/`branches-ignore`. The
 * assertion is on those bytes, so a re-formatted-but-equivalent workflow is
 * judged as written.
 *
 * These are text-level assertions on purpose: the workflow file is the artifact
 * under test and the repo carries no YAML dependency to parse it with — the
 * same approach as `e2e-workflow-gate-membership.test.ts`,
 * `e2e-workflow-artifact-path.test.ts` and
 * `preview-deploy-workflow-guard.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows')

/**
 * The workflows that gate every pull request, base-agnostic by design. A PR to
 * any base must run all four, so each of these must keep a bare
 * `pull_request:` and must keep a `push:` filter (dropping the whole `on:`
 * block is not an acceptable way to satisfy this guard).
 */
const PR_GATED_WORKFLOWS = ['ci-ndk-guard.yml', 'ci-unit.yml', 'e2e.yml', 'prettier.yml']

/**
 * The mapping keys under `pull_request:` that filter on the PR's **base ref**.
 * `branches-ignore` is the complement of `branches` and re-narrows CI exactly
 * the same way: `pull_request: branches-ignore: [auctions]` runs no check-suite
 * for a PR whose base *is* `auctions`, which is the zero-run class this guard
 * exists to prevent.
 */
const BASE_FILTER_KEYS = ['branches', 'branches-ignore']

function workflowText(name: string): string {
	return readFileSync(join(WORKFLOWS_DIR, name), 'utf8')
}

/**
 * The lines of a workflow's top-level `on:` block, with `#` comment lines and
 * blank lines dropped so prose about triggers is never read as a trigger.
 */
function onBlock(yaml: string): string[] {
	const lines = yaml.split('\n')
	const start = lines.indexOf('on:')
	if (start < 0) throw new Error('workflow has no top-level `on:` block')
	const end = lines.findIndex((line, index) => index > start && /^[a-z]/.test(line))
	return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line.trim() !== '' && !/^\s*#/.test(line))
}

/**
 * The child lines of one entry under `on:`.
 *
 * `null` means the entry is absent entirely; `[]` means it is present and bare
 * (no mapping) — which is exactly the shape this guard requires of
 * `pull_request:`.
 */
function triggerChildren(on: string[], key: string): string[] | null {
	const start = on.findIndex((line) => line.startsWith(`  ${key}:`))
	if (start < 0) return null
	const children: string[] = []
	const inline = on[start].slice(`  ${key}:`.length).trim()
	if (inline !== '') children.push(inline)
	for (let index = start + 1; index < on.length; index++) {
		// Anything dedented back to a sibling trigger key ends this entry.
		if (!on[index].startsWith('    ')) break
		children.push(on[index].trim())
	}
	return children
}

/**
 * The mapping keys declared on one inline flow-mapping line, e.g.
 * `{ branches: [main], types: [opened] }` → `['branches', 'types']`.
 *
 * `null` means the line is not an inline flow mapping. The split on `,` is
 * deliberately shallow — a nested list value (`branches: [main, dev]`) yields a
 * trailing fragment like `dev]`, which is harmless because a base-filter key is
 * always the *first* token of its entry and is always found.
 */
function inlineMappingKeys(line: string): string[] | null {
	const trimmed = line.trim()
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
	return trimmed
		.slice(1, -1)
		.split(',')
		.map((entry) =>
			entry
				.split(':')[0]
				.trim()
				.replace(/^['"]|['"]$/g, ''),
		)
		.filter((entry) => entry !== '')
}

/**
 * The mapping keys a trigger declares, e.g. `['branches']` or `['types']`.
 *
 * Reads both the block form (`branches:` as its own child line, the house
 * convention) and the inline flow-mapping form (`pull_request: { branches:
 * [main] }`), which carries the whole mapping on one child line. Without the
 * inline branch the key would read as `{ branches` and slip past both this
 * guard's offender check and the isolated third test.
 */
function triggerKeys(children: string[] | null): string[] {
	return (children ?? []).flatMap((line) => inlineMappingKeys(line) ?? [line.split(':')[0].trim()])
}

/** Every branch name a `branches:` filter declares, inline or list form. */
function branchEntries(children: string[] | null): string[] {
	const inline = (children ?? []).find((line) => /^branches\s*:\s*\S/.test(line))
	if (inline) {
		return inline
			.replace(/^branches\s*:\s*/, '')
			.replace(/^\[|\]$/g, '')
			.split(',')
			.map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
			.filter((entry) => entry !== '')
	}
	return (children ?? [])
		.filter((line) => line.startsWith('- '))
		.map((line) =>
			line
				.slice(2)
				.trim()
				.replace(/^['"]|['"]$/g, ''),
		)
}

describe('PR-gated workflows accept every PR base', () => {
	for (const name of PR_GATED_WORKFLOWS) {
		test(`${name} declares pull_request (so the trigger still exists)`, () => {
			const children = triggerChildren(onBlock(workflowText(name)), 'pull_request')
			expect(children).not.toBeNull()
		})

		test(`${name} keeps the push: branch filter intact (so dropping the on: block is not a pass)`, () => {
			// Deleting the whole `on:` block would also satisfy "no branches under
			// pull_request", so pin the push filter that must survive: the fix
			// drops the base filter for PRs, it does not change push behaviour.
			// This test therefore says nothing about pull_request activity types;
			// test 1 (`declares pull_request`) is what pins its presence.
			const on = onBlock(workflowText(name))
			const push = triggerChildren(on, 'push')
			expect(push).not.toBeNull()
			expect(triggerKeys(push)).toContain('branches')
			expect(branchEntries(push).length).toBeGreaterThan(0)
		})

		test(`${name} pull_request has no branches/branches-ignore filter — re-adding one sends stacked PRs back to zero check-runs`, () => {
			// The regression this guards: a PR based on `auctions`, `security/**`
			// or `pr/**` matches no base branch, so GitHub creates no check-suite
			// for it at all. A `branches:` or `branches-ignore:` key under
			// `pull_request:` here fails with the offending line named — in block
			// form or in the inline flow-mapping form (`{ branches: [main] }`).
			const children = triggerChildren(onBlock(workflowText(name)), 'pull_request')
			const baseFilterLines = (children ?? []).filter(
				(line) => /^branches(-ignore)?\s*:/.test(line) || (inlineMappingKeys(line) ?? []).some((key) => BASE_FILTER_KEYS.includes(key)),
			)
			expect(baseFilterLines).toEqual([])
		})
	}
})

describe('no workflow gates pull_request on the base branch', () => {
	test('every workflow in .github/workflows is base-agnostic for pull_request', () => {
		// The sweep, not just the four: a fifth workflow added later with
		// `pull_request: branches:` (or `branches-ignore:`, its base-ref
		// complement) would recreate the same zero-run class for whatever base it
		// omits. `types:` (preview-deploy.yml) and `paths:`
		// (preview-infra-tests.yml) are legitimate activity/path filters and are
		// not base filters. `.yaml` is read as well as `.yml`, so a workflow
		// written with the long extension is swept too.
		const offenders: string[] = []
		for (const name of readdirSync(WORKFLOWS_DIR).filter((file) => /\.ya?ml$/.test(file))) {
			const children = triggerChildren(onBlock(workflowText(name)), 'pull_request')
			if (children !== null && triggerKeys(children).some((key) => BASE_FILTER_KEYS.includes(key))) offenders.push(name)
		}
		expect(offenders).toEqual([])
	})
})
