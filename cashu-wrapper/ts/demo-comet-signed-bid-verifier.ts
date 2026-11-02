/** Participant-local derivation of the admitted bid facts used for terminal signing. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { authenticatedDemoCometState, type DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'
import {
	demoIntegratedFundingAnyReceiptDigest,
	verifyDemoIntegratedFundingReceiptAny,
} from './demo-integrated-admission-receipt-any'
import type { DemoFrostPublicDeposit, DemoFrostVerifiedSignedBid } from './demo-frost-participant-policy'

export async function deriveDemoCometSignedBidEvidence(options: {
	reader: DemoParticipantConsensusReader
	validatorsHash: string
	minimumHeight: number
	fundingOperationId: string
	deposits: DemoFrostPublicDeposit[]
	sellerRecipientPublicKey: string
}): Promise<DemoFrostVerifiedSignedBid> {
	const authenticated = await authenticatedDemoCometState(options.reader, options.validatorsHash, options.minimumHeight)
	const state = authenticated.observation.state
	const funding = state.integrated_fundings[options.fundingOperationId]
	if (funding === undefined || funding.id !== options.fundingOperationId
		|| !['outbid_return_entitled', 'payout_entitled', 'release_entitled', 'rejected_return_entitled'].includes(funding.status)) {
		throw new Error('DEMO_COMET_SIGNED_BID: exact terminally entitled funding operation is absent')
	}
	const bid = state.bids[funding.bid_id]
	const receipt = verifyDemoIntegratedFundingReceiptAny(funding.receipt)
	const rejected = funding.status === 'rejected_return_entitled'
	if (rejected ? (bid !== undefined || !/^[0-9a-f]{64}$/.test(funding.bid_id)
			|| typeof funding.rejection_reason !== 'string')
		: (bid === undefined || bid.integrated_funding_id !== funding.id || bid.auction_id !== funding.auction_id
			|| bid.bidder !== funding.bidder || !Number.isSafeInteger(bid.amount) || bid.amount < 1)) {
		throw new Error('DEMO_COMET_SIGNED_BID: committed bid or rejected funding identity differs from state')
	}
	if (receipt.funding_operation_id !== funding.id || receipt.auction_id !== funding.auction_id
		|| receipt.bidder !== funding.bidder || receipt.bid_amount !== (rejected ? receipt.pool_amount : bid!.amount)
		|| receipt.input_fee_ppk !== 0) {
		throw new Error('DEMO_COMET_SIGNED_BID: admitted receipt differs from committed bid')
	}
	const deposits = options.deposits.map((deposit) => ({ ...deposit }))
	if (JSON.stringify(deposits.map(({ proofStateRef }) => proofStateRef)) !== JSON.stringify(receipt.proof_state_refs)
		|| deposits.some(({ keysetId, amount }) => keysetId !== receipt.active_keyset_id
			|| !Number.isSafeInteger(amount) || amount < 1)
		|| deposits.reduce((sum, { amount }) => sum + amount, 0) !== receipt.pool_amount
		|| !/^(?:02|03)[0-9a-f]{64}$/.test(options.sellerRecipientPublicKey)) {
		throw new Error('DEMO_COMET_SIGNED_BID: participant proof manifest or seller key is malformed')
	}
	// The current S/S+1 observation above authenticates the lookup but is not
	// part of the durable policy identity: independent signers may query later
	// valid states. Bind only the immutable bid, funding, and receipt facts.
	const evidenceDigest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		'COCO_DEMO_COMET_SIGNED_BID_EVIDENCE_V1', state.chain_id,
		funding.bid_id, funding.auction_id, funding.bidder, receipt.bid_amount, funding.id,
		demoIntegratedFundingAnyReceiptDigest(receipt),
	]))))
	return {
		evidenceDigest, network: state.chain_id, chainId: state.chain_id,
		auctionId: funding.auction_id, operationId: funding.id,
		// The V3 template uses the stable pre-commit funding operation in both
		// slots; the actual Nostr event id remains bound above in evidenceDigest.
		bidId: funding.id, bidEventId: funding.id, bidderActorId: funding.bidder,
		amount: receipt.pool_amount, locktime: receipt.locktime,
		bidderPublicKey: receipt.bidder_public_key,
		sellerRecipientPublicKey: options.sellerRecipientPublicKey, deposits,
	}
}
