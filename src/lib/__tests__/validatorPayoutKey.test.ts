/**
 * The validator's payout key material.
 *
 * The stakes here are asymmetric: a wrong xpub does not fail loudly, it silently receives
 * nothing, and a *replaced* xpub strands funds that were locked to the old one. So the tests
 * below care most about the three refusal paths — especially the third, which looks healthy.
 *
 * The generator script is exercised as a subprocess, because its whole value is what it refuses
 * to do: it is run against temporary files so nothing real is ever written.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HDKey } from '@scure/bip32'
import {
	PAYOUT_KEY_CHANGE_OVERRIDE_ENV,
	PAYOUT_SEED_ENV,
	derivePayoutKeyMaterial,
	hasConfiguredPayoutSeed,
	parsePayoutSeed,
	payoutKeyFingerprint,
	resolvePayoutKey,
} from '@/server/auction-validator/payoutKey'

const SEED_A = 'a'.repeat(64)
const SEED_B = 'b'.repeat(64)
const XPUB_A = derivePayoutKeyMaterial(parsePayoutSeed(SEED_A)).xpub

describe('parsePayoutSeed', () => {
	test('accepts 64 hex characters, either case', () => {
		expect(parsePayoutSeed(SEED_A)).toHaveLength(32)
		expect(parsePayoutSeed(SEED_A.toUpperCase())).toHaveLength(32)
		// Trimmed: a value pasted from a secret manager often arrives with whitespace.
		expect(parsePayoutSeed(`  ${SEED_A}\n`)).toHaveLength(32)
	})

	test('refuses anything that is not 64 hex characters, rather than deriving a different wallet', () => {
		for (const bad of ['', 'abc', SEED_A.slice(0, 63), `${SEED_A}00`, 'z'.repeat(64), `"${SEED_A}"`]) {
			expect(() => parsePayoutSeed(bad)).toThrow()
		}
	})
})

describe('derivePayoutKeyMaterial', () => {
	test('is deterministic: the same seed always reproduces the same xpub', () => {
		// This is what makes the "already announced" check possible at all.
		expect(derivePayoutKeyMaterial(parsePayoutSeed(SEED_A)).xpub).toBe(XPUB_A)
		expect(derivePayoutKeyMaterial(parsePayoutSeed(SEED_A)).fingerprint).toBe(derivePayoutKeyMaterial(parsePayoutSeed(SEED_A)).fingerprint)
	})

	test('different seeds give different xpubs and fingerprints', () => {
		const b = derivePayoutKeyMaterial(parsePayoutSeed(SEED_B))
		expect(b.xpub).not.toBe(XPUB_A)
		expect(b.fingerprint).not.toBe(payoutKeyFingerprint(XPUB_A))
	})

	test('the xpub is a usable extended key, so children can be derived from it', () => {
		// The manifest derives each leg as derive(payout_xpub, shared_path) — if this does not
		// parse as an extended key, no leg can be locked to this validator.
		expect(() => HDKey.fromExtendedKey(XPUB_A)).not.toThrow()
		expect(HDKey.fromExtendedKey(XPUB_A).derive('m/0/1').publicKey).toBeTruthy()
	})

	test('the fingerprint is a short digest, not the whole key', () => {
		const fingerprint = payoutKeyFingerprint(XPUB_A)
		expect(fingerprint).toHaveLength(16)
		expect(XPUB_A).toContain(fingerprint.slice(0, 4).length === 4 ? XPUB_A.slice(0, 4) : '')
		expect(fingerprint).not.toBe(XPUB_A)
	})
})

describe('resolvePayoutKey — the three refusals', () => {
	test('missing: refuses, and names both provisioning paths plus the generator', () => {
		const result = resolvePayoutKey({ env: {} })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.code).toBe('payout_seed_missing')
		expect(result.message).toContain(PAYOUT_SEED_ENV)
		// A CI-deployed operator must not be told to edit a file CI owns.
		expect(result.message.toLowerCase()).toContain('secret')
		expect(result.message.toLowerCase()).toContain('.env')
		expect(result.message).toContain('generate-validator-payout-seed')
	})

	test('empty string is treated as missing, not as a malformed seed', () => {
		const result = resolvePayoutKey({ env: { [PAYOUT_SEED_ENV]: '   ' } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.code).toBe('payout_seed_missing')
	})

	test('malformed: refuses with the parse reason', () => {
		const result = resolvePayoutKey({ env: { [PAYOUT_SEED_ENV]: 'not-a-seed' } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.code).toBe('payout_seed_malformed')
		expect(result.message).toContain('64 hex')
	})

	test('first run: nothing announced yet, so nothing to contradict', () => {
		const result = resolvePayoutKey({ env: { [PAYOUT_SEED_ENV]: SEED_A } })
		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error('unreachable')
		expect(result.changed).toBe(false)
		expect(result.material.xpub).toBe(XPUB_A)
	})

	test('matching the announced xpub: starts quietly', () => {
		const result = resolvePayoutKey({ env: { [PAYOUT_SEED_ENV]: SEED_A }, announcedXpub: XPUB_A })
		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error('unreachable')
		expect(result.changed).toBe(false)
	})

	test('changed: refuses, names BOTH xpubs and their fingerprints, and says how to override', () => {
		const result = resolvePayoutKey({ env: { [PAYOUT_SEED_ENV]: SEED_B }, announcedXpub: XPUB_A })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.code).toBe('payout_xpub_changed')
		expect(result.message).toContain(XPUB_A)
		expect(result.message).toContain(derivePayoutKeyMaterial(parsePayoutSeed(SEED_B)).xpub)
		expect(result.message).toContain(payoutKeyFingerprint(XPUB_A))
		expect(result.message).toContain(PAYOUT_KEY_CHANGE_OVERRIDE_ENV)
		// The reason it is refused must be stated, not implied.
		expect(result.message.toLowerCase()).toContain('strand')
	})

	test('changed with the override: proceeds, and reports that it changed', () => {
		for (const flag of ['1', 'true', 'TRUE']) {
			const result = resolvePayoutKey({
				env: { [PAYOUT_SEED_ENV]: SEED_B, [PAYOUT_KEY_CHANGE_OVERRIDE_ENV]: flag },
				announcedXpub: XPUB_A,
			})
			expect(result.ok).toBe(true)
			if (!result.ok) throw new Error('unreachable')
			expect(result.changed).toBe(true)
		}
	})

	test('the override is not a truthy free-for-all', () => {
		const result = resolvePayoutKey({
			env: { [PAYOUT_SEED_ENV]: SEED_B, [PAYOUT_KEY_CHANGE_OVERRIDE_ENV]: 'yes-please' },
			announcedXpub: XPUB_A,
		})
		expect(result.ok).toBe(false)
	})

	test('hasConfiguredPayoutSeed mirrors the missing check', () => {
		expect(hasConfiguredPayoutSeed({})).toBe(false)
		expect(hasConfiguredPayoutSeed({ [PAYOUT_SEED_ENV]: '  ' })).toBe(false)
		expect(hasConfiguredPayoutSeed({ [PAYOUT_SEED_ENV]: SEED_A })).toBe(true)
	})
})

describe('the generator script refuses to overwrite', () => {
	const SCRIPT = 'scripts/generate-validator-payout-seed.ts'
	const run = (args: string[], env: Record<string, string>) =>
		Bun.spawnSync({
			cmd: ['bun', 'run', SCRIPT, ...args],
			env: { ...process.env, ...env },
			stdout: 'pipe',
			stderr: 'pipe',
		})

	const withTempDir = <T>(fn: (dir: string) => T): T => {
		const dir = mkdtempSync(join(tmpdir(), 'payout-seed-test-'))
		try {
			return fn(dir)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}

	test('refuses when the environment already has a seed', () => {
		withTempDir((dir) => {
			const envFile = join(dir, '.env')
			const result = run(['--env-file', envFile], { [PAYOUT_SEED_ENV]: SEED_A })
			const output = `${result.stdout.toString()}${result.stderr.toString()}`
			expect(result.exitCode).not.toBe(0)
			expect(output).toContain('Refusing to overwrite')
			// And it must not have written anything.
			expect(() => readFileSync(envFile, 'utf8')).toThrow()
		})
	})

	test('refuses when the target .env already has a seed', () => {
		withTempDir((dir) => {
			const envFile = join(dir, '.env')
			writeFileSync(envFile, `# existing\n${PAYOUT_SEED_ENV}=${SEED_A}\n`)
			const before = readFileSync(envFile, 'utf8')
			const result = run(['--env-file', envFile], {})
			const output = `${result.stdout.toString()}${result.stderr.toString()}`
			expect(result.exitCode).not.toBe(0)
			expect(output).toContain('Refusing to overwrite')
			expect(output).toContain(payoutKeyFingerprint(XPUB_A))
			// The existing value is untouched: refusal means no write at all.
			expect(readFileSync(envFile, 'utf8')).toBe(before)
		})
	})

	test('refuses on an unparseable existing value without a stack trace', () => {
		withTempDir((dir) => {
			const envFile = join(dir, '.env')
			writeFileSync(envFile, `${PAYOUT_SEED_ENV}=obviously-not-a-seed\n`)
			const result = run(['--env-file', envFile], {})
			const output = `${result.stdout.toString()}${result.stderr.toString()}`
			expect(result.exitCode).not.toBe(0)
			expect(output).toContain('Refusing to overwrite')
			expect(output).toContain('not parseable')
		})
	})

	test('generates a fresh seed when none exists, writes it 0600, and prints a fingerprint', () => {
		withTempDir((dir) => {
			const envFile = join(dir, '.env')
			const result = run(['--env-file', envFile], {})
			const output = result.stdout.toString()
			expect(result.exitCode).toBe(0)

			const written = readFileSync(envFile, 'utf8')
			const match = written.match(new RegExp(`^${PAYOUT_SEED_ENV}=([0-9a-f]{64})$`, 'm'))
			expect(match).not.toBeNull()
			expect(statSync(envFile).mode & 0o777).toBe(0o600)

			// The seed that was written is the xpub that was announced.
			const seed = match?.[1] ?? ''
			const derived = derivePayoutKeyMaterial(parsePayoutSeed(seed))
			expect(output).toContain(derived.xpub)
			expect(output).toContain(derived.fingerprint)

			// The generated value is not one of our fixtures.
			expect(seed).not.toBe(SEED_A)
			expect(seed).not.toBe(SEED_B)
		})
	})

	test('--print writes nothing, and gives the CI instruction instead', () => {
		withTempDir((dir) => {
			const envFile = join(dir, '.env')
			const result = run(['--print', '--env-file', envFile], {})
			const output = result.stdout.toString()
			expect(result.exitCode).toBe(0)
			expect(output.toLowerCase()).toContain('secret')
			expect(() => readFileSync(envFile, 'utf8')).toThrow()
		})
	})
})
