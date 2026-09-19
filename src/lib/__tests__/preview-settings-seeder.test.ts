/**
 * Guards `scripts/seed-preview-settings.ts` — the per-PR preview SETTINGS
 * seeder that lives on `demo/preview-deploy-20260918-170527` from PR #1356
 * (`feat(preview): seed the per-PR relay with app settings and optional dev
 * data`, merge 6aaff855; the merged blob is byte-identical to 93e8a8ba on that
 * PR's branch).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The settings seeder is the reason a preview boots configured instead of
 * sitting at `/setup — no app settings found`. The CONTENT seeder has unit
 * coverage (`src/lib/__tests__/preview-content-fixtures.test.ts`); the SETTINGS
 * seeder had none, so nothing failed if its idempotency probe, its env guard or
 * its place in the deploy job drifted. This file is that coverage. It is
 * TEST-ONLY: it changes no production file.
 *
 * WHAT IS FROZEN HERE
 * -------------------
 *  1. THE CONTRACT THE APP READS — the three boot events (kind 31990 app
 *     settings carrying `d=plebeian-market-handler`, the kind 30000 admin list,
 *     the kind 10002 relay list) and the exact `d` tag and kind that
 *     `src/lib/appSettings.ts` accepts when it looks for settings to boot from.
 *  2. GUARD — missing `APP_RELAY_URL` / `APP_PRIVATE_KEY` exits 1 with the
 *     explicit message and publishes nothing.
 *  3. IDEMPOTENCY — against a hermetic in-process relay stub:
 *       * an EMPTY relay is seeded with exactly those three events, in order,
 *         all authored by the app key;
 *       * a SECOND run against that same now-seeded relay prints
 *         `already-seeded` and publishes ZERO further events — the property the
 *         deploy workflow relies on so a redeploy never duplicates state;
 *       * the probe is scoped to the APP pubkey, so settings written by some
 *         other key do not make the seeder think the preview is configured.
 *     The stub is `Bun.serve` on 127.0.0.1 with no external service and no
 *     public relay — ADR-0005 test isolation, the same rule the content seeder
 *     test follows.
 *  4. WIRING + ORDER — exactly ONE workflow invokes the seeder
 *     (`preview-deploy.yml`, the per-PR preview deploy), its step is gated on
 *     preview readiness, and inside that deploy job the order is
 *     settings → `docker compose restart market-app` → content. The restart is
 *     not optional (the app caches app settings and the admin list at startup)
 *     and at this revision it lives INSIDE the settings step, as a remote
 *     `docker compose restart` over `infra/preview-vps/remote-ssh.sh` — not as
 *     a step of its own. Content is read per request, so it only has to come
 *     after the restart. No other workflow (production, staging, auctionsdev,
 *     the infra tests) may reference either preview seeder.
 *
 * PITFALLS PAID FOR IN THIS FILE
 * ------------------------------
 *  * `Bun.spawnSync` DEADLOCKS here. The relay stub lives in THIS process, so a
 *    synchronous spawn blocks the very event loop that has to answer the child.
 *    `runSeeder` is async (`Bun.spawn`) for that reason — do not "simplify" it.
 *  * A step's slice runs to the next `- ` list item, so the comment block that
 *    sits ABOVE the content-seeding step belongs to the SETTINGS step's slice.
 *    Both steps are also named `Seed preview relay …`. Locating a step by its
 *    NAME (or by a bare file name that a neighbouring comment mentions)
 *    therefore resolves both lookups to the same step and the ordering
 *    assertions go vacuous. Steps are located by the command they RUN.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { hexToBytes } from '@noble/hashes/utils.js'
import { getPublicKey } from 'nostr-tools/pure'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const SEEDER = 'scripts/seed-preview-settings.ts'
const CONTENT_SEEDER = 'scripts/seed-preview-content.ts'
const APP_SETTINGS_MODULE = 'src/lib/appSettings.ts'
const PREVIEW_WORKFLOW = '.github/workflows/preview-deploy.yml'

/** The preview app key the deploy workflow passes as `APP_PRIVATE_KEY`. */
const PREVIEW_APP_PRIVATE_KEY = 'e2e0000000000000000000000000000000000000000000000000000000000001'
const APP_PUBKEY = getPublicKey(hexToBytes(PREVIEW_APP_PRIVATE_KEY))

/** Must match the seeder's constants AND the coordinates `src/lib/appSettings.ts` accepts. */
const APP_SETTINGS_KIND = 31990
const ADMIN_LIST_KIND = 30000
const RELAY_LIST_KIND = 10002
const APP_SETTINGS_D_TAG = 'plebeian-market-handler'

/** Read a repo file inside a test, so a missing file is a named failure rather than a collection error. */
const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8')

// ── hermetic relay stub ──────────────────────────────────────────────────────
// The smallest NIP-01 server the seeder can talk to: REQ → matching stored
// events + EOSE, EVENT → store + OK. It is also the instrument that RECORDS
// what the seeder published, which is how "publishes nothing" is proven.

type StoredEvent = { id: string; kind: number; pubkey: string; tags: string[][] }
type Filter = { kinds?: number[]; authors?: string[]; '#d'?: string[]; limit?: number }

const matches = (event: StoredEvent, filter: Filter): boolean => {
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false
	if (filter.authors && !filter.authors.includes(event.pubkey)) return false
	if (filter['#d']) {
		const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
		if (!d || !filter['#d'].includes(d)) return false
	}
	return true
}

const startRelayStub = () => {
	const published: StoredEvent[] = []
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: (request, srv) => (srv.upgrade(request) ? undefined : new Response('relay stub', { status: 200 })),
		websocket: {
			message: (ws, raw) => {
				const message = JSON.parse(String(raw)) as [string, ...unknown[]]
				if (message[0] === 'REQ') {
					const [, subId, ...filters] = message as [string, string, ...Filter[]]
					for (const event of published) {
						if (filters.some((filter) => matches(event, filter))) ws.send(JSON.stringify(['EVENT', subId, event]))
					}
					ws.send(JSON.stringify(['EOSE', subId]))
					return
				}
				if (message[0] === 'EVENT') {
					const event = message[1] as StoredEvent
					published.push(event)
					ws.send(JSON.stringify(['OK', event.id, true, '']))
				}
			},
		},
	})
	return { url: `ws://127.0.0.1:${server.port}`, published, stop: () => server.stop(true) }
}

/**
 * Run the seeder in a subprocess with a clean env; returns exit code + output.
 *
 * ASYNC ON PURPOSE: `Bun.spawnSync` would block this process's event loop, and
 * the relay stub above lives in THIS process — a synchronous spawn deadlocks the
 * seeder against a relay that cannot answer until the spawn returns.
 */
const runSeeder = async (env: Record<string, string>) => {
	const base = { ...process.env } as Record<string, string | undefined>
	for (const key of ['APP_RELAY_URL', 'APP_PRIVATE_KEY']) delete base[key]
	const proc = Bun.spawn(['bun', 'run', SEEDER], {
		cwd: REPO_ROOT,
		env: { ...base, ...env },
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
	return { exitCode, stdout, stderr }
}

/** A seeder run that talks to the stub relay needs room for two subprocess boots. */
const SEEDER_TEST_TIMEOUT_MS = 30_000

describe('preview settings seeder — the coordinates the app boots from', () => {
	test('publishes the three boot events, under the kind and `d` tag appSettings.ts accepts', () => {
		const seederSource = readRepoFile(SEEDER)
		expect(seederSource).toContain('const APP_SETTINGS_KIND = 31990')
		expect(seederSource).toContain('const ADMIN_LIST_KIND = 30000')
		expect(seederSource).toContain('const RELAY_LIST_KIND = 10002')
		expect(seederSource).toContain(`const APP_SETTINGS_D_TAG = '${APP_SETTINGS_D_TAG}'`)

		// The `d` tag is half of the read-path contract: `appSettings.ts` accepts
		// settings only when they are kind 31990, authored by the app pubkey, AND
		// carry this exact tag (`src/lib/appSettings.ts:26-38`). If either side is
		// renamed alone, the preview boots into /setup with no failing test
		// anywhere — which is what this cross-check is for. It is a source-level
		// check on purpose: importing appSettings.ts would pull NDK into this unit
		// file, and the contract under test is the literal, not a computed value.
		const appSettingsSource = readRepoFile(APP_SETTINGS_MODULE)
		expect(appSettingsSource).toContain('export const APP_SETTINGS_KIND = 31990')
		expect(appSettingsSource).toContain(`export const APP_SETTINGS_D_TAG = '${APP_SETTINGS_D_TAG}'`)
	})
})

describe('preview settings seeder — guard', () => {
	test(
		'exits 1 and publishes nothing when APP_RELAY_URL and APP_PRIVATE_KEY are missing',
		async () => {
			const { exitCode, stderr, stdout } = await runSeeder({})
			expect(exitCode).toBe(1)
			expect(stderr).toContain('Missing required environment variables: APP_RELAY_URL and APP_PRIVATE_KEY')
			expect(stdout).not.toContain('seeded')
		},
		SEEDER_TEST_TIMEOUT_MS,
	)

	test(
		'exits 1 when only the relay URL is set',
		async () => {
			const stub = startRelayStub()
			try {
				const { exitCode, stderr } = await runSeeder({ APP_RELAY_URL: stub.url })
				expect(exitCode).toBe(1)
				expect(stderr).toContain('Missing required environment variables')
				expect(stub.published).toEqual([])
			} finally {
				stub.stop()
			}
		},
		SEEDER_TEST_TIMEOUT_MS,
	)
})

describe('preview settings seeder — idempotency', () => {
	test(
		'seeds an empty relay with settings + admin list + relay list, then no-ops on a re-run',
		async () => {
			const stub = startRelayStub()
			try {
				// ── first run on an empty relay ──
				const first = await runSeeder({ APP_RELAY_URL: stub.url, APP_PRIVATE_KEY: PREVIEW_APP_PRIVATE_KEY })
				expect(first.stderr).toBe('')
				expect(first.exitCode).toBe(0)
				expect(first.stdout.split('\n')).toContain('seeded')

				const kinds = stub.published.map((event) => event.kind)
				expect(kinds).toEqual([APP_SETTINGS_KIND, ADMIN_LIST_KIND, RELAY_LIST_KIND])
				for (const event of stub.published) expect(event.pubkey).toBe(APP_PUBKEY)

				const settings = stub.published.find((event) => event.kind === APP_SETTINGS_KIND)
				expect(settings?.tags.find((tag) => tag[0] === 'd')?.[1]).toBe(APP_SETTINGS_D_TAG)
				// The app accepts settings only from its own pubkey with that exact `d`
				// tag, which is why the idempotency probe filters on both.
				expect(settings?.tags.some((tag) => tag[0] === 'p')).toBe(false)
				expect(stub.published.find((event) => event.kind === ADMIN_LIST_KIND)?.tags).toContainEqual(['p', APP_PUBKEY])
				expect(stub.published.find((event) => event.kind === RELAY_LIST_KIND)?.tags).toContainEqual(['r', stub.url])

				// ── the proof that a re-deploy is a pure read ──
				const publishedAfterFirst = stub.published.length
				const second = await runSeeder({ APP_RELAY_URL: stub.url, APP_PRIVATE_KEY: PREVIEW_APP_PRIVATE_KEY })
				expect(second.exitCode).toBe(0)
				expect(second.stdout.split('\n')).toContain('already-seeded')
				expect(second.stdout).not.toContain('published app settings')
				expect(stub.published.length, 'a re-run published events — the preview would duplicate state on every deploy').toBe(
					publishedAfterFirst,
				)
			} finally {
				stub.stop()
			}
		},
		SEEDER_TEST_TIMEOUT_MS,
	)

	test(
		'settings written by a DIFFERENT key do not count as configured',
		async () => {
			const stub = startRelayStub()
			try {
				// A stranger's kind 31990 with the same `d` tag: the app would ignore it
				// (author filter), so the seeder must ignore it too and seed properly.
				stub.published.push({
					id: 'f'.repeat(64),
					kind: APP_SETTINGS_KIND,
					pubkey: '0'.repeat(64),
					tags: [['d', APP_SETTINGS_D_TAG]],
				})
				const { exitCode, stdout } = await runSeeder({ APP_RELAY_URL: stub.url, APP_PRIVATE_KEY: PREVIEW_APP_PRIVATE_KEY })
				expect(exitCode).toBe(0)
				expect(stdout.split('\n')).toContain('seeded')
				expect(stdout).not.toContain('already-seeded')
				expect(stub.published.filter((event) => event.pubkey === APP_PUBKEY).map((event) => event.kind)).toEqual([
					APP_SETTINGS_KIND,
					ADMIN_LIST_KIND,
					RELAY_LIST_KIND,
				])
			} finally {
				stub.stop()
			}
		},
		SEEDER_TEST_TIMEOUT_MS,
	)
})

describe('preview settings seeding — wiring and order', () => {
	const workflowsDir = '.github/workflows'
	const workflowPaths = readdirSync(join(REPO_ROOT, workflowsDir)).map((file) => `${workflowsDir}/${file}`)
	const workflow = readRepoFile(PREVIEW_WORKFLOW)

	/** Deploy-job steps, in file order (6-space list items inside `  deploy:`). */
	const deploySteps = (): string[] => {
		const jobStart = workflow.search(/^ {2}deploy:\s*$/m)
		if (jobStart < 0) throw new Error(`deploy job not found in ${PREVIEW_WORKFLOW}`)
		const nextJob = workflow.slice(jobStart + 1).search(/^ {2}[a-z][a-z0-9_-]*:\s*$/m)
		const job = nextJob < 0 ? workflow.slice(jobStart) : workflow.slice(jobStart, jobStart + 1 + nextJob)
		const starts = [...job.matchAll(/^ {6}- /gm)].map((match) => match.index as number)
		return starts.map((start, index) => job.slice(start, starts[index + 1] ?? job.length))
	}

	/**
	 * Locate the step that actually RUNS a seeder. Matching the invocation (not
	 * the step name, not the file name) matters: a step's slice runs to the next
	 * `- `, so the comment block above the content step attaches to the settings
	 * step, and both steps are named `Seed preview relay …` — a name-based lookup
	 * resolves both queries to the same step.
	 */
	const stepRunning = (script: string): { step: string; index: number } => {
		const needle = `bun run ${script}`
		const index = deploySteps().findIndex((step) => step.includes(needle))
		if (index < 0) throw new Error(`no deploy step in ${PREVIEW_WORKFLOW} runs '${needle}'`)
		return { step: deploySteps()[index], index }
	}

	test('exactly one workflow invokes the settings seeder, and it is the per-PR preview deploy', () => {
		const invoking = workflowPaths.filter((path) => readRepoFile(path).includes(SEEDER))
		expect(invoking).toEqual([PREVIEW_WORKFLOW])
	})

	test('the settings seeding step is gated on preview readiness', () => {
		const { step } = stepRunning(SEEDER)
		expect(step).toContain("steps.secrets.outputs.previews_ready == 'true'")
	})

	test('order inside the deploy job is settings → app restart → content', () => {
		const settings = stepRunning(SEEDER)
		const content = stepRunning(CONTENT_SEEDER)

		expect(settings.index, 'the settings seeder step must come first').toBeLessThan(content.index)

		// The restart is INSIDE the settings step at this revision (a remote
		// `docker compose restart market-app` over remote-ssh.sh), not a step of
		// its own — "somewhere between the two steps" would not find it.
		const seedAt = settings.step.indexOf(`bun run ${SEEDER}`)
		const restartAt = settings.step.indexOf('docker compose restart')
		expect(restartAt, 'app settings are cached at boot, so the settings step must restart the app after seeding').toBeGreaterThan(seedAt)
		expect(settings.step.slice(restartAt)).toContain('market-app')
	})

	test('the optional full dev-fixture seed stays anchored to the fresh-seed line', () => {
		const { step } = stepRunning(SEEDER)
		// `scripts/seed.ts` is the heavy fixture load; it may only run on the run
		// that actually seeded. The match is anchored (`^seeded$`) precisely so
		// that `already-seeded` on a redeploy does NOT trip it.
		expect(step).toContain('vars.PREVIEW_SEED_FULL')
		expect(step).toContain("grep -q '^seeded$'")
		expect(/^seeded$/.test('already-seeded'), 'an unanchored match would republish fixtures on every redeploy').toBe(false)
		expect(/^seeded$/.test('seeded')).toBe(true)
	})

	test('content seeding still follows the restart, which is what makes it correct', () => {
		const content = stepRunning(CONTENT_SEEDER)
		// The content step keeps its own guarantees: preview-gated, idempotent.
		expect(content.step).toContain("steps.secrets.outputs.previews_ready == 'true'")
		expect(content.step).toContain('already-seeded')
	})

	test('no non-preview workflow references either preview seeder', () => {
		// A production/staging/auctionsdev deploy must never carry these steps.
		for (const path of workflowPaths.filter((candidate) => candidate !== PREVIEW_WORKFLOW)) {
			const body = readRepoFile(path)
			expect(body.includes('seed-preview-settings'), `${path} references the preview settings seeder`).toBe(false)
			expect(body.includes('seed-preview-content'), `${path} references the preview content seeder`).toBe(false)
		}
	})
})
