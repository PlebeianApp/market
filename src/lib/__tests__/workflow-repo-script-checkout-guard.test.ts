/**
 * Class-level guard: a job that runs a repository-local script must check the
 * repository out.
 *
 * Incident (issue #1358). The `teardown` job of
 * `.github/workflows/preview-deploy.yml` ran `infra/preview-vps/ssh-prepare.sh`
 * and `infra/preview-vps/remote-ssh.sh` with **no** `actions/checkout`, so on
 * the first in-repo PR close it died with
 *
 *   bash: infra/preview-vps/ssh-prepare.sh: No such file or directory
 *   ##[error]Process completed with exit code 127
 *
 * The `success()`-implied cleanup and DNS steps were then skipped, and the
 * notification step still published "Preview torn down … DNS record deleted"
 * (run 35327856582). It survived review because the job's missing checkout was
 * deliberate — the head branch can be gone by the time a PR closes, so a
 * ref-dependent checkout can fail — and because 12 of the 13 times the job had
 * ever run were fork closes where the whole VPS/DNS path skips *green*:
 * "green on every close" meant "skipped on every close".
 *
 * The workflow's own guard test
 * (`preview-deploy-workflow-guard.test.ts`) asserted a dozen teardown
 * properties and still certified the defect — it never asked whether a job that
 * runs a repo-local script can actually reach it. This file asks that question
 * of EVERY job in EVERY workflow, so the class is closed rather than the
 * instance. It is text-level parsing on purpose, matching the existing
 * workflow guards: the repo carries no YAML dependency to parse with, and
 * `bun run test:unit` globs `src/lib/__tests__`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows')

/**
 * Directory prefixes whose committed files a `run:` step executes or reads
 * directly. Deliberately NOT `src/` / `public/` / `dist/` / `deploy-package/`:
 * the first two are inputs to a build that has already checked out, and the
 * last two are produced by the job itself, so neither is evidence that a
 * checkout is required.
 */
const REPO_SCRIPT_REF = /(?:^|[\s'"=(])(?:\.\/)?(?:infra|scripts|e2e|\.github)\/[\w./-]+/

/**
 * Second, directory-agnostic rule: a repo-relative path with an executable
 * extension. Without it a new `tools/thing.sh` or a root-level `./tool.sh` would
 * slip past the four prefixes above — and a hand-maintained path list silently
 * narrowing the claim is the exact failure this file exists to prevent.
 * Build outputs (`deploy-package/`, `dist/`, `node_modules/`) are excluded
 * because they are produced by the job, not checked out. URLs are excluded by
 * the scheme guard, so a link in a log message is not read as an execution.
 */
const REPO_SCRIPT_FILE =
	/(?:^|[\s'"=(])(?!https?:\/\/)(?:\.\/)?(?!deploy-package\/|dist\/|node_modules\/)[\w.-]+\/[\w./-]+\.(?:sh|bash|py|ts|tsx|js|mjs|cjs)/

type Job = { file: string; name: string; body: string }

/** Every top-level job of a workflow, sliced out by its 2-space key. */
function jobsOf(file: string, text: string): Job[] {
	const lines = text.split('\n')
	const jobsAt = lines.findIndex((line) => line.trimEnd() === 'jobs:')
	if (jobsAt < 0) return []
	const starts: { name: string; at: number }[] = []
	for (let i = jobsAt + 1; i < lines.length; i++) {
		const match = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(lines[i])
		if (match) starts.push({ name: match[1], at: i })
	}
	return starts.map((start, i) => ({
		file,
		name: start.name,
		body: lines.slice(start.at, starts[i + 1]?.at ?? lines.length).join('\n'),
	}))
}

/** A job's `steps:` entries (6-space list items, the shape all workflows here use). */
function stepsOf(job: Job): string[] {
	const starts = [...job.body.matchAll(/^ {6}- /gm)].map((match) => match.index as number)
	return starts.map((start, i) => job.body.slice(start, starts[i + 1] ?? job.body.length))
}

function hasStepsKey(job: Job): boolean {
	return /^\s+steps:\s*$/m.test(job.body)
}

function hasCheckout(job: Job): boolean {
	return stepsOf(job).some((step) => /^\s*(?:-\s+)?uses: actions\/checkout@/m.test(step))
}

/**
 * The `run:` bodies of a step, both block scalars and inline commands, with `#`
 * comment lines dropped so prose that merely names a path (every one of these
 * workflows carries long explanatory comments) is not read as an execution.
 */
function runBodies(step: string): string {
	const lines = step.split('\n')
	const out: string[] = []
	for (let i = 0; i < lines.length; i++) {
		const match = /^(\s*)run:\s*(.*)$/.exec(lines[i])
		if (!match) continue
		const indent = match[1].length
		out.push(match[2])
		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j]
			if (line.trim() === '') {
				out.push('')
				continue
			}
			if (line.length - line.trimStart().length > indent) out.push(line)
			else break
		}
	}
	return out.filter((line) => !/^\s*#/.test(line)).join('\n')
}

/** Does this job depend on files that only exist after a checkout? */
function needsRepoFiles(job: Job): boolean {
	return stepsOf(job).some(
		(step) => REPO_SCRIPT_REF.test(runBodies(step)) || REPO_SCRIPT_FILE.test(runBodies(step)) || /^\s*(?:-\s+)?uses: \.\//m.test(step),
	)
}

/** Jobs that run repo-local files without a checkout — the #1358 shape. */
function jobsMissingCheckout(file: string, text: string): string[] {
	return jobsOf(file, text)
		.filter((job) => needsRepoFiles(job) && !hasCheckout(job))
		.map((job) => job.name)
}

const workflowFiles = readdirSync(WORKFLOW_DIR)
	.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
	.sort()
const workflows = workflowFiles.map((name) => ({ name, text: readFileSync(join(WORKFLOW_DIR, name), 'utf8') }))
const allJobs = workflows.flatMap((wf) => jobsOf(wf.name, wf.text))

/**
 * A synthetic workflow, because the assertion above can only be trusted if the
 * detector provably bites. It carries one instance of each shape the detector
 * has to get right: a job that runs a repo script with no checkout (the
 * defect), the same job with a checkout (the fix), an inline `run:`, a
 * repo-relative path that appears only inside a comment (must NOT count), a
 * `./`-relative local action (must count) and a job with nothing repo-local.
 */
const FIXTURE = `name: Fixture
on: [push]
jobs:
  runs-script-without-checkout:
    runs-on: ubuntu-latest
    steps:
      - name: Run a repo script
        run: bash scripts/thing.sh
  runs-script-with-checkout:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Run a repo script
        run: bash scripts/thing.sh
  inline-run-without-checkout:
    runs-on: ubuntu-latest
    steps:
      - name: Inline
        run: python3 infra/preview-vps/helper.py
  unrouted-directory-without-checkout:
    runs-on: ubuntu-latest
    steps:
      - name: A directory the prefix list does not name
        run: bash tools/thing.sh
  root-level-script-without-checkout:
    runs-on: ubuntu-latest
    steps:
      - name: A root-level script
        run: ./tool.sh
  comment-only-mention:
    runs-on: ubuntu-latest
    steps:
      - name: Prose about a path
        run: |
          # see scripts/thing.sh for the history
          echo hello
  url-only-mention:
    runs-on: ubuntu-latest
    steps:
      - name: A link in a log line
        run: echo "see https://example.com/docs/thing.js"
  build-output-only:
    runs-on: ubuntu-latest
    steps:
      - name: A path the job produced itself
        run: cp deploy-package/ecosystem.config.cjs /tmp/
  local-action-without-checkout:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/build
  nothing-repo-local:
    runs-on: ubuntu-latest
    steps:
      - name: Nothing to see
        run: echo hi
`

describe('workflow job checkout guard', () => {
	test('the scan actually reaches the workflows and their jobs', () => {
		// A guard that parses nothing passes vacuously: `every job that runs a
		// repo script has a checkout` is trivially true over an empty set. Pin
		// the scan to the repository's real shape.
		expect(workflowFiles.length).toBeGreaterThanOrEqual(10)
		expect(allJobs.length).toBeGreaterThanOrEqual(15)
		// And prove the step parser agrees with the files: every job that
		// declares `steps:` must yield at least one step.
		const withSteps = allJobs.filter(hasStepsKey)
		expect(withSteps.length).toBeGreaterThanOrEqual(15)
		const unparsed = withSteps.filter((job) => stepsOf(job).length === 0).map((job) => `${job.file}:${job.name}`)
		expect(unparsed).toEqual([])
	})

	test('no job runs a repository-local script without checking the repository out', () => {
		const offenders = workflows.flatMap((wf) => jobsMissingCheckout(wf.name, wf.text))
		expect(offenders).toEqual([])
	})

	test('the detector finds the #1358 shape, and only that shape', () => {
		expect(jobsMissingCheckout('fixture.yml', FIXTURE)).toEqual([
			'runs-script-without-checkout',
			'inline-run-without-checkout',
			'unrouted-directory-without-checkout',
			'root-level-script-without-checkout',
			'local-action-without-checkout',
		])
	})

	test('a checkout in the job clears it, and prose is not evidence', () => {
		const found = jobsMissingCheckout('fixture.yml', FIXTURE)
		expect(found).not.toContain('runs-script-with-checkout')
		// A path in a comment, a path in a URL, and a path the job itself
		// produced are all NOT reasons to demand a checkout.
		expect(found).not.toContain('comment-only-mention')
		expect(found).not.toContain('url-only-mention')
		expect(found).not.toContain('build-output-only')
		expect(found).not.toContain('nothing-repo-local')
	})

	test('the teardown job of preview-deploy.yml is covered by this guard', () => {
		// Named explicitly so a future refactor of the detector cannot quietly
		// stop seeing the job that motivated the guard.
		const teardown = jobsOf('preview-deploy.yml', workflows.find((wf) => wf.name === 'preview-deploy.yml')!.text).find(
			(job) => job.name === 'teardown',
		)!
		expect(needsRepoFiles(teardown)).toBe(true)
		expect(hasCheckout(teardown)).toBe(true)
	})
})
