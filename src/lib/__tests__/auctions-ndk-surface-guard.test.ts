/**
 * Tests for the auctions NDK-surface CI guard
 * (`scripts/check-auctions-ndk-surface.sh`).
 *
 * The guard resolves ROOT from its own location, so we can stage a throwaway
 * "repo" (scripts/ + src/) in a temp dir, copy the real script in, write the
 * production auctions files, and invoke it via bash — then assert on exit code
 * and stdout for the clean / dirty / allowlisted branches. One test runs the
 * real script against the real repo so the committed file set is covered.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, copyFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '..', '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-auctions-ndk-surface.sh')
const ALLOWLISTED_FILE = 'src/lib/auctions/privateAuctionClaimMessage.ts'

const NDK_PACKAGE = '@nostr-dev' + '-kit/ndk'
const NDK_IMPORT = `import { NDKEvent } from '${NDK_PACKAGE}'\n`
const NDK_ACTIONS = "import { ndkActions } from '@/lib/stores/ndk'\n"
const NDK_STORE = "import { ndkStore } from '@/lib/stores/ndk'\n"

/**
 * Run the guard. `strict` enables the coverage gate (pinned paths must exist,
 * glob families must match); staged throwaway repos disable it because they
 * carry only the handful of files a given test needs.
 */
function runGuard(root: string, strict = false): { exitCode: number; stdout: string; stderr: string } {
	const r = spawnSync('bash', [join(root, 'scripts', 'check-auctions-ndk-surface.sh')], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, AUCTIONS_GUARD_REQUIRE_COVERAGE: strict ? '1' : '0' },
	})
	return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const roots: string[] = []
async function stageRepo(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'auctions-ndk-guard-'))
	roots.push(root)
	await mkdir(join(root, 'scripts'), { recursive: true })
	await copyFile(SCRIPT, join(root, 'scripts', 'check-auctions-ndk-surface.sh'))
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(root, rel)
		await mkdir(dirname(abs), { recursive: true })
		await writeFile(abs, content)
	}
	return root
}

describe('auctions NDK-surface guard (scripts/check-auctions-ndk-surface.sh)', () => {
	afterEach(async () => {
		while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
	})

	test('exits 0 against the real repo — the production file set is clean', () => {
		const r = runGuard(ROOT, true)
		expect(r.stderr).toBe('')
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('Auctions NDK-surface guard:')
		expect(r.stdout).toContain('coverage strict=1')
		expect(r.stdout).toContain('OK')
	})

	test('fails closed when the file set is gutted (coverage gate, not a blind OK)', async () => {
		// A staged repo with only test files: every pinned path and glob family
		// is absent. Without the coverage gate this would print `scanned 0 … OK`
		// — the "silently blind guard" the review flagged.
		const root = await stageRepo({ 'src/lib/auction/whatever.test.ts': NDK_IMPORT })
		const r = runGuard(root, true)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('coverage check failed')
		expect(r.stdout).toContain('src/publish/auctions.tsx')
	})

	test('reads a newly created file under src/lib/auction/ (set completeness)', async () => {
		// The guard's own suite passed with `scanned 0` before this: prove that a
		// brand-new production file in the real auction directory is scanned and
		// flagged, so the directory cannot be a blind spot.
		const root = await stageRepo({ 'src/lib/auction/newlyAdded.ts': NDK_IMPORT })
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('src/lib/auction/newlyAdded.ts')
	})

	test('the guard source derives the auction directory and documents the scope gaps', async () => {
		const source = await readFile(SCRIPT, 'utf8')
		// The real directory must be scanned via a glob, not `src/lib/auction*.ts`.
		expect(source).toContain('src/lib/auction/*.ts')
		expect(source).toContain('AUCTIONS_GUARD_REQUIRE_COVERAGE')
		// The named out-of-scope file is documented, not silently ignored.
		expect(source).toContain('src/lib/stores/nip60.ts')
	})

	test('the guard source documents the #1252 allowlist', async () => {
		const source = await readFile(SCRIPT, 'utf8')
		expect(source).toContain('1252')
		expect(source).toContain(ALLOWLISTED_FILE)
	})

	test('the allowlisted private-claim file touches only the raw signer (keeps the allowlist honest)', async () => {
		// The guard skips this file wholesale, so it could acquire any other NDK
		// usage unnoticed. Pin the narrow surface the #1252 citation claims:
		// `ndkActions.getSigner()` and a type-only NDKSigner import.
		const source = await readFile(join(ROOT, ALLOWLISTED_FILE), 'utf8')
		const ndkActionsCalls = [...source.matchAll(/ndkActions\.([A-Za-z0-9_]+)/g)].map((m) => m[1])
		expect(ndkActionsCalls.length).toBeGreaterThan(0)
		expect([...new Set(ndkActionsCalls)]).toEqual(['getSigner'])
		expect(source).not.toContain('ndkStore')
		// No value import of @nostr-dev-kit (a `import type { … }` is allowed).
		expect(source).not.toMatch(/^import\s+(?!type\b)[^\n]*@nostr-dev-kit/m)
	})

	test('exits 0 when the production file set has no NDK surface', async () => {
		const root = await stageRepo({
			'src/publish/auctions.tsx': "import { sign } from '@/lib/nostr/io'\n",
			'src/queries/auctions.tsx': "import { applesauceIo } from '@/lib/nostr/io'\n",
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('OK')
	})

	test('fails (exit 1) when a non-allowlisted auctions file imports @nostr-dev-kit', async () => {
		const root = await stageRepo({ 'src/publish/auctions.tsx': NDK_IMPORT })
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('::error::')
		expect(r.stdout).toContain('src/publish/auctions.tsx')
	})

	test('fails (exit 1) when a non-allowlisted auctions file uses ndkActions or ndkStore', async () => {
		const actions = await stageRepo({ 'src/components/auctions/AuctionCard.tsx': NDK_ACTIONS })
		expect(runGuard(actions).exitCode).toBe(1)

		const store = await stageRepo({ 'src/lib/auctionHd.ts': NDK_STORE })
		expect(runGuard(store).exitCode).toBe(1)
	})

	test('exits 0 when NDK surface is confined to the #1252-allowlisted private-claim file', async () => {
		const root = await stageRepo({
			[ALLOWLISTED_FILE]: NDK_IMPORT,
			'src/publish/auctions.tsx': "import { sign } from '@/lib/nostr/io'\n",
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('allowlisted 1 (#1252-gated)')
	})

	test('ignores test files in the file set', async () => {
		const root = await stageRepo({
			'src/lib/auctionHd.test.ts': NDK_IMPORT,
			'src/lib/__tests__/whatever.test.ts': NDK_ACTIONS,
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
	})
})
