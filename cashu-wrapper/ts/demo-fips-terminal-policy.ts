import { assertDemoFridaySignerContract, demoFridaySignerCometFetch, type DemoFridaySignerContract } from './demo-friday-signer-contract'
/** Participant-local terminal policy used by the authenticated FIPS signer. */
import { hasValidDleq } from '@cashu/cashu-ts'
import { bytesToHex } from '@noble/hashes/utils.js'

import { deriveDemoCometSignedBidEvidence } from './demo-comet-signed-bid-verifier'
import { createDemoCometCloseVerifier } from './demo-comet-close-verifier'
import { createDemoCometRejectedFundingVerifier } from './demo-comet-rejected-funding-verifier'
import { createDemoCometDisplacementVerifier, createLoopbackCometReader } from './demo-comet-displacement-verifier'
import { createDemoFridayFundingAbortFinalityVerifier } from './demo-friday-funding-abort-comet'
import { type DemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { demoIntegratedDisplacementFinalityDigest } from './demo-integrated-authority'
import { demoIntegratedCloseDigest } from './demo-integrated-close-authority'
import { demoIntegratedRejectedFundingDigest } from './demo-integrated-rejected-authority'
import {
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantLocalEvidence,
	type DemoFrostParticipantPolicyPackage,
	type DemoFrostParticipantPolicyPorts,
} from './demo-frost-participant-policy'
import { exactDemoNut07Result } from './demo-nut07-exact'
import { createOriginBoundMintFetch, createPinnedMintTransportFetch } from './coco-rail'
import { CashuMintClient, proofPoint } from './nut-client'

export interface DemoFipsTerminalTrustPinsV1 {
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	validatorsHash: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	cometRpc: string
	mintUrl: string
	mintTransportUrl: string
}

const HEX_32 = /^[0-9a-f]{64}$/

function exactClosureLookup(value: DemoFrostParticipantLocalEvidence): Extract<
	DemoFrostParticipantLocalEvidence,
	{ schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2' }
> {
	if (value.schema !== 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
		|| value.source !== 'participant-local' || !['outbid', 'close', 'rejected', 'funding_abort'].includes(value.kind)
		|| !Number.isSafeInteger(value.eventHeight) || value.eventHeight < 1
		|| ((value.kind === 'outbid' || value.kind === 'rejected' || value.kind === 'funding_abort')
			&& !HEX_32.test(value.eventId))) {
		throw new Error('DEMO_FIPS_TERMINAL_LOOKUP: exact Comet event identity is absent or malformed')
	}
	return structuredClone(value)
}

function exactSignedBidMarker(value: DemoFrostParticipantLocalEvidence): void {
	if (value.schema !== 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1'
		|| value.source !== 'participant-local' || Object.keys(value).sort().join(',') !== 'schema,source') {
		throw new Error('DEMO_FIPS_TERMINAL_SIGNED_BID: participant-local marker is malformed')
	}
}

export function assertDemoFipsTerminalPins(contract: DemoFridaySignerContract, value: DemoFipsTerminalTrustPinsV1): DemoFipsTerminalTrustPinsV1 {
	assertDemoFridaySignerContract(contract, value)
	if (value.network.length === 0 || value.chainId.length === 0 || value.validatorRosterVersion.length === 0
		|| value.committeeKeysetId.length === 0 || value.committeeKeysetVersion.length === 0 || value.dkgRunId.length === 0
		|| [value.genesisHash, value.validatorsHash, value.publicKeyPackageSha256, value.signerRosterDigest].some((entry) => !HEX_32.test(entry))
		|| !/^http:\/\/\[(?:fc|fd)[0-9a-f:]+\]:(?:3338|3438)$/i.test(value.mintTransportUrl)
		|| (!/^https:\/\/[^/?#]+$/.test(value.mintUrl) && value.mintUrl !== value.mintTransportUrl)) {
		throw new Error('DEMO_FIPS_TERMINAL_PINS: network, chain, DKG, Comet, or mint pin is malformed')
	}
	return Object.freeze({ ...value })
}

/**
 * Every call performs fresh participant-local Comet and mint reads. The
 * coordinator supplies only a signed V2 lookup identity carried inside the
 * immutable terminal policy; it never supplies a positive outcome boolean.
 */
export function createDemoFipsTerminalPolicyPorts(options: {
	contract: DemoFridaySignerContract
	pins: DemoFipsTerminalTrustPinsV1
	anchor: DemoDispositionSignerAnchor
	policy: DemoFrostParticipantPolicyPackage
	fetchImpl?: typeof fetch
}): DemoFrostParticipantPolicyPorts {
	const pins = assertDemoFipsTerminalPins(options.contract, options.pins)
	const policy = structuredClone(options.policy)
	const reader = createLoopbackCometReader(pins.cometRpc, demoFridaySignerCometFetch(options.contract, options.fetchImpl ?? fetch))
	const displacement = createDemoCometDisplacementVerifier({ reader, ...pins })
	const close = createDemoCometCloseVerifier({ reader, ...pins })
	const rejected = createDemoCometRejectedFundingVerifier({ reader, ...pins })
	const fundingAbort = createDemoFridayFundingAbortFinalityVerifier({
		reader, validatorsHash: pins.validatorsHash,
		pins: {
			authNetworkId: pins.network, chainId: pins.chainId, genesisSha256: pins.genesisHash,
			mintUrl: policy.mintUrl, activeKeysetId: policy.activeKeysetId,
			committeePublicKey: policy.committeePublicKey, committeeKeysetId: pins.committeeKeysetId,
			committeeKeysetVersion: pins.committeeKeysetVersion, dkgRunId: pins.dkgRunId,
			publicKeyPackageSha256: pins.publicKeyPackageSha256, signerRosterDigest: pins.signerRosterDigest,
		},
	})
	const mintFetch = pins.mintUrl === pins.mintTransportUrl
		? createOriginBoundMintFetch(pins.mintUrl, options.fetchImpl ?? fetch, { allowFipsUlaHttp: true })
		: createPinnedMintTransportFetch(pins.mintUrl, pins.mintTransportUrl, options.fetchImpl ?? fetch)

	return Object.freeze({
		closureVerifier: Object.freeze({
			async verifyAndDerive(evidence: DemoFrostParticipantLocalEvidence) {
				const lookup = exactClosureLookup(evidence)
				if (lookup.kind === 'funding_abort') {
					const finalized = await fundingAbort.verifyExact({ operationId: policy.operationId,
						consensusEventId: lookup.eventId, height: lookup.eventHeight })
					const certificate = finalized.certificate, commit = finalized.commit
					return {
						evidenceDigest: commit.consensusEventId, network: certificate.authNetworkId,
						chainId: certificate.chainId, auctionId: certificate.auctionId,
						operationId: certificate.operationId, bidId: certificate.operationId,
						bidEventId: certificate.fundingAuthorizationEventId, bidderActorId: certificate.actor,
						role: 'refund' as const, outcomeHeight: commit.stateHeight, appStateHash: commit.stateAppHash,
						amount: certificate.amount, locktime: certificate.locktime,
						proofStateRefs: [...certificate.proofYs], recipientPublicKey: policy.recipientPublicKey,
					}
				}
				if (lookup.kind === 'outbid') {
					const certificate = await displacement.verifyAndDerive({
						network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
						validatorRosterVersion: pins.validatorRosterVersion,
						auctionId: policy.auctionId, displacementHeight: lookup.eventHeight,
						replacementBidEventId: lookup.eventId,
					})
					return {
						evidenceDigest: demoIntegratedDisplacementFinalityDigest(certificate),
						network: certificate.network, chainId: certificate.chainId, auctionId: certificate.auctionId,
						operationId: certificate.displacedFundingOperationId,
						bidId: certificate.displacedFundingOperationId, bidEventId: certificate.displacedFundingOperationId,
						bidderActorId: certificate.displacedBidderActorId, role: 'refund' as const,
						outcomeHeight: certificate.displacementState.stateHeight,
						appStateHash: certificate.displacementState.stateAppHash,
						amount: certificate.displacedPoolAmount, locktime: certificate.timing.locktime,
						proofStateRefs: [...certificate.proofStateRefs], recipientPublicKey: policy.recipientPublicKey,
					}
				}
				if (lookup.kind === 'rejected') {
					const certificate = await rejected.verifyAndDerive({
						network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
						validatorRosterVersion: pins.validatorRosterVersion, auctionId: policy.auctionId,
						fundingOperationId: policy.operationId, bidEventId: lookup.eventId,
						rejectionHeight: lookup.eventHeight,
					})
					return {
						evidenceDigest: demoIntegratedRejectedFundingDigest(certificate), network: certificate.network,
						chainId: certificate.chainId, auctionId: certificate.auctionId,
						operationId: certificate.fundingOperationId, bidId: certificate.fundingOperationId,
						bidEventId: certificate.fundingOperationId, bidderActorId: certificate.bidderActorId,
						role: 'refund' as const, outcomeHeight: certificate.fundingState.stateHeight,
						appStateHash: certificate.fundingState.stateAppHash, amount: certificate.poolAmount,
						locktime: certificate.timing.locktime, proofStateRefs: [...certificate.proofStateRefs],
						recipientPublicKey: policy.recipientPublicKey,
					}
				}
				const certificate = await close.verifyAndDerive({
					network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
					validatorRosterVersion: pins.validatorRosterVersion,
					auctionId: policy.auctionId, closeHeight: lookup.eventHeight,
				})
				return {
					evidenceDigest: demoIntegratedCloseDigest(certificate), network: certificate.network,
					chainId: certificate.chainId, auctionId: certificate.auctionId,
					operationId: certificate.fundingOperationId, bidId: certificate.fundingOperationId,
					bidEventId: certificate.fundingOperationId, bidderActorId: certificate.bidderActorId,
					role: certificate.cause === 'winner' ? 'winner_settlement' as const : 'refund' as const,
					outcomeHeight: certificate.closeState.stateHeight, appStateHash: certificate.closeState.stateAppHash,
					amount: certificate.poolAmount, locktime: certificate.timing.locktime,
					proofStateRefs: [...certificate.proofStateRefs], recipientPublicKey: policy.recipientPublicKey,
				}
			},
		}),
		signedBidVerifier: Object.freeze({
			async verifyAndDerive(evidence: DemoFrostParticipantLocalEvidence) {
				exactSignedBidMarker(evidence)
				const closure = policy.certifiedClosure.evidence
				if (closure.schema === 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
					&& closure.kind === 'funding_abort') {
					const finalized = await fundingAbort.verifyExact({ operationId: policy.operationId,
						consensusEventId: closure.eventId, height: closure.eventHeight })
					const certificate = finalized.certificate
					return {
						evidenceDigest: policy.signedBid.evidenceDigest, network: certificate.authNetworkId,
						chainId: certificate.chainId, auctionId: certificate.auctionId,
						operationId: certificate.operationId, bidId: certificate.operationId,
						bidEventId: certificate.fundingAuthorizationEventId, bidderActorId: certificate.actor,
						amount: certificate.amount, locktime: certificate.locktime,
						bidderPublicKey: certificate.paymentPublicKey,
						sellerRecipientPublicKey: policy.sellerRecipientPublicKey,
						deposits: certificate.proofYs.map((proofStateRef, index) => ({ proofStateRef,
							amount: policy.deposits[index]!.amount, keysetId: certificate.activeKeysetId })),
					}
				}
				return deriveDemoCometSignedBidEvidence({
					reader, validatorsHash: pins.validatorsHash, minimumHeight: policy.outcomeHeight,
					fundingOperationId: policy.operationId, deposits: policy.deposits,
					sellerRecipientPublicKey: policy.sellerRecipientPublicKey,
				})
			},
		}),
		proofUse: Object.freeze({
			async assertExclusive(request: Parameters<DemoFrostParticipantPolicyPorts['proofUse']['assertExclusive']>[0]) {
				const policyDigest = demoFrostParticipantPolicyDigest(policy)
				if (request.network !== pins.network || request.chainId !== pins.chainId
					|| request.mintUrl !== pins.mintUrl || request.mintUrl !== policy.mintUrl
					|| request.auctionId !== policy.auctionId || request.operationId !== policy.operationId
					|| request.policyPackageDigest !== policyDigest || request.activeKeysetId !== policy.activeKeysetId
					|| JSON.stringify(request.proofStateRefs) !== JSON.stringify(policy.deposits.map(({ proofStateRef }) => proofStateRef))) {
					throw new Error('DEMO_FIPS_TERMINAL_PROOF_USE: request differs from exact policy or trust pins')
				}
				const client = new CashuMintClient({ mintUrl: pins.mintUrl, fetchImpl: mintFetch })
				const active = (await client.keysets()).keysets.filter((entry) => entry.active && entry.unit === 'sat')
				if (active.length !== 1 || active[0]!.id !== policy.activeKeysetId || (active[0]!.input_fee_ppk ?? 0) !== 0) {
					throw new Error('DEMO_FIPS_TERMINAL_MINT: active zero-fee keyset differs from policy')
				}
				const keyset = (await client.keys(policy.activeKeysetId)).keysets
					.find((entry) => entry.id === policy.activeKeysetId && entry.unit === 'sat')
				if (keyset === undefined || policy.committeeLockedProofs.some((proof) => proof.id !== policy.activeKeysetId
					|| !hasValidDleq(proof as never, keyset as never, { require: true }))) {
					throw new Error('DEMO_FIPS_TERMINAL_MINT: input DLEQ/keyset binding failed')
				}
				const refs = policy.committeeLockedProofs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true)))
				const response = await mintFetch(`${pins.mintUrl}/v1/checkstate`, {
					method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: refs }),
				})
				if (!response.ok) throw new Error(`DEMO_FIPS_TERMINAL_MINT: NUT-07 returned HTTP ${response.status}`)
				const exact = exactDemoNut07Result(refs, await response.json())
				if (exact.states.some((state) => state !== 'UNSPENT')) throw new Error('DEMO_FIPS_TERMINAL_MINT: proof pool is not UNSPENT')
				options.anchor.claimProofs(refs.map((proofRef) => ({
					proofRef, network: pins.network, chainId: pins.chainId, auctionId: policy.auctionId,
					operationId: policy.operationId, policyDigest,
				})))
			},
		}),
	})
}
