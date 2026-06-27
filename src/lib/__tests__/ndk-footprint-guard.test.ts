/**
 * Tests for the NDK footprint CI guard (`scripts/check-ndk-footprint.sh`).
 *
 * The guard resolves ROOT from its own location, so we stage a throwaway "repo"
 * (scripts/ + src/ + an empty contextvm/) in a temp dir, copy the real script
 * in, write a baseline, and invoke it via bash — then assert on exit code and
 * stdout for the equal / exceeds / ratchet-down branches.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

// NOTE: specifier is split so this test file itself is NOT counted by the NDK
// footprint guard (scripts/check-ndk-footprint.sh greps src/** for the NDK
// package specifier). The fixture string is reassembled at runtime; the files
// written into the staged temp repo still contain a valid, greppable import.
const NDK_PKG = '@nostr-dev-' + 'kit/ndk'
const NDK_IMPORT = `import { NDK } from '${NDK_PKG}'\n`

/** Build a temp repo with the guard script, a baseline, and N ndk-importing .ts files. */
async function stageRepo(baseline: number, ndkFiles: number): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'ndk-guard-'))
	await mkdir(join(root, 'scripts'))
	await mkdir(join(root, 'src'))
	await mkdir(join(root, 'contextvm')) // exists in the real repo; keeps grep's paths valid

	const scriptSrc = join(import.meta.dir, '..', '..', '..', 'scripts', 'check-ndk-footprint.sh')
	await copyFile(scriptSrc, join(root, 'scripts', 'check-ndk-footprint.sh'))
	await writeFile(join(root, 'scripts', 'ndk-baseline.txt'), `${baseline}\n`)
	for (let i = 0; i < ndkFiles; i++) {
		await writeFile(join(root, 'src', `f${i}.ts`), NDK_IMPORT)
	}
	return root
}

function runGuard(root: string): { exitCode: number; stdout: string; stderr: string } {
	const r = spawnSync('bash', [join(root, 'scripts', 'check-ndk-footprint.sh')], {
		cwd: root,
		encoding: 'utf8',
	})
	return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const roots: string[] = []
async function stage(baseline: number, ndkFiles: number): Promise<string> {
	const root = await stageRepo(baseline, ndkFiles)
	roots.push(root)
	return root
}

describe('NDK footprint guard (scripts/check-ndk-footprint.sh)', () => {
	afterEach(async () => {
		while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
	})

	test('exits 0 and prints OK when footprint equals the baseline', async () => {
		const r = runGuard(await stage(1, 1))
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('NDK footprint: 1 file(s)')
		expect(r.stdout).toContain('OK')
	})

	test('fails (exit 1) with an error annotation when footprint exceeds the baseline', async () => {
		const r = runGuard(await stage(0, 2))
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('::error::')
		expect(r.stdout).toContain('increased from 0 to 2')
	})

	test('exits 0 with a ratchet-down notice when footprint is below the baseline', async () => {
		const r = runGuard(await stage(5, 1))
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('::notice::')
		expect(r.stdout).toContain('decreased')
	})

	test('counts .tsx files too, not only .ts', async () => {
		// Two ndk imports across .ts + .tsx = footprint 2; baseline 1 must fail.
		const root = await mkdtemp(join(tmpdir(), 'ndk-guard-tsx-'))
		roots.push(root)
		await mkdir(join(root, 'scripts'))
		await mkdir(join(root, 'src'))
		await mkdir(join(root, 'contextvm'))
		await copyFile(
			join(import.meta.dir, '..', '..', '..', 'scripts', 'check-ndk-footprint.sh'),
			join(root, 'scripts', 'check-ndk-footprint.sh'),
		)
		await writeFile(join(root, 'scripts', 'ndk-baseline.txt'), '1\n')
		await writeFile(join(root, 'src', 'a.ts'), NDK_IMPORT)
		await writeFile(join(root, 'src', 'b.tsx'), NDK_IMPORT)

		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('NDK footprint: 2 file(s)')
	})
})
