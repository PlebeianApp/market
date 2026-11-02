import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { createDemoCometCloseVerifier } from './demo-comet-close-verifier'
import type { DemoCometStateV1, DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'
import {
	demoIntegratedFundingV4AdmissionSignatureDigest,
	finalizeDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4Unsigned,
} from './demo-integrated-funding-receipt-v4'

const H = (value: string): string => value.repeat(64).slice(0, 64)
const scalar = (value: number): Uint8Array => hexToBytes(value.toString(16).padStart(64, '0'))
const compressed = (value: number): string => bytesToHex(secp256k1.getPublicKey(scalar(value), true))

describe('V4 close recipient binding', () => {
	test('derives the seller Coco key only from authenticated committed auction state', async () => {
		const fixture = JSON.parse(readFileSync('../fixtures/integrated-funding-v4-browser-golden.json', 'utf8')) as {
			receipt: DemoIntegratedFundingReceiptV4Unsigned
		}
		const policy = H('8')
		const receipt = finalizeDemoIntegratedFundingReceiptV4(
			fixture.receipt, policy,
			bytesToHex(schnorr.sign(hexToBytes(demoIntegratedFundingV4AdmissionSignatureDigest(fixture.receipt, policy)), scalar(4))),
		)
		const height = 40
		const bidId = H('c')
		const sellerActor = H('d')
		const sellerPaymentPublicKey = compressed(5)
		const state: DemoCometStateV1 = {
			chain_id: receipt.chain_id, height: height + 2,
			auctions: { [receipt.auction_id]: {
				id: receipt.auction_id, seller: sellerActor, seller_coco_payment_public_key: sellerPaymentPublicKey,
				funding_mode: 'threshold_sigall_v1', status: 'closed', leader_bid_id: bidId,
				high_bid: receipt.bid_amount, reserve: 2_000, original_end_time: 1_500, end_time: 3_300,
				winner: receipt.bidder, closed_at: 3_400,
			} },
			bids: { [bidId]: { id: bidId, auction_id: receipt.auction_id, bidder: receipt.bidder,
				amount: receipt.bid_amount, integrated_funding_id: receipt.funding_operation_id, replaces_bid_id: '' } },
			integrated_fundings: { [receipt.funding_operation_id]: { id: receipt.funding_operation_id,
				auction_id: receipt.auction_id, bid_id: bidId, bidder: receipt.bidder,
				status: 'payout_entitled', receipt } },
			integrated_displacements: {},
		}
		const bytes = new TextEncoder().encode(JSON.stringify(state))
		const appHash = bytesToHex(sha256(bytes))
		const validatorsHash = H('e')
		const reader: DemoParticipantConsensusReader = {
			async readChainId() { return receipt.chain_id },
			async readBlock(at) { return { height: at, blockHash: at.toString(16).padStart(64, '0'),
				transactions: [new TextEncoder().encode(JSON.stringify({ version: 1, type: 'close', auction_id: receipt.auction_id }))] } },
			async readCommit(at) { return { height: at, blockTime: at === height ? 3_400 : 3_400 + at - height,
				blockHash: at.toString(16).padStart(64, '0'), appHash: at === height + 1 ? H('f') : appHash,
				validatorsHash, commitSignerAddresses: ['A', 'B', 'C'].map((value) => value.repeat(40)) } },
			async readCurrentState() { return { queryHeight: height + 2, appHash, canonicalStateBytes: bytes, state } },
		}
		const verifier = createDemoCometCloseVerifier({ reader, network: 'friday-demo', chainId: receipt.chain_id,
			genesisHash: H('1'), validatorRosterVersion: 'roster-1', validatorsHash,
			committeeKeysetId: receipt.committee_keyset_id, committeeKeysetVersion: receipt.committee_keyset_version,
			dkgRunId: receipt.dkg_run_id, publicKeyPackageSha256: receipt.public_key_package_sha256,
			signerRosterDigest: receipt.signer_roster_digest })
		const certified = await verifier.verifyAndDerive({ network: 'friday-demo', chainId: receipt.chain_id,
			genesisHash: H('1'), validatorRosterVersion: 'roster-1', auctionId: receipt.auction_id, closeHeight: height })
		expect(certified).toMatchObject({ cause: 'winner', sellerActorId: sellerActor, sellerPaymentPublicKey })

		state.auctions[receipt.auction_id]!.seller_coco_payment_public_key = compressed(6)
		await expect(verifier.verifyAndDerive({ network: 'friday-demo', chainId: receipt.chain_id,
			genesisHash: H('1'), validatorRosterVersion: 'roster-1', auctionId: receipt.auction_id, closeHeight: height }))
			.rejects.toThrow(/canonical state bytes differ|seller key/)
	})
})
