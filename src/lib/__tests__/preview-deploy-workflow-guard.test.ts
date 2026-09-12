/**
 * Regression guards for the Preview Deploy workflow
 * (`.github/workflows/preview-deploy.yml`) and the provisioning entrypoint it
 * calls (`infra/preview-vps/provision.sh`).
 *
 * Two real incidents motivated these assertions:
 *
 *  1. The preflight guard (`Check preview VPS secrets`) asserted only the four
 *     `PREVIEW_VPS_*` secrets, while `provision.sh` also hard-requires
 *     `PREVIEW_CLOUDFLARE_API_TOKEN` and `PREVIEW_CLOUDFLARE_ZONE_ID`
 *     (`${VAR:?…}`). With the four VPS secrets configured and the two
 *     Cloudflare ones missing, the deploy proceeded and died at
 *     `provision.sh: line 39: PREVIEW_CLOUDFLARE_API_TOKEN is required` — a red
 *     check instead of the intended loud skip.
 *  2. The `teardown` job never checked the repository out, so `gh pr comment`
 *     failed with `fatal: not a git repository` and the "Preview torn down"
 *     comment was never posted (observed on the closed predecessor PR #1257).
 *
 * These are text-level assertions on purpose: the workflow is the artifact under
 * test, and the repo carries no YAML dependency to parse it with.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOW_PATH = '.github/workflows/preview-deploy.yml'
const PROVISION_PATH = 'infra/preview-vps/provision.sh'

const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_PATH), 'utf8')
const provision = readFileSync(join(REPO_ROOT, PROVISION_PATH), 'utf8')

/** Names `provision.sh` aborts on when unset: `${NAME:?message}`. */
function provisionRequiredSecrets(): string[] {
	const names = [...provision.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1])
	return [...new Set(names)].sort()
}

/** Slice one top-level job block out of the workflow text. */
function jobBlock(name: string): string {
	const start = workflow.indexOf(`\n  ${name}:\n`)
	if (start < 0) throw new Error(`job not found in ${WORKFLOW_PATH}: ${name}`)
	const rest = workflow.slice(start + 1)
	const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/)
	return next < 0 ? rest : rest.slice(0, next + 1)
}

/** Split a job block into its `steps:` entries (6-space list items). */
function stepsOf(job: string): string[] {
	const starts = [...job.matchAll(/^ {6}- /gm)].map((m) => m.index as number)
	return starts.map((s, i) => job.slice(s, starts[i + 1] ?? job.length))
}

function stepNamed(job: string, name: string): string {
	const hit = stepsOf(job).find((s) => s.includes(`- name: ${name}`))
	if (!hit) throw new Error(`step not found: ${name}`)
	return hit
}

/** Secret names a step injects via `NAME: ${{ secrets.NAME }}` (env blocks). */
function secretsInjectedBy(step: string): string[] {
	return [...step.matchAll(/([A-Z][A-Z0-9_]*): \$\{\{ secrets\.[A-Z0-9_]+ \}\}/g)].map((m) => m[1])
}

/** Drop `#` comment lines so prose about secrets is not read as a secret use. */
function stripComments(step: string): string {
	return step
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n')
}

/** Every `PREVIEW_*` secret a step references, env block or action input. */
function previewSecretRefs(step: string): string[] {
	return [...new Set([...stripComments(step).matchAll(/secrets\.(PREVIEW_[A-Z0-9_]+)/g)].map((m) => m[1]))]
}

/** The `run:` body of a step, with YAML indentation stripped. */
function runBody(step: string): string {
	const at = step.indexOf('\n        run:')
	return at < 0 ? '' : step.slice(at)
}

const required = provisionRequiredSecrets()
const deployJob = jobBlock('deploy')
const teardownJob = jobBlock('teardown')

describe('preview deploy preflight guard', () => {
	test('provision.sh hard-requires the six preview secrets', () => {
		expect(required).toEqual([
			'PREVIEW_CLOUDFLARE_API_TOKEN',
			'PREVIEW_CLOUDFLARE_ZONE_ID',
			'PREVIEW_VPS_HOST',
			'PREVIEW_VPS_HOST_FINGERPRINT',
			'PREVIEW_VPS_SSH_KEY',
			'PREVIEW_VPS_USER',
		])
	})

	test('the deploy guard asserts exactly the secrets provision.sh requires', () => {
		const guard = stepNamed(deployJob, 'Check preview VPS secrets')
		expect(secretsInjectedBy(guard).sort()).toEqual(required)
	})

	test("the deploy guard's run condition tests every asserted secret", () => {
		// Injected into `env:` but never tested means the guard silently
		// claims readiness while provision.sh aborts later.
		const body = runBody(stepNamed(deployJob, 'Check preview VPS secrets'))
		for (const name of required) {
			expect(body).toContain(name)
		}
	})

	test('the deploy guard skips loudly instead of failing', () => {
		const body = runBody(stepNamed(deployJob, 'Check preview VPS secrets'))
		expect(body).toContain('previews_ready=false')
		expect(body).toContain('::warning')
		expect(body).toContain('missing_secrets')
		// A guard that exits non-zero turns an unconfigured repo red.
		expect(body).not.toMatch(/exit\s+1/)
	})

	test('every deploy step consuming a preview secret is gated on readiness', () => {
		const consuming = stepsOf(deployJob).filter((s) => previewSecretRefs(s).length > 0 && !s.includes('- name: Check preview VPS secrets'))
		expect(consuming.length).toBeGreaterThanOrEqual(4)
		for (const step of consuming) {
			if (step.includes('steps.secrets.outputs.previews_ready == ')) continue
			// Ungated consumption is only acceptable when the step is explicitly
			// best-effort and cannot turn the check red.
			expect(step).toContain('continue-on-error: true')
		}
	})
})

describe('preview teardown job', () => {
	test('gives the gh CLI a repository context so the comment can be posted', () => {
		// The teardown job intentionally has no checkout (the PR's head branch may
		// be gone once it closes), so `gh` must be told the repo explicitly —
		// otherwise `gh pr comment` dies with
		// `failed to run git: fatal: not a git repository`.
		expect(stepNamed(teardownJob, 'Update PR comment (torn down)')).toContain('GH_REPO: ${{ github.repository }}')
	})

	test('guards its VPS and DNS steps on the same secret set', () => {
		const guard = stepNamed(teardownJob, 'Check preview VPS secrets')
		expect(secretsInjectedBy(guard).sort()).toEqual(required)

		for (const name of ['Release port offset, stop containers, clean up VPS directory', 'Delete Cloudflare DNS record']) {
			expect(stepNamed(teardownJob, name)).toContain('steps.secrets.outputs.previews_ready == ')
		}
	})

	test('always updates the PR comment, even when secrets are absent', () => {
		const body = stepNamed(teardownJob, 'Update PR comment (torn down)')
		expect(body).toContain('!cancelled()')
		expect(body).not.toMatch(/steps\.secrets\.outputs\.previews_ready == /)
	})
})

/**
 * A third incident motivated this block: the preview's `nak-relay` service
 * pulled `ghcr.io/fiatjaf/nak:latest`, and that registry now denies anonymous
 * pulls (the token request returns no token and the manifest GET is denied).
 * `docker compose up` aborted inside "Claim host-port offset (M6) then bring
 * up services", the Cloudflare DNS step never ran, and the preview URL stayed
 * `NXDOMAIN`. The image is now built from source on the preview host.
 */
describe('preview nak relay image', () => {
	const BUILD_STEP = 'Build nak image on VPS (registry image is gone)'
	const CLAIM_STEP = 'Claim host-port offset (M6) then bring up services'
	const NAK_IMAGE = 'market-nak:b6568388'
	/** The upstream commit the host build checks out. */
	const NAK_COMMIT = 'b65683886b58382890888fbdda90e5c2129df488'

	test('the workflow never references the dead ghcr.io nak image again', () => {
		expect(workflow).not.toContain('ghcr.io/fiatjaf/nak')
	})

	test('the nak-relay compose service uses the image built on the host', () => {
		// The compose file is a heredoc inside the claim/up step, so assert on
		// that step's body: the `nak-relay:` service must name the local tag.
		expect(stepNamed(deployJob, CLAIM_STEP)).toMatch(new RegExp(`nak-relay:\\s*\\n\\s+image:\\s*${NAK_IMAGE}`))
	})

	test('the build step exists, is gated on readiness, and precedes compose up', () => {
		const build = stepNamed(deployJob, BUILD_STEP)
		expect(build).toContain('steps.secrets.outputs.previews_ready == ')

		// Ordering is the substance of the fix: `docker compose up` resolves the
		// tag, so a build that ran after the claim/up step would still fail.
		const stepOrder = stepsOf(deployJob).map((s) => /- name: (.+)/.exec(s)?.[1]?.trim() ?? '')
		expect(stepOrder.indexOf(BUILD_STEP)).toBeGreaterThanOrEqual(0)
		expect(stepOrder.indexOf(BUILD_STEP)).toBeLessThan(stepOrder.indexOf(CLAIM_STEP))
	})

	test('the build step shells out through the pinned-OpenSSH helper, not an action', () => {
		const build = stepNamed(deployJob, BUILD_STEP)
		// A `uses:` action here would break the pinned-OpenSSH host-key rule
		// (infra/preview-vps/test_pinned_openssh.sh), so this must be a `run:`.
		expect(build).toContain('infra/preview-vps/remote-ssh.sh')
		expect(build).not.toMatch(/^\s+uses:/m)
		// The build is pinned to a commit and cached so repeat deploys skip it.
		expect(build).toContain(NAK_COMMIT)
		expect(build).toContain(`docker image inspect ${NAK_IMAGE}`)
	})
})
