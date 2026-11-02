/** Bounded actual Rust CLI + independent anchor; synthetic local keys only. */
import { afterEach, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { demoDispositionEnrollmentPermit, openDemoDispositionSignerAnchor, type DemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { demoFrostAdmissionAuthorization, type DemoFrostAdmissionRustCommitment } from './demo-frost-threshold3-admission'
import { demoIntegratedFundingBundleDigest, demoIntegratedFundingReceiptDigest, prepareDemoIntegratedFundingReceipt, type DemoIntegratedFundingReceiptTerms } from './demo-integrated-funding-receipt'
import { demoThreshold3SignerRosterDigest, type DemoThreshold3PublicInspection } from './demo-frost-threshold3-dkg'
import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'
import { demoFrostFundingAbortAuthorization, demoFrostFundingAbortParticipantPolicyDigest, type DemoFundingAbortParticipantEvidenceV1, type DemoFrostFundingAbortCommitmentV1 } from './demo-frost-threshold3-funding-abort'

export const main = process.env.COCO_SIGNER_TEST_BINARY
const generator = process.env.COCO_SIGNER_FIXTURE_BINARY
if (!main || !generator) throw new Error('Set explicit COCO_SIGNER_TEST_BINARY and COCO_SIGNER_FIXTURE_BINARY; no automatic build/download')
export const H = (v: number) => v.toString(16).padStart(2, '0').repeat(32)
export const hash = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex')
const scalar = (v: number) => Uint8Array.from(Buffer.from(v.toString(16).padStart(64, '0'), 'hex'))
const compressed = (v: number) => Buffer.from(secp256k1.getPublicKey(scalar(v), true)).toString('hex')
const xonly = (v: number) => Buffer.from(schnorr.getPublicKey(scalar(v))).toString('hex')
const sign = (digest: string, v: number) => Buffer.from(schnorr.sign(Buffer.from(digest, 'hex'), scalar(v), new Uint8Array(32))).toString('hex')
export const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T
export const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 })
export type Domain = 'admission' | 'funding-abort'
export type Auth = ReturnType<typeof demoFrostAdmissionAuthorization> | ReturnType<typeof demoFrostFundingAbortAuthorization>
export type Commitment = DemoFrostAdmissionRustCommitment | DemoFrostFundingAbortCommitmentV1
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

export function registerDemoSignerFixtureCleanup(cleanup: () => Promise<void>): void { cleanups.push(cleanup) }

export async function exec(args: string[], env: Record<string, string | undefined> = {}) {
	const child = Bun.spawn(args, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
	const timeout = setTimeout(() => child.kill(), 10_000)
	try {
		const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
		return { code, stdout, stderr }
	} finally { clearTimeout(timeout) }
}

export async function demoSignerV1LocalFixture(domain: Domain) {
	const root = await mkdtemp(join(tmpdir(), 'signer-order-cli-'))
	const generated = await exec([generator!, '--exact', 'write_synthetic_signer_fixture'], { COCO_SYNTHETIC_SIGNER_FIXTURE_OUTPUT: root })
	expect(generated.code, generated.stderr).toBe(0)
	const inspection = await json<DemoThreshold3PublicInspection>(join(root, 'inspection.json'))
	const roster = demoThreshold3SignerRosterDigest(inspection)
	const options = [1, 2, 3, 4].map((id) => ({
		participantId: id as 1 | 2 | 3 | 4, dkgRunId: 'synthetic-f1', publicKeyPackageSha256: inspection.public_key_package_sha256,
		signerRosterDigest: roster, stateDirectory: join(root, `state-${id}`), signerMetadataPath: join(root, `state-${id}`, 'metadata.sqlite3'),
		proofUsePath: join(root, `proof-${id}.sqlite3`), coordinatorAnchorPath: join(root, `anchor-${id}.sqlite3`), initialEnrollmentPermitPath: join(root, `permit-${id}.json`), admissionSafetyPath: join(root, `admission-${id}.sqlite3`),
	}))
	let anchors: DemoDispositionSignerAnchor[] = []
	for (const option of options) { await save(option.initialEnrollmentPermitPath, demoDispositionEnrollmentPermit(option)); anchors.push(openDemoDispositionSignerAnchor(option)) }
	cleanups.push(async () => { for (const anchor of anchors) { try { anchor.close() } catch {} }; await rm(root, { recursive: true, force: true }) })
	const now = Math.floor(Date.now() / 1000) - 1
	const authorize = (variant = 0, session = H(9)): Auth => {
		if (domain === 'admission') {
			const terms: DemoIntegratedFundingReceiptTerms = {
				schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: 'synthetic-f1', chain_id: 'synthetic-f1', mint_url: 'http://127.0.0.1:3338',
				auction_id: 'auction', bidder: xonly(5), bid_amount: 1000 + variant, pool_amount: 1000 + variant, replaces_bid_id: '', funding_operation_id: 'operation',
				attested_at: now, expires_at: now + 240, proof_state_refs: [compressed(8)], active_keyset_id: 'synthetic', input_fee_ppk: 0, locktime: now + 4000,
				bidder_public_key: compressed(6), refund_public_key: compressed(7), committee_public_key: inspection.committee_public_key,
				committee_keyset_id: 'synthetic-f1', committee_keyset_version: '1', dkg_run_id: 'synthetic-f1', public_key_package_sha256: inspection.public_key_package_sha256,
				signer_roster_digest: roster, winner_package_digest: H(10), return_package_digest: H(11), return_cashu_sigall_digest: H(12), bidder_return_signature: sign(H(12), 6),
			}
			const receipt = prepareDemoIntegratedFundingReceipt(terms, sign(demoIntegratedFundingBundleDigest(terms), 5))
			const evidence = [1, 2, 3].map((id) => ({ schema: 'COCO_DEMO_INTEGRATED_ADMISSION_POLICY_EVIDENCE_V1' as const,
				participantId: id as 1 | 2 | 3, receiptDigest: demoIntegratedFundingReceiptDigest(receipt), mintEvidenceDigest: H(20 + id), consensusEvidenceDigest: H(30 + id),
				proofUseEvidenceDigest: H(40 + id), bundleDigest: receipt.bundle_digest, proofStateRefs: [...receipt.proof_state_refs], poolAmount: receipt.pool_amount })) as Parameters<typeof demoFrostAdmissionAuthorization>[1]
			return demoFrostAdmissionAuthorization(receipt, evidence, session)
		}
		const evidence = [1, 2, 3].map((id) => ({ schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1' as const,
			participantId: id as 1 | 2 | 3, operationId: 'operation', poolDigest: H(10), proofYsDigest: H(11), activeKeysetId: 'synthetic', returnPackageDigest: H(12),
			returnCashuSigAllDigest: H(13), mintEvidenceDigest: H(14), consensusEvidenceDigest: H(15), evidenceDigest: H(20 + id) })) as [DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1]
		const terms = { schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const, authNetworkId: 'synthetic-f1', chainId: 'synthetic-f1', genesisSha256: H(30),
			auctionId: 'auction', operationId: 'operation', actor: xonly(5), mintUrl: 'https://mint.invalid', activeKeysetId: 'synthetic', amount: 1000 + variant,
			proofYs: [compressed(8)], poolDigest: H(10), nut11LockPublicKeys: [compressed(6), inspection.committee_public_key] as [string, string],
			locktime: now + 4000, paymentPublicKey: compressed(6), refundPublicKey: compressed(7), committeePublicKey: inspection.committee_public_key,
			returnPackageDigest: H(12), returnCashuSigAllDigest: H(13), bidderReturnSignature: sign(H(13), 6), fundingAuthorizationEventId: H(31),
			abortNotBefore: now, abortExpiresAt: now + 240, abortReason: 'prebroadcast_service_failure' as const, committeeKeysetId: 'synthetic-f1', committeeKeysetVersion: '1',
			dkgRunId: 'synthetic-f1', publicKeyPackageSha256: inspection.public_key_package_sha256, signerRosterDigest: roster,
			participantPolicyDigest: demoFrostFundingAbortParticipantPolicyDigest(evidence) }
		// Mandatory actor event is a synthetic fixture only; it is never published.
		const { participantPolicyDigest: _policyDigest, ...actorTerms } = terms
		const event = demoFridayFundingAbortActorUnsignedEvent(actorTerms, now)
		const id = hash(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
		return demoFrostFundingAbortAuthorization({ committeeUnsigned: { ...terms, actorAbortEvent: { ...event, id, sig: sign(id, 5) } }, participantEvidence: evidence, sessionId: session })
	}
	const auth = authorize()
	const state = options[0]!.stateDirectory
	const journalPath = (value = auth) => join(state, `${domain}-sign-${hash(`${value.operation_id}:${value.session_id}`)}.journal`)
	const safety = async () => {
		const records: Record<string, string> = {}
		for (const name of (await readdir(state)).sort()) {
			if (name === 'dkg-final.state' || name.startsWith(domain)) {
				if (name === `${domain}-operations`) { for (const child of (await readdir(join(state, name))).sort()) records[`${name}/${child}`] = hash(await readFile(join(state, name, child))) }
				else records[name] = hash(await readFile(join(state, name)))
			}
		}
		return records
	}
	let index = 0
	const raw = async (method: 'commit' | 'share', value: Auth = auth, bundle?: Commitment[], id = 1, output?: string) => {
		const prefix = join(root, `request-${++index}`), authPath = `${prefix}-auth.json`, out = output ?? `${prefix}-out.json`
		await save(authPath, value)
		const args = [main!, `${domain}-${method}`, join(root, `config-${id}.json`), join(root, `state-${id}`), authPath]
		if (bundle !== undefined) { const path = `${prefix}-bundle.json`; await save(path, { version: value.version, entries: bundle }); args.push(path) }
		args.push(out)
		const result = await exec(args)
		return { ...result, out }
	}
	const guarded = async (...args: Parameters<typeof raw>) => {
		const id = args[3] ?? 1
		anchors[id - 1]!.assertRustStateCurrent()
		const result = await raw(...args)
		if (result.code === 0) anchors[id - 1]!.recordRustStateAdvance()
		return result
	}
	const commit = async (id = 1) => { const r = await guarded('commit', auth, undefined, id); expect(r.code, r.stderr).toBe(0); return json<Commitment>(r.out) }
	const commits = async () => Promise.all([1, 2, 3].map(commit))
	const restart = () => { for (const a of anchors) a.close(); anchors = options.map(openDemoDispositionSignerAnchor) }
	return { root, state, auth, authorize, journalPath, safety, raw, guarded, commit, commits, restart, options, anchors: () => anchors, anchor: () => anchors[0]! }
}

