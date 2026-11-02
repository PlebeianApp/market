/**
 * Fixed browser trust boundary for the fake-money Friday flow.
 *
 * The caller may name an auction and operation, but it cannot supply a
 * deployment, consensus reader, mint/keyset, seller, leader, or winner plan.
 * Those values come from the injected, fixed readers and an immutable seller
 * plan registry. This module performs no network I/O and starts no listener.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoFridayTrustedAuctionFundingV1,
	DemoFridayTrustedBrowserDeploymentV1,
} from './demo-friday-browser-coco-client'
import type { DemoFridaySellerPlanRegisteredV1 } from './demo-friday-browser-coco-seller-client'
import {
	DEMO_FRIDAY_SELLER_WINNER_PLAN_KIND,
	type DemoFridaySellerWinnerPlanChallengeV1,
	type DemoFridaySellerWinnerPlanEnvelopeV1,
} from './demo-friday-browser-coco-seller-plan'
import type { DemoFridaySignedNostrBidV1, DemoFridayUnsignedNostrBidV1 } from './demo-friday-browser-payment-state'
import type { DemoRecipientCoordinatorRequest } from './demo-sigall-recipient'
import {
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
} from './demo-sigall-settlement'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const MAX_VALIDITY_SECONDS = 300
export const DEMO_FRIDAY_SELLER_PLAN_INTENT_KIND = 28_649 as const

export interface DemoFridaySellerPlanIntentContentV1 {
	schema: 'PLEBEIAN_FRIDAY_SELLER_PLAN_INTENT_V1'
	authNetworkId: string
	chainId: string
	auctionId: string
	fundingOperationId: string
	bidAmount: number
	fullPoolAmount: number
	replacesBidId: string
	canonicalMintUrl: string
	expiresAt: number
}

export interface DemoFridaySellerPlanIntentV1 {
	event: DemoFridaySignedNostrBidV1
	content: DemoFridaySellerPlanIntentContentV1
}

export interface DemoFridayAuthenticatedAuctionV1 {
	schema: 'PLEBEIAN_FRIDAY_AUTHENTICATED_AUCTION_V1'
	authNetworkId: string
	chainId: string
	auctionId: string
	status: 'open'
	fundingMode: 'threshold_sigall_v1'
	sellerActor: string
	sellerPaymentPublicKey: string
	leaderBidId: string
	leaderActor: string
	leaderBidAmount: number
	stateHeight: number
	appHash: string
	evidenceDigest: string
}

export interface DemoFridayTrustedDeploymentReaderPort {
	readExact(): Promise<DemoFridayTrustedBrowserDeploymentV1>
}

export interface DemoFridayAuthenticatedAuctionReaderPort {
	readExact(auctionId: string): Promise<DemoFridayAuthenticatedAuctionV1>
}

export interface DemoFridaySellerPlanRecordV1 {
	intentEventId: string
	intent: DemoFridaySellerPlanIntentContentV1
	challenge: DemoFridaySellerWinnerPlanChallengeV1
	leaderBidId: string
	leaderActor: string
	leaderBidAmount: number
	deploymentDigest: string
	envelope: DemoFridaySellerWinnerPlanEnvelopeV1 | null
}

export interface DemoFridaySellerPlanRegistryPort {
	createChallengeExact(record: DemoFridaySellerPlanRecordV1): DemoFridaySellerPlanRecordV1
	readExact(fundingOperationId: string): DemoFridaySellerPlanRecordV1 | null
	listBySellerExact(sellerActor: string): DemoFridaySellerPlanRecordV1[]
	registerExact(fundingOperationId: string, envelope: DemoFridaySellerWinnerPlanEnvelopeV1): DemoFridaySellerPlanRecordV1
}

export interface DemoFridayBrowserTrustService {
	readDeploymentExact(): Promise<DemoFridayTrustedBrowserDeploymentV1>
	issueSellerPlanChallengeExact(intent: unknown): Promise<DemoFridaySellerWinnerPlanChallengeV1>
	readSellerPlanChallengeExact(request: {
		sellerActor: string
		auctionId: string
		fundingOperationId: string
	}): Promise<DemoFridaySellerWinnerPlanChallengeV1>
	listSellerPlanChallengesExact(sellerActor: string): Promise<DemoFridaySellerWinnerPlanChallengeV1[]>
	registerSellerPlanExact(envelope: unknown): Promise<DemoFridaySellerWinnerPlanEnvelopeV1>
	readSellerPlanExact(request: {
		sellerActor: string
		auctionId: string
		fundingOperationId: string
	}): Promise<DemoFridaySellerPlanRegisteredV1 | null>
	readAuctionFundingExact(request: {
		auctionId: string
		fundingOperationId: string
		fullPoolAmount: number
	}): Promise<DemoFridayTrustedAuctionFundingV1>
	/** Required integration hook before accepting the prepared funding envelope. */
	assertRegisteredWinnerExact(request: {
		auctionId: string
		fundingOperationId: string
		bidderActor: string
		bidAmount: number
		winnerRequest: DemoRecipientCoordinatorRequest
	}): Promise<void>
}

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_BROWSER_TRUST: ${message}`) }

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value contains an unsupported type')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

function exactKeys(value: object, expected: readonly string[], label: string): void {
	if (canonical(Object.keys(value).sort()) !== canonical([...expected].sort())) refuse(`${label} has missing or unexpected fields`)
}

function exactOrigin(value: unknown): string {
	if (typeof value !== 'string' || !URL.canParse(value)) refuse('canonical mint is invalid')
	const url = new URL(value)
	if (url.protocol !== 'https:' || value !== url.origin || url.username !== '' || url.password !== ''
		|| url.pathname !== '/' || url.search !== '' || url.hash !== '') refuse('canonical mint must be one exact HTTPS origin')
	return url.origin
}

function nostrId(value: DemoFridayUnsignedNostrBidV1): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, value.pubkey, value.created_at, value.kind, value.tags, value.content,
	]))))
}

function exactSignedEvent(value: unknown, unsigned: DemoFridayUnsignedNostrBidV1, label: string): DemoFridaySignedNostrBidV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse(`${label} is not an event`)
	const event = value as Record<string, unknown>
	exactKeys(event, ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'], label)
	const expectedId = nostrId(unsigned)
	if (event.id !== expectedId || event.pubkey !== unsigned.pubkey || event.created_at !== unsigned.created_at
		|| event.kind !== unsigned.kind || canonical(event.tags) !== canonical(unsigned.tags)
		|| event.content !== unsigned.content || !HEX_64.test(String(event.sig))
		|| !schnorr.verify(hexToBytes(String(event.sig)), hexToBytes(expectedId), hexToBytes(unsigned.pubkey))) {
		refuse(`${label} id, signature, or canonical fields differ`)
	}
	return structuredClone(value) as DemoFridaySignedNostrBidV1
}

function exactDeployment(value: DemoFridayTrustedBrowserDeploymentV1): DemoFridayTrustedBrowserDeploymentV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('deployment is not an object')
	exactKeys(value, ['schema', 'environmentId', 'authNetworkId', 'chainId', 'genesisSha256', 'canonicalMintUrl', 'mintSnapshot', 'keyset',
		'committeePublicKey', 'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId', 'publicKeyPackageSha256',
		'signerRosterDigest', 'participants'], 'deployment')
	if (value.schema !== 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1'
		|| ![value.environmentId, value.authNetworkId, value.chainId, value.committeeKeysetId,
			value.committeeKeysetVersion, value.dkgRunId].every((entry) => ID.test(entry))
		|| !HEX_32.test(value.genesisSha256)
		|| !COMPRESSED_KEY.test(value.committeePublicKey) || !HEX_32.test(value.publicKeyPackageSha256)
		|| !HEX_32.test(value.signerRosterDigest) || !Array.isArray(value.participants) || value.participants.length !== 4
		|| value.participants.some((participant, index) => participant.identifier !== index + 1
			|| !COMPRESSED_KEY.test(participant.verifyingShare))) refuse('deployment identity is malformed')
	const mintUrl = exactOrigin(value.canonicalMintUrl)
	const snapshot = value.mintSnapshot, keyset = value.keyset
	if (snapshot.mintUrl !== mintUrl || !COMPRESSED_KEY.test(snapshot.mintPublicKey)
		|| snapshot.activeSatKeysetId !== keyset.id || keyset.unit !== 'sat'
		|| snapshot.denominationKeyDigest !== demoDenominationKeyDigest(keyset.keys)
		|| snapshot.inputFeePpk !== 0 || ![4, 7, 9, 10, 11, 12].every((nut) => snapshot.nuts.includes(nut))) {
		refuse('deployment mint snapshot or keyset is not the pinned zero-fee Coco deployment')
	}
	return structuredClone(value)
}

function exactAuction(value: DemoFridayAuthenticatedAuctionV1, auctionId: string, deployment: DemoFridayTrustedBrowserDeploymentV1): DemoFridayAuthenticatedAuctionV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('authenticated auction is not an object')
	exactKeys(value, ['schema', 'authNetworkId', 'chainId', 'auctionId', 'status', 'fundingMode', 'sellerActor',
		'sellerPaymentPublicKey', 'leaderBidId', 'leaderActor', 'leaderBidAmount', 'stateHeight', 'appHash',
		'evidenceDigest'], 'authenticated auction')
	if (value.schema !== 'PLEBEIAN_FRIDAY_AUTHENTICATED_AUCTION_V1' || value.auctionId !== auctionId
		|| value.authNetworkId !== deployment.authNetworkId || value.chainId !== deployment.chainId
		|| value.status !== 'open' || value.fundingMode !== 'threshold_sigall_v1' || !HEX_32.test(value.sellerActor)
		|| !COMPRESSED_KEY.test(value.sellerPaymentPublicKey) || value.sellerPaymentPublicKey.slice(2) === value.sellerActor
		|| !Number.isSafeInteger(value.stateHeight) || value.stateHeight < 1 || !HEX_32.test(value.appHash)
		|| !HEX_32.test(value.evidenceDigest)
		|| ((value.leaderBidId === '') !== (value.leaderActor === ''))
		|| ((value.leaderBidId === '') !== (value.leaderBidAmount === 0))
		|| (value.leaderBidId !== '' && (!HEX_32.test(value.leaderBidId) || !HEX_32.test(value.leaderActor)
			|| !Number.isSafeInteger(value.leaderBidAmount) || value.leaderBidAmount < 1))) {
		refuse('authenticated auction identity, seller, leader, or finality evidence is malformed')
	}
	return structuredClone(value)
}

function exactIntentContent(value: unknown): DemoFridaySellerPlanIntentContentV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('seller-plan intent content is not an object')
	const raw = value as Record<string, unknown>
	exactKeys(raw, ['schema', 'authNetworkId', 'chainId', 'auctionId', 'fundingOperationId', 'bidAmount',
		'fullPoolAmount', 'replacesBidId', 'canonicalMintUrl', 'expiresAt'], 'seller-plan intent content')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_SELLER_PLAN_INTENT_V1'
		|| ![raw.authNetworkId, raw.chainId, raw.auctionId, raw.fundingOperationId].every((entry) => typeof entry === 'string' && ID.test(entry))
		|| !Number.isSafeInteger(raw.bidAmount) || Number(raw.bidAmount) < 1 || Number(raw.bidAmount) > 50_000
		|| raw.fullPoolAmount !== raw.bidAmount
		|| (raw.replacesBidId !== '' && (typeof raw.replacesBidId !== 'string' || !HEX_32.test(raw.replacesBidId)))) {
		refuse('seller-plan intent identity, amount, or replacement is malformed')
	}
	return {
		schema: raw.schema, authNetworkId: String(raw.authNetworkId), chainId: String(raw.chainId),
		auctionId: String(raw.auctionId), fundingOperationId: String(raw.fundingOperationId),
		bidAmount: Number(raw.bidAmount), fullPoolAmount: Number(raw.fullPoolAmount),
		replacesBidId: String(raw.replacesBidId), canonicalMintUrl: exactOrigin(raw.canonicalMintUrl),
		expiresAt: Number(raw.expiresAt),
	}
}

export function demoFridaySellerPlanIntentUnsignedEvent(
	actor: string,
	createdAt: number,
	contentValue: DemoFridaySellerPlanIntentContentV1,
): DemoFridayUnsignedNostrBidV1 {
	const content = exactIntentContent(contentValue)
	if (!HEX_32.test(actor) || !Number.isSafeInteger(createdAt) || createdAt < 1) refuse('intent actor or created_at is invalid')
	return { pubkey: actor, created_at: createdAt, kind: DEMO_FRIDAY_SELLER_PLAN_INTENT_KIND,
		tags: [['t', 'plebeian-friday-seller-plan-intent-v1'], ['a', content.auctionId], ['operation', content.fundingOperationId]],
		content: canonical(content) }
}

export function verifyDemoFridaySellerPlanIntent(value: unknown, pins: {
	authNetworkId: string
	chainId: string
	canonicalMintUrl: string
	nowSeconds: number
}): DemoFridaySellerPlanIntentV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('seller-plan intent is not an event')
	const raw = value as Record<string, unknown>
	let parsed: unknown
	try { parsed = JSON.parse(String(raw.content)) } catch { refuse('seller-plan intent content is not JSON') }
	const content = exactIntentContent(parsed)
	const unsigned = demoFridaySellerPlanIntentUnsignedEvent(String(raw.pubkey), Number(raw.created_at), content)
	const event = exactSignedEvent(value, unsigned, 'seller-plan intent')
	if (content.authNetworkId !== pins.authNetworkId || content.chainId !== pins.chainId
		|| content.canonicalMintUrl !== exactOrigin(pins.canonicalMintUrl)
		|| !Number.isSafeInteger(pins.nowSeconds) || event.created_at > pins.nowSeconds
		|| pins.nowSeconds - event.created_at > MAX_VALIDITY_SECONDS || content.expiresAt < pins.nowSeconds
		|| content.expiresAt < event.created_at || content.expiresAt - event.created_at > MAX_VALIDITY_SECONDS) {
		refuse('seller-plan intent belongs to another deployment or is expired')
	}
	return { event, content }
}

function exactWinnerRequest(value: unknown, expected: {
	deployment: DemoFridayTrustedBrowserDeploymentV1
	auctionId: string
	operationId: string
	amount: number
}): DemoRecipientCoordinatorRequest {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('winner request is not an object')
	const raw = value as Record<string, unknown>
	exactKeys(raw, ['capability', 'outputs'], 'winner request')
	if (!Array.isArray(raw.outputs) || raw.outputs.length < 1) refuse('winner outputs are absent')
	const outputs = raw.outputs as Array<Record<string, unknown>>
	const points = new Set<string>()
	for (const output of outputs) {
		exactKeys(output, ['B_', 'amount', 'id'], 'winner output')
		if (!COMPRESSED_KEY.test(String(output.B_)) || points.has(String(output.B_))
			|| !Number.isSafeInteger(output.amount) || Number(output.amount) < 1
			|| output.id !== expected.deployment.keyset.id
			|| expected.deployment.keyset.keys[String(output.amount)] === undefined) refuse('winner output is malformed, duplicate, or outside the keyset')
		points.add(String(output.B_))
	}
	if (outputs.reduce((sum, output) => sum + Number(output.amount), 0) !== expected.amount) refuse('winner outputs do not equal the exact bid pool')
	const capability = raw.capability
	if (capability === null || typeof capability !== 'object' || Array.isArray(capability)) refuse('winner capability is not an object')
	const cap = capability as Record<string, unknown>
	exactKeys(cap, ['schema', 'network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl', 'unit',
		'recipientPublicKey', 'outputsDigest', 'signature'], 'winner capability')
	if (cap.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' || cap.network !== expected.deployment.authNetworkId
		|| cap.chainId !== expected.deployment.chainId || cap.auctionId !== expected.auctionId
		|| cap.operationId !== expected.operationId || cap.role !== 'winner_settlement'
		|| cap.mintUrl !== expected.deployment.canonicalMintUrl || cap.unit !== 'sat'
		|| !COMPRESSED_KEY.test(String(cap.recipientPublicKey)) || cap.outputsDigest !== demoOutputsDigest(outputs as never)
		|| !HEX_64.test(String(cap.signature))
		|| !schnorr.verify(hexToBytes(String(cap.signature)), hexToBytes(demoRecipientCapabilityDigest(cap as never)),
			hexToBytes(String(cap.recipientPublicKey).slice(2)))) refuse('winner capability identity, output digest, or signature is invalid')
	return structuredClone(value) as DemoRecipientCoordinatorRequest
}

function exactSellerEnvelope(value: unknown, record: DemoFridaySellerPlanRecordV1, deployment: DemoFridayTrustedBrowserDeploymentV1, nowSeconds: number): DemoFridaySellerWinnerPlanEnvelopeV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('seller plan envelope is not an object')
	const raw = value as Record<string, unknown>
	exactKeys(raw, ['schema', 'planDigest', 'plan', 'sellerAuthorization'], 'seller plan envelope')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_ENVELOPE_V1' || !HEX_32.test(String(raw.planDigest))
		|| raw.plan === null || typeof raw.plan !== 'object' || Array.isArray(raw.plan)) refuse('seller plan envelope is malformed')
	const plan = raw.plan as Record<string, unknown>, challenge = record.challenge
	exactKeys(plan, ['schema', 'authNetworkId', 'chainId', 'auctionId', 'fundingOperationId', 'sellerActor',
		'bidderActor', 'bidAmount', 'canonicalMintUrl', 'activeSatKeysetId', 'denominationKeyDigest',
		'recipientPublicKey', 'recipientPlan', 'expiresAt'], 'seller plan')
	if (plan.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_V1'
		|| plan.authNetworkId !== challenge.authNetworkId || plan.chainId !== challenge.chainId
		|| plan.auctionId !== challenge.auctionId || plan.fundingOperationId !== challenge.fundingOperationId
		|| plan.sellerActor !== challenge.sellerActor || plan.bidderActor !== challenge.bidderActor
		|| plan.bidAmount !== challenge.bidAmount || plan.canonicalMintUrl !== challenge.canonicalMintUrl
		|| plan.activeSatKeysetId !== challenge.activeSatKeysetId
		|| plan.denominationKeyDigest !== challenge.denominationKeyDigest || plan.expiresAt !== challenge.expiresAt
		|| plan.recipientPublicKey !== (plan.recipientPlan as { capability?: { recipientPublicKey?: unknown } })?.capability?.recipientPublicKey
		|| nowSeconds > challenge.expiresAt || digest(plan) !== raw.planDigest) refuse('seller plan differs from the exact issued challenge')
	const recipientPlan = exactWinnerRequest(plan.recipientPlan, { deployment, auctionId: challenge.auctionId,
		operationId: challenge.fundingOperationId, amount: challenge.bidAmount })
	const unsigned: DemoFridayUnsignedNostrBidV1 = {
		pubkey: challenge.sellerActor, created_at: Number((raw.sellerAuthorization as Record<string, unknown>)?.created_at),
		kind: DEMO_FRIDAY_SELLER_WINNER_PLAN_KIND,
		tags: [['t', 'plebeian-friday-seller-plan-v1'], ['a', challenge.auctionId], ['operation', challenge.fundingOperationId]],
		content: canonical({ schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_AUTHORIZATION_V1', planDigest: raw.planDigest, plan }),
	}
	if (!Number.isSafeInteger(unsigned.created_at) || unsigned.created_at < nowSeconds - MAX_VALIDITY_SECONDS
		|| unsigned.created_at > nowSeconds || unsigned.created_at > challenge.expiresAt) refuse('seller authorization time is invalid')
	const sellerAuthorization = exactSignedEvent(raw.sellerAuthorization, unsigned, 'seller authorization')
	return { schema: raw.schema, planDigest: String(raw.planDigest), plan: {
		...(structuredClone(plan) as unknown as DemoFridaySellerWinnerPlanEnvelopeV1['plan']), recipientPlan,
	}, sellerAuthorization }
}

export class DemoFridaySellerPlanMemoryRegistry implements DemoFridaySellerPlanRegistryPort {
	readonly #records = new Map<string, DemoFridaySellerPlanRecordV1>()

	createChallengeExact(record: DemoFridaySellerPlanRecordV1): DemoFridaySellerPlanRecordV1 {
		const encoded = canonical({ ...record, envelope: null }), prior = this.#records.get(record.challenge.fundingOperationId)
		if (prior !== undefined) {
			if (canonical({ ...prior, envelope: null }) !== encoded) refuse('funding operation already owns another challenge')
			return structuredClone(prior)
		}
		this.#records.set(record.challenge.fundingOperationId, structuredClone(record))
		return structuredClone(record)
	}

	readExact(fundingOperationId: string): DemoFridaySellerPlanRecordV1 | null {
		const record = this.#records.get(fundingOperationId)
		return record === undefined ? null : structuredClone(record)
	}

	listBySellerExact(sellerActor: string): DemoFridaySellerPlanRecordV1[] {
		if (!HEX_32.test(sellerActor)) refuse('seller identity is malformed')
		return [...this.#records.values()].filter((record) => record.challenge.sellerActor === sellerActor)
			.sort((left, right) => left.challenge.fundingOperationId.localeCompare(right.challenge.fundingOperationId))
			.map((record) => structuredClone(record))
	}

	registerExact(fundingOperationId: string, envelope: DemoFridaySellerWinnerPlanEnvelopeV1): DemoFridaySellerPlanRecordV1 {
		const record = this.#records.get(fundingOperationId)
		if (record === undefined) refuse('seller plan has no issued challenge')
		if (record.envelope !== null && canonical(record.envelope) !== canonical(envelope)) refuse('seller plan changed after registration')
		const next = { ...record, envelope: structuredClone(envelope) }
		this.#records.set(fundingOperationId, next)
		return structuredClone(next)
	}
}

export function createDemoFridayBrowserTrustService(options: {
	deployment: DemoFridayTrustedDeploymentReaderPort
	auctions: DemoFridayAuthenticatedAuctionReaderPort
	registry: DemoFridaySellerPlanRegistryPort
	nowSeconds: () => number
}): DemoFridayBrowserTrustService {
	const deployment = async () => exactDeployment(await options.deployment.readExact())
	const recordFor = (operationId: string): DemoFridaySellerPlanRecordV1 => {
		if (!ID.test(operationId)) refuse('funding operation is invalid')
		const record = options.registry.readExact(operationId)
		if (record === null) refuse('seller plan operation is absent')
		return record
	}
	return Object.freeze({
		readDeploymentExact: deployment,
		async issueSellerPlanChallengeExact(intentValue: unknown) {
			const trustedDeployment = await deployment(), nowSeconds = options.nowSeconds()
			const intent = verifyDemoFridaySellerPlanIntent(intentValue, {
				authNetworkId: trustedDeployment.authNetworkId, chainId: trustedDeployment.chainId,
				canonicalMintUrl: trustedDeployment.canonicalMintUrl, nowSeconds,
			})
			const auction = exactAuction(await options.auctions.readExact(intent.content.auctionId), intent.content.auctionId, trustedDeployment)
			if (intent.event.pubkey === auction.sellerActor || intent.content.replacesBidId !== auction.leaderBidId) {
				refuse('seller-plan intent is a seller self-bid or has a stale leader')
			}
			const challenge: DemoFridaySellerWinnerPlanChallengeV1 = {
				schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1',
				authNetworkId: trustedDeployment.authNetworkId, chainId: trustedDeployment.chainId,
				auctionId: auction.auctionId, fundingOperationId: intent.content.fundingOperationId,
				sellerActor: auction.sellerActor, sellerPaymentPublicKey: auction.sellerPaymentPublicKey,
				bidderActor: intent.event.pubkey, bidAmount: intent.content.bidAmount,
				canonicalMintUrl: trustedDeployment.canonicalMintUrl,
				activeSatKeysetId: trustedDeployment.keyset.id,
				denominationKeyDigest: demoDenominationKeyDigest(trustedDeployment.keyset.keys),
				expiresAt: intent.content.expiresAt,
			}
			return options.registry.createChallengeExact({
				intentEventId: intent.event.id, intent: intent.content, challenge,
				leaderBidId: auction.leaderBidId, leaderActor: auction.leaderActor, leaderBidAmount: auction.leaderBidAmount,
				deploymentDigest: digest(trustedDeployment), envelope: null,
			}).challenge
		},
		async registerSellerPlanExact(envelopeValue: unknown) {
			const trustedDeployment = await deployment()
			const operationId = (envelopeValue as { plan?: { fundingOperationId?: unknown } })?.plan?.fundingOperationId
			if (typeof operationId !== 'string') refuse('seller plan operation is absent')
			const record = recordFor(operationId)
			if (record.deploymentDigest !== digest(trustedDeployment)) refuse('deployment changed after challenge issuance')
			const envelope = exactSellerEnvelope(envelopeValue, record, trustedDeployment, options.nowSeconds())
			return options.registry.registerExact(operationId, envelope).envelope!
		},
		async readSellerPlanChallengeExact(request: { sellerActor: string; auctionId: string; fundingOperationId: string }) {
			if (!HEX_32.test(request.sellerActor) || !ID.test(request.auctionId) || !ID.test(request.fundingOperationId)) {
				refuse('seller challenge read identity is malformed')
			}
			const record = recordFor(request.fundingOperationId)
			if (record.challenge.sellerActor !== request.sellerActor || record.challenge.auctionId !== request.auctionId
				|| options.nowSeconds() > record.challenge.expiresAt) refuse('seller challenge is absent, expired, or belongs to another seller')
			return structuredClone(record.challenge)
		},
		async listSellerPlanChallengesExact(sellerActor: string) {
			if (!HEX_32.test(sellerActor)) refuse('seller challenge list identity is malformed')
			const now = options.nowSeconds()
			return options.registry.listBySellerExact(sellerActor)
				// Registered challenges remain discoverable until expiry. This lets a
				// seller recover when registration committed but its HTTP response was
				// lost before the browser recorded the public operation identity.
				.filter((record) => record.challenge.expiresAt >= now)
				.map((record) => structuredClone(record.challenge))
		},
		async readSellerPlanExact(request: { sellerActor: string; auctionId: string; fundingOperationId: string }) {
			if (!HEX_32.test(request.sellerActor) || !ID.test(request.auctionId) || !ID.test(request.fundingOperationId)) {
				refuse('seller plan read identity is malformed')
			}
			const record = recordFor(request.fundingOperationId)
			if (record.challenge.sellerActor !== request.sellerActor || record.challenge.auctionId !== request.auctionId) {
				refuse('seller plan belongs to another seller or auction')
			}
			if (record.envelope === null) return null
			return { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_REGISTERED_V1' as const, status: 'registered' as const,
				planDigest: record.envelope.planDigest, plan: structuredClone(record.envelope.plan) }
		},
		async readAuctionFundingExact(request: { auctionId: string; fundingOperationId: string; fullPoolAmount: number }) {
			if (!ID.test(request.auctionId) || !ID.test(request.fundingOperationId)
				|| !Number.isSafeInteger(request.fullPoolAmount) || request.fullPoolAmount < 1) refuse('trusted auction request is malformed')
			const trustedDeployment = await deployment(), record = recordFor(request.fundingOperationId)
			if (record.envelope === null || record.deploymentDigest !== digest(trustedDeployment)
				|| record.challenge.auctionId !== request.auctionId || record.challenge.bidAmount !== request.fullPoolAmount
				|| options.nowSeconds() > record.challenge.expiresAt) refuse('seller plan is absent, expired, or belongs to another request')
			const auction = exactAuction(await options.auctions.readExact(request.auctionId), request.auctionId, trustedDeployment)
			if (auction.sellerActor !== record.challenge.sellerActor || auction.leaderBidId !== record.leaderBidId
				|| auction.sellerPaymentPublicKey !== record.challenge.sellerPaymentPublicKey
				|| auction.leaderActor !== record.leaderActor || auction.leaderBidAmount !== record.leaderBidAmount) {
				refuse('authenticated auction changed after seller challenge issuance')
			}
			return { schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1' as const, auctionId: request.auctionId,
				sellerPaymentPublicKey: auction.sellerPaymentPublicKey,
				leaderBidId: auction.leaderBidId, leaderActor: auction.leaderActor,
				leaderBidAmount: auction.leaderBidAmount,
				winnerRequest: structuredClone(record.envelope.plan.recipientPlan) }
		},
		async assertRegisteredWinnerExact(request: { auctionId: string; fundingOperationId: string; bidderActor: string;
			bidAmount: number; winnerRequest: DemoRecipientCoordinatorRequest }) {
			if (!HEX_32.test(request.bidderActor)) refuse('prepared funding bidder is malformed')
			const trustedDeployment = await deployment(), record = recordFor(request.fundingOperationId)
			if (record.envelope === null || record.deploymentDigest !== digest(trustedDeployment)
				|| record.challenge.auctionId !== request.auctionId || record.challenge.bidderActor !== request.bidderActor
				|| record.challenge.bidAmount !== request.bidAmount
				|| record.envelope.plan.recipientPublicKey !== record.challenge.sellerPaymentPublicKey
				|| canonical(record.envelope.plan.recipientPlan) !== canonical(exactWinnerRequest(request.winnerRequest, {
					deployment: trustedDeployment, auctionId: request.auctionId,
					operationId: request.fundingOperationId, amount: request.bidAmount,
				}))) refuse('prepared funding winner plan was not registered by the committed seller')
		},
	})
}
