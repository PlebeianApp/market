/** Participant-local Comet history verifier for winner/no-sale close. */
import {
	authenticatedDemoCometState,
	exactDemoCometCommit,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import { demoIntegratedTiming } from './demo-integrated-authority'
import {
	type DemoCertifiedCloseRequestV1,
	type DemoCertifiedCloseV1,
	type DemoCertifiedCloseVerifierPort,
} from './demo-integrated-close-authority'
import { verifyDemoIntegratedFundingReceiptAny } from './demo-integrated-admission-receipt-any'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

export interface DemoCometCloseVerifierOptions {
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

function fail(message: string): never { throw new Error(`DEMO_COMET_CLOSE_HISTORY: ${message}`) }

function text(value: string, field: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(`${field} is invalid`)
	return value
}

function exactCloseInBlock(transactions: Uint8Array[], auctionId: string): void {
	let matches = 0
	for (const raw of transactions) {
		let value: unknown
		try { value = JSON.parse(new TextDecoder().decode(raw)) }
		catch { continue }
		if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
		const tx = value as Record<string, unknown>
		if (tx.version === 1 && tx.type === 'close' && tx.auction_id === auctionId
			&& JSON.stringify(Object.keys(tx).sort()) === JSON.stringify(['auction_id', 'type', 'version'])) matches++
	}
	if (matches !== 1) fail('close block does not contain one exact close transaction')
}

export function createDemoCometCloseVerifier(options: DemoCometCloseVerifierOptions): DemoCertifiedCloseVerifierPort {
	const pins = {
		network: text(options.network, 'network'), chainId: text(options.chainId, 'chainId'),
		genesisHash: options.genesisHash, validatorRosterVersion: text(options.validatorRosterVersion, 'validatorRosterVersion'),
		validatorsHash: options.validatorsHash, committeeKeysetId: text(options.committeeKeysetId, 'committeeKeysetId'),
		committeeKeysetVersion: text(options.committeeKeysetVersion, 'committeeKeysetVersion'),
		dkgRunId: text(options.dkgRunId, 'dkgRunId'), publicKeyPackageSha256: options.publicKeyPackageSha256,
		signerRosterDigest: options.signerRosterDigest,
	}
	if ([pins.genesisHash, pins.validatorsHash, pins.publicKeyPackageSha256, pins.signerRosterDigest].some((value) => !HEX_32.test(value))) {
		fail('genesis, validator-roster, or DKG binding hash is invalid')
	}
	const reader = options.reader
	return Object.freeze({
		async verifyAndDerive(request: DemoCertifiedCloseRequestV1): Promise<DemoCertifiedCloseV1> {
			if (request.network !== pins.network || request.chainId !== pins.chainId || request.genesisHash !== pins.genesisHash
				|| request.validatorRosterVersion !== pins.validatorRosterVersion || !ID.test(request.auctionId)
				|| !Number.isSafeInteger(request.closeHeight) || request.closeHeight < 1) {
				fail('request differs from participant-local network pins')
			}
			if (await reader.readChainId() !== pins.chainId) fail('local Comet node reports another chain')
			const [stateResult, block, ...observed] = await Promise.all([
				authenticatedDemoCometState(reader, pins.validatorsHash, request.closeHeight + 2),
				reader.readBlock(request.closeHeight),
				...([0, 1, 2] as const).map((offset) => reader.readCommit(request.closeHeight + offset)),
			])
			if (block.height !== request.closeHeight) fail('local block height differs from requested close')
			exactCloseInBlock(block.transactions, request.auctionId)
			const commits = observed.map((entry, index) => exactDemoCometCommit(
				entry, request.closeHeight + index, pins.validatorsHash,
			)) as DemoCertifiedCloseV1['commits']
			if (block.blockHash !== commits[0].blockHash) fail('close block bytes are not joined to canonical commit')
			const state = stateResult.observation.state
			const auction = state.auctions?.[request.auctionId]
			if (state.chain_id !== pins.chainId || auction === undefined || auction.id !== request.auctionId
				|| auction.funding_mode !== 'threshold_sigall_v1' || auction.status !== 'closed'
				|| auction.closed_at !== commits[0].blockTime || !Number.isSafeInteger(auction.original_end_time)
				|| !Number.isSafeInteger(auction.end_time) || !Number.isSafeInteger(auction.high_bid)
				|| !Number.isSafeInteger(auction.reserve) || typeof auction.seller !== 'string'
				|| !/^[0-9a-f]{64}$/.test(auction.seller) || typeof auction.leader_bid_id !== 'string'
				|| !HEX_32.test(auction.leader_bid_id)) {
				fail('authenticated state does not contain one closed threshold auction with an admitted leader')
			}
			const bid = state.bids[auction.leader_bid_id]
			if (bid === undefined || bid.id !== auction.leader_bid_id || bid.auction_id !== auction.id
				|| bid.integrated_funding_id.length === 0 || bid.amount !== auction.high_bid) {
				fail('closed auction leader does not resolve to one integrated funded bid')
			}
			const reserve = auction.reserve
			if (reserve === undefined) fail('closed auction reserve disappeared after validation')
			const funding = state.integrated_fundings[bid.integrated_funding_id]
			if (funding === undefined || funding.id !== bid.integrated_funding_id || funding.auction_id !== auction.id
				|| funding.bid_id !== bid.id || funding.bidder !== bid.bidder) {
				fail('closed leader funding record is absent or mismatched')
			}
			const cause = reserve === 0 || bid.amount >= reserve ? 'winner' : 'reserve_unmet'
			if ((cause === 'winner' && (auction.winner !== bid.bidder || funding.status !== 'payout_entitled'))
				|| (cause === 'reserve_unmet' && ((auction.winner ?? '') !== '' || funding.status !== 'release_entitled'))) {
				fail('closed auction outcome and funding entitlement disagree')
			}
			let receipt
			try { receipt = verifyDemoIntegratedFundingReceiptAny(funding.receipt) }
			catch (error) { return fail(error instanceof Error ? error.message : 'leader admission receipt is invalid') }
			if (receipt.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
				&& (!/^(?:02|03)[0-9a-f]{64}$/.test(auction.seller_coco_payment_public_key ?? '')
					|| auction.seller_coco_payment_public_key!.slice(2) === auction.seller)) {
				fail('V4 close state lacks one distinct auction-committed Coco seller key')
			}
			if (receipt.funding_operation_id !== funding.id || receipt.auction_id !== auction.id
				|| receipt.bidder !== bid.bidder || receipt.bid_amount !== bid.amount || receipt.pool_amount !== bid.amount
				|| receipt.committee_keyset_id !== pins.committeeKeysetId
				|| receipt.committee_keyset_version !== pins.committeeKeysetVersion
				|| receipt.dkg_run_id !== pins.dkgRunId
				|| receipt.public_key_package_sha256 !== pins.publicKeyPackageSha256
				|| receipt.signer_roster_digest !== pins.signerRosterDigest || receipt.input_fee_ppk !== 0) {
				fail('leader admission receipt differs from pinned threshold identity or amount')
			}
			return {
				schema: 'COCO_DEMO_CERTIFIED_CLOSE_V1', network: pins.network, chainId: pins.chainId,
				genesisHash: pins.genesisHash, validatorRosterVersion: pins.validatorRosterVersion,
				auctionId: auction.id, sellerActorId: auction.seller,
				sellerPaymentPublicKey: auction.seller_coco_payment_public_key,
				bidId: bid.id, bidEventId: bid.id,
				bidderActorId: bid.bidder, fundingOperationId: funding.id, cause,
				poolAmount: receipt.pool_amount, reserveAmount: reserve,
				proofStateRefs: [...receipt.proof_state_refs], activeKeysetId: receipt.active_keyset_id,
				inputFeePpk: 0, admittedFundingReceipt: receipt,
				timing: demoIntegratedTiming(auction.original_end_time!, auction.end_time!), commits,
				// The current app does not serve historical state.  Bind the exact
				// observed S bytes to header S+1 and separately retain H/H+1/H+2
				// as the close-event finality history; never relabel S as H.
				closeState: {
					stateHeight: stateResult.observation.queryHeight,
					stateAppHash: stateResult.observation.appHash,
					bindingCommit: stateResult.bindingCommit,
				},
			}
		},
	})
}
