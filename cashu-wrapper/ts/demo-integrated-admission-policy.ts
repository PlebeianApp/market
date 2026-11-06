/**
 * Participant-local admission policy for one fake-only threshold-funded bid.
 *
 * A FROST participant calls this before producing an admission-receipt nonce.
 * The coordinator may supply lookup identifiers and hidden template bytes, but
 * the participant's own mint-evidence/proof-use ports derive spendability and
 * exclusivity. No positive result is accepted from a coordinator boolean.
 */
import type { DemoSignerPureContext } from './demo-signer-pure-policy'
import { bytesToHex } from '@noble/hashes/utils.js'

import {
	validateDemoMaintainerExactTemplateBundle,
	type DemoMaintainerExactTemplateBundle,
} from './demo-maintainer-offline'
import {
	demoIntegratedFundingAnyReceiptDigest,
	type DemoIntegratedFundingReceiptAnyUnsigned,
} from './demo-integrated-admission-receipt-any'
import { proofPoint, type CashuProof } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const MAX_ADMISSION_RECEIPT_TTL_SECONDS = 300

export interface DemoIntegratedAdmissionMintEvidenceV1 {
	schema: 'COCO_DEMO_INTEGRATED_ADMISSION_MINT_EVIDENCE_V1'
	evidenceDigest: string
	mintUrl: string
	activeKeysetId: string
	inputFeePpk: 0
	inputTotal: number
	proofStates: Array<{ proofStateRef: string; state: 'UNSPENT' }>
}

export interface DemoIntegratedAdmissionMintVerifierPort {
	/** Query the participant-authorized fake mint and verify keyset, DLEQ and NUT-07 state. */
	verifyAndDerive(request: {
		mintUrl: string
		activeKeysetId: string
		inputs: CashuProof[]
	}): Promise<DemoIntegratedAdmissionMintEvidenceV1>
}

export interface DemoIntegratedAdmissionProofUsePort {
	/**
	 * Refuse any proof Y already claimed outside this exact proposed funding
	 * operation. This pre-commit check is advisory evidence; consensus remains
	 * the authority that atomically serializes the global proof claim.
	 */
	assertAvailable(request: {
		network: string
		chainId: string
		auctionId: string
		fundingOperationId: string
		proofStateRefs: string[]
	}): Promise<{ evidenceDigest: string }>
}

export interface DemoIntegratedAdmissionConsensusPort {
	/** Derive the current committed leader from this participant's own consensus state. */
	readCommittedLeader(request: {
		network: string
		chainId: string
		auctionId: string
	}): Promise<{
		leaderBidId: string
		/** Nostr seller actor committed in the participant's authenticated auction state. */
		sellerActor?: string
		sellerPaymentPublicKey: string
		height: number
		evidenceDigest: string
	}>
}

export interface DemoIntegratedAdmissionPolicyEvidenceV1 {
	schema: 'COCO_DEMO_INTEGRATED_ADMISSION_POLICY_EVIDENCE_V1'
	participantId: 1 | 2 | 3 | 4
	receiptDigest: string
	mintEvidenceDigest: string
	consensusEvidenceDigest: string
	proofUseEvidenceDigest: string
	bundleDigest: string
	proofStateRefs: string[]
	poolAmount: number
}

export interface DemoIntegratedAdmissionDkgBindingV1 {
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
}

export class DemoIntegratedAdmissionRefusedError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoIntegratedAdmissionRefusedError'
	}
}

function refuse(code: string, message: string): never { throw new DemoIntegratedAdmissionRefusedError(code, message) }

function exactMintEvidence(value: DemoIntegratedAdmissionMintEvidenceV1): DemoIntegratedAdmissionMintEvidenceV1 {
	if (value === null || typeof value !== 'object' || value.schema !== 'COCO_DEMO_INTEGRATED_ADMISSION_MINT_EVIDENCE_V1'
		|| !HEX_32.test(value.evidenceDigest) || typeof value.mintUrl !== 'string' || value.mintUrl.length === 0
		|| typeof value.activeKeysetId !== 'string' || value.activeKeysetId.length === 0 || value.inputFeePpk !== 0
		|| !Number.isSafeInteger(value.inputTotal) || value.inputTotal < 1 || !Array.isArray(value.proofStates)
		|| value.proofStates.length === 0 || value.proofStates.some((state) => state.state !== 'UNSPENT' || !/^(?:02|03)[0-9a-f]{64}$/.test(state.proofStateRef))
		|| new Set(value.proofStates.map((state) => state.proofStateRef.slice(2))).size !== value.proofStates.length) {
		refuse('DEMO_INTEGRATED_ADMISSION_MINT', 'participant-local mint evidence is malformed or not wholly UNSPENT')
	}
	return structuredClone(value)
}

function proofStateRefs(inputs: CashuProof[]): string[] {
	try {
		return inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	} catch (error) {
		return refuse('DEMO_INTEGRATED_ADMISSION_PROOF', error instanceof Error ? error.message : 'input proof Y derivation failed')
	}
}

export async function preflightDemoIntegratedAdmission(options: {
	participantId: 1 | 2 | 3 | 4
	receipt: DemoIntegratedFundingReceiptAnyUnsigned
	bundle: DemoMaintainerExactTemplateBundle
	nowSeconds: number
	mintVerifier: DemoIntegratedAdmissionMintVerifierPort
	context?: DemoSignerPureContext
	consensus: DemoIntegratedAdmissionConsensusPort
	dkgBinding: DemoIntegratedAdmissionDkgBindingV1
}): Promise<DemoAdmissionReadOnlyResult> {
	if (![1, 2, 3, 4].includes(options.participantId)
		|| options.dkgBinding === null || typeof options.dkgBinding !== 'object'
		|| options.dkgBinding.dkgRunId.length === 0
		|| !HEX_32.test(options.dkgBinding.publicKeyPackageSha256)
		|| !HEX_32.test(options.dkgBinding.signerRosterDigest)) {
		refuse('DEMO_INTEGRATED_ADMISSION_DKG', 'participant-local DKG binding is malformed')
	}
	options.context?.check()
	if (Number.isSafeInteger(options.receipt.attested_at) && Number.isSafeInteger(options.receipt.expires_at)
		&& (options.receipt.attested_at > options.nowSeconds || options.receipt.expires_at < options.nowSeconds)) {
		options.context?.refuse('ADMISSION_STALE')
	}
	const bundle = validateDemoMaintainerExactTemplateBundle(options.bundle, options.nowSeconds, true)
	const winner = bundle.winner
	const refund = bundle.refund
	const receipt = structuredClone(options.receipt)
	const refs = proofStateRefs(winner.inputs)
	const inputTotal = winner.inputs.reduce((sum, proof) => sum + proof.amount, 0)
	const readConsensus = () => options.consensus.readCommittedLeader({ network: winner.network, chainId: winner.chainId, auctionId: winner.auctionId })
	const committed = await (options.context ? options.context.observe(readConsensus) : readConsensus())
	const v3SellerAuthorization = winner.schema === 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V3'
		? winner.auctionPayoutAuthorization?.authorization
		: undefined
	if (!Number.isSafeInteger(options.nowSeconds) || options.nowSeconds < 1
		|| committed === null || typeof committed !== 'object'
		|| (committed.leaderBidId !== '' && !HEX_32.test(committed.leaderBidId))
		|| (committed.sellerActor !== undefined && !HEX_32.test(committed.sellerActor))
		|| (committed.sellerPaymentPublicKey !== '' && !/^(?:02|03)[0-9a-f]{64}$/.test(committed.sellerPaymentPublicKey))
		|| !Number.isSafeInteger(committed.height) || committed.height < 1 || !HEX_32.test(committed.evidenceDigest)
		|| receipt.attested_at > options.nowSeconds
		|| receipt.expires_at < options.nowSeconds
		|| receipt.expires_at - receipt.attested_at > MAX_ADMISSION_RECEIPT_TTL_SECONDS) {
		refuse('DEMO_INTEGRATED_ADMISSION_CONSENSUS', 'receipt is stale or does not replace the participant-local committed leader')
	}
	if (receipt.replaces_bid_id !== committed.leaderBidId
		|| (winner.schema !== 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1'
			&& committed.sellerPaymentPublicKey !== winner.sellerPaymentPublicKey)
		|| (winner.schema === 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V3'
			&& (v3SellerAuthorization === undefined
				|| committed.sellerActor !== v3SellerAuthorization.sellerActor
				|| committed.sellerPaymentPublicKey !== v3SellerAuthorization.sellerPaymentPublicKey))) {
		options.context?.refuse('ADMISSION_STALE')
		refuse('DEMO_INTEGRATED_ADMISSION_CONSENSUS', 'receipt does not replace the participant-local leader')
	}
	if (winner.inputFee !== 0 || winner.mintSeal.inputFeePpk !== 0 || refund.inputFee !== 0 || refund.mintSeal.inputFeePpk !== 0
		|| inputTotal !== winner.amount || refund.amount !== winner.amount
		|| JSON.stringify(refs) !== JSON.stringify(proofStateRefs(refund.inputs))) {
		options.context?.refuse('ADMISSION_POOL')
		refuse('DEMO_INTEGRATED_ADMISSION_POOL', 'winner and return templates do not share one exact zero-fee full pool')
	}
	if (receipt.auth_network_id !== winner.network || receipt.chain_id !== winner.chainId
		|| receipt.mint_url !== winner.mintUrl || receipt.auction_id !== winner.auctionId
		|| receipt.bidder !== winner.bidderActorId || receipt.pool_amount !== winner.amount
		|| receipt.funding_operation_id !== winner.operationId
		// The final Nostr event id cannot exist until after threshold admission
		// signs the receipt.  Exact branch packages therefore bind this stable
		// pre-commit intent slot to the funding operation; Comet separately binds
		// that operation to the eventual signed event and committed bid record.
		|| winner.bidId !== receipt.funding_operation_id || winner.bidEventId !== receipt.funding_operation_id
		|| refund.bidId !== receipt.funding_operation_id || refund.bidEventId !== receipt.funding_operation_id
		|| JSON.stringify(receipt.proof_state_refs) !== JSON.stringify(refs)
		|| receipt.active_keyset_id !== winner.mintSeal.activeSatKeysetId || receipt.input_fee_ppk !== 0
		|| receipt.locktime !== winner.locktime || receipt.bidder_public_key !== winner.bidderPublicKey
		|| receipt.refund_public_key !== winner.refundPublicKey || receipt.committee_public_key !== winner.committeePublicKey
		|| receipt.committee_keyset_id !== winner.committeeKeysetId
		|| receipt.committee_keyset_version !== winner.committeeKeysetVersion
		|| receipt.dkg_run_id !== options.dkgBinding.dkgRunId
		|| receipt.public_key_package_sha256 !== options.dkgBinding.publicKeyPackageSha256
		|| receipt.signer_roster_digest !== options.dkgBinding.signerRosterDigest
		|| receipt.winner_package_digest !== winner.templateDigest
		|| receipt.return_package_digest !== refund.templateDigest
		|| receipt.return_cashu_sigall_digest !== refund.cashuSigAllDigest
		|| receipt.bidder_return_signature !== refund.bidderMainSignature
		|| (receipt.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
			&& receipt.prepared_bundle_digest !== bundle.bundleDigest)) {
		options.context?.refuse('ADMISSION_BINDING')
		refuse('DEMO_INTEGRATED_ADMISSION_BINDING', 'consensus receipt differs from the exact pre-signed branch bundle')
	}
	const readMint = () => options.mintVerifier.verifyAndDerive({ mintUrl: winner.mintUrl, activeKeysetId: winner.mintSeal.activeSatKeysetId, inputs: structuredClone(winner.inputs) })
	const mintEvidence = exactMintEvidence(await (options.context ? options.context.observe(readMint) : readMint()))
	if (mintEvidence.mintUrl !== winner.mintUrl || mintEvidence.activeKeysetId !== winner.mintSeal.activeSatKeysetId
		|| mintEvidence.inputTotal !== winner.amount
		|| JSON.stringify(mintEvidence.proofStates.map(({ proofStateRef }) => proofStateRef).sort()) !== JSON.stringify(refs)) {
		refuse('DEMO_INTEGRATED_ADMISSION_MINT', 'participant-local mint derivation differs from the exact full pool')
	}

	options.context?.check()
	return { proofClaim: { network: winner.network, chainId: winner.chainId, auctionId: winner.auctionId,
		fundingOperationId: receipt.funding_operation_id, proofStateRefs: [...refs] }, evidence: {
		schema: 'COCO_DEMO_INTEGRATED_ADMISSION_POLICY_EVIDENCE_V1',
		participantId: options.participantId,
		receiptDigest: demoIntegratedFundingAnyReceiptDigest(receipt), mintEvidenceDigest: mintEvidence.evidenceDigest,
		consensusEvidenceDigest: committed.evidenceDigest,
		bundleDigest: bundle.bundleDigest, proofStateRefs: refs, poolAmount: winner.amount,
	} }
}

export interface DemoAdmissionReadOnlyResult {
	proofClaim: Parameters<DemoIntegratedAdmissionProofUsePort['assertAvailable']>[0]
	evidence: Omit<DemoIntegratedAdmissionPolicyEvidenceV1, 'proofUseEvidenceDigest'>
}
export async function validateDemoIntegratedAdmission(options: Parameters<typeof preflightDemoIntegratedAdmission>[0] & {
	proofUse: DemoIntegratedAdmissionProofUsePort
}): Promise<DemoIntegratedAdmissionPolicyEvidenceV1> {
	const { proofUse, ...readOnly } = options
	const ready = await preflightDemoIntegratedAdmission(readOnly)
	const proof = await proofUse.assertAvailable(ready.proofClaim)
	if (proof === null || typeof proof !== 'object' || !HEX_32.test(proof.evidenceDigest)) refuse('DEMO_INTEGRATED_ADMISSION_PROOF_USE', 'participant-local proof-use evidence is malformed')
	return { ...ready.evidence, proofUseEvidenceDigest: proof.evidenceDigest }
}
