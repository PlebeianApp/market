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

function runGuard(root: string): { exitCode: number; stdout: string; stderr: string } {
	const r = spawnSync('bash', [join(root, 'scripts', 'check-auctions-ndk-surface.sh')], {
		cwd: root,
		encoding: 'utf8',
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
		const r = runGuard(ROOT)
		expect(r.stderr).toBe('')
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('Auctions NDK-surface guard:')
		expect(r.stdout).toContain('OK')
	})

	test('the guard source documents the #1252 allowlist', async () => {
		const source = await readFile(SCRIPT, 'utf8')
		expect(source).toContain('1252')
		expect(source).toContain(ALLOWLISTED_FILE)
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
		const actions = await stageRepo({ 'src/components/AuctionCard.tsx': NDK_ACTIONS })
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
