/** Source-prepared local fixture for concrete sign/broadcast/commit confirmation. NOT_RUN. */
import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	createDemoCometBidConsensus,
	createLoopbackCometBidBroadcaster,
	createLoopbackCometTxRecovery,
	type DemoNostrBidEvent,
} from './demo-comet-bid-consensus'
import type { DemoCometStateV1, DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'
import {
	demoIntegratedFundingAdmissionSignatureDigest,
	demoIntegratedFundingBundleDigest,
	finalizeDemoIntegratedFundingReceipt,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'

const privateKey = (value: number) => new Uint8Array(32).fill(value)
const publicKey = (value: number) => bytesToHex(schnorr.getPublicKey(privateKey(value)))
const sign = (digest: string, value: number) => bytesToHex(schnorr.sign(hexToBytes(digest), privateKey(value)))
const hex = (value: string) => value.repeat(64).slice(0, 64)

function receipt() {
	const terms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: 'demo-chain', chain_id: 'demo-chain',
		mint_url: 'http://127.0.0.1:3338',
		auction_id: 'auction-admission', bidder: publicKey(4), bid_amount: 1_500, pool_amount: 1_500,
		replaces_bid_id: '', funding_operation_id: 'funding-admission', attested_at: 2_000_000_000,
		expires_at: 2_000_000_300, proof_state_refs: [`02${'11'.repeat(32)}`], active_keyset_id: 'zero-fee',
		input_fee_ppk: 0, locktime: 2_000_002_700, bidder_public_key: `02${publicKey(1)}`,
		refund_public_key: `02${publicKey(3)}`, committee_public_key: `02${publicKey(2)}`,
		committee_keyset_id: 'committee', committee_keyset_version: '1', dkg_run_id: 'dkg-run',
		public_key_package_sha256: hex('6'), signer_roster_digest: hex('7'), winner_package_digest: hex('8'),
		return_package_digest: hex('9'), return_cashu_sigall_digest: hex('a'), bidder_return_signature: sign(hex('a'), 1),
	}
	const bundle = demoIntegratedFundingBundleDigest(terms)
	const unsigned = prepareDemoIntegratedFundingReceipt(terms, sign(bundle, 4))
	const policyDigest = hex('8')
	return finalizeDemoIntegratedFundingReceipt(unsigned, policyDigest, sign(demoIntegratedFundingAdmissionSignatureDigest(unsigned, policyDigest), 2))
}

describe('concrete Comet bid consensus adapter (prepared, not yet executed)', () => {
	test('uses Comet v1 exact 0x byte-slice framing rather than quoted base64 text', async () => {
		const transaction = new TextEncoder().encode('{"type":"event"}')
		let observed: URL | undefined
		const fetchMock = (async (input: RequestInfo | URL) => {
			observed = new URL(String(input))
			return new Response(JSON.stringify({ result: {
				height: '7', hash: 'AB'.repeat(32), check_tx: { code: 0 }, tx_result: { code: 0 },
			} }), { status: 200, headers: { 'content-type': 'application/json' } })
		}) as typeof fetch
		const broadcaster = createLoopbackCometBidBroadcaster('http://127.0.0.1:28657', fetchMock)
		const result = await broadcaster.broadcastAndWait(transaction)
		expect(observed?.searchParams.get('tx')).toBe(`0x${Buffer.from(transaction).toString('hex')}`)
		expect(result).toEqual({ height: 7, txHash: 'ab'.repeat(32) })
	})

	test('recovers exact accepted transaction bytes without rebroadcasting', async () => {
		const transaction = new TextEncoder().encode('{"type":"event","accepted":true}')
		const txHash = bytesToHex(sha256(transaction))
		let observed: URL | undefined
		const fetchMock = (async (input: RequestInfo | URL) => {
			observed = new URL(String(input))
			return new Response(JSON.stringify({ result: {
				height: '19', hash: txHash.toUpperCase(), tx: Buffer.from(transaction).toString('base64'),
				tx_result: { code: 0 },
			} }), { status: 200, headers: { 'content-type': 'application/json' } })
		}) as typeof fetch
		const recovery = createLoopbackCometTxRecovery('http://127.0.0.1:28657', fetchMock)
		expect(await recovery.recoverExact(txHash)).toEqual({ height: 19, txHash })
		expect(observed?.pathname).toBe('/tx')
		expect(observed?.searchParams.get('hash')).toBe(`0x${txHash}`)
		expect(observed?.searchParams.get('prove')).toBe('false')
	})

	test('rejects permissive or mismatched base64 in transaction recovery', async () => {
		const transaction = new TextEncoder().encode('exact transaction')
		const txHash = bytesToHex(sha256(transaction))
		for (const encoded of [`${Buffer.from(transaction).toString('base64')}!`, Buffer.from('other').toString('base64')]) {
			const fetchMock = (async () => new Response(JSON.stringify({ result: {
				height: '19', hash: txHash.toUpperCase(), tx: encoded, tx_result: { code: 0 },
			} }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
			const recovery = createLoopbackCometTxRecovery('http://127.0.0.1:28657', fetchMock)
			await expect(recovery.recoverExact(txHash)).rejects.toThrow(/base64|hash/)
		}
	})

	test('signs one exact Nostr bid and authenticates H/H+1/H+2 plus observed S/S+1', async () => {
		const funding = receipt()
		const height = 70
		let committedEvent: DemoNostrBidEvent | undefined
		let txHash = ''
		const state = (): DemoCometStateV1 => {
			if (committedEvent === undefined) throw new Error('event not yet committed')
			return {
				chain_id: 'friday-chain', height: height + 2,
				auctions: { [funding.auction_id]: { id: funding.auction_id, funding_mode: 'threshold_sigall_v1', status: 'open', leader_bid_id: committedEvent.id } },
				bids: { [committedEvent.id]: { id: committedEvent.id, auction_id: funding.auction_id, bidder: funding.bidder, amount: funding.bid_amount, integrated_funding_id: funding.funding_operation_id, replaces_bid_id: '' } },
				integrated_fundings: { [funding.funding_operation_id]: { id: funding.funding_operation_id, auction_id: funding.auction_id, bid_id: committedEvent.id, bidder: funding.bidder, status: 'active', receipt: Object.fromEntries(Object.entries(funding).reverse()) as typeof funding } },
				integrated_displacements: {},
			}
		}
		const stateBytes = () => new TextEncoder().encode(JSON.stringify(state()))
		const stateHash = () => bytesToHex(sha256(stateBytes()))
		const reader: DemoParticipantConsensusReader = {
			async readChainId() { return 'friday-chain' },
			async readCommit(at) { return { height: at, blockTime: 2_000_000_100 + at, blockHash: at.toString(16).padStart(64, '0'), appHash: at === height + 3 ? stateHash() : hex('c'), validatorsHash: hex('d'), commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)] } },
			async readBlock(at) { return { height: at, blockHash: at.toString(16).padStart(64, '0'), transactions: committedEvent === undefined ? [] : [new TextEncoder().encode(JSON.stringify({ version: 1, type: 'event', event: committedEvent }))] } },
			async readCurrentState() { return { queryHeight: height + 2, appHash: stateHash(), canonicalStateBytes: stateBytes(), state: state() } },
		}
		const consensus = createDemoCometBidConsensus({
			reader, chainId: 'friday-chain', validatorsHash: hex('d'), nowSeconds: () => 2_000_000_100,
			signer: {
				async getPublicKey() { return publicKey(4) },
				async signEvent(unsigned) {
					const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content]))))
					return { ...unsigned, id, sig: sign(id, 4) }
				},
			},
			broadcaster: {
				async broadcastAndWait(tx) {
					const decoded = JSON.parse(new TextDecoder().decode(tx)) as { event: DemoNostrBidEvent }
					committedEvent = decoded.event; txHash = bytesToHex(sha256(tx)); return { height, txHash }
				},
			},
		})
		const committed = await consensus.broadcastAndConfirm(funding)
		expect(committed).toMatchObject({
			height, stateHeight: height + 2, stateBindingHeight: height + 3,
			fundingOperationId: funding.funding_operation_id, disposition: { kind: 'active' }, broadcastTxHash: txHash,
		})
	})

	test('keeps H committed when authenticated S already records displacement at H+1', async () => {
		const funding = receipt()
		const height = 80
		let committedEvent: DemoNostrBidEvent | undefined
		let replacementId = ''
		const state = (): DemoCometStateV1 => {
			if (committedEvent === undefined) throw new Error('event not yet committed')
			replacementId = hex('e')
			return {
				chain_id: 'friday-chain', height: height + 2,
				auctions: { [funding.auction_id]: { id: funding.auction_id, funding_mode: 'threshold_sigall_v1', status: 'open', leader_bid_id: replacementId } },
				bids: { [committedEvent.id]: { id: committedEvent.id, auction_id: funding.auction_id, bidder: funding.bidder, amount: funding.bid_amount, integrated_funding_id: funding.funding_operation_id, replaces_bid_id: '' } },
				integrated_fundings: { [funding.funding_operation_id]: { id: funding.funding_operation_id, auction_id: funding.auction_id, bid_id: committedEvent.id, bidder: funding.bidder, status: 'outbid_return_entitled', receipt: funding } },
				integrated_displacements: { [replacementId]: { id: replacementId, auction_id: funding.auction_id, displaced_bid_id: committedEvent.id, replacement_bid_id: replacementId, displaced_funding_id: funding.funding_operation_id, replacement_funding_id: 'replacement-funding', committed_at: 2_000_000_181, original_end_time: 2_000_001_000, certified_end_time: 2_000_001_000 } },
			}
		}
		const stateBytes = () => new TextEncoder().encode(JSON.stringify(state()))
		const stateHash = () => bytesToHex(sha256(stateBytes()))
		const reader: DemoParticipantConsensusReader = {
			async readChainId() { return 'friday-chain' },
			async readCommit(at) { return { height: at, blockTime: 2_000_000_100 + at, blockHash: at.toString(16).padStart(64, '0'), appHash: at === height + 3 ? stateHash() : hex('c'), validatorsHash: hex('d'), commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)] } },
			async readBlock(at) { return { height: at, blockHash: at.toString(16).padStart(64, '0'), transactions: committedEvent === undefined ? [] : [new TextEncoder().encode(JSON.stringify({ version: 1, type: 'event', event: committedEvent }))] } },
			async readCurrentState() { return { queryHeight: height + 2, appHash: stateHash(), canonicalStateBytes: stateBytes(), state: state() } },
		}
		const consensus = createDemoCometBidConsensus({
			reader, chainId: 'friday-chain', validatorsHash: hex('d'), nowSeconds: () => 2_000_000_100,
			signer: { async getPublicKey() { return publicKey(4) }, async signEvent(unsigned) {
				const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content]))))
				return { ...unsigned, id, sig: sign(id, 4) }
			} },
			broadcaster: { async broadcastAndWait(tx) {
				committedEvent = (JSON.parse(new TextDecoder().decode(tx)) as { event: DemoNostrBidEvent }).event
				return { height, txHash: bytesToHex(sha256(tx)) }
			} },
		})
		const committed = await consensus.broadcastAndConfirm(funding)
		expect(committed).toMatchObject({
			height, disposition: { kind: 'displaced', branch: 'outbid_return', successorBidId: replacementId },
		})
	})
})
