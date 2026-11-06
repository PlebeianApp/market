import { describe, expect, test } from 'bun:test'

import {
	createDemoCometDisplacementVerifier,
	createDemoCometAdmissionConsensus,
	createLoopbackCometReader,
	type DemoCometStateV1,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import {
	demoIntegratedFundingAdmissionSignatureDigest,
	demoIntegratedFundingBundleDigest,
	finalizeDemoIntegratedFundingReceipt,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const hex = (digit: string, bytes = 32): string => digit.repeat(bytes * 2)
const eventId = hex('a')
const displacedId = hex('b')
const scalar = (value: number): Uint8Array => hexToBytes(value.toString(16).padStart(64, '0'))
const compressed = (value: number): string => bytesToHex(secp256k1.getPublicKey(scalar(value), true))
const xOnly = (value: number): string => bytesToHex(schnorr.getPublicKey(scalar(value)))
const bidderA = xOnly(1)
const bidderB = xOnly(6)
const proof = `02${hex('e')}`
const validatorsHash = hex('f')

function fixture() {
	const returnCashuSigAllDigest = hex('3')
	const receiptTerms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: 'demo-chain', chain_id: 'demo-chain',
		mint_url: 'http://127.0.0.1:3338', auction_id: 'auction',
		bidder: bidderA, bid_amount: 1_000, pool_amount: 1_000, replaces_bid_id: '', funding_operation_id: 'funding-old',
		attested_at: 900, expires_at: 1_100, proof_state_refs: [proof], active_keyset_id: 'keyset', input_fee_ppk: 0,
		locktime: 4_700, bidder_public_key: compressed(3), refund_public_key: compressed(4), committee_public_key: compressed(2),
		committee_keyset_id: 'committee-1', committee_keyset_version: '1', dkg_run_id: 'dkg-run-1',
		public_key_package_sha256: hex('7'), signer_roster_digest: hex('8'), winner_package_digest: hex('1'),
		return_package_digest: hex('2'), return_cashu_sigall_digest: returnCashuSigAllDigest,
		bidder_return_signature: bytesToHex(schnorr.sign(hexToBytes(returnCashuSigAllDigest), scalar(3))),
	}
	const bundleDigest = demoIntegratedFundingBundleDigest(receiptTerms)
	const unsigned = prepareDemoIntegratedFundingReceipt(receiptTerms, bytesToHex(schnorr.sign(hexToBytes(bundleDigest), scalar(1))))
	const policyDigest = hex('8')
	const receiptDigest = demoIntegratedFundingAdmissionSignatureDigest(unsigned, policyDigest)
	const admittedReceipt = finalizeDemoIntegratedFundingReceipt(unsigned, policyDigest, bytesToHex(schnorr.sign(hexToBytes(receiptDigest), scalar(2))))
	const state: DemoCometStateV1 = {
		chain_id: 'demo-chain',
		height: 42,
		auctions: {
			auction: {
				id: 'auction', funding_mode: 'threshold_sigall_v1', status: 'open', leader_bid_id: eventId,
				seller: xOnly(9),
				seller_coco_payment_public_key: compressed(9),
			},
		},
		bids: {
			[displacedId]: { id: displacedId, auction_id: 'auction', bidder: bidderA, amount: 1_000, integrated_funding_id: 'funding-old', replaces_bid_id: '' },
			[eventId]: { id: eventId, auction_id: 'auction', bidder: bidderB, amount: 1_500, integrated_funding_id: 'funding-new', replaces_bid_id: displacedId },
		},
		integrated_fundings: {
			'funding-old': { id: 'funding-old', auction_id: 'auction', bid_id: displacedId, bidder: bidderA, status: 'outbid_return_entitled', receipt: admittedReceipt },
			'funding-new': { id: 'funding-new', auction_id: 'auction', bid_id: eventId, bidder: bidderB, status: 'active', receipt: { ...admittedReceipt, funding_operation_id: 'funding-new', bidder: bidderB, bid_amount: 1_500, pool_amount: 1_500, proof_state_refs: [`03${hex('1')}`] } },
		},
		integrated_displacements: {
			[eventId]: { id: eventId, auction_id: 'auction', displaced_bid_id: displacedId, replacement_bid_id: eventId, displaced_funding_id: 'funding-old', replacement_funding_id: 'funding-new', committed_at: 1_000, original_end_time: 2_000, certified_end_time: 2_180 },
		},
	}
	const raw = new TextEncoder().encode(JSON.stringify({
		version: 1, type: 'event', event: {
			id: eventId, pubkey: bidderB, kind: 28641,
			content: JSON.stringify({ auction_id: 'auction', amount: 1_500, replaces_bid_id: displacedId, integrated_funding: { funding_operation_id: 'funding-new' } }),
		},
	}))
	const stateBytes = utf8ToBytes(JSON.stringify(state))
	const stateAppHash = bytesToHex(sha256(stateBytes))
	const reader: DemoParticipantConsensusReader = {
		async readChainId() { return 'demo-chain' },
		async readCurrentState() {
			return { queryHeight: state.height, appHash: stateAppHash, canonicalStateBytes: stateBytes, state: structuredClone(state) }
		},
		async readBlock(height) { return { height, blockHash: height.toString(16).padStart(64, '0'), transactions: [raw] } },
		async readCommit(height) {
			return { height, blockTime: 1_000 + (height - 40), blockHash: height.toString(16).padStart(64, '0'), appHash: height === 43 ? stateAppHash : (height + 100).toString(16).padStart(64, '0'), validatorsHash, commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)] }
		},
	}
	const verifier = createDemoCometDisplacementVerifier({
		reader, network: 'fips-demo', chainId: 'demo-chain', genesisHash: hex('9'), validatorRosterVersion: 'roster-1', validatorsHash,
		committeeKeysetId: 'committee-1', committeeKeysetVersion: '1', dkgRunId: 'dkg-run-1',
		publicKeyPackageSha256: hex('7'), signerRosterDigest: hex('8'),
	})
	const request = { network: 'fips-demo', chainId: 'demo-chain', genesisHash: hex('9'), validatorRosterVersion: 'roster-1', auctionId: 'auction', displacementHeight: 40, replacementBidEventId: eventId }
	return { state, reader, verifier, request }
}

describe('participant-local Comet displacement derivation', () => {
	test('decodes real Comet HTTP HexBytes as uppercase hex while retaining base64 for tx and ABCI value', async () => {
		const { state } = fixture()
		const stateBytes = utf8ToBytes(JSON.stringify(state))
		const appHash = bytesToHex(sha256(stateBytes))
		const transaction = utf8ToBytes('{"version":1,"type":"event"}')
		const rpcFetch = async (input: string | URL | Request): Promise<Response> => {
			const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
			let result: unknown
			switch (url.pathname) {
			case '/status': result = { node_info: { network: 'demo-chain' } }; break
			case '/commit':
				result = {
					canonical: true,
					signed_header: {
						header: {
							height: '40', time: '2026-10-22T00:00:00Z', app_hash: appHash.toUpperCase(),
							validators_hash: validatorsHash.toUpperCase(),
						},
						commit: {
							block_id: { hash: hex('1').toUpperCase() },
							signatures: ['A', 'B', 'C'].map((digit) => ({
								block_id_flag: 2, validator_address: digit.repeat(40),
							})),
						},
					},
				}
				break
			case '/block':
				result = { block_id: { hash: hex('1').toUpperCase() }, block: { header: { height: '40' }, data: { txs: [Buffer.from(transaction).toString('base64')] } } }
				break
			case '/abci_query':
				result = { response: {
					code: 0, height: String(state.height),
					value: Buffer.from(JSON.stringify({
						state, wallet: {}, app_hash: appHash, canonical_state: Buffer.from(stateBytes).toString('base64'),
					})).toString('base64'),
				} }
				break
			default: throw new Error(`unexpected RPC path ${url.pathname}`)
			}
			return Response.json({ jsonrpc: '2.0', id: -1, result })
		}
		const reader = createLoopbackCometReader('http://127.0.0.1:26657', rpcFetch as typeof fetch)
		expect(await reader.readChainId()).toBe('demo-chain')
		await expect(reader.readCommit(40)).resolves.toMatchObject({
			blockHash: hex('1'), appHash, validatorsHash, commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)],
		})
		expect((await reader.readBlock(40)).transactions[0]).toEqual(transaction)
		const observed = await reader.readCurrentState()
		expect(observed.appHash).toBe(appHash)
		expect(observed.canonicalStateBytes).toEqual(stateBytes)

		const malformedHexFetch = async (): Promise<Response> => Response.json({ result: {
			canonical: true, signed_header: {
				header: { height: '40', time: '2026-10-22T00:00:00Z', app_hash: Buffer.alloc(32).toString('base64'), validators_hash: validatorsHash.toUpperCase() },
				commit: { block_id: { hash: hex('1').toUpperCase() }, signatures: [] },
			},
		} })
		await expect(createLoopbackCometReader('http://127.0.0.1:26657', malformedHexFetch as unknown as typeof fetch).readCommit(40))
			.rejects.toThrow(/uppercase Comet HexBytes/)
	})

	test('hashes exact Go canonical state bytes even when numeric-like map keys reorder after JSON parsing', async () => {
		const { reader } = fixture()
		const observed = await reader.readCurrentState()
		const state = structuredClone(observed.state) as DemoCometStateV1 & { numeric_map?: Record<string, number> }
		const prefix = JSON.stringify(state).slice(0, -1)
		const goBytes = utf8ToBytes(`${prefix},"numeric_map":{"10":10,"2":2}}`)
		const appHash = bytesToHex(sha256(goBytes))
		reader.readCurrentState = async () => ({ queryHeight: state.height, appHash, canonicalStateBytes: goBytes, state: JSON.parse(new TextDecoder().decode(goBytes)) })
		reader.readCommit = async (height) => ({
			height, blockTime: height, blockHash: hex('1'), appHash: height === state.height + 1 ? appHash : hex('2'),
			validatorsHash, commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)],
		})
		const admission = createDemoCometAdmissionConsensus(reader, { network: 'fips-demo', chainId: 'demo-chain', validatorsHash })
		await expect(admission.readCommittedLeader({ network: 'fips-demo', chainId: 'demo-chain', auctionId: 'auction' }))
			.resolves.toMatchObject({ height: state.height })
	})

	test('reads the pre-admission leader only from the participant-local threshold auction', async () => {
		const { reader } = fixture()
		const admission = createDemoCometAdmissionConsensus(reader, { network: 'fips-demo', chainId: 'demo-chain', validatorsHash })
		await expect(admission.readCommittedLeader({ network: 'fips-demo', chainId: 'demo-chain', auctionId: 'auction' }))
			.resolves.toMatchObject({
				leaderBidId: eventId, sellerActor: xOnly(9), sellerPaymentPublicKey: compressed(9), height: 42,
				evidenceDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			})
		await expect(admission.readCommittedLeader({ network: 'other', chainId: 'demo-chain', auctionId: 'auction' }))
			.rejects.toThrow(/network pins/)
	})

	test('holds one exact state snapshot while waiting boundedly for its S+1 authenticating header', async () => {
		const { reader } = fixture()
		const original = reader.readCommit.bind(reader)
		let nextHeaderAttempts = 0
		reader.readCommit = async (height) => {
			if (height === 43 && nextHeaderAttempts++ < 2) throw new Error('future height is not available yet')
			return original(height)
		}
		const admission = createDemoCometAdmissionConsensus(reader, { network: 'fips-demo', chainId: 'demo-chain', validatorsHash })
		await expect(admission.readCommittedLeader({ network: 'fips-demo', chainId: 'demo-chain', auctionId: 'auction' }))
			.resolves.toMatchObject({ height: 42 })
		expect(nextHeaderAttempts).toBe(3)
	})

	test('derives exact displaced funding from state, raw transaction and three canonical commits', async () => {
		const { verifier, request } = fixture()
		const derived = await verifier.verifyAndDerive(request)
		expect(derived).toMatchObject({
			displacedBidId: displacedId, replacementBidId: eventId, displacedPoolAmount: 1_000,
			proofStateRefs: [proof], activeKeysetId: 'keyset', inputFeePpk: 0,
		})
		expect(derived.commits.map((commit) => commit.height)).toEqual([40, 41, 42])
		expect(derived.displacementState.stateHeight).toBe(42)
		expect(derived.displacementState.bindingCommit.height).toBe(43)
		expect(derived.displacementState.stateAppHash).toBe(derived.displacementState.bindingCommit.appHash)
		expect(derived.timing).toMatchObject({ originalEndTime: 2_000, certifiedEndTime: 2_180, locktime: 4_700, mainCutoff: 4_400 })
	})

	test('fails closed on altered state linkage or a two-signature commit', async () => {
		const broken = fixture()
		broken.state.bids[eventId]!.replaces_bid_id = hex('7')
		await expect(broken.verifier.verifyAndDerive(broken.request)).rejects.toThrow(/canonical state bytes differ structurally/)

		const noQuorum = fixture()
		noQuorum.reader.readCommit = async (height) => ({ height, blockTime: 1_000 + height - 40, blockHash: hex('1'), appHash: hex('2'), validatorsHash, commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40)] })
		await expect(noQuorum.verifier.verifyAndDerive(noQuorum.request)).rejects.toThrow(/canonical quorum/)
	})
})

