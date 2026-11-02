import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import type { DemoParticipantConsensusReader, DemoCometStateV1 } from './demo-comet-displacement-verifier'
import { createDemoCometRejectedFundingVerifier } from './demo-comet-rejected-funding-verifier'
import {
	demoIntegratedFundingV4AdmissionSignatureDigest,
	finalizeDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4Unsigned,
} from './demo-integrated-funding-receipt-v4'
import {
	createDemoFridayV4CometAdmission,
	type DemoFridayPinnedGenesisPort,
	type DemoFridayPreparedFundingAdmissionPort,
} from './demo-friday-v4-comet-admission'
import type { DemoFridayFundingAdmissionCommitV1, DemoFridayFundingReplayRecordV1 } from './demo-friday-prepared-funding'
import type { DemoMaintainerOfflineRecord } from './demo-maintainer-offline'
import { DemoFridayAuthenticatedTerminalDiscovery } from './demo-friday-terminal-discovery'
import { DemoFridayTerminalDescriptorSqlite } from './demo-friday-fixed-terminal-resolver'
import { DemoFridayTrustedTerminalSqlite } from './demo-friday-authority-runtime'

const H = 40
const VALIDATORS = 'd'.repeat(64)
const GENESIS = 'e'.repeat(64)
const ACTOR_KEY = hexToBytes('1'.padStart(64, '0'))
const hex = (value: string) => value.repeat(64).slice(0, 64)

function fixtureReceipt(): DemoIntegratedFundingReceiptV4 {
	const unsigned = (JSON.parse(readFileSync('../fixtures/integrated-funding-v4-browser-golden.json', 'utf8')) as {
		receipt: DemoIntegratedFundingReceiptV4Unsigned
	}).receipt
	const policy = 'd'.repeat(64)
	return finalizeDemoIntegratedFundingReceiptV4(
		unsigned, policy, bytesToHex(schnorr.sign(hexToBytes(
			demoIntegratedFundingV4AdmissionSignatureDigest(unsigned, policy),
		), hexToBytes('4'.padStart(64, '0')))),
	)
}

function signedTransaction(receipt: DemoIntegratedFundingReceiptV4) {
	const unsigned = {
		pubkey: receipt.bidder, created_at: 1_100, kind: 28641 as const, tags: [] as string[][],
		content: JSON.stringify({
			auction_id: receipt.auction_id, amount: receipt.bid_amount,
			replaces_bid_id: receipt.replaces_bid_id, integrated_funding: receipt,
		}),
	}
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	const event = { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), ACTOR_KEY)) }
	const raw = new TextEncoder().encode(JSON.stringify({ version: 1, type: 'event', event }))
	return { event, raw, txHash: bytesToHex(sha256(raw)) }
}

function exactStored(receipt: DemoIntegratedFundingReceiptV4): DemoMaintainerOfflineRecord {
	const branch = {
		network: receipt.auth_network_id, chainId: receipt.chain_id, auctionId: receipt.auction_id,
		operationId: receipt.funding_operation_id, bidderActorId: receipt.bidder, amount: receipt.pool_amount,
		mintUrl: receipt.mint_url, bidderPublicKey: receipt.bidder_public_key,
		refundPublicKey: receipt.refund_public_key, committeePublicKey: receipt.committee_public_key,
		committeeKeysetId: receipt.committee_keyset_id, committeeKeysetVersion: receipt.committee_keyset_version,
	} as const
	return {
		bundle: {
			bundleDigest: receipt.prepared_bundle_digest,
			winner: { ...branch, templateDigest: receipt.winner_package_digest } as never,
			refund: {
				...branch, templateDigest: receipt.return_package_digest,
				cashuSigAllDigest: receipt.return_cashu_sigall_digest,
				bidderMainSignature: receipt.bidder_return_signature,
			} as never,
		} as never,
		admission: {
			schema: 'COCO_DEMO_MAINTAINER_ADMISSION_RECEIPT_V1',
			bundleDigest: receipt.prepared_bundle_digest, admittedAt: 1_000, notAfter: 1_200,
		},
	}
}

function harness(overrides: {
	chain?: string
	genesis?: string
	txMutation?: (raw: Uint8Array) => Uint8Array
	missingCommit?: number
	blockHash?: string
	blockTime?: number
	rejected?: boolean
	rejectionReason?: DemoFridayFundingAdmissionCommitV1['rejectionReason']
} = {}) {
	const receipt = fixtureReceipt()
	const transaction = signedTransaction(receipt)
	const replay: DemoFridayFundingReplayRecordV1 = {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_RECORD_V1',
		eventId: receipt.actor_funding_authorization.id, fundingOperationId: receipt.funding_operation_id,
		bundleDigest: receipt.prepared_bundle_digest, scope: 'a'.repeat(64), phase: 'stored', revision: 1,
	}
	let admitted: DemoFridayFundingReplayRecordV1 | undefined
	let admissions = 0
	const prepared: DemoFridayPreparedFundingAdmissionPort = {
		async readStoredExact(eventId) {
			if (eventId !== replay.eventId) throw new Error('absent')
			return { replay: structuredClone(admitted ?? replay), identity: { scope: replay.scope, bundleDigest: replay.bundleDigest }, stored: exactStored(receipt) }
		},
		markAdmittedExact(commit: DemoFridayFundingAdmissionCommitV1) {
			if (admitted !== undefined) {
				if (JSON.stringify(admitted.admission) !== JSON.stringify(commit)) throw new Error('changed after acceptance')
				return structuredClone(admitted)
			}
			admissions++
			admitted = { ...replay, phase: 'admitted', revision: 2, admission: structuredClone(commit) }
			return structuredClone(admitted)
		},
	}
	const state = (): DemoCometStateV1 => ({
		chain_id: overrides.chain ?? 'friday-chain', height: H + 2,
		auctions: { [receipt.auction_id]: {
			id: receipt.auction_id, seller: hex('b'), seller_coco_payment_public_key: receipt.committee_public_key,
			funding_mode: 'threshold_sigall_v1', status: overrides.rejected ? 'closed' : 'open',
			original_end_time: 1_500, end_time: 1_500,
			...(overrides.rejected ? {} : { leader_bid_id: transaction.event.id }),
		} },
		bids: overrides.rejected ? {} : { [transaction.event.id]: {
			id: transaction.event.id, auction_id: receipt.auction_id, bidder: receipt.bidder,
			amount: receipt.bid_amount, integrated_funding_id: receipt.funding_operation_id, replaces_bid_id: '',
		} },
		integrated_fundings: { [receipt.funding_operation_id]: {
			id: receipt.funding_operation_id, auction_id: receipt.auction_id, bid_id: transaction.event.id,
			bidder: receipt.bidder, status: overrides.rejected ? 'rejected_return_entitled' : 'active',
			...(overrides.rejected ? { rejection_reason: overrides.rejectionReason ?? 'late' } : {}), receipt: receipt as never,
		} }, integrated_displacements: {},
	})
	const stateBytes = () => new TextEncoder().encode(JSON.stringify(state()))
	const stateHash = () => bytesToHex(sha256(stateBytes()))
	const blockRaw = overrides.txMutation?.(transaction.raw) ?? transaction.raw
	const reader: DemoParticipantConsensusReader = {
		async readChainId() { return overrides.chain ?? 'friday-chain' },
		async readBlock(height) { return { height, blockHash: overrides.blockHash ?? height.toString(16).padStart(64, '0'), transactions: [blockRaw] } },
		async readCommit(height) {
			if (height === overrides.missingCommit) throw new Error('commit unavailable')
			return {
				height, blockTime: overrides.blockTime ?? 1_100, blockHash: height.toString(16).padStart(64, '0'),
				appHash: height === H + 3 ? stateHash() : hex('c'), validatorsHash: VALIDATORS,
				commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)],
			}
		},
		async readCurrentState() {
			return { queryHeight: H + 2, appHash: stateHash(), canonicalStateBytes: stateBytes(), state: state() }
		},
	}
	const genesis: DemoFridayPinnedGenesisPort = {
		async readExact() { return { schema: 'PLEBEIAN_FRIDAY_PINNED_GENESIS_IDENTITY_V1', chainId: 'friday-chain', genesisSha256: overrides.genesis ?? GENESIS } },
	}
	const identity = {
		schema: 'PLEBEIAN_FRIDAY_V4_BROADCAST_IDENTITY_V1' as const,
		fundingAuthorizationEventId: replay.eventId, bidEventId: transaction.event.id,
		fundingOperationId: replay.fundingOperationId, committedHeight: H, transactionHash: transaction.txHash,
	}
	return { receipt, transaction, prepared, reader, genesis, identity, admissions: () => admissions }
}

function adapter(value: ReturnType<typeof harness>) {
	return createDemoFridayV4CometAdmission({
		chainId: 'friday-chain', genesisSha256: GENESIS, validatorsHash: VALIDATORS,
		reader: value.reader, genesis: value.genesis, prepared: value.prepared,
	})
}

describe('Friday V4 authenticated Comet admission', () => {
	test('admits only after exact H/H+1/H+2, transaction, state, package and genesis binding', async () => {
		const value = harness()
		const first = await adapter(value).confirmAndAdmitExact(value.identity)
		expect(first).toMatchObject({ phase: 'admitted', admission: { committedHeight: H, transactionHash: value.identity.transactionHash } })
		// A new process instance re-reads the durable result; no second transition.
		const replay = await adapter(value).confirmAndAdmitExact(value.identity)
		expect(replay).toEqual(first)
		expect(value.admissions()).toBe(1)
	})

	test('rejects wrong chain or genesis before durable admission', async () => {
		const wrongChain = harness({ chain: 'another-chain' })
		await expect(adapter(wrongChain).confirmAndAdmitExact(wrongChain.identity)).rejects.toThrow(/chain or genesis/)
		expect(wrongChain.admissions()).toBe(0)
		const wrongGenesis = harness({ genesis: hex('f') })
		await expect(adapter(wrongGenesis).confirmAndAdmitExact(wrongGenesis.identity)).rejects.toThrow(/chain or genesis/)
		expect(wrongGenesis.admissions()).toBe(0)
	})

	test('rejects mismatched transaction/receipt and partial finality', async () => {
		const mismatch = harness({ txMutation: (raw) => new Uint8Array([...raw, 0x20]) })
		await expect(adapter(mismatch).confirmAndAdmitExact(mismatch.identity)).rejects.toThrow(/transaction hash/)
		expect(mismatch.admissions()).toBe(0)
		const partial = harness({ missingCommit: H + 2 })
		await expect(adapter(partial).confirmAndAdmitExact(partial.identity)).rejects.toThrow(/commit unavailable/)
		expect(partial.admissions()).toBe(0)
		const spliced = harness({ blockHash: hex('9') })
		await expect(adapter(spliced).confirmAndAdmitExact(spliced.identity)).rejects.toThrow(/not joined to canonical commit/)
		expect(spliced.admissions()).toBe(0)
	})

	test('rejects replay under a changed transaction identity', async () => {
		const value = harness()
		await adapter(value).confirmAndAdmitExact(value.identity)
		await expect(adapter(value).confirmAndAdmitExact({ ...value.identity, transactionHash: hex('9') })).rejects.toThrow(/transaction hash/)
		expect(value.admissions()).toBe(1)
	})

	test('persists one exact rejected-return disposition without inventing an admitted bid', async () => {
		const value = harness({ rejected: true })
		const replay = await adapter(value).confirmAndAdmitExact(value.identity)
		expect(replay.admission).toMatchObject({
			disposition: 'rejected_return', rejectionReason: 'late', bidEventId: value.transaction.event.id,
		})
		expect(value.admissions()).toBe(1)
	})

	test('persists an authenticated post-expiry commitment as one return entitlement', async () => {
		const value = harness({ blockTime: 1_201, rejected: true, rejectionReason: 'funding_expired' })
		const replay = await adapter(value).confirmAndAdmitExact(value.identity)
		expect(replay.admission).toMatchObject({
			disposition: 'rejected_return', rejectionReason: 'funding_expired', bidEventId: value.transaction.event.id,
		})
		expect(value.admissions()).toBe(1)
	})

	test('treats exact expiry as valid and rejects a fabricated expiry return', async () => {
		const valid = harness({ blockTime: 1_200 })
		await expect(adapter(valid).confirmAndAdmitExact(valid.identity)).resolves.toMatchObject({
			admission: { disposition: 'active' },
		})
		const fabricated = harness({ blockTime: 1_200, rejected: true, rejectionReason: 'funding_expired' })
		await expect(adapter(fabricated).confirmAndAdmitExact(fabricated.identity)).rejects.toThrow(
			/funding expiry was not true/,
		)
		expect(fabricated.admissions()).toBe(0)
	})

	test('rejects an expired active funding or a mismatched rejection reason', async () => {
		const active = harness({ blockTime: 1_201 })
		await expect(adapter(active).confirmAndAdmitExact(active.identity)).rejects.toThrow(/expired funding lacks/)
		expect(active.admissions()).toBe(0)
		const wrongReason = harness({ blockTime: 1_201, rejected: true, rejectionReason: 'late' })
		await expect(adapter(wrongReason).confirmAndAdmitExact(wrongReason.identity)).rejects.toThrow(/expired funding lacks/)
		expect(wrongReason.admissions()).toBe(0)
	})

	test('carries the committed bid identity from rejected admission through terminal discovery', async () => {
		const value = harness({ rejected: true })
		const replay = await adapter(value).confirmAndAdmitExact(value.identity)
		const descriptorDb = new Database(':memory:')
		const sourceDb = new Database(':memory:')
		const descriptors = new DemoFridayTerminalDescriptorSqlite(descriptorDb)
		const source = new DemoFridayTrustedTerminalSqlite(sourceDb, {
			async resolveExact() { throw new Error('resolver is not used by discovery') },
		})
		const discovery = new DemoFridayAuthenticatedTerminalDiscovery({
			reader: value.reader,
			pins: {
				network: value.receipt.auth_network_id, chainId: 'friday-chain', genesisHash: GENESIS,
				validatorRosterVersion: 'roster-1', validatorsHash: VALIDATORS,
				committeeKeysetId: value.receipt.committee_keyset_id,
				committeeKeysetVersion: value.receipt.committee_keyset_version,
				dkgRunId: value.receipt.dkg_run_id,
				publicKeyPackageSha256: value.receipt.public_key_package_sha256,
				signerRosterDigest: value.receipt.signer_roster_digest,
				committeePublicKey: value.receipt.committee_public_key, participants: [],
			},
			prepared: {
				listAdmittedExact() { return [structuredClone(replay)] },
				readStoredExact(eventId) { return value.prepared.readStoredExact(eventId) },
			},
			descriptors, source,
		})
		try {
			expect(await discovery.discoverExact()).toBe(1)
			const descriptor = await descriptors.readExact(`terminal-${replay.eventId.slice(0, 32)}`)
			expect(descriptor).toMatchObject({
				branch: 'rejected_return', eventHeight: H, eventId: value.transaction.event.id,
			})
			expect(source.pendingCount()).toBe(1)
		} finally {
			descriptorDb.close()
			sourceDb.close()
		}
	})

	test('derives a participant-local rejected-return certificate from the exact transaction and authenticated state', async () => {
		const value = harness({ rejected: true })
		const verifier = createDemoCometRejectedFundingVerifier({
			reader: value.reader, network: value.receipt.auth_network_id, chainId: 'friday-chain',
			genesisHash: GENESIS, validatorRosterVersion: 'roster-1', validatorsHash: VALIDATORS,
			committeeKeysetId: value.receipt.committee_keyset_id,
			committeeKeysetVersion: value.receipt.committee_keyset_version,
			dkgRunId: value.receipt.dkg_run_id, publicKeyPackageSha256: value.receipt.public_key_package_sha256,
			signerRosterDigest: value.receipt.signer_roster_digest,
		})
		const certificate = await verifier.verifyAndDerive({
			network: value.receipt.auth_network_id, chainId: 'friday-chain', genesisHash: GENESIS,
			validatorRosterVersion: 'roster-1', auctionId: value.receipt.auction_id,
			fundingOperationId: value.receipt.funding_operation_id, bidEventId: value.transaction.event.id,
			rejectionHeight: H,
		})
		expect(certificate).toMatchObject({
			rejectionReason: 'late', poolAmount: value.receipt.pool_amount,
			fundingOperationId: value.receipt.funding_operation_id, bidEventId: value.transaction.event.id,
		})
		expect(certificate.commits).toHaveLength(3)
	})
})
