import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { DemoFridayTrustedBrowserDeploymentV1 } from './demo-friday-browser-coco-client'
import type { PlebeianFridayBrowserController } from './poc-friday-browser-entry'
import {
	createDemoFridayR20BrowserRoleController,
	createDemoFridayR20OperatorAcceptanceComposition,
	DEMO_FRIDAY_R20_ACCEPTANCE_POLICY,
	exactDemoFridayR20BrowserReadiness,
	type DemoFridayR20AcceptancePinsV1,
} from './demo-friday-r20-browser-acceptance-composition'
import {
	connectPlebeianFridayR20AcceptanceRole,
	connectPlebeianFridayR20Controller,
	validateDemoFridayBrowserPublicState,
} from './poc-friday-browser-entry'

const secret = new Uint8Array(32).fill(7), actor = bytesToHex(schnorr.getPublicKey(secret))
const pins: DemoFridayR20AcceptancePinsV1 = { environmentId: 'friday-demo-20261030-separated-v1',
	authNetworkId: 'friday-network-r20', chainId: 'friday-chain-r20', genesisSha256: '11'.repeat(32),
	canonicalMintUrl: 'https://139.162.161.233', committeeKeysetId: 'friday-demo-frost-keyset-separated-v1',
	committeeKeysetVersion: '3', dkgRunId: 'friday-demo-20261030-separated-v1-dkg1',
	committeePublicKey: `02${'77'.repeat(32)}`,
	publicKeyPackageSha256: '22'.repeat(32), signerRosterDigest: '33'.repeat(32),
	fakeFundingPolicyDigest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' }

function deployment(): DemoFridayTrustedBrowserDeploymentV1 { return {
	schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1', ...pins,
	mintSnapshot: { mintUrl: pins.canonicalMintUrl, mintPublicKey: `02${'44'.repeat(32)}`, serverVersion: 'test',
		activeSatKeysetId: 'keyset', denominationKeyDigest: '55'.repeat(32), denominationAmounts: [1],
		inputFeePpk: 0, nuts: [4, 7, 9, 10, 11, 12] },
	keyset: { id: 'keyset', unit: 'sat', keys: { 1: `02${'66'.repeat(32)}` } },
	participants: [1, 2, 3, 4].map((identifier) => ({ identifier, verifyingShare: `02${String(identifier).repeat(64)}` })) as any,
} }

function readiness(overrides: Record<string, unknown> = {}) { return { threshold_custody: true,
	fips_transport: true, shared_application_key: false, browser_threshold_admission_ready: true,
	browser_threshold_wallet_ready: true, recovery_only: false, chain_id: pins.chainId,
	cashu_mint_url: pins.canonicalMintUrl, committee_public_key: pins.committeePublicKey,
	deployment_id: pins.environmentId, auth_network_id: pins.authNetworkId,
	genesis_sha256: pins.genesisSha256, committee_keyset_id: pins.committeeKeysetId,
	committee_keyset_version: pins.committeeKeysetVersion, dkg_run_id: pins.dkgRunId,
	public_key_package_sha256: pins.publicKeyPackageSha256,
	signer_roster_digest: pins.signerRosterDigest,
	fake_funding_policy: { schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1',
		max_per_request: 10_000, max_resulting_balance: 50_000,
		digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069',
		enforcement: 'browser_wallet_advisory_only' }, ...overrides } }

function signer() { return { async getPublicKey() { return actor }, async signEvent(event: any) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, actor, event.created_at, event.kind, event.tags, event.content]))))
	return { ...event, id, pubkey: actor, sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)) }
} } }

function controller(calls: string[]): PlebeianFridayBrowserController { return {
	async actor() { calls.push('actor'); return actor },
	fundingPolicy() { return { schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
		browserWalletAdvisoryMaxResultingBalance: 50_000,
		digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' } },
	async pendingFakeFunding() { return null },
	async sellerPaymentPublicKey() { calls.push('seller-key'); return `02${'88'.repeat(32)}` },
	async balance() { calls.push('balance'); return { available: 10_000, reserved: 0, locked: 0, pending: 0, unresolved: 0, total: 10_000 } },
	async fundFake(amount) { calls.push(`fund:${amount}`); return { operationId: 'funding-1', state: 'finalized', balance: amount } },
	async placeBid() { calls.push('bid'); return { status: 'admitted', fundingOperationId: 'funding-1', committedHeight: 1 } },
	async serviceSellerPlans() { calls.push('plans'); return { registered: 0, operations: [] } },
	async importAvailable() { calls.push('import'); return { refunds: 0, winnerPayments: 0 } },
	async cancelPending() { throw new Error('unused') }, async recoverCancellation() { throw new Error('unused') },
} }

describe('R20 staged browser acceptance composition', () => {
	test('shipped entrypoint is disabled before controller construction unless every readiness gate is true', async () => {
		await expect(connectPlebeianFridayR20AcceptanceRole({ role: 'seller', signer: signer(), pins,
			fetchImpl: async () => Response.json(readiness({ browser_threshold_admission_ready: false })) }))
			.rejects.toThrow(/disabled or public pins differ/)
	})

	test('accepts only the exact-current R20 readiness surface', () => {
		expect(exactDemoFridayR20BrowserReadiness(readiness(), pins)).toEqual(expect.objectContaining({
			...readiness(),
			fake_funding_policy: {
				schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
				browserWalletAdvisoryMaxResultingBalance: 50_000,
				digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069',
			},
		}))
		expect(() => exactDemoFridayR20BrowserReadiness(readiness({ recovery_only: true }), pins)).toThrow(/disabled/)
		expect(() => exactDemoFridayR20BrowserReadiness(readiness({ committee_public_key: `03${'77'.repeat(32)}` }), pins))
			.toThrow(/pins differ/)
		expect(() => exactDemoFridayR20BrowserReadiness(readiness({ fake_funding_policy: {
			...(readiness().fake_funding_policy as Record<string, unknown>), digest: '44'.repeat(32) } }), pins))
			.toThrow(/absent or invalid/)
	})

	test('ordinary browser controller is also unavailable before exact readiness and pin checks', async () => {
		await expect(connectPlebeianFridayR20Controller({ signer: signer(), pins,
			fetchImpl: async () => Response.json(readiness({ dkg_run_id: 'wrong-run' })) }))
			.rejects.toThrow(/disabled or public pins differ/)
	})

	test('a prior-policy pending faucet never blocks refund and seller-operation discovery', () => {
		expect(() => validateDemoFridayBrowserPublicState({
			schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1', pendingBids: [], sellerOperations: [],
			pendingFaucet: { actor, environmentId: 'friday-demo', fundingOperationId: 'funding-prior-policy',
				amount: 50_000, policyDigest: '44'.repeat(32) },
		})).not.toThrow()
		expect(() => validateDemoFridayBrowserPublicState({
			schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1', pendingBids: [], sellerOperations: [],
			pendingFaucet: { actor, environmentId: 'friday-demo', fundingOperationId: 'funding-prior-policy',
				amount: 50_000, policyDigest: 'not-a-digest' },
		})).toThrow(/malformed entry/)
	})

	test('constructs an exact seller event with an actual isolated controller and NIP-07 signer', async () => {
		const calls: string[] = [], role = createDemoFridayR20BrowserRoleController({ role: 'seller', pins,
			signer: signer(), controller: controller(calls), deployment: { async readExact() { return deployment() } }, nowSeconds: () => 1_000 })
		const prepared = await role.prepareAuctionExact('auction-r20')
		expect(prepared.signed.pubkey).toBe(actor); expect(prepared.signed.id).toHaveLength(64)
		expect(JSON.parse(prepared.signed.content).duration_seconds).toBe(900)
		expect(calls).toEqual(['actor', 'seller-key'])
	})

	test('rejects a changed deployment before any wallet/controller dispatch', async () => {
		const calls: string[] = [], wrong = deployment(); wrong.publicKeyPackageSha256 = 'ff'.repeat(32)
		const role = createDemoFridayR20BrowserRoleController({ role: 'bidder-a', pins, signer: signer(),
			controller: controller(calls), deployment: { async readExact() { return wrong } } })
		await expect(role.fundExact()).rejects.toThrow(/external R20 pins/)
		expect(calls).toEqual([])
	})

	test('keeps seller, bidder, and fault actions in separate fail-closed roles', async () => {
		const calls: string[] = [], seller = createDemoFridayR20BrowserRoleController({ role: 'seller', pins,
			signer: signer(), controller: controller(calls), deployment: { async readExact() { return deployment() } } })
		await expect(seller.fundExact()).rejects.toThrow(/isolated bidder profile/)
		const bidder = createDemoFridayR20BrowserRoleController({ role: 'bidder-a', pins,
			signer: signer(), controller: controller(calls), deployment: { async readExact() { return deployment() } } })
		await expect(bidder.prepareAuctionExact('auction-r20')).rejects.toThrow(/isolated seller profile/)
		await expect(bidder.placeBidExact({ auctionId: 'auction-r20', bidAmount: 1_000,
			fullPoolAmount: 1_000, reservedPoolAmount: 1_000, replacesBidId: '', locktime: 4_000 }))
			.rejects.toThrow(/complete exact funding/)
		await bidder.fundExact()
		await expect(bidder.placeBidExact({ auctionId: 'auction-r20', bidAmount: 1_500,
			fullPoolAmount: 1_500, reservedPoolAmount: 1_500, replacesBidId: 'aa'.repeat(32), locktime: 4_000 }))
			.rejects.toThrow(/exact staged acceptance phase/)
	})

	test('requires the separately consumed fault receipt before authenticated close', async () => {
		const validators = ['A', 'B', 'C', 'D'].map((value, index) => ({ slot: (index + 1) as 1 | 2 | 3 | 4,
			address: value.repeat(40) }))
		const reader: any = { async readChainId() { return pins.chainId } }
		const composition = createDemoFridayR20OperatorAcceptanceComposition({ pins, chainId: pins.chainId,
			validatorsHash: '44'.repeat(32), validatorRoster: validators, reader,
			faultApprovalPath: '/var/lib/plebeian-auctions-friday-operator/acceptance-fault/r20.json',
			faultApprovalSha256: '55'.repeat(32), validatorUnitSha256: '66'.repeat(32) })
		expect(() => composition.prepareValidator4FaultExact()).toThrow(/out of order/)
		await expect(composition.closeAuctionExact('auction-r20')).rejects.toThrow(/out of order/)
	})

	test('pins the reviewed payment and anti-sniping policy', () => {
		expect(DEMO_FRIDAY_R20_ACCEPTANCE_POLICY).toEqual(expect.objectContaining({ durationSeconds: 900,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 }))
	})
})
