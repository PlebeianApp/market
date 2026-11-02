/** Bounded actual Rust CLI + independent anchor; synthetic local keys only. */
import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { demoDispositionEnrollmentPermit, openDemoDispositionSignerAnchor, type DemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { demoFrostAdmissionAuthorization, demoFrostAdmissionAuthorizationDigest, type DemoFrostAdmissionRustCommitment } from './demo-frost-threshold3-admission'
import { demoIntegratedFundingBundleDigest, demoIntegratedFundingReceiptDigest, prepareDemoIntegratedFundingReceipt, type DemoIntegratedFundingReceiptTerms } from './demo-integrated-funding-receipt'
import { demoThreshold3SignerRosterDigest, type DemoThreshold3PublicInspection } from './demo-frost-threshold3-dkg'
import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'
import { demoFrostFundingAbortAuthorization, demoFrostFundingAbortAuthorizationDigest, demoFrostFundingAbortParticipantPolicyDigest, type DemoFundingAbortParticipantEvidenceV1, type DemoFrostFundingAbortCommitmentV1 } from './demo-frost-threshold3-funding-abort'

const main = process.env.COCO_SIGNER_TEST_BINARY
const generator = process.env.COCO_SIGNER_FIXTURE_BINARY
if (!main || !generator) throw new Error('Set explicit COCO_SIGNER_TEST_BINARY and COCO_SIGNER_FIXTURE_BINARY; no automatic build/download')
const H = (v: number) => v.toString(16).padStart(2, '0').repeat(32)
const hash = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex')
const scalar = (v: number) => Uint8Array.from(Buffer.from(v.toString(16).padStart(64, '0'), 'hex'))
const compressed = (v: number) => Buffer.from(secp256k1.getPublicKey(scalar(v), true)).toString('hex')
const xonly = (v: number) => Buffer.from(schnorr.getPublicKey(scalar(v))).toString('hex')
const sign = (digest: string, v: number) => Buffer.from(schnorr.sign(Buffer.from(digest, 'hex'), scalar(v), new Uint8Array(32))).toString('hex')
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T
const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 })
type Domain = 'admission' | 'funding-abort'
type Auth = ReturnType<typeof demoFrostAdmissionAuthorization> | ReturnType<typeof demoFrostFundingAbortAuthorization>
type Commitment = DemoFrostAdmissionRustCommitment | DemoFrostFundingAbortCommitmentV1
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function exec(args: string[], env: Record<string, string | undefined> = {}) {
	const child = Bun.spawn(args, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
	const timeout = setTimeout(() => child.kill(), 10_000)
	try {
		const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
		return { code, stdout, stderr }
	} finally { clearTimeout(timeout) }
}

async function fixture(domain: Domain) {
	const root = await mkdtemp(join(tmpdir(), 'signer-order-cli-'))
	const generated = await exec([generator!, '--exact', 'write_synthetic_signer_fixture'], { COCO_SYNTHETIC_SIGNER_FIXTURE_OUTPUT: root })
	expect(generated.code, generated.stderr).toBe(0)
	const inspection = await json<DemoThreshold3PublicInspection>(join(root, 'inspection.json'))
	const roster = demoThreshold3SignerRosterDigest(inspection)
	const options = [1, 2, 3, 4].map((id) => ({
		participantId: id as 1 | 2 | 3 | 4, dkgRunId: 'synthetic-f1', publicKeyPackageSha256: inspection.public_key_package_sha256,
		signerRosterDigest: roster, stateDirectory: join(root, `state-${id}`), signerMetadataPath: join(root, `state-${id}`, 'metadata.sqlite3'),
		proofUsePath: join(root, `proof-${id}.sqlite3`), coordinatorAnchorPath: join(root, `anchor-${id}.sqlite3`), initialEnrollmentPermitPath: join(root, `permit-${id}.json`),
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
	return { root, state, auth, authorize, journalPath, safety, raw, guarded, commit, commits, restart, anchor: () => anchors[0]! }
}

for (const domain of ['admission', 'funding-abort'] as const) {
	for (const rejection of ['duplicate-owner-commit', 'duplicate-owner-share', 'journal-mismatch-commit', 'journal-mismatch-share', 'T2-consuming', 'T2-consumed'] as const) {
		for (const restart of [false, true]) {
			test(`${domain}: ${rejection} leaves all safety bytes unchanged and legitimate retry succeeds (${restart ? 'restart' : 'live anchor'})`, async () => {
				const f = await fixture(domain)
				const commitments = await f.commits()
				let badAuth = f.auth, badBundle = commitments
				let method: 'commit' | 'share' = 'share'
				if (rejection.startsWith('duplicate-owner')) { badAuth = f.authorize(1); method = rejection.endsWith('commit') ? 'commit' : 'share'
					if (method === 'share') { const digest = domain === 'admission' ? demoFrostAdmissionAuthorizationDigest(badAuth as ReturnType<typeof demoFrostAdmissionAuthorization>) : demoFrostFundingAbortAuthorizationDigest(badAuth as ReturnType<typeof demoFrostFundingAbortAuthorization>); badBundle = commitments.map((entry) => ({ ...entry, authorization_digest: digest })) }
				}
				else if (rejection.startsWith('journal-mismatch')) {
					badAuth = f.authorize(0, H(99)); method = rejection.endsWith('commit') ? 'commit' : 'share'
					badBundle = commitments.map((entry) => ({ ...entry, session_id: badAuth.session_id, authorization_digest: '' }))
					// Rebind public bundle envelope to the valid alternate authorization; the stored journal guard must reject first.
					if (method === 'share') {
						const authDigest = domain === 'admission' ? demoFrostAdmissionAuthorizationDigest(badAuth as ReturnType<typeof demoFrostAdmissionAuthorization>) : demoFrostFundingAbortAuthorizationDigest(badAuth as ReturnType<typeof demoFrostFundingAbortAuthorization>)
						badBundle = badBundle.map((entry) => ({ ...entry, authorization_digest: authDigest }))
					}
					await copyFile(f.journalPath(), f.journalPath(badAuth)); f.anchor().recordRustStateAdvance()
				} else {
					const committed = await json<Record<string, unknown>>(f.journalPath())
					const first = await f.guarded('share', f.auth, commitments); expect(first.code, first.stderr).toBe(0)
					if (rejection === 'T2-consuming') {
						const consumed = await json<Record<string, unknown>>(f.journalPath())
						await save(f.journalPath(), { ...consumed, state: 'CONSUMING', nonces_hex: committed.nonces_hex, share_hex: null })
						f.anchor().recordRustStateAdvance() // explicit synthetic crash fixture, not runtime recovery
					}
					badBundle = structuredClone(commitments); badBundle[2]!.binding_hex = commitments[1]!.binding_hex
				}
				const before = await f.safety()
				const rejected = await f.guarded(method, badAuth, method === 'share' ? badBundle : undefined)
				expect(rejected.code).not.toBe(0)
				expect(rejected.stderr).toMatch(rejection.startsWith('duplicate-owner') ? /DUPLICATE_OPERATION_OWNER/ : rejection.startsWith('journal-mismatch') ? /journal/ : /transcript/)
				const after = await f.safety()
				if (JSON.stringify(after) !== JSON.stringify(before)) {
					// Negative-control runs prove the persistent anchor consequence too.
					expect(() => f.anchor().assertRustStateCurrent()).toThrow(/QUARANTINED/)
					expect(() => f.restart()).toThrow(/QUARANTINED/)
				}
				expect(after).toEqual(before)
				f.anchor().assertRustStateCurrent()
				if (restart) f.restart()
				const good = await f.guarded('share', f.auth, commitments); expect(good.code, good.stderr).toBe(0)
				const retry = await f.guarded('share', f.auth, commitments); expect(retry.code, retry.stderr).toBe(0)
				expect((await json<{ share_hex: string }>(retry.out)).share_hex).toBe((await json<{ share_hex: string }>(good.out)).share_hex)
			})
		}
	}
}


for (const domain of ['admission', 'funding-abort'] as const) {
	for (const restart of [false, true]) {
		test(`${domain}: share-before-commit creates no claim/binding and a fresh valid operation still works (${restart ? 'restart' : 'live'})`, async () => {
			const f = await fixture(domain)
			const peer2 = await f.commit(2), peer3 = await f.commit(3)
			// Public, structurally valid bundle; local missing journal must reject before claim.
			const own = { ...peer2, participant_id: 1 } as Commitment
			const before = await f.safety()
			const result = await f.guarded('share', f.auth, [own, peer2, peer3])
			expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/No such file/)
			expect(await f.safety()).toEqual(before)
			f.anchor().assertRustStateCurrent(); if (restart) f.restart()
			const local = await f.commit()
			const good = await f.guarded('share', f.auth, [local, peer2, peer3]); expect(good.code, good.stderr).toBe(0)
		})
	}

	for (const field of ['version', 'operation_id', 'commitment_hex', 'nonces_hex'] as const) {
		const methods: ('commit' | 'share')[] = field === 'nonces_hex' ? ['share'] : field === 'commitment_hex' ? ['commit'] : ['commit', 'share']
		for (const method of methods) {
			test(`${domain}: independent ${field} journal rejection has no safety effect (${method})`, async () => {
				const f = await fixture(domain), commits = await f.commits()
				const alternate = f.authorize(0, H(98))
				const digest = domain === 'admission' ? demoFrostAdmissionAuthorizationDigest(alternate as ReturnType<typeof demoFrostAdmissionAuthorization>) : demoFrostFundingAbortAuthorizationDigest(alternate as ReturnType<typeof demoFrostFundingAbortAuthorization>)
				const value = await json<Record<string, unknown>>(f.journalPath())
				await save(f.journalPath(alternate), { ...value, session_id: alternate.session_id, authorization_digest: digest, [field]: 'invalid-synthetic-field' })
				f.anchor().recordRustStateAdvance() // adversarial local fixture present before the request
				const bundle = commits.map((entry) => ({ ...entry, session_id: alternate.session_id, authorization_digest: digest }))
				const before = await f.safety()
				const result = await f.guarded(method, alternate, method === 'share' ? bundle : undefined)
				expect(result.code).not.toBe(0)
				if (field === 'version' || field === 'operation_id') expect(result.stderr).toMatch(/journal/)
				else expect(result.stderr).toMatch(/Invalid character|Odd number|invalid/)
				expect(await f.safety()).toEqual(before)
				f.restart()
				const good = await f.guarded('share', f.auth, commits); expect(good.code, good.stderr).toBe(0)
			})
		}
	}

	test(`${domain}: deterministic output conflict rejects before transition; partial durable write still quarantines`, async () => {
		const f = await fixture(domain), commitments = await f.commits()
		const out = join(f.root, 'existing-output.json'); await save(out, { conflicting: true })
		const before = await f.safety()
		const denied = await f.guarded('share', f.auth, commitments, 1, out)
		expect(denied.code).not.toBe(0); expect(denied.stderr).toMatch(/already exists/)
		expect(await f.safety()).toEqual(before)
		f.anchor().assertRustStateCurrent()
		// Simulate a crash after binding persistence and before another safety-store update.
		const path = join(f.state, `${domain}-durable-binding.json`)
		const binding = await json<Record<string, number | string>>(path)
		await save(path, { ...binding, restart_epoch: Number(binding.restart_epoch) + 1 })
		expect(() => f.anchor().assertRustStateCurrent()).toThrow(/QUARANTINED/)
		expect(() => f.restart()).toThrow(/QUARANTINED/)
	})

	for (const phase of ['CONSUMING', 'CONSUMED']) {
		test(`${domain}: simulated ${phase} before anchor update remains quarantined; exact raw recovery does not reset nonce`, async () => {
			const f = await fixture(domain), commitments = await f.commits()
			const committed = await json<Record<string, unknown>>(f.journalPath())
			const good = await f.raw('share', f.auth, commitments); expect(good.code, good.stderr).toBe(0)
			if (phase === 'CONSUMING') {
				const consumed = await json<Record<string, unknown>>(f.journalPath())
				await save(f.journalPath(), { ...consumed, state: phase, nonces_hex: committed.nonces_hex, share_hex: null })
			}
			expect(() => f.anchor().assertRustStateCurrent()).toThrow(/QUARANTINED/)
			const bad = structuredClone(commitments); bad[2]!.binding_hex = bad[1]!.binding_hex
			const before = await f.safety()
			const rejected = await f.raw('share', f.auth, bad); expect(rejected.code).not.toBe(0); expect(rejected.stderr).toMatch(/transcript/)
			expect(await f.safety()).toEqual(before)
			const recovered = await f.raw('share', f.auth, commitments); expect(recovered.code, recovered.stderr).toBe(0)
			const journal = await json<{ state: string; nonces_hex: unknown; share_hex: string }>(f.journalPath())
			expect(journal.state).toBe('CONSUMED'); expect(journal.nonces_hex).toBeNull()
			expect(journal.share_hex).toBe((await json<{ share_hex: string }>(good.out)).share_hex)
			expect(() => f.anchor().assertRustStateCurrent()).toThrow(/QUARANTINED/)
		})
	}
}

for (const domain of ['admission', 'funding-abort'] as const) {
	test(`${domain}: actual three-participant CLI shares aggregate and verify; commit retry preserves consumed journal`, async () => {
		const f = await fixture(domain), commitments = await f.commits()
		const shares = [] as { participant_id: number; share_hex: string }[]
		for (const id of [1, 2, 3]) {
			const result = await f.guarded('share', f.auth, commitments, id); expect(result.code, result.stderr).toBe(0)
			shares.push(await json(result.out))
		}
		const before = await json<Record<string, unknown>>(f.journalPath())
		const replay = await f.commit()
		expect(replay.hiding_hex).toBe(commitments[0]!.hiding_hex); expect(replay.binding_hex).toBe(commitments[0]!.binding_hex)
		expect(await json<Record<string, unknown>>(f.journalPath())).toEqual(before)
		const authPath = join(f.root, 'aggregate-auth.json'), requestPath = join(f.root, 'aggregate-request.json'), out = join(f.root, 'signature.json')
		await save(authPath, f.auth)
		await save(requestPath, { version: f.auth.version, operation_id: f.auth.operation_id, session_id: f.auth.session_id,
			commitments: commitments.map(({ participant_id, hiding_hex, binding_hex }) => ({ participant_id, hiding_hex, binding_hex })),
			shares: shares.map(({ participant_id, share_hex }) => ({ participant_id, share_hex })) })
		const result = await exec([main!, `${domain}-aggregate`, authPath, join(f.root, 'public.json'), requestPath, out])
		expect(result.code, result.stderr).toBe(0)
		const aggregate = await json<{ signature_hex: string; admission_signature_digest?: string; committee_digest?: string }>(out)
		expect(schnorr.verify(Buffer.from(aggregate.signature_hex, 'hex'), Buffer.from((aggregate.admission_signature_digest ?? aggregate.committee_digest)!, 'hex'), Buffer.from(f.auth.committee_public_key.slice(2), 'hex'))).toBe(true)
	})
}
