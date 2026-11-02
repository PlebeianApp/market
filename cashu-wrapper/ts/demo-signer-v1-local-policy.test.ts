import { expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { createDemoSignerPurePhase, demoSignerObservationFetch } from './demo-signer-pure-policy'
import { demoSignerV1PolicyFixture } from './demo-signer-v1-local-policy-fixture'
import { preflightDemoIntegratedAdmission } from './demo-integrated-admission-policy'
import { preflightDemoFundingAbortParticipantPolicy, finalizeDemoFundingAbortPolicyEvidence, createDemoFundingAbortParticipantPolicy } from './demo-funding-abort-participant-policy'
import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'
import { createHash } from 'node:crypto'

const H = (value: string) => value.repeat(64)
const phase = () => createDemoSignerPurePhase(new AbortController().signal)
function admission() {
	const f = demoSignerV1PolicyFixture()
	return { f, options: { participantId: 1 as const, receipt: f.receipt, bundle: f.bundle, nowSeconds: 1100,
		dkgBinding: { dkgRunId: 'dkg-run-1', publicKeyPackageSha256: H('d'), signerRosterDigest: H('e') },
		consensus: { async readCommittedLeader() { return { leaderBidId: '', sellerPaymentPublicKey: '', height: 42, evidenceDigest: H('1') } } },
		mintVerifier: { async verifyAndDerive() { return { schema: 'COCO_DEMO_INTEGRATED_ADMISSION_MINT_EVIDENCE_V1' as const,
			evidenceDigest: H('3'), mintUrl: f.receipt.mint_url, activeKeysetId: 'keyset-1', inputFeePpk: 0 as const, inputTotal: 12,
			proofStates: f.refs.map((proofStateRef) => ({ proofStateRef, state: 'UNSPENT' as const })) } } },
	} }
}
function abort() {
	const { f } = admission(), template = f.bundle.refund
	const terms = { schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const, authNetworkId: template.network, chainId: template.chainId, genesisSha256: H('7'), auctionId: template.auctionId,
		operationId: template.operationId, actor: template.bidderActorId, mintUrl: template.mintUrl, activeKeysetId: 'keyset-1', amount: template.amount, proofYs: f.refs,
		poolDigest: H('6'), nut11LockPublicKeys: [template.bidderPublicKey, template.committeePublicKey] as [string, string], locktime: template.locktime,
		paymentPublicKey: template.bidderPublicKey, refundPublicKey: template.refundPublicKey, committeePublicKey: template.committeePublicKey,
		returnPackageDigest: template.templateDigest, returnCashuSigAllDigest: template.cashuSigAllDigest, bidderReturnSignature: template.bidderMainSignature,
		fundingAuthorizationEventId: H('4'), abortNotBefore: 1000, abortExpiresAt: 1200, abortReason: 'prebroadcast_service_failure' as const,
		committeeKeysetId: template.committeeKeysetId, committeeKeysetVersion: template.committeeKeysetVersion, dkgRunId: 'dkg-run-1', publicKeyPackageSha256: H('d'), signerRosterDigest: H('e') }
	const unsigned = demoFridayFundingAbortActorUnsignedEvent(terms, 1100)
	const id = createHash('sha256').update(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content])).digest('hex')
	const actor = new Uint8Array(32); actor[31] = 2
	const request = { schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_POLICY_REQUEST_V1' as const, actorTerms: terms, actorAbortEvent: { ...unsigned, id, sig: Buffer.from(schnorr.sign(Buffer.from(id, 'hex'), actor)).toString('hex') },
		evidence: { operationId: terms.operationId, poolDigest: terms.poolDigest, proofYs: f.refs } as any, returnTemplate: template, nowSeconds: 1100 }
	const options = { participantId: 1 as const, pins: { ...terms },
		consensus: { async readExact() { return { origin: 'none' as const, evidenceDigest: H('1') } } },
		mint: { async verifyExact() { return { activeKeysetId: 'keyset-1', proofStates: f.refs.map((proofY) => ({ proofY, state: 'UNSPENT' as const })), evidenceDigest: H('2') } } },
	}
	return { options, request }
}

for (const refusal of ['expired', 'stale-leader', 'business-binding'] as const) {
	test(`G2 admission pure policy ${refusal} is typed and has no claim capability`, async () => {
		const { options } = admission(), p = phase()
		if (refusal === 'expired') options.nowSeconds = 1300
		if (refusal === 'stale-leader') options.receipt.replaces_bid_id = H('8')
		if (refusal === 'business-binding') options.dkgBinding.dkgRunId = 'wrong'
		try { await p.run((context) => preflightDemoIntegratedAdmission({ ...options, context })); throw new Error('must refuse') }
		catch (error) { expect(p.classification(error)).toEqual({ kind: 'refused', reason: refusal === 'business-binding' ? 'ADMISSION_BINDING' : 'ADMISSION_STALE' }) }
	})
}
for (const refusal of ['time', 'pins', 'template'] as const) {
	test(`G2/G5 abort pure policy ${refusal} refuses before any claim/read effect`, async () => {
		const { options, request } = abort(), p = phase(); let reads = 0
		const original = options.consensus.readExact; options.consensus.readExact = async () => { reads++; return original() }
		if (refusal === 'time') request.nowSeconds = 1300
		if (refusal === 'pins') options.pins.dkgRunId = 'wrong'
		if (refusal === 'template') request.evidence.poolDigest = H('f')
		try { await p.run((context) => preflightDemoFundingAbortParticipantPolicy(options, request, context)); throw new Error('must refuse') }
		catch (error) { expect(p.classification(error)).toEqual({ kind: 'refused', reason: refusal === 'time' ? 'ABORT_TIME' : 'ABORT_BINDING' }) }
		expect(reads).toBe(0)
	})
}

test('G5 FundingAbort no longer claims in parallel with reads; read failure leaves claim count zero', async () => {
	const { options, request } = abort(); let claims = 0
	const policy = createDemoFundingAbortParticipantPolicy({ ...options,
		consensus: { async readExact() { throw new Error('read failed') } }, proofUse: { async claimExact() { claims++; return { evidenceDigest: H('3') } } } })
	await expect(policy.validateExact(request)).rejects.toThrow('read failed'); expect(claims).toBe(0)
	const ready = await preflightDemoFundingAbortParticipantPolicy(options, request)
	expect(finalizeDemoFundingAbortPolicyEvidence(ready, H('3'))).toHaveProperty('evidenceDigest')
})

test('G4 bounded pure read timeout cannot schedule a later effect; foreign typed category is unknown', async () => {
	const p = createDemoSignerPurePhase(new AbortController().signal, 10)
	let finish!: () => void, after = 0
	const pending = new Promise<void>((resolve) => { finish = resolve })
	try { await p.run(async (context) => { await context.observe(async () => pending); after++; return true }) }
	catch (error) { expect(p.classification(error)).toEqual({ kind: 'unavailable' }) }
	finish(); await new Promise((resolve) => setTimeout(resolve, 1)); expect(after).toBe(0)
	const other = phase(); let foreign: unknown
	try { await other.run(async (ctx) => ctx.refuse('ABORT_TIME')) } catch (error) { foreign = error }
	expect(p.classification(foreign)).toEqual({ kind: 'unknown' })
})

for (const failure of ['transport', 'malformed-json', 'generic-message'] as const) {
	test(`G4 observation ${failure}: only transport enters unavailable category`, async () => {
		const p = phase()
		try { await p.run(async (context) => {
			const fetchRead = demoSignerObservationFetch(context.signal, (async (_input: RequestInfo | URL) => {
				if (failure === 'transport') throw new TypeError('network')
				if (failure === 'generic-message') throw new Error('503 timeout unavailable')
				return new Response('{bad')
			}) as typeof fetch)
			return context.observe(async () => (await fetchRead('http://127.0.0.1:26657/status')).json())
		}) } catch (error) { expect(p.classification(error)).toEqual({ kind: failure === 'transport' ? 'unavailable' : 'unknown' }) }
	})
}


test('G5 pure observation capability cannot invoke mint/consensus mutators', async () => {
	const p = phase(); let calls = 0
	const fetchImpl: typeof fetch = Object.assign(async (): Promise<Response> => { calls++; return Response.json({}) }, { preconnect: fetch.preconnect })
	for (const [url, method] of [['http://[fd00::1]:3338/v1/swap', 'POST'], ['http://127.0.0.1:26657/broadcast_tx_commit', 'GET']]) {
		await expect(demoSignerObservationFetch(p.context.signal, fetchImpl)(url!, { method })).rejects.toThrow(/CAPABILITY_DENIED/)
	}
	expect(calls).toBe(0)
})


test('G2/G5 committed FundingAbort lifecycle observation refuses before mint or proof claims', async () => {
	const { assertDemoFundingAbortNoCommittedLifecycle } = await import('./demo-fips-funding-abort-policy')
	for (const origin of ['bid', 'abort']) {
		const { options, request } = abort(), p = phase(); let mintReads = 0
		options.consensus.readExact = async () => {
			assertDemoFundingAbortNoCommittedLifecycle({ auctionId: request.actorTerms.auctionId, origin }, p.context)
			return { origin: 'none', evidenceDigest: H('1') }
		}
		const original = options.mint.verifyExact
		options.mint.verifyExact = async () => { mintReads++; return original() }
		try { await p.run((context) => preflightDemoFundingAbortParticipantPolicy(options, request, context)); throw new Error('must refuse') }
		catch (error) { expect(p.classification(error)).toEqual({ kind: 'refused', reason: 'ABORT_LIFECYCLE' }) }
		expect(mintReads).toBe(0)
	}
})


for (const domain of ['admission', 'funding-abort'] as const) {
	test(`G5 ${domain}: real stable quorum comparator rejects changed evidence before journal claim, then next valid request signs`, async () => {
		const { service } = await import('./demo-signer-v1-local.test')
		const { sameDemoAdmissionPolicyAuthorizationFacts } = await import('./demo-frost-threshold3-admission')
		const { sameDemoFundingAbortStableParticipantEvidence } = await import('./demo-funding-abort-participant-policy')
		const s = await service(domain), before = await s.safety()
		if (domain === 'admission') {
			const { options } = admission()
			const ready = await preflightDemoIntegratedAdmission(options)
			const evidence = { ...ready.evidence, proofUseEvidenceDigest: H('3') }
			expect(sameDemoAdmissionPolicyAuthorizationFacts(evidence, evidence)).toBe(true)
			const supplied = { ...evidence, proofUseEvidenceDigest: H('4') }
			s.pureHook(async (context) => { if (!sameDemoAdmissionPolicyAuthorizationFacts(supplied, evidence)) context.refuse('QUORUM_BINDING') })
		} else {
			const { options, request } = abort()
			const ready = await preflightDemoFundingAbortParticipantPolicy(options, request)
			const evidence = finalizeDemoFundingAbortPolicyEvidence(ready, H('3'))
			expect(sameDemoFundingAbortStableParticipantEvidence(evidence, evidence)).toBe(true)
			const supplied = { ...evidence, poolDigest: H('4') }
			s.pureHook(async (context) => { if (!sameDemoFundingAbortStableParticipantEvidence(supplied, evidence)) context.refuse('QUORUM_BINDING') })
		}
		await expect(s.call('commit')).rejects.toThrow(/422/)
		expect(await s.responses.at(-1)!.text()).toContain('QUORUM_BINDING')
		expect(await s.safety()).toEqual(before); expect(s.count.effects).toBe(0); expect(s.count.rust).toBe(0)
		const calls = { ...s.count }; s.pureHook()
		await expect(s.call('commit')).rejects.toThrow(/422/); expect(s.count).toEqual(calls)
		await expect(s.call('commit', 'valid-next')).resolves.toHaveProperty('hiding_hex')
		expect(s.count.rust).toBe(1)
	})
}
