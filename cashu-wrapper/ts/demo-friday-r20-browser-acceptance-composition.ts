/**
 * Fail-closed R20 live-acceptance composition.
 *
 * The three Nostr/Coco actors intentionally run in three isolated browser
 * profiles.  No controller, wallet key, bearer proof, or NIP-07 signer crosses
 * profiles.  Public receipts are carried between phases by the operator, while
 * canonical auction state is independently re-read through the pinned local
 * Comet adapter.  The validator-4 fault is a separate, approval-consuming
 * operator command and can never be dispatched by this module.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoFridayTrustedBrowserDeploymentPort,
	DemoFridayTrustedBrowserDeploymentV1,
} from './demo-friday-browser-coco-client'
import { createDemoFridayBrowserTrustedDeploymentHttp } from './demo-friday-browser-trust-http'
import {
	createDemoFridayAuthenticatedAcceptanceConsensus,
	DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID,
	type DemoFridayAcceptanceFaultPort,
	type DemoFridayAcceptanceNostrSignerPort,
} from './demo-friday-browser-acceptance-adapters'
import type { DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'
import type {
	DemoFridayAcceptanceAuctionV1,
	DemoFridayAcceptanceConsensusPort,
	DemoFridayAcceptanceValidatorV1,
} from './demo-friday-browser-acceptance-runner'
import type { PlebeianFridayBrowserController } from './poc-friday-browser-entry'
import type { DemoFridayFakeFundingPolicyV1 } from './demo-friday-browser-payment-state'
import {
	DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_OPERATOR_BINARY,
} from './demo-friday-sidequest-acceptance-path-contract'

const HEX32 = /^[0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{128}$/
const POINT = /^(?:02|03)[0-9a-f]{64}$/
const ADDRESS = /^[0-9A-F]{40}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const ORIGIN = 'https://139.162.161.233'

export const DEMO_FRIDAY_R20_ACCEPTANCE_POLICY = Object.freeze({
	deploymentId: DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID,
	durationSeconds: 900,
	lateBidWindowSeconds: 180,
	lateBidExtensionSeconds: 180,
	maxTotalExtensionSeconds: 1_800,
	emergencyRecoverySeconds: 900,
	initialBid: 1_000,
	displacingBid: 1_500,
	lateBid: 2_000,
	fakeFundingAmount: 10_000,
})

function fail(message: string): never { throw new Error(`PLEBEIAN_FRIDAY_R20_ACCEPTANCE: ${message}`) }
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) fail('canonical number is not a safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') fail('canonical value is invalid')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

export interface DemoFridayR20AcceptancePinsV1 {
	environmentId: typeof DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID
	authNetworkId: string
	chainId: string
	genesisSha256: string
	canonicalMintUrl: typeof ORIGIN
	committeeKeysetId: 'friday-demo-frost-keyset-separated-v1'
	committeeKeysetVersion: '3'
	dkgRunId: 'friday-demo-20261030-separated-v1-dkg1'
	committeePublicKey: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	fakeFundingPolicyDigest: string
}

function exactPins(pins: DemoFridayR20AcceptancePinsV1): DemoFridayR20AcceptancePinsV1 {
	if (pins.environmentId !== DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID || pins.canonicalMintUrl !== ORIGIN
		|| pins.committeeKeysetId !== 'friday-demo-frost-keyset-separated-v1'
		|| pins.committeeKeysetVersion !== '3'
		|| pins.dkgRunId !== 'friday-demo-20261030-separated-v1-dkg1'
		|| ![pins.authNetworkId, pins.chainId].every((value) => ID.test(value))
		|| !POINT.test(pins.committeePublicKey)
		|| ![pins.genesisSha256, pins.publicKeyPackageSha256, pins.signerRosterDigest,
			pins.fakeFundingPolicyDigest].every((value) => HEX32.test(value))) {
		fail('R20 acceptance pins are incomplete or differ from the fixed deployment')
	}
	return structuredClone(pins)
}

export interface DemoFridayR20BrowserReadinessV1 {
	threshold_custody: true
	fips_transport: true
	shared_application_key: false
	browser_threshold_admission_ready: true
	browser_threshold_wallet_ready: true
	recovery_only: false
	chain_id: string
	cashu_mint_url: typeof ORIGIN
	committee_public_key: string
	deployment_id: string
	auth_network_id: string
	genesis_sha256: string
	committee_keyset_id: string
	committee_keyset_version: string
	dkg_run_id: string
	public_key_package_sha256: string
	signer_roster_digest: string
	fake_funding_policy: DemoFridayFakeFundingPolicyV1
}

/** Fail closed before constructing a wallet/controller when public activation is disabled. */
export function exactDemoFridayR20BrowserReadiness(value: unknown,
	pins: DemoFridayR20AcceptancePinsV1): DemoFridayR20BrowserReadinessV1 {
	const expected = exactPins(pins)
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('browser readiness response is invalid')
	const config = value as Record<string, unknown>
	if (config.threshold_custody !== true || config.fips_transport !== true
		|| config.shared_application_key !== false || config.browser_threshold_admission_ready !== true
		|| config.browser_threshold_wallet_ready !== true || config.recovery_only !== false
		|| config.chain_id !== expected.chainId || config.cashu_mint_url !== expected.canonicalMintUrl
		|| config.committee_public_key !== expected.committeePublicKey
		|| config.deployment_id !== expected.environmentId || config.auth_network_id !== expected.authNetworkId
		|| config.genesis_sha256 !== expected.genesisSha256
		|| config.committee_keyset_id !== expected.committeeKeysetId
		|| config.committee_keyset_version !== expected.committeeKeysetVersion
		|| config.dkg_run_id !== expected.dkgRunId
		|| config.public_key_package_sha256 !== expected.publicKeyPackageSha256
		|| config.signer_roster_digest !== expected.signerRosterDigest
		|| config.fake_funding_policy === null || typeof config.fake_funding_policy !== 'object'
		|| Array.isArray(config.fake_funding_policy)) {
		fail('R20 browser acceptance is disabled or public pins differ')
	}
	const funding = config.fake_funding_policy as Record<string, unknown>
	if (funding.schema !== 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1'
		|| JSON.stringify(Object.keys(funding).sort()) !== JSON.stringify([
			'digest', 'enforcement', 'max_per_request', 'max_resulting_balance', 'schema',
		])
		|| !Number.isSafeInteger(funding.max_per_request) || Number(funding.max_per_request) < 1
		|| !Number.isSafeInteger(funding.max_resulting_balance)
		|| Number(funding.max_resulting_balance) < Number(funding.max_per_request)
		|| typeof funding.digest !== 'string' || !HEX32.test(funding.digest)
		|| funding.enforcement !== 'browser_wallet_advisory_only'
		|| funding.digest !== digest({ max_per_request: funding.max_per_request,
			max_resulting_balance: funding.max_resulting_balance,
			schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1' })
		|| funding.digest !== expected.fakeFundingPolicyDigest) {
		fail('R20 fake funding policy is absent or invalid')
	}
	return Object.freeze({ threshold_custody: true, fips_transport: true, shared_application_key: false,
		browser_threshold_admission_ready: true, browser_threshold_wallet_ready: true, recovery_only: false,
		chain_id: expected.chainId, cashu_mint_url: expected.canonicalMintUrl,
		committee_public_key: expected.committeePublicKey, deployment_id: expected.environmentId,
		auth_network_id: expected.authNetworkId, genesis_sha256: expected.genesisSha256,
		committee_keyset_id: expected.committeeKeysetId,
		committee_keyset_version: expected.committeeKeysetVersion, dkg_run_id: expected.dkgRunId,
		public_key_package_sha256: expected.publicKeyPackageSha256,
		signer_roster_digest: expected.signerRosterDigest,
		fake_funding_policy: Object.freeze({ schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1',
			maxPerRequest: Number(funding.max_per_request),
			browserWalletAdvisoryMaxResultingBalance: Number(funding.max_resulting_balance),
			digest: funding.digest }) })
}

async function assertDeployment(port: DemoFridayTrustedBrowserDeploymentPort,
	pins: DemoFridayR20AcceptancePinsV1): Promise<DemoFridayTrustedBrowserDeploymentV1> {
	const deployment = await port.readExact()
	const fields = ['environmentId', 'authNetworkId', 'chainId',
		'genesisSha256', 'canonicalMintUrl', 'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId',
		'committeePublicKey', 'publicKeyPackageSha256', 'signerRosterDigest'] as const
	if (fields.some((field) => deployment[field] !== pins[field]) || deployment.participants.length !== 4) {
		fail('browser deployment differs from the external R20 pins')
	}
	return deployment
}

export type DemoFridayR20BrowserRole = 'seller' | 'bidder-a' | 'bidder-b'
export interface DemoFridayR20ExternalSigner {
	getPublicKey(): Promise<string>
	signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<{
		id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string
	}>
}

export interface DemoFridayR20RoleIdentityV1 {
	schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_ROLE_IDENTITY_V1'
	role: DemoFridayR20BrowserRole
	actor: string
	deploymentBindingDigest: string
	sellerPaymentPublicKey?: string
}

export interface DemoFridayR20PreparedAuctionV1 {
	schema: 'PLEBEIAN_FRIDAY_R20_PREPARED_AUCTION_V1'
	deploymentBindingDigest: string
	auctionId: string
	sellerActor: string
	sellerPaymentPublicKey: string
	unsigned: { pubkey: string; created_at: number; kind: 28640; tags: string[][]; content: string }
	signed: { id: string; pubkey: string; created_at: number; kind: 28640; tags: string[][]; content: string; sig: string }
}

export interface DemoFridayR20BrowserRoleController {
	identifyExact(): Promise<DemoFridayR20RoleIdentityV1>
	prepareAuctionExact(auctionId: string): Promise<DemoFridayR20PreparedAuctionV1>
	fundExact(): ReturnType<PlebeianFridayBrowserController['fundFake']>
	placeBidExact(request: Parameters<PlebeianFridayBrowserController['placeBid']>[0]): ReturnType<PlebeianFridayBrowserController['placeBid']>
	serviceSellerPlansExact(): ReturnType<PlebeianFridayBrowserController['serviceSellerPlans']>
	importAvailableExact(): ReturnType<PlebeianFridayBrowserController['importAvailable']>
	readBalanceExact(): ReturnType<PlebeianFridayBrowserController['balance']>
}

function eventId(event: DemoFridayR20PreparedAuctionV1['unsigned']): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))))
}

export function createDemoFridayR20BrowserRoleController(options: {
	role: DemoFridayR20BrowserRole
	signer: DemoFridayR20ExternalSigner
	pins: DemoFridayR20AcceptancePinsV1
	controller: PlebeianFridayBrowserController
	deployment?: DemoFridayTrustedBrowserDeploymentPort
	nowSeconds?: () => number
}): DemoFridayR20BrowserRoleController {
	const pins = exactPins(options.pins), deployment = options.deployment
		?? createDemoFridayBrowserTrustedDeploymentHttp({ origin: ORIGIN })
	const controller = options.controller
	const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	let funded = false, admittedBids = 0
	const ready = async () => { await assertDeployment(deployment, pins); const actor = await controller.actor()
		if (!HEX32.test(actor) || actor !== await options.signer.getPublicKey()) fail('browser controller and NIP-07 actor differ')
		return actor }
	const only = (role: DemoFridayR20BrowserRole) => { if (options.role !== role) fail(`step belongs to isolated ${role} profile`) }
	return Object.freeze({
		async identifyExact() {
			const actor = await ready(), sellerPaymentPublicKey = options.role === 'seller'
				? await controller.sellerPaymentPublicKey() : undefined
			if (sellerPaymentPublicKey !== undefined && !POINT.test(sellerPaymentPublicKey)) fail('seller payment key is invalid')
			return Object.freeze({ schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_ROLE_IDENTITY_V1' as const,
				role: options.role, actor, deploymentBindingDigest: digest(pins),
				...(sellerPaymentPublicKey === undefined ? {} : { sellerPaymentPublicKey }) })
		},
		async prepareAuctionExact(auctionId: string) {
			only('seller'); const sellerActor = await ready()
			if (!ID.test(auctionId)) fail('auction id is invalid')
			const sellerPaymentPublicKey = await controller.sellerPaymentPublicKey()
			if (!POINT.test(sellerPaymentPublicKey)) fail('seller payment key is invalid')
			const unsigned = { pubkey: sellerActor, created_at: now(), kind: 28640 as const,
				tags: [['auction', auctionId]], content: JSON.stringify({ auction_id: auctionId,
					title: auctionId, description: 'Friday FIPS/FROST Coco v2 acceptance', image_url: '',
					duration_seconds: DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.durationSeconds,
					starting_bid: DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.initialBid, min_increment: 100,
					reserve: 0, funding_mode: 'threshold_sigall_v1',
					seller_coco_payment_public_key: sellerPaymentPublicKey }) }
			const returned = await options.signer.signEvent({ kind: unsigned.kind, created_at: unsigned.created_at,
				tags: structuredClone(unsigned.tags), content: unsigned.content })
			const id = eventId(unsigned)
			if (returned.id !== id || returned.pubkey !== sellerActor || returned.kind !== unsigned.kind
				|| returned.created_at !== unsigned.created_at || canonical(returned.tags) !== canonical(unsigned.tags)
				|| returned.content !== unsigned.content || !HEX64.test(returned.sig)
				|| !schnorr.verify(hexToBytes(returned.sig), hexToBytes(id), hexToBytes(sellerActor))) {
				fail('NIP-07 changed or invalidly signed the exact R20 auction')
			}
			return Object.freeze({ schema: 'PLEBEIAN_FRIDAY_R20_PREPARED_AUCTION_V1' as const,
				deploymentBindingDigest: digest(pins), auctionId, sellerActor, sellerPaymentPublicKey,
				unsigned: structuredClone(unsigned), signed: structuredClone(returned) as DemoFridayR20PreparedAuctionV1['signed'] })
		},
		async fundExact() {
			if (options.role === 'seller' || funded) fail('funding must run once in an isolated bidder profile')
			await ready(); const result = await controller.fundFake(DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.fakeFundingAmount)
			if (result.state !== 'finalized' || result.balance !== DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.fakeFundingAmount) {
				fail('exact fake funding did not finalize')
			}
			funded = true; return result
		},
		async placeBidExact(request: Parameters<PlebeianFridayBrowserController['placeBid']>[0]) {
			if (options.role === 'seller' || !funded) fail('bidder profile must complete exact funding before bidding')
			const expectedAmount = options.role === 'bidder-b' ? DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.displacingBid
				: admittedBids === 0 ? DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.initialBid : DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.lateBid
			if (!ID.test(request.auctionId) || request.bidAmount !== expectedAmount
				|| request.fullPoolAmount !== expectedAmount || request.reservedPoolAmount !== expectedAmount
				|| !Number.isSafeInteger(request.locktime) || request.locktime < 1
				|| (expectedAmount === DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.initialBid ? request.replacesBidId !== ''
					: !HEX32.test(request.replacesBidId))
				|| (options.role === 'bidder-b' && admittedBids !== 0)
				|| (options.role === 'bidder-a' && admittedBids > 1)) fail('bid differs from the exact staged acceptance phase')
			await ready(); const result = await controller.placeBid(request)
			if (result.status === 'admitted') admittedBids += 1
			return result
		},
		async serviceSellerPlansExact() { only('seller'); await ready(); return controller.serviceSellerPlans() },
		async importAvailableExact() { await ready(); return controller.importAvailable() },
		async readBalanceExact() { await ready(); return controller.balance() },
	})
}

export interface DemoFridayR20FaultGateV1 {
	schema: 'PLEBEIAN_FRIDAY_R20_EXTERNAL_FAULT_GATE_V1'
	deploymentId: typeof DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID
	approvalSha256: string
	unitSha256: string
	command: readonly string[]
}
export interface DemoFridayR20FaultResultV1 {
	schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_RESULT_V1'
	slot: 4
	status: 'inactive'
	approvalSha256: string
}

export interface DemoFridayR20OperatorAcceptanceComposition {
	createAuctionExact(prepared: DemoFridayR20PreparedAuctionV1): Promise<DemoFridayAcceptanceAuctionV1>
	waitForLeaderExact(request: { auctionId: string; actor: string; amount: number }): Promise<DemoFridayAcceptanceAuctionV1>
	waitUntilLateWindowExact(auctionId: string): Promise<DemoFridayAcceptanceAuctionV1>
	prepareValidator4FaultExact(): DemoFridayR20FaultGateV1
	confirmValidator4FaultExact(result: DemoFridayR20FaultResultV1): Promise<DemoFridayAcceptanceValidatorV1[]>
	closeAuctionExact(auctionId: string): Promise<DemoFridayAcceptanceAuctionV1>
}

export function createDemoFridayR20OperatorAcceptanceComposition(options: {
	pins: DemoFridayR20AcceptancePinsV1
	chainId: string
	validatorsHash: string
	validatorRoster: readonly { slot: 1 | 2 | 3 | 4; address: string }[]
	reader: DemoParticipantConsensusReader
	fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
	nowSeconds?: () => number
	sleep?: (milliseconds: number) => Promise<void>
	pollIntervalMs?: number
	maxWaitMs?: number
	faultApprovalPath: string
	faultApprovalSha256: string
	validatorUnitSha256: string
}): DemoFridayR20OperatorAcceptanceComposition {
	const pins = exactPins(options.pins)
	if (options.chainId !== pins.chainId || !HEX32.test(options.validatorsHash)
		|| options.validatorRoster.length !== 4
		|| options.validatorRoster.some((entry, index) => entry.slot !== index + 1 || !ADDRESS.test(entry.address))
		|| new Set(options.validatorRoster.map((entry) => entry.address)).size !== 4
		|| !options.faultApprovalPath.startsWith('/') || !HEX32.test(options.faultApprovalSha256)
		|| !HEX32.test(options.validatorUnitSha256)) fail('operator pins or fault gate are invalid')
	const gate: DemoFridayR20FaultGateV1 = Object.freeze({ schema: 'PLEBEIAN_FRIDAY_R20_EXTERNAL_FAULT_GATE_V1',
		deploymentId: DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID,
		approvalSha256: options.faultApprovalSha256, unitSha256: options.validatorUnitSha256,
		command: Object.freeze([DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_OPERATOR_BINARY,
			'validator-4-offline', '--approval', options.faultApprovalPath, '--approval-sha256',
			options.faultApprovalSha256, '--unit-sha256', options.validatorUnitSha256]) })
	let phase: 'start' | 'created' | 'first' | 'second' | 'late-window' | 'late' | 'fault-gated' | 'faulted' | 'closed' = 'start'
	let consensus: DemoFridayAcceptanceConsensusPort | undefined
	const port = () => consensus ?? fail('exact signed auction has not initialized the operator composition')
	return Object.freeze({
		async createAuctionExact(prepared: DemoFridayR20PreparedAuctionV1) {
			if (phase !== 'start' || prepared.schema !== 'PLEBEIAN_FRIDAY_R20_PREPARED_AUCTION_V1'
				|| prepared.deploymentBindingDigest !== digest(pins) || !ID.test(prepared.auctionId)
				|| prepared.unsigned.pubkey !== prepared.sellerActor || prepared.signed.id !== eventId(prepared.unsigned)) {
				fail('prepared auction is invalid, replayed, or belongs to another R20 deployment')
			}
			let used = false
			const sellerSigner: DemoFridayAcceptanceNostrSignerPort = Object.freeze({
				async getPublicKey() { return prepared.sellerActor },
				async signEvent(event: Parameters<DemoFridayAcceptanceNostrSignerPort['signEvent']>[0]) {
					if (used || canonical(event) !== canonical(prepared.unsigned)) fail('operator requested a changed or replayed seller event')
					used = true; return structuredClone(prepared.signed)
				},
			})
			const forbiddenFault: DemoFridayAcceptanceFaultPort = Object.freeze({
				async setValidatorOfflineExact() { fail('validator fault requires the separate approval-consuming operator command') },
			})
			consensus = createDemoFridayAuthenticatedAcceptanceConsensus({ reader: options.reader, fault: forbiddenFault,
				sellerSigner, chainId: options.chainId, validatorsHash: options.validatorsHash,
				validatorRoster: options.validatorRoster, fetchImpl: options.fetchImpl,
				nowSeconds: options.nowSeconds, sleep: options.sleep,
				pollIntervalMs: options.pollIntervalMs, maxWaitMs: options.maxWaitMs })
			await consensus.createAuctionExact({ auctionId: prepared.auctionId, sellerActor: prepared.sellerActor,
				sellerPaymentPublicKey: prepared.sellerPaymentPublicKey,
				durationSeconds: DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.durationSeconds,
				startingBid: DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.initialBid, minIncrement: 100, reserve: 0 })
			phase = 'created'; return consensus.readAuctionExact(prepared.auctionId)
		},
		async waitForLeaderExact(request: { auctionId: string; actor: string; amount: number }) {
			const expected = phase === 'created' ? DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.initialBid
				: phase === 'first' ? DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.displacingBid
					: phase === 'late-window' ? DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.lateBid : -1
			if (request.amount !== expected || !HEX32.test(request.actor)) fail('leader checkpoint is out of order or has wrong public identity')
			const result = await port().waitForLeaderExact(request)
			phase = phase === 'created' ? 'first' : phase === 'first' ? 'second' : 'late'
			return result
		},
		async waitUntilLateWindowExact(auctionId: string) {
			if (phase !== 'second') fail('late-window checkpoint is out of order')
			const result = await port().waitUntilLateWindowExact({ auctionId,
				windowSeconds: DEMO_FRIDAY_R20_ACCEPTANCE_POLICY.lateBidWindowSeconds })
			phase = 'late-window'; return result
		},
		prepareValidator4FaultExact() {
			if (phase !== 'late') fail('fault gate is out of order')
			phase = 'fault-gated'; return structuredClone(gate)
		},
		async confirmValidator4FaultExact(result: DemoFridayR20FaultResultV1) {
			if (phase !== 'fault-gated' || result.schema !== 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_RESULT_V1'
				|| result.slot !== 4 || result.status !== 'inactive' || result.approvalSha256 !== gate.approvalSha256) {
				fail('external validator fault result differs from the exact approved action')
			}
			const validators = await port().readValidatorsExact()
			if (validators.length !== 4 || validators.find((entry) => entry.slot === 4)?.online !== false
				|| validators.filter((entry) => entry.online).length !== 3
				|| validators.some((entry) => entry.online && entry.commitSignatures < 3)) {
				fail('authenticated Comet state does not confirm one-validator-unavailable 3-of-4 finality')
			}
			phase = 'faulted'; return validators
		},
		async closeAuctionExact(auctionId: string) {
			if (phase !== 'faulted') fail('close is out of order or external fault is unconfirmed')
			await port().waitUntilCloseEligibleExact(auctionId); await port().closeAuctionExact(auctionId)
			const result = await port().waitUntilClosedExact(auctionId); phase = 'closed'; return result
		},
	})
}
