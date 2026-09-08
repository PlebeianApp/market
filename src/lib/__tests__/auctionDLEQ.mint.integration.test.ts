import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CashuMint, CashuWallet, type MintKeys, type Proof } from '@cashu/cashu-ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildDleqProofs, getMintKeyset, verifyBidDleq, type DleqProof, type DleqVerifyResult } from '../cashu/dleq'

/**
 * I3 — DLEQ via a real local mint (not the offline A3 fixture).
 *
 * This suite starts a real nutshell Cashu mint (FakeWallet backend) on
 * 127.0.0.1:3338, FIRST asserts it advertises NUT-12 DLEQ support, mints a
 * real proof carrying a DLEQ proof, serializes it to the `dleq_proof`
 * bid-tag shape via `buildDleqProofs`, and runs `verifyBidDleq` end-to-end
 * — plus the two negative cases (wrong amount sum, forged signature `C`).
 *
 * Run via: `bun run test:integration`
 * (the mint is spawned and torn down by this suite; no external services).
 */

const MINT_URL = 'http://127.0.0.1:3338'
const MINT_AMOUNT = 64

// Compressed secp256k1 generator point — a valid curve point that is NOT the
// unblinded signature for any honest proof, used to forge `C`.
const GENERATOR_HEX = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

// Project root — resolves the repo checkout regardless of the caller's cwd,
// so the `e2e/start-local-mint.sh` script is found reliably.
const PROJECT_ROOT = path.resolve(import.meta.dir, '../../..')

/** Fresh, isolated mint data dir per run — avoids stale-DB/schema collisions. */
const MINT_DIR = mkdtempSync(path.join(tmpdir(), 'cashu-mint-i3-'))

let mintProc: ChildProcess | undefined
let shared: { proofs: Proof[]; dleqProofs: DleqProof[]; keyset: MintKeys } | undefined

/**
 * Wait for the mint's `/v1/info` to respond (bounded, fail loudly).
 *
 * Also fails fast if the spawned child exits early (e.g. the mint script
 * could not bind its port because another process already owns :3338) so
 * the suite never silently runs against a foreign process.
 */
const waitForMint = async (timeoutMs = 30_000): Promise<void> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (mintProc?.exitCode !== null && mintProc?.exitCode !== undefined) {
			throw new Error(`local mint process exited early with code ${mintProc.exitCode} — see CASHU_MINT_DIR=${MINT_DIR}`)
		}
		try {
			const res = await fetch(`${MINT_URL}/v1/info`)
			if (res.ok) return
		} catch {
			// mint not up yet — keep polling
		}
		await Bun.sleep(250)
	}
	throw new Error(`local mint at ${MINT_URL} did not become ready within ${timeoutMs}ms`)
}

/**
 * Mint one proof (carrying DLEQ), serialize it, and fetch the keyset.
 *
 * NUT-12 DLEQ proofs are returned by the mint in the blind-signature
 * response (the mint decides based on its own NUT-12 support); the
 * cashu-ts mint path has no client-side `includeDleq` switch — that option
 * exists only on the *send/swap* path (`SendOptions`). The proof carrying
 * `dleq` is asserted by the caller (`expect(p.dleq).toBeDefined()`), which
 * is the real guarantee that the minted collateral is DLEQ-verifiable.
 */
const mintDleqProofs = async (amount: number): Promise<{ proofs: Proof[]; dleqProofs: DleqProof[]; keyset: MintKeys }> => {
	const mint = new CashuMint(MINT_URL)
	const wallet = new CashuWallet(mint)
	const quote = await wallet.createMintQuote(amount)
	const proofs = await wallet.mintProofs(amount, quote.quote)
	expect(proofs.length).toBeGreaterThan(0)

	// serialize to dleq_proof (parallel to lockSecrets/proofYs, per buildDleqProofs contract)
	const dleqProofs = buildDleqProofs(proofs)
	expect(dleqProofs.length).toBe(proofs.length)

	const keyset = await getMintKeyset(MINT_URL, proofs[0].id)
	return { proofs, dleqProofs, keyset }
}

/** Attach the wallet secret to each serialized proof for verification. */
const withSecrets = (proofs: Proof[], dleqProofs: DleqProof[]): Array<DleqProof & { secret: string }> =>
	dleqProofs.map((dp, i) => ({ ...dp, secret: proofs[i].secret }))

beforeAll(async () => {
	mintProc = spawn('bash', ['e2e/start-local-mint.sh'], {
		cwd: PROJECT_ROOT,
		env: { ...process.env, CASHU_MINT_DIR: MINT_DIR },
		detached: true,
		stdio: 'ignore',
	})
	await waitForMint()

	// FIRST gate: the mint MUST advertise NUT-12 DLEQ support before we mint
	// anything — a mint without NUT-12 would make the whole collateral
	// unverifiable, so we assert it up front rather than after the fact.
	const info = await new CashuMint(MINT_URL).getInfo()
	expect(info?.nuts?.['12']?.supported).toBe(true)

	// Shared honest fixture: one real minted proof + serialized dleq_proof + keyset.
	shared = await mintDleqProofs(MINT_AMOUNT)
}, 60_000)

afterAll(async () => {
	if (mintProc?.pid) {
		// Kill the whole process group (the script `exec`s the mint, so the
		// direct child IS the mint process; detached gives it its own group).
		try {
			process.kill(-mintProc.pid, 'SIGTERM')
		} catch {
			/* already gone */
		}
		// Give the mint a moment to flush and exit on SIGTERM before the
		// hard SIGKILL fallback (deterministic teardown, no orphan writes).
		await Bun.sleep(300)
		try {
			process.kill(-mintProc.pid, 'SIGKILL')
		} catch {
			/* already gone */
		}
	}
	rmSync(MINT_DIR, { recursive: true, force: true })
})

describe('DLEQ via a real local mint (NUT-12)', () => {
	test('minted proof carries a DLEQ proof and serializes to dleq_proof', () => {
		const { proofs, dleqProofs } = shared!
		for (const p of proofs) expect(p.dleq).toBeDefined()
		expect(dleqProofs).toHaveLength(proofs.length)
		for (const dp of dleqProofs) {
			expect(dp.id).toBe(proofs[0].id)
			expect(dp.amount).toBeGreaterThan(0)
			expect(dp.C).toMatch(/^0[23][0-9a-f]{64}$/)
			expect(dp.e).toMatch(/^[0-9a-f]{64}$/)
			expect(dp.s).toMatch(/^[0-9a-f]{64}$/)
			expect(dp.r).toMatch(/^[0-9a-f]{64}$/)
		}
	})

	test('verifyBidDleq passes end-to-end for an honest minted proof', () => {
		const { proofs, dleqProofs, keyset } = shared!
		const result: DleqVerifyResult = verifyBidDleq({ legDelta: MINT_AMOUNT, proofs: withSecrets(proofs, dleqProofs) }, keyset)
		expect(result).toEqual({ ok: true, matchesAmount: true, allProofsValid: true })
	})

	test('verifyBidDleq rejects a bid whose amount sum does not match legDelta (wrong amount)', () => {
		const { proofs, dleqProofs, keyset } = shared!
		const result: DleqVerifyResult = verifyBidDleq({ legDelta: MINT_AMOUNT + 1, proofs: withSecrets(proofs, dleqProofs) }, keyset)
		expect(result.ok).toBe(false)
		expect(result.matchesAmount).toBe(false)
		// The crypto itself is still valid — only the sum is wrong.
		expect(result.allProofsValid).toBe(true)
	})

	test('verifyBidDleq rejects a proof with a forged signature C', () => {
		const { proofs, dleqProofs, keyset } = shared!
		const forged = withSecrets(proofs, dleqProofs).map((p, i) => (i === 0 ? { ...p, C: GENERATOR_HEX } : p))
		const result: DleqVerifyResult = verifyBidDleq({ legDelta: MINT_AMOUNT, proofs: forged }, keyset)
		expect(result.ok).toBe(false)
		expect(result.allProofsValid).toBe(false)
		expect(result.failedProofIndex).toBe(0)
		// Amount sum is untouched — only the signature is forged.
		expect(result.matchesAmount).toBe(true)
	})
})
