import { describe, expect, test } from 'bun:test'

import {
	authorizeDemoCooperativeOutbidReturn,
	demoIntegratedDisplacementFinalityDigest,
	demoIntegratedTiming,
	type DemoCertifiedDisplacementV1,
	type DemoIntegratedAuthorityClaim,
	type DemoIntegratedAuthorityStore,
	type DemoIntegratedExecutionRootBindingV1,
	type DemoIntegratedLifecycleRecord,
	type DemoIntegratedLifecycleStatus,
} from './demo-integrated-authority'
import {
	demoIntegratedFundingAdmissionSignatureDigest,
	demoIntegratedFundingBundleDigest,
	finalizeDemoIntegratedFundingReceipt,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'
import { demoMaintainerExactTemplateDigest, type DemoMaintainerExactBranchTemplate } from './demo-maintainer-offline'
import { buildDemoSigAllSecret, demoCashuSigAllDigest, demoOutputsDigest, demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import { proofPoint } from './nut-client'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'

const scalar = (value: number): string => value.toString(16).padStart(64, '0')
const key = (value: number): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(scalar(value)), true))
const sign = (digest: string, value: number): string => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(scalar(value))))
const hex = (value: string): string => value.repeat(64)

function fixture(auctionId = 'auction', offset = 0) {
	const timing = demoIntegratedTiming(1_900_000_000, 1_900_000_600)
	const bidderPublicKey = key(1), committeePublicKey = key(2), refundPublicKey = key(3)
	const inputs = [4, 8].map((amount, index) => ({
		amount, id: 'zero-fee-keyset', C: key(10 + offset + index),
		secret: buildDemoSigAllSecret({ nonce: `${index + 1 + offset}`.padStart(64, '0'), bidderPublicKey, committeePublicKey, refundPublicKey, locktime: timing.locktime }),
	}))
	const outputs = [{ amount: 4, id: 'zero-fee-keyset', B_: key(20 + offset) }, { amount: 8, id: 'zero-fee-keyset', B_: key(21 + offset) }]
	const bidId = `bid-${offset + 1}`
	const operationId = (300 + offset).toString(16).padStart(64, '0')
	const bidEventId = (100 + offset).toString(16).padStart(64, '0')
	const replacementEventId = (200 + offset).toString(16).padStart(64, '0')
	const capabilityBase = {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: hex('a'), chainId: 'chain', auctionId,
		operationId, role: 'refund' as const, mintUrl: 'http://127.0.0.1:3338', unit: 'sat',
		recipientPublicKey: refundPublicKey, outputsDigest: demoOutputsDigest(outputs), signature: '00'.repeat(64),
	}
	const recipientCapability = { ...capabilityBase, signature: sign(demoRecipientCapabilityDigest(capabilityBase), 3) }
	const cashuSigAllDigest = demoCashuSigAllDigest(inputs, outputs)
	const participants = [1, 2, 3, 4].map((identifier) => ({ identifier: identifier as 1 | 2 | 3 | 4, verifyingShare: key(30 + identifier) })) as DemoMaintainerExactBranchTemplate['participants']
	const seller = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42))
	const template: DemoMaintainerExactBranchTemplate = {
		schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1', role: 'refund', network: hex('a'), chainId: 'chain', auctionId,
		// Pre-signed branch bytes use the stable funding intent in the legacy
		// bid slots; certificate.bidId/bidEventId remain the actual Comet event.
		operationId, bidId: operationId, bidEventId: operationId, bidderActorId: key(4).slice(2),
		amount: 12, inputFee: 0, mintUrl: 'http://127.0.0.1:3338', unit: 'sat', locktime: timing.locktime,
		validUntil: timing.maximumEndTime, closeTime: timing.certifiedEndTime, settlementWindowSeconds: 600,
		sellerP2pkXpub: seller.publicExtendedKey, bidderDerivationPath: 'm/1/2/3/4/5', recipientPublicKey: refundPublicKey,
		bidderPublicKey, refundPublicKey, committeePublicKey, committeeKeysetId: 'keyset', committeeKeysetVersion: '1',
		threshold: 3, participants, mintSeal: {
			mintUrl: 'http://127.0.0.1:3338', mintPublicKey: key(5), serverVersion: 'Nutshell/0.19.2', activeSatKeysetId: 'zero-fee-keyset',
			denominationKeyDigest: hex('d'), denominationAmounts: [4, 8], inputFeePpk: 0, nuts: [7, 10, 11],
		}, inputs, outputs, recipientCapability, templateDigest: '', cashuSigAllDigest,
		bidderMainSignature: sign(cashuSigAllDigest, 1), refundSignature: sign(cashuSigAllDigest, 3),
	}
	template.templateDigest = demoMaintainerExactTemplateDigest(template)
	const proofStateRefs = inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	const receiptTerms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: template.network, chain_id: template.chainId,
		mint_url: template.mintUrl, auction_id: auctionId,
		bidder: template.bidderActorId, bid_amount: template.amount, pool_amount: template.amount,
		replaces_bid_id: '', funding_operation_id: operationId, attested_at: 1_900_000_000,
		expires_at: 1_900_000_300, proof_state_refs: proofStateRefs, active_keyset_id: template.mintSeal.activeSatKeysetId,
		input_fee_ppk: 0, locktime: timing.locktime, bidder_public_key: bidderPublicKey,
		refund_public_key: refundPublicKey, committee_public_key: committeePublicKey,
		committee_keyset_id: 'keyset', committee_keyset_version: '1', dkg_run_id: 'dkg-run-1',
		public_key_package_sha256: hex('6'), signer_roster_digest: hex('7'), winner_package_digest: hex('8'),
		return_package_digest: template.templateDigest, return_cashu_sigall_digest: template.cashuSigAllDigest,
		bidder_return_signature: template.bidderMainSignature,
	}
	const receiptBundleDigest = demoIntegratedFundingBundleDigest(receiptTerms)
	const unsignedReceipt = prepareDemoIntegratedFundingReceipt(receiptTerms, sign(receiptBundleDigest, 4))
	const admittedFundingReceipt = finalizeDemoIntegratedFundingReceipt(
		unsignedReceipt, hex('8'), sign(demoIntegratedFundingAdmissionSignatureDigest(unsignedReceipt, hex('8')), 2),
	)
	const certificate: DemoCertifiedDisplacementV1 = {
		schema: 'COCO_DEMO_CERTIFIED_DISPLACEMENT_V1', network: hex('a'), chainId: 'chain', genesisHash: hex('c'),
		validatorRosterVersion: 'roster-1', auctionId, displacedBidId: bidId, displacedBidEventId: bidEventId,
		displacedBidderActorId: key(4).slice(2), displacedFundingOperationId: operationId,
		replacementBidId: 'bid-2', replacementBidEventId: hex('e'),
		replacementBidderActorId: key(6).slice(2), replacementAmount: 20, displacedPoolAmount: 12,
		proofStateRefs, activeKeysetId: 'zero-fee-keyset', inputFeePpk: 0, admittedFundingReceipt, timing,
		commits: [1, 2, 3].map((height) => ({ height, blockTime: 1_900_000_100 + height, blockHash: height.toString(16).padStart(64, '0'), appHash: (height + 10).toString(16).padStart(64, '0') })) as DemoCertifiedDisplacementV1['commits'],
		// The application exposes current state S, not historical H state.
		displacementState: { stateHeight: 3, stateAppHash: (14).toString(16).padStart(64, '0'), bindingCommit: { height: 4, blockTime: 1_900_000_104, blockHash: '4'.padStart(64, '0'), appHash: (14).toString(16).padStart(64, '0') } },
	}
	certificate.replacementBidId = `replacement-${offset + 1}`
	certificate.replacementBidEventId = replacementEventId
	return { timing, template, certificate }
}

class Store implements DemoIntegratedAuthorityStore {
	readonly claims = new Map<string, DemoIntegratedAuthorityClaim>()
	readonly lifecycles = new Map<string, DemoIntegratedLifecycleRecord>()
	readonly executionRoots = new Map<string, DemoIntegratedExecutionRootBindingV1>()
	async claimOutbidReturn(claim: DemoIntegratedAuthorityClaim) {
		for (const existing of this.claims.values()) {
			if (existing.proofStateRefs.some((proof) => claim.proofStateRefs.includes(proof)) && existing.operationRoot !== claim.operationRoot) {
				throw new Error('proof pool conflict')
			}
		}
		const existing = this.claims.get(claim.operationId)
		if (existing !== undefined) return { claim: structuredClone(existing), created: false }
		this.claims.set(claim.operationId, structuredClone(claim))
		this.lifecycles.set(claim.operationId, { schema: 'COCO_DEMO_INTEGRATED_LIFECYCLE_V1', revision: 0, claim: structuredClone(claim), status: 'outbid_return_pending' })
		return { claim: structuredClone(claim), created: true }
	}
	async bindExecutionRoot(binding: DemoIntegratedExecutionRootBindingV1) {
		const prior = this.executionRoots.get(binding.operationId)
		if (prior !== undefined) return { binding: structuredClone(prior), created: false }
		this.executionRoots.set(binding.operationId, structuredClone(binding))
		return { binding: structuredClone(binding), created: true }
	}
	async readExecutionRoot(operationId: string) { return structuredClone(this.executionRoots.get(operationId) ?? null) }
	async readLifecycle(operationId: string) { return structuredClone(this.lifecycles.get(operationId) ?? null) }
	async transitionLifecycle(request: { operationId: string; expectedRevision: number; expectedStatus: DemoIntegratedLifecycleStatus; nextStatus: DemoIntegratedLifecycleStatus; evidenceDigest?: string }) {
		const found = this.lifecycles.get(request.operationId)
		if (found === undefined || found.revision !== request.expectedRevision || found.status !== request.expectedStatus) throw new Error('lifecycle conflict')
		const next: DemoIntegratedLifecycleRecord = { ...found, revision: found.revision + 1, status: request.nextStatus, evidenceDigest: request.evidenceDigest }
		this.lifecycles.set(request.operationId, next)
		return structuredClone(next)
	}
}

describe('integrated fake-money outbid authority', () => {
	test('keeps participant policy finality stable across later authenticated state observations', () => {
		const { certificate } = fixture()
		const later = structuredClone(certificate)
		later.displacementState = {
			stateHeight: 9,
			stateAppHash: 'f'.repeat(64),
			bindingCommit: {
				height: 10,
				blockTime: certificate.commits[2].blockTime + 10,
				blockHash: '9'.repeat(64),
				appHash: 'f'.repeat(64),
			},
		}
		expect(demoIntegratedDisplacementFinalityDigest(later)).toBe(demoIntegratedDisplacementFinalityDigest(certificate))
		const alteredFinality = structuredClone(later)
		alteredFinality.commits[2].blockHash = 'a'.repeat(64)
		expect(demoIntegratedDisplacementFinalityDigest(alteredFinality)).not.toBe(demoIntegratedDisplacementFinalityDigest(certificate))
	})

	test('certifies H/H+1/H+2 and atomically claims the exact full pool for an offline cooperative return', async () => {
		const { timing, template, certificate } = fixture()
		const verified: number[] = []
		const store = new Store()
		const claim = await authorizeDemoCooperativeOutbidReturn({
			certificate, template, store, nowSeconds: certificate.commits[2].blockTime,
			displacementVerifier: { async verifyAndDerive({ displacementHeight }) { verified.push(displacementHeight); return structuredClone(certificate) } },
		})
		expect(verified).toEqual([1])
		expect(claim).toMatchObject({ poolAmount: 12, status: 'outbid_return_pending', displacementHeight: 1 })
		expect(claim.proofStateRefs).toEqual(certificate.proofStateRefs)
		expect(timing.locktime).toBe(timing.originalEndTime + 2_700)
		await expect(authorizeDemoCooperativeOutbidReturn({
			certificate, template, store, nowSeconds: certificate.commits[2].blockTime,
			displacementVerifier: { async verifyAndDerive() { return structuredClone(certificate) } },
		})).resolves.toEqual(claim)
	})

	test('fails closed on partial-pool, keyset, successor, cutoff, and cross-operation proof reuse', async () => {
		const base = fixture()
		const run = (certificate = base.certificate, template = base.template, store = new Store(), nowSeconds = certificate.commits[2].blockTime) =>
			authorizeDemoCooperativeOutbidReturn({ certificate, template, store, nowSeconds, displacementVerifier: { async verifyAndDerive() { return structuredClone(certificate) } } })
		const partial = structuredClone(base.certificate); partial.displacedPoolAmount = 4
		await expect(run(partial)).rejects.toMatchObject({ code: 'DEMO_AUTHORITY_RECEIPT' })
		const wrongKeyset = structuredClone(base.certificate); wrongKeyset.activeKeysetId = 'rotated'
		await expect(run(wrongKeyset)).rejects.toMatchObject({ code: 'DEMO_AUTHORITY_RECEIPT' })
		const alternate = structuredClone(base.template)
		alternate.outputs = [{ ...alternate.outputs[0]!, B_: key(99) }, ...alternate.outputs.slice(1)]
		alternate.recipientCapability.outputsDigest = demoOutputsDigest(alternate.outputs)
		alternate.recipientCapability.signature = sign(demoRecipientCapabilityDigest(alternate.recipientCapability), 3)
		alternate.cashuSigAllDigest = demoCashuSigAllDigest(alternate.inputs, alternate.outputs)
		alternate.bidderMainSignature = sign(alternate.cashuSigAllDigest, 1)
		alternate.refundSignature = sign(alternate.cashuSigAllDigest, 3)
		alternate.templateDigest = demoMaintainerExactTemplateDigest(alternate)
		await expect(run(base.certificate, alternate)).rejects.toMatchObject({ code: 'DEMO_AUTHORITY_ADMISSION_TEMPLATE' })
		const gap = structuredClone(base.certificate); gap.commits[2].height += 1
		await expect(run(gap)).rejects.toMatchObject({ code: 'DEMO_AUTHORITY_COMMIT' })
		await expect(run(base.certificate, base.template, new Store(), base.timing.mainCutoff)).rejects.toMatchObject({ code: 'DEMO_AUTHORITY_CUTOFF' })
		const store = new Store(); await run(base.certificate, base.template, store)
		const conflicting = fixture(); conflicting.certificate.replacementBidId = 'bid-3'; conflicting.certificate.replacementBidEventId = hex('f')
		await expect(run(conflicting.certificate, conflicting.template, store)).rejects.toThrow(/durable authority returned a conflicting claim/)
	})

	test('rejects a well-shaped caller certificate when participant-local history derives different replacement facts', async () => {
		const claimed = fixture()
		const derived = structuredClone(claimed.certificate)
		derived.replacementBidId = 'different-committed-bid'
		derived.replacementBidEventId = hex('f')
		await expect(authorizeDemoCooperativeOutbidReturn({
			certificate: claimed.certificate, template: claimed.template, store: new Store(),
			nowSeconds: claimed.certificate.commits[2].blockTime,
			displacementVerifier: { async verifyAndDerive() { return derived } },
		})).rejects.toMatchObject({ code: 'DEMO_AUTHORITY_HISTORY' })
	})

	test('keeps two simultaneous auctions independent while globally rejecting one proof pool twice', async () => {
		const first = fixture('auction-a', 0)
		const second = fixture('auction-b', 40)
		const store = new Store()
		const verifierFor = (certificate: DemoCertifiedDisplacementV1) => ({ async verifyAndDerive() { return structuredClone(certificate) } })
		const [left, right] = await Promise.all([
			authorizeDemoCooperativeOutbidReturn({ certificate: first.certificate, template: first.template, store, nowSeconds: first.certificate.commits[2].blockTime, displacementVerifier: verifierFor(first.certificate) }),
			authorizeDemoCooperativeOutbidReturn({ certificate: second.certificate, template: second.template, store, nowSeconds: second.certificate.commits[2].blockTime, displacementVerifier: verifierFor(second.certificate) }),
		])
		expect(left.auctionId).toBe('auction-a')
		expect(right.auctionId).toBe('auction-b')
		expect(left.operationRoot).not.toBe(right.operationRoot)
		expect(new Set([...left.proofStateRefs, ...right.proofStateRefs]).size).toBe(4)

		const replay = fixture('auction-c', 0)
		await expect(authorizeDemoCooperativeOutbidReturn({
			certificate: replay.certificate, template: replay.template, store,
			nowSeconds: replay.certificate.commits[2].blockTime, displacementVerifier: verifierFor(replay.certificate),
		})).rejects.toThrow('proof pool conflict')
	})
})
