/**
 * Authenticated post-broadcast admission for the disabled Friday V4 route.
 *
 * A successful Comet RPC response is deliberately insufficient.  This
 * adapter re-reads the pinned genesis identity, canonical H/H+1/H+2 commits,
 * the exact transaction bytes at H, and an application state S authenticated
 * by S+1.  Only then may the durable prepared-funding replay row transition
 * from `stored` to `admitted`.
 */
import { readFile } from 'node:fs/promises'
import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	authenticatedDemoCometState,
	exactDemoCometCommit,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import {
	demoIntegratedFundingV4ReceiptDigest,
	verifyDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4,
} from './demo-integrated-funding-receipt-v4'
import {
	type DemoFridayFundingAdmissionCommitV1,
	type DemoFridayFundingReplayRecordV1,
	type DemoFridayPreparedFundingAdmission,
} from './demo-friday-prepared-funding'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const BID_KIND = 28641

export interface DemoFridayPinnedGenesisIdentityV1 {
	schema: 'PLEBEIAN_FRIDAY_PINNED_GENESIS_IDENTITY_V1'
	chainId: string
	genesisSha256: string
}

export interface DemoFridayPinnedGenesisPort {
	readExact(): Promise<DemoFridayPinnedGenesisIdentityV1>
}

export interface DemoFridayV4BroadcastIdentityV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_BROADCAST_IDENTITY_V1'
	fundingAuthorizationEventId: string
	bidEventId: string
	fundingOperationId: string
	committedHeight: number
	transactionHash: string
}

export interface DemoFridayV4CometAdmissionPort {
	confirmAndAdmitExact(value: DemoFridayV4BroadcastIdentityV1): Promise<DemoFridayFundingReplayRecordV1>
}

export type DemoFridayV4CometAdmissionFailureStage =
	| 'identity'
	| 'stored_package_read'
	| 'replay_ownership'
	| 'network_reads'
	| 'network_identity'
	| 'block_height'
	| 'transaction_match'
	| 'transaction_decode'
	| 'commit_verification'
	| 'block_commit_join'
	| 'receipt_interval'
	| 'private_bundle'
	| 'state_funding'
	| 'state_receipt'
	| 'state_disposition'
	| 'state_expiry'
	| 'admission_write'

export interface DemoFridayV4CometAdmissionFailureDiagnosticV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_COMET_ADMISSION_FAILURE_DIAGNOSTIC_V1'
	stage: DemoFridayV4CometAdmissionFailureStage
}

export interface DemoFridayPreparedFundingAdmissionPort {
	readStoredExact(eventId: string): ReturnType<DemoFridayPreparedFundingAdmission['readStoredExact']>
	markAdmittedExact(commit: DemoFridayFundingAdmissionCommitV1): DemoFridayFundingReplayRecordV1
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_V4_COMET_ADMISSION: ${message}`) }

function exactKeys(value: object, expected: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail(`${label} has unexpected fields`)
}

function exactIdentity(value: DemoFridayV4BroadcastIdentityV1): DemoFridayV4BroadcastIdentityV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_V4_BROADCAST_IDENTITY_V1'
		|| ![value.fundingAuthorizationEventId, value.bidEventId, value.transactionHash].every((item) => HEX_32.test(item))
		|| typeof value.fundingOperationId !== 'string' || value.fundingOperationId.length < 1
		|| value.fundingOperationId.length > 160 || !Number.isSafeInteger(value.committedHeight)
		|| value.committedHeight < 1) fail('broadcast identity is malformed')
	return structuredClone(value)
}

interface ExactBidEvent {
	id: string
	pubkey: string
	created_at: number
	kind: typeof BID_KIND
	tags: string[][]
	content: string
	sig: string
}

function exactEventId(event: Omit<ExactBidEvent, 'id' | 'sig'>): string {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
	]))))
}

function exactBidTransaction(raw: Uint8Array, expected: DemoFridayV4BroadcastIdentityV1): {
	event: ExactBidEvent
	receipt: DemoIntegratedFundingReceiptV4
} {
	let decoded: unknown
	try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) }
	catch { return fail('committed transaction is not exact UTF-8 JSON') }
	if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) fail('committed transaction is not an object')
	const transaction = decoded as Record<string, unknown>
	exactKeys(transaction, ['version', 'type', 'event'], 'transaction')
	if (transaction.version !== 1 || transaction.type !== 'event'
		|| transaction.event === null || typeof transaction.event !== 'object' || Array.isArray(transaction.event)) {
		fail('committed transaction is not one event envelope')
	}
	const rawEvent = transaction.event as Record<string, unknown>
	exactKeys(rawEvent, ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'], 'bid event')
	if (!HEX_32.test(String(rawEvent.id ?? '')) || !HEX_32.test(String(rawEvent.pubkey ?? ''))
		|| !HEX_64.test(String(rawEvent.sig ?? '')) || rawEvent.kind !== BID_KIND
		|| !Number.isSafeInteger(rawEvent.created_at) || Number(rawEvent.created_at) < 1
		|| !Array.isArray(rawEvent.tags) || rawEvent.tags.some((tag) => !Array.isArray(tag) || tag.some((item) => typeof item !== 'string'))
		|| typeof rawEvent.content !== 'string') fail('bid event shape is invalid')
	const event = rawEvent as unknown as ExactBidEvent
	const unsigned = {
		pubkey: event.pubkey, created_at: event.created_at, kind: event.kind,
		tags: structuredClone(event.tags), content: event.content,
	}
	if (event.id !== expected.bidEventId || event.id !== exactEventId(unsigned)
		|| !schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))) {
		fail('bid event identity or signature is invalid')
	}
	let content: unknown
	try { content = JSON.parse(event.content) }
	catch { return fail('bid content is not JSON') }
	if (content === null || typeof content !== 'object' || Array.isArray(content)) fail('bid content is not an object')
	const bid = content as Record<string, unknown>
	exactKeys(bid, ['auction_id', 'amount', 'replaces_bid_id', 'integrated_funding'], 'bid content')
	let receipt: DemoIntegratedFundingReceiptV4
	try { receipt = verifyDemoIntegratedFundingReceiptV4(bid.integrated_funding as DemoIntegratedFundingReceiptV4) }
	catch (error) { return fail(error instanceof Error ? error.message : 'V4 receipt is invalid') }
	if (bid.auction_id !== receipt.auction_id || bid.amount !== receipt.bid_amount
		|| bid.replaces_bid_id !== receipt.replaces_bid_id
		|| receipt.funding_operation_id !== expected.fundingOperationId
		|| event.pubkey !== receipt.bidder) fail('bid content differs from the V4 receipt')
	return { event, receipt }
}

function exactReceiptEqual(left: unknown, right: DemoIntegratedFundingReceiptV4): void {
	let exact: DemoIntegratedFundingReceiptV4
	try { exact = verifyDemoIntegratedFundingReceiptV4(left as DemoIntegratedFundingReceiptV4) }
	catch (error) { return fail(error instanceof Error ? error.message : 'state V4 receipt is invalid') }
	if (demoIntegratedFundingV4ReceiptDigest(exact) !== demoIntegratedFundingV4ReceiptDigest(right)
		|| exact.committee_signature !== right.committee_signature
		|| exact.participant_policy_digest !== right.participant_policy_digest) {
		fail('state receipt differs from the exact committed V4 receipt')
	}
}

function exactPrivateBundle(
	replay: DemoFridayFundingReplayRecordV1,
	receipt: DemoIntegratedFundingReceiptV4,
	stored: Awaited<ReturnType<DemoFridayPreparedFundingAdmission['readStoredExact']>>['stored'],
): void {
	const winner = stored.bundle.winner
	const refund = stored.bundle.refund
	if (replay.eventId !== receipt.actor_funding_authorization.id
		|| replay.fundingOperationId !== receipt.funding_operation_id
		|| replay.bundleDigest !== receipt.prepared_bundle_digest
		|| stored.bundle.bundleDigest !== receipt.prepared_bundle_digest
		|| winner.network !== receipt.auth_network_id || winner.chainId !== receipt.chain_id
		|| winner.auctionId !== receipt.auction_id || winner.operationId !== receipt.funding_operation_id
		|| winner.bidderActorId !== receipt.bidder || winner.amount !== receipt.pool_amount
		|| winner.mintUrl !== receipt.mint_url || winner.bidderPublicKey !== receipt.bidder_public_key
		|| winner.refundPublicKey !== receipt.refund_public_key
		|| winner.committeePublicKey !== receipt.committee_public_key
		|| winner.committeeKeysetId !== receipt.committee_keyset_id
		|| winner.committeeKeysetVersion !== receipt.committee_keyset_version
		|| winner.templateDigest !== receipt.winner_package_digest
		|| refund.templateDigest !== receipt.return_package_digest
		|| refund.cashuSigAllDigest !== receipt.return_cashu_sigall_digest
		|| refund.bidderMainSignature !== receipt.bidder_return_signature) {
		fail('durable private package differs from the committed receipt')
	}
}

/** Read one exact local genesis file and compare its bytes with the reviewed pin. */
export function createDemoFridayPinnedGenesisFilePort(options: {
	chainId: string
	genesisSha256: string
	genesisPath: string
}): DemoFridayPinnedGenesisPort {
	if (!HEX_32.test(options.genesisSha256) || !options.genesisPath.startsWith('/')) fail('genesis file pins are malformed')
	return Object.freeze({
		async readExact() {
			const bytes = await readFile(options.genesisPath)
			const digest = bytesToHex(sha256(bytes))
			let value: unknown
			try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
			catch { return fail('pinned genesis file is not JSON') }
			if (value === null || typeof value !== 'object' || Array.isArray(value)
				|| (value as Record<string, unknown>).chain_id !== options.chainId || digest !== options.genesisSha256) {
				fail('pinned genesis bytes or chain identity changed')
			}
			return { schema: 'PLEBEIAN_FRIDAY_PINNED_GENESIS_IDENTITY_V1' as const, chainId: options.chainId, genesisSha256: digest }
		},
	})
}

export function createDemoFridayV4CometAdmission(options: {
	chainId: string
	genesisSha256: string
	validatorsHash: string
	reader: DemoParticipantConsensusReader
	genesis: DemoFridayPinnedGenesisPort
	prepared: DemoFridayPreparedFundingAdmissionPort
	/** Payload-free diagnostic sink; it must never alter admission behavior. */
	onFailure?: (diagnostic: DemoFridayV4CometAdmissionFailureDiagnosticV1) => void
}): DemoFridayV4CometAdmissionPort {
	if (!HEX_32.test(options.genesisSha256) || !HEX_32.test(options.validatorsHash)
		|| options.chainId.length < 1 || options.chainId.length > 160) fail('fixed network pins are malformed')
	return Object.freeze({
		async confirmAndAdmitExact(inputValue: DemoFridayV4BroadcastIdentityV1) {
			let stage: DemoFridayV4CometAdmissionFailureStage = 'identity'
			try {
				const input = exactIdentity(inputValue)
				stage = 'stored_package_read'
				const held = await options.prepared.readStoredExact(input.fundingAuthorizationEventId)
				stage = 'replay_ownership'
				if (held.replay.fundingOperationId !== input.fundingOperationId) fail('broadcast identity differs from replay ownership')
				stage = 'network_reads'
				const [genesis, reportedChain, block, commitH, commitH1, commitH2, stateResult] = await Promise.all([
					options.genesis.readExact(), options.reader.readChainId(), options.reader.readBlock(input.committedHeight),
					options.reader.readCommit(input.committedHeight), options.reader.readCommit(input.committedHeight + 1),
					options.reader.readCommit(input.committedHeight + 2),
					authenticatedDemoCometState(options.reader, options.validatorsHash, input.committedHeight + 2),
				])
				stage = 'network_identity'
				if (genesis.chainId !== options.chainId || genesis.genesisSha256 !== options.genesisSha256
					|| reportedChain !== options.chainId || stateResult.observation.state.chain_id !== options.chainId) {
					fail('chain or genesis identity differs from fixed pins')
				}
				stage = 'block_height'
				if (block.height !== input.committedHeight) fail('committed block height differs')
				stage = 'transaction_match'
				const matching = block.transactions.filter((raw) => bytesToHex(sha256(raw)) === input.transactionHash)
				if (matching.length !== 1) fail('committed block does not contain one exact transaction hash')
				stage = 'transaction_decode'
				const { event, receipt } = exactBidTransaction(matching[0]!, input)
				stage = 'commit_verification'
				const commits = [commitH, commitH1, commitH2].map((value, index) =>
					exactDemoCometCommit(value, input.committedHeight + index, options.validatorsHash))
				stage = 'block_commit_join'
				if (block.blockHash !== commits[0]!.blockHash) fail('committed block bytes are not joined to canonical commit H')
				stage = 'receipt_interval'
				if (commits[0]!.blockTime < receipt.attested_at) fail('receipt predates its attested validity interval')
				stage = 'private_bundle'
				exactPrivateBundle(held.replay, receipt, held.stored)
				const state = stateResult.observation.state
				const bid = state.bids?.[event.id]
				const funding = state.integrated_fundings?.[receipt.funding_operation_id]
				stage = 'state_funding'
				if (funding === undefined || funding.id !== receipt.funding_operation_id || funding.auction_id !== receipt.auction_id
					|| funding.bid_id !== event.id || funding.bidder !== receipt.bidder) {
					fail('authenticated application state lacks the exact committed funding')
				}
				stage = 'state_receipt'
				exactReceiptEqual(funding.receipt, receipt)
				let disposition: DemoFridayFundingAdmissionCommitV1['disposition']
				let rejectionReason: DemoFridayFundingAdmissionCommitV1['rejectionReason']
				stage = 'state_disposition'
				if (funding.status === 'active') {
					if (bid === undefined || bid.id !== event.id || bid.auction_id !== receipt.auction_id
						|| bid.bidder !== receipt.bidder || bid.amount !== receipt.bid_amount
						|| bid.integrated_funding_id !== receipt.funding_operation_id
						|| funding.rejection_reason !== undefined) {
						fail('authenticated active funding lacks the exact committed bid')
					}
					disposition = 'active'
				} else if (funding.status === 'rejected_return_entitled') {
					if (bid !== undefined || !['auction_not_open', 'seller_self_bid', 'late', 'below_minimum', 'stale_leader', 'funding_expired']
						.includes(funding.rejection_reason ?? '')) {
						fail('authenticated rejected funding lacks one exact rejection reason')
					}
					disposition = 'rejected_return'
					rejectionReason = funding.rejection_reason as DemoFridayFundingAdmissionCommitV1['rejectionReason']
				} else fail('committed funding has no active or rejected-return disposition')
				stage = 'state_expiry'
				const expiredAtCommit = commits[0]!.blockTime > receipt.expires_at
				if (expiredAtCommit) {
					if (disposition !== 'rejected_return' || rejectionReason !== 'funding_expired') {
						fail('expired funding lacks the exact committed return entitlement')
					}
				} else if (rejectionReason === 'funding_expired') {
					fail('funding expiry was not true at committed block time')
				}
				const commit: DemoFridayFundingAdmissionCommitV1 = {
					schema: 'PLEBEIAN_FRIDAY_FUNDING_ADMISSION_COMMIT_V1',
					eventId: input.fundingAuthorizationEventId, bidEventId: event.id,
					fundingOperationId: input.fundingOperationId,
					bundleDigest: held.replay.bundleDigest, scope: held.replay.scope,
					receiptDigest: demoIntegratedFundingV4ReceiptDigest(receipt), transactionHash: input.transactionHash,
					committedHeight: input.committedHeight, disposition, ...(rejectionReason === undefined ? {} : { rejectionReason }),
				}
				stage = 'admission_write'
				return options.prepared.markAdmittedExact(commit)
			} catch (error) {
				try { options.onFailure?.({ schema: 'PLEBEIAN_FRIDAY_V4_COMET_ADMISSION_FAILURE_DIAGNOSTIC_V1', stage }) }
				catch { /* diagnostics cannot alter the protocol result */ }
				throw error
			}
		},
	})
}
