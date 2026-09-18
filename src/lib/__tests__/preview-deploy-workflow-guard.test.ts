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

/**
 * A fourth incident motivated this block: the PR #1271 preview deployed, its
 * health check ran, and it served a BLANK page. `GET /` answered
 * `HTTP/1.1 200 OK` with a zero-length body and no Content-Type while
 * `/api/config` returned normal JSON and the app logged a clean startup, so
 * nothing in the pipeline noticed. Two independent causes:
 *
 *  1. `src/index.tsx` has no static middleware: it imports `./index.html` and
 *     hands that import to Bun as the `/*` route, so Bun bundles the shell at
 *     REQUEST time inside the preview container. That bundle resolves
 *     `../public/images/logo.svg` and `/styles/index.css`, and the deploy
 *     package shipped neither:
 *       error: Could not resolve: "../public/images/logo.svg"
 *       error: Could not resolve: "/styles/index.css"
 *     That also broke the `serveStatic` routes reading `public/`
 *     (`/manifest.json`, `/favicon.ico` answered 500).
 *  2. The container ran `bun install --production`, which drops the
 *     `tailwindcss` devDependency while keeping `bun-plugin-tailwind` — the
 *     dependency that `bunfig.toml` enables to resolve the stylesheet's
 *     `@import 'tailwindcss'`. The request-time bundle then fails:
 *       error: Could not resolve: "tailwindcss" at styles/globals.css:1:1
 *     Measured live in the preview container (oven/bun:1.4.1):
 *       `bun install --production` -> GET / = HTTP 500 "Build Failed", 0 bytes
 *       `bun install`              -> GET / = HTTP 200 text/html, 891 bytes
 *
 * The empty body stayed invisible because the health check was `curl -sf`,
 * which exits 0 on a 200 whose body is zero bytes.
 */
describe('preview app serves a real document', () => {
	const PACKAGE_STEP = 'Create deployment package'
	const CLAIM_STEP = 'Claim host-port offset (M6) then bring up services'
	const HEALTH_STEP = 'Health check'

	test('the deploy package ships the assets the request-time HTML bundle needs', () => {
		const body = runBody(stepNamed(deployJob, PACKAGE_STEP))
		// `public/` and `styles/` are both copied; assert on the cp line itself
		// rather than a fixed ordering of the arguments.
		expect(body).toMatch(/^\s*cp -r .*\bpublic\b.* deploy-package\/$/m)
		expect(body).toMatch(/^\s*cp -r .*\bstyles\b.* deploy-package\/$/m)
		// bunfig.toml carries `[serve.static] plugins = ["bun-plugin-tailwind"]`,
		// the plugin that resolves the stylesheet's tailwind import.
		expect(body).toContain('cp bunfig.toml deploy-package/')
		// The Dockerfile is baked into the uploaded package and built into the
		// prebuilt app image on the host.
		expect(body).toContain('app.Dockerfile deploy-package/Dockerfile')
	})

	test('the app container starts the prebuilt image (no install at container start)', () => {
		// Deps are baked into market-app:<sha> by the VPS build step, so the
		// compose must not install anything when the container starts (that was
		// the ~5 min cold start). Comments are stripped so prose explaining the
		// history is not read as a use.
		const body = stripComments(runBody(stepNamed(deployJob, CLAIM_STEP)))
		expect(body).not.toContain('bun install')
		expect(body).toContain('image: market-app:${{ github.sha }}')
		expect(body).toContain('bun run start:production')
	})

	test('the app image is built on the CI runner with a PR-scoped label', () => {
		const CI_BUILD_STEP = 'Build app image on CI runner'
		const build = stepNamed(deployJob, CI_BUILD_STEP)
		// Gated with the rest of the deploy path, so a fork PR that skips the
		// VPS steps does not build an image it cannot ship.
		expect(build).toContain('steps.secrets.outputs.previews_ready == ')
		// Built with the runner's own Docker, not an action and not over SSH.
		expect(build).toContain('docker build')
		expect(build).not.toContain('infra/preview-vps/remote-ssh.sh')
		expect(build).not.toMatch(/^\s+uses:/m)
		// The label is what lets deploy/teardown garbage-collect this PR's
		// images without touching other previews.
		expect(build).toContain('--label "preview.pr=${{ github.event.pull_request.number }}"')
		expect(build).toContain('market-app:${{ github.sha }}')
		// The built commit is baked into the image so the health check can
		// prove the served artifact is the one we built.
		expect(build).toContain('--build-arg APP_COMMIT_SHA=${{ github.sha }}')
		// The deploy package (assembled above) is the build context, the last
		// argument of the `docker build` invocation.
		expect(runBody(build)).toMatch(/\n\s+deploy-package\n/)
	})

	test('the VPS no longer builds the app image', () => {
		// Regression guard for the disk-starved on-host build that pushed the
		// job past its timeout (run 35265465544, "Build app image on VPS"
		// cancelled at 10m09s). The image is built on the runner and shipped.
		// Assert on the step definition, not the phrase: the workflow comments
		// still name the removed step when explaining the history.
		expect(workflow).not.toContain('- name: Build app image on VPS')
	})

	test('the image is shipped over the pinned OpenSSH helper before compose up', () => {
		const SHIP_STEP = 'Ship app image to VPS'
		const ship = stepNamed(deployJob, SHIP_STEP)
		expect(ship).toContain('steps.secrets.outputs.previews_ready == ')
		expect(ship).toContain('infra/preview-vps/remote-ssh.sh')
		expect(ship).not.toMatch(/^\s+uses:/m)
		// Streamed `docker save | gzip | … 'gunzip | docker load'`, so no temp
		// file is written on either side.
		expect(ship).toContain('docker save')
		expect(ship).toContain('gzip')
		expect(ship).toContain('docker load')

		const stepOrder = stepsOf(deployJob).map((s) => /- name: (.+)/.exec(s)?.[1]?.trim() ?? '')
		expect(stepOrder.indexOf(SHIP_STEP)).toBeGreaterThanOrEqual(0)
		expect(stepOrder.indexOf(SHIP_STEP)).toBeLessThan(stepOrder.indexOf(CLAIM_STEP))
	})

	test('deploy prunes older same-PR images by label after shipping', () => {
		const prune = stepNamed(deployJob, 'Prune older app images for this PR')
		expect(prune).toContain('steps.secrets.outputs.previews_ready == ')
		expect(prune).toContain('infra/preview-vps/remote-ssh.sh')
		expect(prune).toContain('label=preview.pr=$PR_NUMBER')
		expect(prune).toContain('docker image rm')
	})

	test('teardown removes every image the PR shipped, scoped by label', () => {
		const clean = stepNamed(teardownJob, 'Release port offset, stop containers, clean up VPS directory')
		expect(clean).toContain('label=preview.pr=$PR_NUMBER')
		expect(clean).toContain('docker image rm')
		expect(clean).toContain('docker image prune')
		// The build-cache sweep is scoped so it does not cold-build the shared
		// nak image for the next deploy.
		expect(clean).toContain('--filter until=24h')
	})

	test('the deploy job allows enough time to build and stream the image', () => {
		const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(deployJob)?.[1])
		expect(minutes).toBeGreaterThanOrEqual(20)
	})

	test('the image Dockerfile installs the full dependency set', () => {
		// Full `bun install` (not `--production`) so the tailwindcss
		// devDependency the request-time HTML bundle needs is present.
		const dockerfile = readFileSync(join(REPO_ROOT, 'infra/preview-vps/app.Dockerfile'), 'utf8')
		expect(dockerfile).toContain('bun install')
		expect(dockerfile).not.toContain('bun install --production')
	})

	test('the health check requires a non-empty HTML body, not merely a status', () => {
		// Comments are stripped so prose ABOUT `curl -sf` is not read as a use.
		const body = stripComments(runBody(stepNamed(deployJob, HEALTH_STEP)))
		expect(body).not.toContain('curl -sf')
		expect(body).not.toContain('-o /dev/null')
		// Assert a byte count and the app's doctype, so a 200 with an empty
		// body fails instead of being reported as "Preview is live".
		expect(body).toContain('wc -c')
		expect(body).toContain('-gt 0')
		expect(body).toContain('<!doctype html')
	})

	test('the app advertises a browser-reachable wss relay URL', () => {
		// The browser cannot resolve the compose-internal nak-relay:10547, and
		// a plain ws:// relay on the https preview is mixed-content blocked.
		// The app must advertise the same host's /relay path over wss.
		const body = stripComments(runBody(stepNamed(deployJob, CLAIM_STEP)))
		expect(body).toContain('APP_RELAY_URL=wss://${{ steps.ports.outputs.subdomain }}/relay')
		expect(body).not.toContain('APP_RELAY_URL=ws://nak-relay:10547')
	})

	test('the health check also proves the relay WebSocket is reachable', () => {
		// An app that serves HTML but cannot reach its relay is not a preview
		// of this application (review finding 2, 2026-09-17).
		const body = stripComments(runBody(stepNamed(deployJob, HEALTH_STEP)))
		expect(body).toContain('wss://${{ steps.ports.outputs.subdomain }}/relay')
		expect(body).toContain('new WebSocket')
		expect(body).toContain('REQ')
	})

	test('a failed health check turns the Deploy preview check red', () => {
		// continue-on-error keeps the comment posting, but the check must not
		// stay green when the preview did not serve.
		const fail = stepNamed(deployJob, 'Fail the check when the preview did not serve')
		expect(fail).toContain("steps.health.outcome == 'failure'")
		expect(fail).toContain('previews_ready == ')
		expect(fail).toContain('exit 1')
	})

	test('the image Dockerfile bakes the commit after the dependency layer', () => {
		// APP_COMMIT_SHA must be baked (ENV), and placed after `RUN bun install`
		// so a per-commit ARG change does not invalidate the dependency cache.
		const dockerfile = readFileSync(join(REPO_ROOT, 'infra/preview-vps/app.Dockerfile'), 'utf8')
		expect(dockerfile).toContain('ARG APP_COMMIT_SHA')
		expect(dockerfile).toContain('ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}')
		expect(dockerfile.indexOf('RUN bun install')).toBeLessThan(dockerfile.indexOf('ARG APP_COMMIT_SHA'))
	})

	test('the health check asserts the served commit matches the built one', () => {
		// The image surfaces the commit on /api/config; the health check must
		// assert the live value equals the commit we built (${{ github.sha }}),
		// so a stale/wrong artifact fails instead of reporting a working preview.
		const body = stripComments(runBody(stepNamed(deployJob, HEALTH_STEP)))
		expect(body).toContain('/api/config')
		expect(body).toContain("jq -r '.commit // empty'")
		expect(body).toContain('"$SERVED_COMMIT" = "${{ github.sha }}"')
	})

	test('the PR comment reports the served commit and the PR head', () => {
		const body = stripComments(runBody(stepNamed(deployJob, 'Post / update preview URL PR comment')))
		expect(body).toContain('(served, verified)')
		expect(body).toContain('PR head:')
		expect(body).toContain('${{ github.event.pull_request.head.sha }}')
	})
})
