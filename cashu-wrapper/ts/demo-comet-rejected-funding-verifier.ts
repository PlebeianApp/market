/** Participant-local proof that one exact V4 funding transaction committed as a deterministic rejection. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	authenticatedDemoCometState,
	exactDemoCometCommit,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import { demoIntegratedTiming, type DemoCanonicalCommitV1, type DemoDisplacementStateCommitV1, type DemoIntegratedTimingV1 } from './demo-integrated-authority'
import {
	demoIntegratedFundingV4ReceiptDigest,
	verifyDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4,
} from './demo-integrated-funding-receipt-v4'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const ACTOR = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
export const DEMO_REJECTION_REASONS = [
	'auction_not_open', 'seller_self_bid', 'late', 'below_minimum', 'stale_leader', 'funding_expired',
] as const
export type DemoRejectedFundingReason = typeof DEMO_REJECTION_REASONS[number]

export interface DemoCertifiedRejectedFundingV1 {
	schema: 'COCO_DEMO_CERTIFIED_REJECTED_FUNDING_V1'
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	auctionId: string
	sellerActorId: string
	sellerPaymentPublicKey: string
	bidEventId: string
	bidderActorId: string
	fundingOperationId: string
	rejectionReason: DemoRejectedFundingReason
	poolAmount: number
	proofStateRefs: string[]
	activeKeysetId: string
	inputFeePpk: 0
	admittedFundingReceipt: DemoIntegratedFundingReceiptV4
	timing: DemoIntegratedTimingV1
	commits: [DemoCanonicalCommitV1, DemoCanonicalCommitV1, DemoCanonicalCommitV1]
	fundingState: DemoDisplacementStateCommitV1
}

export interface DemoCertifiedRejectedFundingRequestV1 {
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	auctionId: string
	fundingOperationId: string
	bidEventId: string
	rejectionHeight: number
}

export interface DemoCertifiedRejectedFundingVerifierPort {
	verifyAndDerive(request: DemoCertifiedRejectedFundingRequestV1): Promise<DemoCertifiedRejectedFundingV1>
}

export interface DemoCometRejectedFundingVerifierOptions {
	reader: DemoParticipantConsensusReader
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
}

function fail(message: string): never { throw new Error(`DEMO_COMET_REJECTED_FUNDING: ${message}`) }
function exactText(value: string, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(`${label} is invalid`)
	return value
}

interface ExactBidEvent {
	id: string; pubkey: string; created_at: number; kind: 28641; tags: string[][]; content: string; sig: string
}

function eventId(event: Omit<ExactBidEvent, 'id' | 'sig'>): string {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
	]))))
}

function exactCommittedBid(raw: Uint8Array, expectedEventId: string): { event: ExactBidEvent; receipt: DemoIntegratedFundingReceiptV4 } {
	let value: unknown
	try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) }
	catch { return fail('committed transaction is not exact UTF-8 JSON') }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('committed transaction is not an object')
	const tx = value as Record<string, unknown>
	if (JSON.stringify(Object.keys(tx).sort()) !== JSON.stringify(['event', 'type', 'version'])
		|| tx.version !== 1 || tx.type !== 'event' || tx.event === null || typeof tx.event !== 'object' || Array.isArray(tx.event)) {
		fail('committed transaction is not one exact event envelope')
	}
	const rawEvent = tx.event as Record<string, unknown>
	if (JSON.stringify(Object.keys(rawEvent).sort()) !== JSON.stringify(['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'])
		|| !HEX_32.test(String(rawEvent.id ?? '')) || !ACTOR.test(String(rawEvent.pubkey ?? ''))
		|| !HEX_64.test(String(rawEvent.sig ?? '')) || rawEvent.kind !== 28641
		|| !Number.isSafeInteger(rawEvent.created_at) || Number(rawEvent.created_at) < 1
		|| !Array.isArray(rawEvent.tags) || rawEvent.tags.some((tag) => !Array.isArray(tag) || tag.some((entry) => typeof entry !== 'string'))
		|| typeof rawEvent.content !== 'string') fail('committed bid event is malformed')
	const event = rawEvent as unknown as ExactBidEvent
	const unsigned = { pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags, content: event.content }
	if (event.id !== expectedEventId || event.id !== eventId(unsigned)
		|| !schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))) fail('committed bid signature or identity is invalid')
	let content: unknown
	try { content = JSON.parse(event.content) }
	catch { return fail('committed bid content is not JSON') }
	if (content === null || typeof content !== 'object' || Array.isArray(content)) fail('committed bid content is malformed')
	const bid = content as Record<string, unknown>
	if (JSON.stringify(Object.keys(bid).sort()) !== JSON.stringify(['amount', 'auction_id', 'integrated_funding', 'replaces_bid_id'])) {
		fail('committed bid content has unexpected fields')
	}
	let receipt: DemoIntegratedFundingReceiptV4
	try { receipt = verifyDemoIntegratedFundingReceiptV4(bid.integrated_funding as DemoIntegratedFundingReceiptV4) }
	catch (error) { return fail(error instanceof Error ? error.message : 'committed V4 receipt is invalid') }
	if (bid.auction_id !== receipt.auction_id || bid.amount !== receipt.bid_amount
		|| bid.replaces_bid_id !== receipt.replaces_bid_id || event.pubkey !== receipt.bidder) {
		fail('committed bid content differs from its V4 receipt')
	}
	return { event, receipt }
}

export function createDemoCometRejectedFundingVerifier(
	options: DemoCometRejectedFundingVerifierOptions,
): DemoCertifiedRejectedFundingVerifierPort {
	const pins = {
		network: exactText(options.network, 'network'), chainId: exactText(options.chainId, 'chainId'),
		genesisHash: options.genesisHash, validatorRosterVersion: exactText(options.validatorRosterVersion, 'validatorRosterVersion'),
		validatorsHash: options.validatorsHash, committeeKeysetId: exactText(options.committeeKeysetId, 'committeeKeysetId'),
		committeeKeysetVersion: exactText(options.committeeKeysetVersion, 'committeeKeysetVersion'),
		dkgRunId: exactText(options.dkgRunId, 'dkgRunId'), publicKeyPackageSha256: options.publicKeyPackageSha256,
		signerRosterDigest: options.signerRosterDigest,
	}
	if (![pins.genesisHash, pins.validatorsHash, pins.publicKeyPackageSha256, pins.signerRosterDigest].every((value) => HEX_32.test(value))) {
		fail('genesis, validator-roster, or DKG binding hash is invalid')
	}
	return Object.freeze({
		async verifyAndDerive(request: DemoCertifiedRejectedFundingRequestV1): Promise<DemoCertifiedRejectedFundingV1> {
			if (request.network !== pins.network || request.chainId !== pins.chainId || request.genesisHash !== pins.genesisHash
				|| request.validatorRosterVersion !== pins.validatorRosterVersion || !ID.test(request.auctionId)
				|| !ID.test(request.fundingOperationId) || !HEX_32.test(request.bidEventId)
				|| !Number.isSafeInteger(request.rejectionHeight) || request.rejectionHeight < 1) {
				fail('request differs from participant-local network pins')
			}
			if (await options.reader.readChainId() !== pins.chainId) fail('local Comet node reports another chain')
			const [stateResult, block, ...commitObservations] = await Promise.all([
				authenticatedDemoCometState(options.reader, pins.validatorsHash, request.rejectionHeight + 2),
				options.reader.readBlock(request.rejectionHeight),
				...([0, 1, 2] as const).map((offset) => options.reader.readCommit(request.rejectionHeight + offset)),
			])
			if (block.height !== request.rejectionHeight || block.blockHash !== commitObservations[0]?.blockHash) {
				fail('rejected transaction block is not joined to canonical commit H')
			}
			const matches = block.transactions.map((raw) => {
				try { return exactCommittedBid(raw, request.bidEventId) } catch { return null }
			}).filter((value): value is { event: ExactBidEvent; receipt: DemoIntegratedFundingReceiptV4 } => value !== null)
			if (matches.length !== 1) fail('block does not contain one exact rejected V4 bid')
			const { event, receipt } = matches[0]!
			const state = stateResult.observation.state
			const auction = state.auctions?.[request.auctionId]
			const funding = state.integrated_fundings?.[request.fundingOperationId]
			if (state.chain_id !== pins.chainId || auction === undefined || funding === undefined
				|| funding.id !== request.fundingOperationId || funding.auction_id !== request.auctionId
				|| funding.bid_id !== event.id || funding.bidder !== event.pubkey
				|| funding.status !== 'rejected_return_entitled'
				|| !DEMO_REJECTION_REASONS.includes(funding.rejection_reason as DemoRejectedFundingReason)
				|| state.bids?.[event.id] !== undefined) fail('authenticated state does not prove one exact rejected funding operation')
			let stateReceipt: DemoIntegratedFundingReceiptV4
			try { stateReceipt = verifyDemoIntegratedFundingReceiptV4(funding.receipt as DemoIntegratedFundingReceiptV4) }
			catch (error) { return fail(error instanceof Error ? error.message : 'state V4 receipt is invalid') }
			if (demoIntegratedFundingV4ReceiptDigest(stateReceipt) !== demoIntegratedFundingV4ReceiptDigest(receipt)
				|| stateReceipt.committee_signature !== receipt.committee_signature
				|| stateReceipt.participant_policy_digest !== receipt.participant_policy_digest
				|| receipt.funding_operation_id !== request.fundingOperationId || receipt.auction_id !== request.auctionId
				|| receipt.committee_keyset_id !== pins.committeeKeysetId
				|| receipt.committee_keyset_version !== pins.committeeKeysetVersion || receipt.dkg_run_id !== pins.dkgRunId
				|| receipt.public_key_package_sha256 !== pins.publicKeyPackageSha256
				|| receipt.signer_roster_digest !== pins.signerRosterDigest || receipt.input_fee_ppk !== 0) {
				fail('rejected funding receipt differs from transaction or participant-local pins')
			}
			if (!ACTOR.test(auction.seller ?? '') || !/^(?:02|03)[0-9a-f]{64}$/.test(auction.seller_coco_payment_public_key ?? '')
				|| !Number.isSafeInteger(auction.original_end_time) || !Number.isSafeInteger(auction.end_time)) {
				fail('auction payout identity or timing is absent')
			}
			const timing = demoIntegratedTiming(auction.original_end_time!, auction.end_time!)
			if (timing.locktime !== receipt.locktime) fail('auction timing differs from admitted emergency locktime')
			const commits = commitObservations.map((value, index) =>
				exactDemoCometCommit(value, request.rejectionHeight + index, pins.validatorsHash)) as DemoCertifiedRejectedFundingV1['commits']
			return {
				schema: 'COCO_DEMO_CERTIFIED_REJECTED_FUNDING_V1', network: pins.network, chainId: pins.chainId,
				genesisHash: pins.genesisHash, validatorRosterVersion: pins.validatorRosterVersion,
				auctionId: request.auctionId, sellerActorId: auction.seller!, sellerPaymentPublicKey: auction.seller_coco_payment_public_key!,
				bidEventId: event.id, bidderActorId: event.pubkey, fundingOperationId: request.fundingOperationId,
				rejectionReason: funding.rejection_reason as DemoRejectedFundingReason, poolAmount: receipt.pool_amount,
				proofStateRefs: [...receipt.proof_state_refs], activeKeysetId: receipt.active_keyset_id, inputFeePpk: 0,
				admittedFundingReceipt: receipt, timing, commits,
				fundingState: { stateHeight: stateResult.observation.queryHeight, stateAppHash: stateResult.observation.appHash, bindingCommit: stateResult.bindingCommit },
			}
		},
	})
}
