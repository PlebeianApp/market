import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFrostThreshold3AdmissionPort,
	DemoAdmissionSqliteSessionStore,
} from './demo-frost-threshold3-admission'
import { provisionEphemeralDemoThreshold3 } from './demo-frost-threshold3-dkg'
import type { DemoIntegratedAdmissionPolicyEvidenceV1 } from './demo-integrated-admission-policy'
import {
	demoIntegratedFundingBundleDigest,
	demoIntegratedFundingReceiptDigest,
	finalizeDemoIntegratedFundingReceipt,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'

type Four<T> = [T, T, T, T]

const participantBinary = resolve(import.meta.dir, '../frost-participant-3of4/target/debug/coco-demo-frost-participant-3of4-demo')
const inspectorBinary = resolve(import.meta.dir, '../frost-public-inspect/target/debug/coco-demo-frost-public-inspect')
const repoRoot = resolve(import.meta.dir, '..', '..')

function scalar(value: number): Uint8Array {
	return hexToBytes(value.toString(16).padStart(64, '0'))
}

function xonly(value: number): string {
	return bytesToHex(schnorr.getPublicKey(scalar(value)))
}

function compressed(value: number): string {
	return bytesToHex(secp256k1.getPublicKey(scalar(value), true))
}

function sign(digest: string, value: number): string {
	return bytesToHex(schnorr.sign(hexToBytes(digest), scalar(value)))
}

function digest(value: number): string {
	return value.toString(16).padStart(2, '0').repeat(32)
}

async function runGoVector(vectorPath: string, cache: string): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([
		'go', 'test', '-mod=readonly', './internal/poc', '-run', '^TestExternalRustAdmissionVector$', '-count=1', '-v',
	], {
		cwd: repoRoot,
		env: { ...process.env, POC_RUST_ADMISSION_VECTOR: vectorPath, GOCACHE: cache },
		stdout: 'pipe', stderr: 'pipe',
	})
	let timedOut = false
	const timeout = setTimeout(() => { timedOut = true; child.kill() }, 90_000)
	try {
		const [code, stdout, stderr] = await Promise.all([
			child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
		])
		if (timedOut) throw new Error('Rust-to-Go admission vector timed out')
		return { code, stdout, stderr }
	} finally {
		clearTimeout(timeout)
	}
}

test('three Rust FROST participants produce an admission signature accepted by the full Go verifier', async () => {
	const parent = await mkdtemp('/tmp/plebeian-friday-admission-go-')
	const sessions = new Database(join(parent, 'sessions.sqlite'), { create: true })
	try {
		const dkg = await provisionEphemeralDemoThreshold3({
			root: join(parent, 'dkg'), participantBinaryPath: participantBinary, inspectorBinaryPath: inspectorBinary,
			dkgRunId: `admission-${crypto.randomUUID()}`, committeeKeysetId: `committee-${crypto.randomUUID()}`,
			committeeKeysetVersion: '1', commandTimeoutMs: 30_000,
		})
		const now = Math.floor(Date.now() / 1000)
		const originalEndTime = now + 600
		const bidderPaymentSecret = 6
		const returnCashuDigest = digest(0x31)
		const terms: DemoIntegratedFundingReceiptTerms = {
			schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: 'rust-admission-vector', chain_id: 'rust-admission-vector',
			mint_url: 'http://127.0.0.1:3338',
			auction_id: 'rust-go-admission', bidder: xonly(5), bid_amount: 1000, pool_amount: 1000,
			replaces_bid_id: '', funding_operation_id: 'rust-go-funding', attested_at: now - 1,
			expires_at: now + 120, proof_state_refs: [compressed(8)], active_keyset_id: 'zero-fee-keyset',
			input_fee_ppk: 0, locktime: originalEndTime + 1800 + 900,
			bidder_public_key: compressed(bidderPaymentSecret), refund_public_key: compressed(7),
			committee_public_key: dkg.committeePublicKey, committee_keyset_id: dkg.committeeKeysetId,
			committee_keyset_version: dkg.committeeKeysetVersion, dkg_run_id: dkg.dkgRunId,
			public_key_package_sha256: dkg.publicKeyPackageSha256, signer_roster_digest: dkg.signerRosterDigest,
			winner_package_digest: digest(0x32), return_package_digest: digest(0x33),
			return_cashu_sigall_digest: returnCashuDigest,
			bidder_return_signature: sign(returnCashuDigest, bidderPaymentSecret),
		}
		const bundleDigest = demoIntegratedFundingBundleDigest(terms)
		const unsigned = prepareDemoIntegratedFundingReceipt(terms, sign(bundleDigest, 5))
		const receiptDigest = demoIntegratedFundingReceiptDigest(unsigned)
		const evidenceFor = (receipt: typeof unsigned, participantId: 1 | 2 | 3 | 4): DemoIntegratedAdmissionPolicyEvidenceV1 => ({
			schema: 'COCO_DEMO_INTEGRATED_ADMISSION_POLICY_EVIDENCE_V1', participantId,
			receiptDigest: demoIntegratedFundingReceiptDigest(receipt), mintEvidenceDigest: digest(0x40 + participantId),
			consensusEvidenceDigest: digest(0x50 + participantId), proofUseEvidenceDigest: digest(0x60 + participantId),
			bundleDigest: receipt.bundle_digest, proofStateRefs: [...receipt.proof_state_refs], poolAmount: receipt.pool_amount,
		})
		const evidence = [1, 2, 3].map((participantId) => evidenceFor(unsigned, participantId as 1 | 2 | 3)) as [DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1]
		const participants = dkg.participants.map((participant) => ({
			...participant,
			policyService: {
				participantId: participant.participantId,
				async validateExact(request) { return evidenceFor(request.receipt, participant.participantId) },
			},
		})) as Parameters<typeof createDemoFrostThreshold3AdmissionPort>[0]['participants']
		const port = createDemoFrostThreshold3AdmissionPort({
			binaryPath: participantBinary, publicKeyPackagePath: dkg.publicKeyPackagePath,
			scratchParent: parent, participants, selectedParticipantIds: [1, 2, 3],
			sessions: new DemoAdmissionSqliteSessionStore(sessions),
		})
		const authorization = await port.signExact({
			receipt: unsigned, receiptDigest, bundle: {} as never, nowSeconds: now,
			dkgBinding: {
				dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
				signerRosterDigest: dkg.signerRosterDigest,
			},
			participantEvidence: evidence,
		})
		expect(authorization.participantIds).toEqual([1, 2, 3])
		const receipt = finalizeDemoIntegratedFundingReceipt(
			unsigned, authorization.participantEvidenceDigest, authorization.committeeSignature,
		)
		const vectorPath = join(parent, 'rust-to-go-admission.json')
		await writeFile(vectorPath, `${JSON.stringify({
			schema: 'CocoDemoRustToGoAdmissionVectorV1', actor: terms.bidder,
			committed_at: now, original_end_time: originalEndTime, receipt,
		})}\n`, { mode: 0o600, flag: 'wx' })
		const go = await runGoVector(vectorPath, process.env.GOCACHE ?? '/tmp/plebeian-friday-go-cache')
		expect(go.code, `${go.stdout}\n${go.stderr}`).toBe(0)
		expect(go.stdout).toContain('PASS')

		const bindingPath = join(dkg.participants[0]!.stateDirectory, 'admission-durable-binding.json')
		const staleBinding = await readFile(bindingPath)
		const wrappedPublic = JSON.parse(await readFile(dkg.publicKeyPackagePath, 'utf8')) as { public_key_package_hex: string }
		const rawPublicPath = join(parent, 'public-key-package.raw')
		await writeFile(rawPublicPath, hexToBytes(wrappedPublic.public_key_package_hex), { mode: 0o600, flag: 'wx' })
		const rawPort = createDemoFrostThreshold3AdmissionPort({
			binaryPath: participantBinary, publicKeyPackagePath: rawPublicPath,
			scratchParent: parent, participants, selectedParticipantIds: [1, 2, 3],
			sessions: new DemoAdmissionSqliteSessionStore(sessions),
		})
		const signVariant = async (suffix: number) => {
			const variantTerms: DemoIntegratedFundingReceiptTerms = {
				...terms, funding_operation_id: `rust-go-funding-${suffix}`,
				proof_state_refs: [compressed(8 + suffix)], winner_package_digest: digest(0x32 + suffix),
				return_package_digest: digest(0x42 + suffix),
			}
			const variantBundle = demoIntegratedFundingBundleDigest(variantTerms)
			const variant = prepareDemoIntegratedFundingReceipt(variantTerms, sign(variantBundle, 5))
			const variantEvidence = [1, 2, 3].map((participantId) => evidenceFor(variant, participantId as 1 | 2 | 3)) as [DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1]
			return rawPort.signExact({
				receipt: variant, receiptDigest: demoIntegratedFundingReceiptDigest(variant), bundle: {} as never,
				nowSeconds: now, dkgBinding: {
					dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
					signerRosterDigest: dkg.signerRosterDigest,
				}, participantEvidence: variantEvidence,
			})
		}
		await expect(signVariant(2)).resolves.toMatchObject({ participantIds: [1, 2, 3] })
		await writeFile(bindingPath, staleBinding, { mode: 0o600 })
		await expect(signVariant(3)).rejects.toThrow(/ANCHOR_REGRESSED/)
	} finally {
		sessions.close()
		await rm(parent, { recursive: true, force: true })
	}
}, 180_000)
