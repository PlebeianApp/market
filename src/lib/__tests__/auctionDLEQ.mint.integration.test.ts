import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CashuMint, CashuWallet, type MintKeys, type Proof } from '@cashu/cashu-ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	buildDleqProofs,
	getMintKeyset,
	verifyBidDleq,
	verifyBidDleqWithKeysets,
	type DleqProof,
	type DleqVerifyResult,
} from '../cashu/dleq'

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

/** The mint's own log, captured so a startup failure is diagnosable. */
const MINT_LOG = path.join(MINT_DIR, 'mint.log')

let mintProc: ChildProcess | undefined
let shared: { proofs: Proof[]; dleqProofs: DleqProof[]; keyset: MintKeys } | undefined

/**
 * Wait for the mint's `/v1/info` to respond (bounded, fail loudly).
 *
 * Also fails fast if the spawned child exits early (e.g. the mint script
 * could not bind its port because another process already owns :3338) so
 * the suite never silently runs against a foreign process.
 */
const waitForMint = async (timeoutMs = 90_000): Promise<void> => {
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
	const logTail = readFileSync(MINT_LOG, 'utf8').split('\n').slice(-20).join('\n')
	throw new Error(`local mint at ${MINT_URL} did not become ready within ${timeoutMs}ms\n--- mint log tail ---\n${logTail}`)
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
	// Capture the mint's stdout+stderr to MINT_LOG so a startup failure is
	// diagnosable (the default `stdio: 'ignore'` gives no trace).
	const mintLogFd = openSync(MINT_LOG, 'w')
	mintProc = spawn('bash', ['e2e/start-local-mint.sh'], {
		cwd: PROJECT_ROOT,
		env: { ...process.env, CASHU_MINT_DIR: MINT_DIR },
		detached: true,
		stdio: ['ignore', mintLogFd, mintLogFd],
	})
	closeSync(mintLogFd) // parent's copy — the child inherited its own

	await waitForMint()

	// FIRST gate: the mint MUST advertise NUT-12 DLEQ support before we mint
	// anything — a mint without NUT-12 would make the whole collateral
	// unverifiable, so we assert it up front rather than after the fact.
	const info = await new CashuMint(MINT_URL).getInfo()
	expect(info?.nuts?.['12']?.supported).toBe(true)

	// Shared honest fixture: one real minted proof + serialized dleq_proof + keyset.
	shared = await mintDleqProofs(MINT_AMOUNT)
}, 120_000)

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

	// ADR-0011 Blocker 2: the security property lives on the NEWLY ISSUED
	// P2PK swap outputs — this is the exact swap shape the bid lock path
	// (`lockAuctionBidProofs` in src/lib/stores/nip60.ts) performs. The
	// re-enabled Direct Lightning funding e2e scenarios depend on the local
	// mint returning NUT-12 DLEQ proofs on this swap, and on the outputs
	// surviving the lock path's fail-closed `buildDleqProofs` serialization
	// and keyset verification. (Empirically, nutshell 0.19.2 does both;
	// nutshell >= 0.20.x emits version-01 keyset ids that cashu-ts 2.9.0
	// cannot even verify — which is why CI pins cashu==0.19.2.)
	test('P2PK lock-path swap issues output proofs carrying verifiable DLEQ (Blocker 2)', async () => {
		// Fresh proofs for this test — the swap consumes its inputs, and the
		// shared fixture must stay untouched for the tests above.
		const { proofs, keyset } = await mintDleqProofs(MINT_AMOUNT)

		const wallet = new CashuWallet(new CashuMint(MINT_URL))
		const lockPubkey = GENERATOR_HEX // any valid compressed secp256k1 point
		const refundPubkey = GENERATOR_HEX
		const result = await wallet.swap(32, proofs, {
			p2pk: {
				pubkey: lockPubkey,
				locktime: Math.floor(Date.now() / 1000) + 3_600,
				refundKeys: [refundPubkey],
			},
		})

		expect(result.send.length).toBeGreaterThan(0)
		// 1. Every freshly issued P2PK output carries a NUT-12 DLEQ proof.
		for (const p of result.send) expect(p.dleq).toBeDefined()
		for (const p of result.keep) expect(p.dleq).toBeDefined()
		// 2. The lock path's fail-closed output serializer accepts them.
		const dleqProofs: DleqProof[] = buildDleqProofs(result.send)
		expect(dleqProofs).toHaveLength(result.send.length)
		// 3. The serialized outputs verify against their own keyset and sum
		//    to the locked leg amount (same call shape as computeValidatedBids).
		const sendSum = result.send.reduce((sum, p) => sum + p.amount, 0)
		const withSecrets = dleqProofs.map((dp, i) => ({ ...dp, secret: result.send[i].secret }))
		const keysets = new Map([[`${MINT_URL}:${keyset.id}`, keyset]])
		const verdict = verifyBidDleqWithKeysets({ mint: MINT_URL, legDelta: sendSum, proofs: withSecrets }, keysets)
		expect(verdict).toEqual({ ok: true, matchesAmount: true, allProofsValid: true })
	})
})
