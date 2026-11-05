/**
 * Source-prepared terminal fixtures.  NOT_RUN while the shared test slot is
 * released; no result from this file may be cited until the recorded gate runs.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { demoIntegratedTiming, type DemoIntegratedAuthorityClaim, type DemoIntegratedTerminalAuthorityClaimV2 } from './demo-integrated-authority'
import { demoIntegratedCloseFinalityDigest } from './demo-integrated-close-authority'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import { createDemoCometCloseVerifier, type DemoCometCloseVerifierOptions } from './demo-comet-close-verifier'
import type { DemoCometStateV1, DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'
import { executeDemoIntegratedThreshold3Terminal } from './demo-integrated-threshold3-terminal-service'
import {
	demoIntegratedFundingAdmissionSignatureDigest,
	demoIntegratedFundingBundleDigest,
	finalizeDemoIntegratedFundingReceipt,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

const hex = (value: string): string => value.repeat(64).slice(0, 64)
const key = (value: number): string => `02${bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(value)))}`
const sign = (digest: string, value: number): string => bytesToHex(schnorr.sign(hexToBytes(digest), new Uint8Array(32).fill(value)))

function receipt() {
	const terms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: 'demo-network', chain_id: 'demo-chain', mint_url: 'http://127.0.0.1:3338',
		auction_id: 'auction-terminal', bidder: key(4).slice(2), bid_amount: 2_500, pool_amount: 2_500,
		replaces_bid_id: '', funding_operation_id: 'funding-terminal', attested_at: 2_000_000_000,
		expires_at: 2_000_000_300, proof_state_refs: [`02${'11'.repeat(32)}`], active_keyset_id: 'zero-fee',
		input_fee_ppk: 0, locktime: 2_000_002_700, bidder_public_key: key(1), refund_public_key: key(3),
		committee_public_key: key(2), committee_keyset_id: 'committee', committee_keyset_version: '1',
		dkg_run_id: 'dkg-run', public_key_package_sha256: hex('6'), signer_roster_digest: hex('7'),
		winner_package_digest: hex('8'), return_package_digest: hex('9'), return_cashu_sigall_digest: hex('a'),
		bidder_return_signature: sign(hex('a'), 1),
	}
	const bundleDigest = demoIntegratedFundingBundleDigest(terms)
	const unsigned = prepareDemoIntegratedFundingReceipt(terms, sign(bundleDigest, 4))
	const policyDigest = hex('8')
	return finalizeDemoIntegratedFundingReceipt(unsigned, policyDigest, sign(demoIntegratedFundingAdmissionSignatureDigest(unsigned, policyDigest), 2))
}

function closeFixture(cause: 'winner' | 'reserve_unmet') {
	const admitted = receipt()
	const height = 40
	const state: DemoCometStateV1 = {
		chain_id: 'friday-chain', height: height + 2,
		auctions: { 'auction-terminal': {
			id: 'auction-terminal', seller: hex('b'), funding_mode: 'threshold_sigall_v1', status: 'closed',
			leader_bid_id: hex('c'), high_bid: 2_500, reserve: cause === 'winner' ? 2_000 : 5_000,
			original_end_time: 2_000_000_000, end_time: 2_000_001_800,
			winner: cause === 'winner' ? admitted.bidder : '', closed_at: 2_000_001_900,
		} },
		bids: { [hex('c')]: {
			id: hex('c'), auction_id: 'auction-terminal', bidder: admitted.bidder, amount: 2_500,
			integrated_funding_id: admitted.funding_operation_id, replaces_bid_id: '',
		} },
		integrated_fundings: { [admitted.funding_operation_id]: {
			id: admitted.funding_operation_id, auction_id: 'auction-terminal', bid_id: hex('c'), bidder: admitted.bidder,
			status: cause === 'winner' ? 'payout_entitled' : 'release_entitled', receipt: admitted,
		} },
		integrated_displacements: {},
	}
	const stateBytes = new TextEncoder().encode(JSON.stringify(state))
	const stateAppHash = bytesToHex(sha256(stateBytes))
	const commit = (at: number) => ({
		height: at, blockTime: at === height ? 2_000_001_900 : 2_000_001_900 + at - height,
		blockHash: at.toString(16).padStart(64, '0'), appHash: at === height + 1 ? hex('d') : stateAppHash,
		validatorsHash: hex('e'), commitSignerAddresses: ['1', '2', '3'].map((value) => value.repeat(40)),
	})
	const reader: DemoParticipantConsensusReader = {
		async readChainId() { return 'friday-chain' },
		async readCommit(at) { return commit(at) },
		async readBlock(at) {
			return { height: at, blockHash: at.toString(16).padStart(64, '0'), transactions: [new TextEncoder().encode(JSON.stringify({ version: 1, type: 'close', auction_id: 'auction-terminal' }))] }
		},
		async readCurrentState() { return { queryHeight: height + 2, appHash: stateAppHash, canonicalStateBytes: stateBytes, state } },
	}
	const options: DemoCometCloseVerifierOptions = {
		reader, network: 'fake-only', chainId: 'friday-chain', genesisHash: hex('f'),
		validatorRosterVersion: 'roster-1', validatorsHash: hex('e'), committeeKeysetId: 'committee',
		committeeKeysetVersion: '1', dkgRunId: 'dkg-run', publicKeyPackageSha256: hex('6'),
		signerRosterDigest: hex('7'),
	}
	return { height, verifier: createDemoCometCloseVerifier(options) }
}

function terminalClaim(cause: 'winner' | 'reserve_unmet' | 'rejected', proof = `02${'21'.repeat(32)}`): DemoIntegratedTerminalAuthorityClaimV2 {
	const role = cause === 'winner' ? 'winner_settlement' : 'refund'
	return {
		schema: 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2', operationId: 'funding-terminal',
		operationRoot: cause === 'winner' ? hex('1') : hex('2'), network: 'fake-only', chainId: 'friday-chain',
		auctionId: 'auction-terminal', bidId: hex('c'), successorBidId: '', cause, role, outcomeHeight: 40,
		outcomeStateHash: hex('d'), outcomeEvidenceDigest: hex('3'),
		templateDigest: cause === 'winner' ? hex('1') : hex('2'), cashuSigAllDigest: hex('4'), outputsDigest: hex('5'),
		proofStateRefs: [proof], poolAmount: 2_500, admissionOperationId: 'funding-terminal',
		admissionReceiptDigest: hex('6'), committeeKeysetId: 'committee', committeeKeysetVersion: '1',
		dkgRunId: 'dkg-run', publicKeyPackageSha256: hex('7'), signerRosterDigest: hex('8'), status: 'terminal_pending',
	}
}

function outbidClaim(): DemoIntegratedAuthorityClaim {
	return {
		schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1', operationId: 'funding-outbid', operationRoot: hex('9'),
		network: 'fake-only', chainId: 'friday-chain', auctionId: 'auction-outbid', displacedBidId: 'bid-old',
		replacementBidId: 'bid-new', displacementHeight: 20, templateDigest: hex('9'), cashuSigAllDigest: hex('a'),
		outputsDigest: hex('b'), proofStateRefs: [`02${'31'.repeat(32)}`], poolAmount: 1_500,
		admissionOperationId: 'funding-outbid', admissionReceiptDigest: hex('c'), committeeKeysetId: 'committee',
		committeeKeysetVersion: '1', dkgRunId: 'dkg-run', publicKeyPackageSha256: hex('d'),
		signerRosterDigest: hex('e'), status: 'outbid_return_pending',
	}
}

describe('integrated terminal branch fixtures (prepared, not yet executed in the released slot)', () => {
	test.each(['winner', 'reserve_unmet'] as const)('authenticates a %s close from H/H+1/H+2 and exact app state', async (cause) => {
		const fixture = closeFixture(cause)
		const certificate = await fixture.verifier.verifyAndDerive({
			network: 'fake-only', chainId: 'friday-chain', genesisHash: hex('f'),
			validatorRosterVersion: 'roster-1', auctionId: 'auction-terminal', closeHeight: fixture.height,
		})
		expect(certificate.cause).toBe(cause)
		expect(certificate.commits).toHaveLength(3)
		expect(certificate.poolAmount).toBe(2_500)
	})

	test('keeps close finality stable across later authenticated state observations', async () => {
		const fixture = closeFixture('winner')
		const certificate = await fixture.verifier.verifyAndDerive({
			network: 'fake-only', chainId: 'friday-chain', genesisHash: hex('f'),
			validatorRosterVersion: 'roster-1', auctionId: 'auction-terminal', closeHeight: fixture.height,
		})
		const later = structuredClone(certificate)
		later.closeState = {
			stateHeight: certificate.closeState.stateHeight + 5,
			stateAppHash: hex('9'),
			bindingCommit: {
				height: certificate.closeState.stateHeight + 6,
				blockTime: certificate.closeState.bindingCommit.blockTime + 5,
				blockHash: hex('8'), appHash: hex('9'),
			},
		}
		expect(later.closeState.stateAppHash).not.toBe(certificate.closeState.stateAppHash)
		expect(demoIntegratedCloseFinalityDigest(later)).toBe(demoIntegratedCloseFinalityDigest(certificate))
	})

	test('keeps outbid, winner, and no-sale fixtures in one global proof/operation exclusion domain', async () => {
		const root = await mkdtemp('/tmp/plebeian-terminal-branches-'); roots.push(root)
		const database = new Database(join(root, 'authority.sqlite3'), { create: true, strict: true })
		const store = new DemoIntegratedAuthoritySqliteStore(database)
		await expect(store.claimOutbidReturn(outbidClaim())).resolves.toMatchObject({ created: true })
		await expect(store.claimTerminalDisposition(terminalClaim('winner'))).resolves.toMatchObject({ created: true })
		await expect(store.claimTerminalDisposition(terminalClaim('reserve_unmet'))).rejects.toThrow(/TERMINAL_OPERATION_CONFLICT/)
		const conflicting = terminalClaim('reserve_unmet', outbidClaim().proofStateRefs[0]!)
		conflicting.operationId = 'funding-other'; conflicting.admissionOperationId = 'funding-other'
		await expect(store.claimTerminalDisposition(conflicting)).rejects.toThrow(/PROOF_CONFLICT/)
		database.close()
	})

	test('persists rejected funding as its own refund cause in the same global exclusion domain', async () => {
		const root = await mkdtemp('/tmp/plebeian-rejected-branch-'); roots.push(root)
		const database = new Database(join(root, 'authority.sqlite3'), { create: true, strict: true })
		const store = new DemoIntegratedAuthoritySqliteStore(database)
		const claim = terminalClaim('rejected')
		await expect(store.claimTerminalDisposition(claim)).resolves.toMatchObject({ created: true, claim: { cause: 'rejected', role: 'refund' } })
		await expect(store.claimTerminalDisposition({ ...claim, cause: 'reserve_unmet' })).rejects.toThrow(/TERMINAL_OPERATION_CONFLICT/)
		database.close()
	})

	test('uses the approved emergency deadline formula in both close fixtures', () => {
		const timing = demoIntegratedTiming(2_000_000_000, 2_000_001_800)
		expect(timing.maximumEndTime).toBe(2_000_001_800)
		expect(timing.locktime).toBe(2_000_002_700)
		expect(timing.mainCutoff).toBe(2_000_002_400)
	})

	test('rejects a requested terminal branch mismatch before any durable or payment effect', async () => {
		const fixture = closeFixture('winner')
		const calls = { durable: 0, signer: 0, mint: 0, import: 0 }
		const forbidden = (bucket: keyof typeof calls) => new Proxy({}, {
			get() {
				return async () => { calls[bucket]++; throw new Error(`unexpected ${bucket} effect`) }
			},
		})
		await expect(executeDemoIntegratedThreshold3Terminal({
			branch: 'reserve_unmet_return',
			options: {
				closeRequest: {
					network: 'fake-only', chainId: 'friday-chain', genesisHash: hex('f'),
					validatorRosterVersion: 'roster-1', auctionId: 'auction-terminal', closeHeight: fixture.height,
				},
				closeVerifier: fixture.verifier,
				authorityStore: forbidden('durable'), template: {}, offlineIdentity: {}, policy: {}, federationRequest: {},
				threshold: forbidden('signer'), executor: { mint: forbidden('mint'), recipient: forbidden('import') },
				recoveryAudit: forbidden('mint'), nowSeconds: 2_000_001_902,
			} as never,
		})).rejects.toThrow(/another terminal branch/)
		expect(calls).toEqual({ durable: 0, signer: 0, mint: 0, import: 0 })
	})
})
