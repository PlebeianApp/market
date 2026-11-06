/**
 * Auction-scoped seller payout authorization.
 *
 * The current Friday demo prepares one seller-owned blinded-output plan for every
 * bidder operation. That keeps recipient openings private, but requires the
 * seller's browser and NIP-07 signer to be online for every bid. This module
 * moves that consent to auction creation without moving a seller credential to
 * the server:
 *
 * - the seller browser prepares one blinded output for every binary denomination
 *   needed to cover the auction's maximum payout;
 * - the Coco recipient key authenticates that complete catalog once;
 * - the seller's Nostr key authorizes the exact auction, terms, recipient,
 *   mint/keyset, cap, and validity window once;
 * - a deterministic public selector may later choose only the exact subset that
 *   equals a valid bid.
 *
 * Recipient openings remain in the browser-private journal. A production
 * integration MUST atomically enforce one winner terminal branch per auction
 * before allowing catalog outputs to reach the mint. This module deliberately
 * does not weaken or replace that terminal-claim invariant.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	awaitDemoFridaySellerApproval,
	type DemoFridaySellerNostrPort,
	type DemoFridaySellerOpeningRefV1,
	type DemoFridaySellerRecipientKeyPort,
} from './demo-friday-browser-coco-seller-plan'
import type { DemoFridaySignedNostrBidV1, DemoFridayUnsignedNostrBidV1 } from './demo-friday-browser-payment-state'
import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientCoordinatorRequest,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
} from './demo-sigall-recipient'
import { demoDenominationKeyDigest, demoOutputsDigest, demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import { blindMessage, randomSecretHex } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const POINT = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const MAX_PAYOUT = 50_000
const MAX_AUTHORIZATION_SECONDS = 8 * 60 * 60
export const DEMO_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_KIND = 28_652 as const

export interface DemoFridayAuctionPayoutScopeV1 {
	schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1'
	authNetworkId: string
	chainId: string
	auctionId: string
	sellerActor: string
	sellerPaymentPublicKey: string
	canonicalMintUrl: string
	activeSatKeysetId: string
	denominationKeyDigest: string
	startingBid: number
	minIncrement: number
	reserve: number
	originalEndTime: number
	maximumEndTime: number
	maximumPayout: number
	validFrom: number
	validUntil: number
}

export interface DemoFridayAuctionPayoutAuthorizationV1 extends Omit<DemoFridayAuctionPayoutScopeV1, 'schema'> {
	schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_V1'
	catalogOperationId: string
	recipientCatalog: DemoRecipientCoordinatorRequest
}

export interface DemoFridayAuctionPayoutAuthorizationEnvelopeV1 {
	schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_ENVELOPE_V1'
	authorizationDigest: string
	authorization: DemoFridayAuctionPayoutAuthorizationV1
	sellerAuthorization: DemoFridaySignedNostrBidV1
}

export interface DemoFridayAuctionPayoutLiveAuctionV1 {
	auctionId: string
	sellerActor: string
	sellerPaymentPublicKey: string
	status: 'open'
	startingBid: number
	minIncrement: number
	reserve: number
	originalEndTime: number
	endTime: number
	leaderBidId: string
	leaderActor: string
	leaderBidAmount: number
	stateHeight: number
	appHash: string
}

export interface DemoFridayAuctionPayoutSelectionV1 {
	schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SELECTION_V1'
	authorizationDigest: string
	catalogOperationId: string
	auctionId: string
	fundingOperationId: string
	bidderActor: string
	bidAmount: number
	replacesBidId: string
	stateHeight: number
	appHash: string
	selectedAt: number
	selectedIndexes: number[]
	outputs: DemoRecipientCoordinatorRequest['outputs']
	recipientPublicKey: string
	selectionDigest: string
}

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_AUCTION_PAYOUT: ${message}`) }

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value contains an unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

function exactOrigin(value: string): string {
	let url: URL
	try { url = new URL(value) } catch { return refuse('mint identity is invalid') }
	if (url.protocol !== 'https:' || value !== url.origin || url.username !== '' || url.password !== ''
		|| url.pathname !== '/' || url.search !== '' || url.hash !== '') refuse('mint identity must be one public HTTPS origin')
	return url.origin
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) refuse(`${label} has unexpected fields`)
}

function exactScope(value: DemoFridayAuctionPayoutScopeV1, keyset: DemoRecipientKeyset, nowSeconds: number): DemoFridayAuctionPayoutScopeV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1'
		|| !ID.test(value.authNetworkId) || !ID.test(value.chainId) || !ID.test(value.auctionId)
		|| !HEX_32.test(value.sellerActor) || !POINT.test(value.sellerPaymentPublicKey)
		|| value.sellerPaymentPublicKey.slice(2) === value.sellerActor
		|| keyset.unit !== 'sat' || keyset.id !== value.activeSatKeysetId
		|| demoDenominationKeyDigest(keyset.keys) !== value.denominationKeyDigest
		|| !Number.isSafeInteger(value.startingBid) || value.startingBid < 1
		|| !Number.isSafeInteger(value.minIncrement) || value.minIncrement < 1
		|| !Number.isSafeInteger(value.reserve) || value.reserve < 0
		|| !Number.isSafeInteger(value.originalEndTime) || value.originalEndTime <= nowSeconds
		|| !Number.isSafeInteger(value.maximumEndTime) || value.maximumEndTime < value.originalEndTime
		|| !Number.isSafeInteger(value.maximumPayout) || value.maximumPayout < value.startingBid || value.maximumPayout > MAX_PAYOUT
		|| !Number.isSafeInteger(value.validFrom) || value.validFrom !== nowSeconds
		|| !Number.isSafeInteger(value.validUntil) || value.validUntil < value.maximumEndTime
		|| value.validUntil - value.validFrom > MAX_AUTHORIZATION_SECONDS) {
		refuse('auction payout scope is malformed, expired, or outside the supported cap')
	}
	return { ...structuredClone(value), canonicalMintUrl: exactOrigin(value.canonicalMintUrl) }
}

/** One unique binary denomination lets any value from 1 through maximumPayout be selected exactly. */
export function demoFridayAuctionPayoutCatalogAmounts(maximumPayout: number, keyset: DemoRecipientKeyset): number[] {
	if (!Number.isSafeInteger(maximumPayout) || maximumPayout < 1 || maximumPayout > MAX_PAYOUT || keyset.unit !== 'sat') {
		refuse('catalog payout cap or unit is invalid')
	}
	const amounts: number[] = []
	for (let amount = 1; amount <= maximumPayout; amount *= 2) {
		if (keyset.keys[String(amount)] === undefined) refuse(`keyset is missing catalog denomination ${amount}`)
		amounts.push(amount)
	}
	if (amounts.reduce((sum, amount) => sum + amount, 0) < maximumPayout) refuse('catalog does not cover the payout cap')
	return amounts.sort((left, right) => right - left)
}

function catalogOperationId(scope: DemoFridayAuctionPayoutScopeV1): string {
	return digest(['PLEBEIAN_FRIDAY_AUCTION_PAYOUT_CATALOG_OPERATION_V1', scope])
}

function scopeFromAuthorization(value: DemoFridayAuctionPayoutAuthorizationV1): DemoFridayAuctionPayoutScopeV1 {
	return {
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1',
		authNetworkId: value.authNetworkId,
		chainId: value.chainId,
		auctionId: value.auctionId,
		sellerActor: value.sellerActor,
		sellerPaymentPublicKey: value.sellerPaymentPublicKey,
		canonicalMintUrl: value.canonicalMintUrl,
		activeSatKeysetId: value.activeSatKeysetId,
		denominationKeyDigest: value.denominationKeyDigest,
		startingBid: value.startingBid,
		minIncrement: value.minIncrement,
		reserve: value.reserve,
		originalEndTime: value.originalEndTime,
		maximumEndTime: value.maximumEndTime,
		maximumPayout: value.maximumPayout,
		validFrom: value.validFrom,
		validUntil: value.validUntil,
	}
}

function unsignedAuthorization(authorization: DemoFridayAuctionPayoutAuthorizationV1, createdAt: number): DemoFridayUnsignedNostrBidV1 {
	const authorizationDigest = digest(authorization)
	return {
		pubkey: authorization.sellerActor,
		created_at: createdAt,
		kind: DEMO_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_KIND,
		tags: [['t', 'plebeian-friday-auction-payout-v1'], ['a', authorization.auctionId],
			['catalog', authorization.catalogOperationId]],
		content: canonical({ schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_EVENT_V1',
			authorizationDigest, authorization }),
	}
}

function signedExact(value: DemoFridaySignedNostrBidV1, unsigned: DemoFridayUnsignedNostrBidV1): DemoFridaySignedNostrBidV1 {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	if (value.id !== id || !HEX_64.test(value.sig) || value.pubkey !== unsigned.pubkey
		|| value.created_at !== unsigned.created_at || value.kind !== unsigned.kind
		|| JSON.stringify(value.tags) !== JSON.stringify(unsigned.tags) || value.content !== unsigned.content
		|| !schnorr.verify(hexToBytes(value.sig), hexToBytes(id), hexToBytes(unsigned.pubkey))) {
		refuse('NIP-07 changed or invalidly signed the auction payout authorization')
	}
	return structuredClone(value)
}

export async function prepareDemoFridayAuctionPayoutAuthorization(options: {
	scope: DemoFridayAuctionPayoutScopeV1
	keyset: DemoRecipientKeyset
	journal: DemoRecipientPrivateJournalPort<DemoFridaySellerOpeningRefV1>
	recipientKey: DemoFridaySellerRecipientKeyPort
	nostr: DemoFridaySellerNostrPort
	nowSeconds: number
	assertSigningScope?: () => Promise<void>
	signal?: AbortSignal
}): Promise<DemoFridayAuctionPayoutAuthorizationEnvelopeV1> {
	const scope = exactScope(structuredClone(options.scope), structuredClone(options.keyset), options.nowSeconds)
	const catalogId = catalogOperationId(scope)
	const assertScope = async () => {
		if (options.signal?.aborted) refuse('seller authorization cancelled')
		await awaitDemoFridaySellerApproval(options.signal, async () => options.assertSigningScope?.())
		const [actor, recipient] = await awaitDemoFridaySellerApproval(options.signal,
			() => Promise.all([options.nostr.getPublicKey(), options.recipientKey.getPublicKey()]))
		if (actor !== scope.sellerActor || recipient !== scope.sellerPaymentPublicKey) refuse('seller identity or payout key changed')
		if (options.signal?.aborted) refuse('seller authorization cancelled')
	}
	await assertScope()
	const amounts = demoFridayAuctionPayoutCatalogAmounts(scope.maximumPayout, options.keyset)
	const recipientCatalog = await prepareDemoSigAllRecipientOutputs({
		intent: {
			schema: 'COCO_DEMO_RECIPIENT_INTENT_V1', network: scope.authNetworkId, chainId: scope.chainId,
			auctionId: scope.auctionId, operationId: catalogId, role: 'winner_settlement',
			mintUrl: scope.canonicalMintUrl, unit: 'sat', recipientPublicKey: scope.sellerPaymentPublicKey, amounts,
		},
		keyset: options.keyset,
		journal: options.journal,
		roleBinding: {
			async assertWinnerRecipient(binding) {
				if (binding.network !== scope.authNetworkId || binding.chainId !== scope.chainId
					|| binding.auctionId !== scope.auctionId || binding.operationId !== catalogId
					|| binding.recipientPublicKey !== scope.sellerPaymentPublicKey) refuse('catalog winner binding changed')
			},
			async assertRefundRecipient() { refuse('auction payout catalog changed into a refund') },
		},
		signer: { async signCapability(value) {
			await assertScope()
			const signature = await awaitDemoFridaySellerApproval(options.signal,
				() => options.recipientKey.signRecipientCapability({ ...value, role: 'winner_settlement' }))
			await assertScope()
			return signature
		} },
		outputFactory: {
			async createRecipientOwnedOutput(value) {
				const opening = blindMessage(randomSecretHex())
				return { message: { amount: value.amount, id: value.keysetId, B_: opening.B_ },
					privateOpeningRef: { secret: opening.secret, r: opening.r.toString(16).padStart(64, '0'), B_: opening.B_ } }
			},
		},
	})
	const authorization: DemoFridayAuctionPayoutAuthorizationV1 = {
		...scope,
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_V1',
		catalogOperationId: catalogId,
		recipientCatalog,
	}
	const authorizationDigest = digest(authorization)
	const unsigned = unsignedAuthorization(authorization, options.nowSeconds)
	await assertScope()
	const signed = await awaitDemoFridaySellerApproval(options.signal, () => options.nostr.signEvent(structuredClone(unsigned)))
	await assertScope()
	return {
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_ENVELOPE_V1',
		authorizationDigest,
		authorization,
		sellerAuthorization: signedExact(signed, unsigned),
	}
}

export function verifyDemoFridayAuctionPayoutAuthorization(
	value: DemoFridayAuctionPayoutAuthorizationEnvelopeV1,
	keyset: DemoRecipientKeyset,
	nowSeconds: number,
): DemoFridayAuctionPayoutAuthorizationEnvelopeV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('authorization envelope is absent')
	const envelope = value as DemoFridayAuctionPayoutAuthorizationEnvelopeV1
	exactKeys(envelope as unknown as Record<string, unknown>,
		['schema', 'authorizationDigest', 'authorization', 'sellerAuthorization'], 'authorization envelope')
	if (envelope.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_ENVELOPE_V1'
		|| !HEX_32.test(envelope.authorizationDigest)) refuse('authorization envelope is malformed')
	const authorization = envelope.authorization
	if (authorization === null || typeof authorization !== 'object' || Array.isArray(authorization)) refuse('authorization is absent')
	exactKeys(authorization as unknown as Record<string, unknown>, [
		'schema', 'authNetworkId', 'chainId', 'auctionId', 'sellerActor', 'sellerPaymentPublicKey',
		'canonicalMintUrl', 'activeSatKeysetId', 'denominationKeyDigest', 'startingBid', 'minIncrement',
		'reserve', 'originalEndTime', 'maximumEndTime', 'maximumPayout', 'validFrom', 'validUntil',
		'catalogOperationId', 'recipientCatalog',
	], 'authorization')
	const scope = scopeFromAuthorization(authorization)
	// Scope creation requires validFrom === now. Verification instead permits the
	// authorization's bounded lifetime while retaining the same structural checks.
	const checked = exactScope(scope, keyset, scope.validFrom)
	if (nowSeconds < checked.validFrom || nowSeconds > checked.validUntil) refuse('auction payout authorization is not currently valid')
	if (authorization.catalogOperationId !== catalogOperationId(checked)
		|| envelope.authorizationDigest !== digest(authorization)) refuse('authorization identity or digest changed')
	const expectedAmounts = demoFridayAuctionPayoutCatalogAmounts(checked.maximumPayout, keyset)
	const catalog = authorization.recipientCatalog
	if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)
		|| !Array.isArray(catalog.outputs) || catalog.outputs.length !== expectedAmounts.length) refuse('recipient catalog is malformed')
	const points = new Set<string>()
	for (let index = 0; index < catalog.outputs.length; index += 1) {
		const output = catalog.outputs[index]!
		if (output.amount !== expectedAmounts[index] || output.id !== keyset.id || !POINT.test(output.B_) || points.has(output.B_)) {
			refuse('recipient catalog output changed, duplicated, or left the keyset')
		}
		points.add(output.B_)
	}
	const capability = catalog.capability
	if (capability.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1'
		|| capability.network !== checked.authNetworkId || capability.chainId !== checked.chainId
		|| capability.auctionId !== checked.auctionId || capability.operationId !== authorization.catalogOperationId
		|| capability.role !== 'winner_settlement' || capability.mintUrl !== checked.canonicalMintUrl
		|| capability.unit !== 'sat' || capability.recipientPublicKey !== checked.sellerPaymentPublicKey
		|| capability.outputsDigest !== demoOutputsDigest(catalog.outputs) || !HEX_64.test(capability.signature)
		|| !schnorr.verify(hexToBytes(capability.signature), hexToBytes(demoRecipientCapabilityDigest(capability)),
			hexToBytes(capability.recipientPublicKey.slice(2)))) refuse('recipient catalog capability is invalid')
	const unsigned = unsignedAuthorization(authorization, envelope.sellerAuthorization.created_at)
	if (unsigned.created_at !== checked.validFrom) refuse('seller authorization was not created with the exact auction scope')
	const sellerAuthorization = signedExact(envelope.sellerAuthorization, unsigned)
	return structuredClone({ ...envelope, authorization: { ...authorization, recipientCatalog: catalog }, sellerAuthorization })
}

export function selectDemoFridayAuctionPayout(options: {
	authorization: DemoFridayAuctionPayoutAuthorizationEnvelopeV1
	keyset: DemoRecipientKeyset
	nowSeconds: number
	auction: DemoFridayAuctionPayoutLiveAuctionV1
	request: {
		auctionId: string
		fundingOperationId: string
		bidderActor: string
		bidAmount: number
		replacesBidId: string
	}
}): DemoFridayAuctionPayoutSelectionV1 {
	const envelope = verifyDemoFridayAuctionPayoutAuthorization(options.authorization, options.keyset, options.nowSeconds)
	const authorization = envelope.authorization, auction = structuredClone(options.auction), request = structuredClone(options.request)
	if (auction.auctionId !== authorization.auctionId || request.auctionId !== authorization.auctionId
		|| auction.status !== 'open' || auction.sellerActor !== authorization.sellerActor
		|| auction.sellerPaymentPublicKey !== authorization.sellerPaymentPublicKey
		|| auction.startingBid !== authorization.startingBid || auction.minIncrement !== authorization.minIncrement
		|| auction.reserve !== authorization.reserve || auction.originalEndTime !== authorization.originalEndTime
		|| !Number.isSafeInteger(auction.endTime) || auction.endTime < auction.originalEndTime
		|| auction.endTime > authorization.maximumEndTime || options.nowSeconds > auction.endTime
		|| !Number.isSafeInteger(auction.stateHeight) || auction.stateHeight < 1 || !HEX_32.test(auction.appHash)) {
		refuse('live auction changed from the exact authorized scope')
	}
	if (!ID.test(request.fundingOperationId) || !HEX_32.test(request.bidderActor)
		|| request.bidderActor === authorization.sellerActor || request.bidderActor === auction.leaderActor
		|| !Number.isSafeInteger(request.bidAmount) || request.bidAmount < authorization.startingBid
		|| request.bidAmount > authorization.maximumPayout
		|| (auction.leaderBidId === '' && (auction.leaderActor !== '' || auction.leaderBidAmount !== 0 || request.replacesBidId !== ''))
		|| (auction.leaderBidId !== '' && (!HEX_32.test(auction.leaderBidId) || !HEX_32.test(auction.leaderActor)
			|| !Number.isSafeInteger(auction.leaderBidAmount) || auction.leaderBidAmount < authorization.startingBid
			|| request.replacesBidId !== auction.leaderBidId
			|| request.bidAmount < auction.leaderBidAmount + authorization.minIncrement))) {
		refuse('bid is malformed, stale, self-authored, or outside the authorized payout policy')
	}
	const { selectedIndexes, outputs } = selectCatalogOutputs(authorization, request.bidAmount)
	const base = {
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SELECTION_V1' as const,
		authorizationDigest: envelope.authorizationDigest,
		catalogOperationId: authorization.catalogOperationId,
		auctionId: authorization.auctionId,
		fundingOperationId: request.fundingOperationId,
		bidderActor: request.bidderActor,
		bidAmount: request.bidAmount,
		replacesBidId: request.replacesBidId,
		stateHeight: auction.stateHeight,
		appHash: auction.appHash,
		selectedAt: options.nowSeconds,
		selectedIndexes,
		outputs,
		recipientPublicKey: authorization.sellerPaymentPublicKey,
	}
	return { ...base, selectionDigest: digest(base) }
}

function selectCatalogOutputs(authorization: DemoFridayAuctionPayoutAuthorizationV1, amount: number): {
	selectedIndexes: number[]
	outputs: DemoRecipientCoordinatorRequest['outputs']
} {
	const selectedIndexes: number[] = [], outputs: DemoRecipientCoordinatorRequest['outputs'] = []
	let remainder = amount
	for (let index = 0; index < authorization.recipientCatalog.outputs.length; index += 1) {
		const output = authorization.recipientCatalog.outputs[index]!
		if (output.amount <= remainder) {
			selectedIndexes.push(index)
			outputs.push(structuredClone(output))
			remainder -= output.amount
		}
	}
	if (remainder !== 0 || outputs.reduce((sum, output) => sum + output.amount, 0) !== amount) {
		refuse('catalog cannot represent the exact bid amount')
	}
	return { selectedIndexes, outputs }
}

/**
 * Verifies a previously selected payout without consulting mutable auction
 * state. Terminal code must additionally bind it to one authenticated final
 * auction outcome before claiming the winner fence.
 */
export function verifyDemoFridayAuctionPayoutSelectionStatic(
	value: DemoFridayAuctionPayoutSelectionV1,
	options: {
		authorization: DemoFridayAuctionPayoutAuthorizationEnvelopeV1
		keyset: DemoRecipientKeyset
		observedAt: number
	},
): DemoFridayAuctionPayoutSelectionV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('payout selection is absent')
	exactKeys(value as unknown as Record<string, unknown>, [
		'schema', 'authorizationDigest', 'catalogOperationId', 'auctionId', 'fundingOperationId', 'bidderActor',
		'bidAmount', 'replacesBidId', 'stateHeight', 'appHash', 'selectedIndexes', 'outputs',
		'selectedAt', 'recipientPublicKey', 'selectionDigest',
	], 'payout selection')
	if (!Number.isSafeInteger(value.selectedAt) || value.selectedAt < 1 || options.observedAt < value.selectedAt) {
		refuse('payout selection observation time is invalid')
	}
	const envelope = verifyDemoFridayAuctionPayoutAuthorization(options.authorization, options.keyset, value.selectedAt)
	const authorization = envelope.authorization
	if (value.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SELECTION_V1'
		|| value.authorizationDigest !== envelope.authorizationDigest
		|| value.catalogOperationId !== authorization.catalogOperationId
		|| value.auctionId !== authorization.auctionId || !ID.test(value.fundingOperationId)
		|| !HEX_32.test(value.bidderActor) || value.bidderActor === authorization.sellerActor
		|| !Number.isSafeInteger(value.bidAmount) || value.bidAmount < authorization.startingBid
		|| value.bidAmount > authorization.maximumPayout
		|| (value.replacesBidId !== '' && !HEX_32.test(value.replacesBidId))
		|| !Number.isSafeInteger(value.stateHeight) || value.stateHeight < 1 || !HEX_32.test(value.appHash)
		|| value.recipientPublicKey !== authorization.sellerPaymentPublicKey) {
		refuse('payout selection identity or amount is invalid')
	}
	const expectedCatalog = selectCatalogOutputs(authorization, value.bidAmount)
	const base = {
		schema: value.schema,
		authorizationDigest: value.authorizationDigest,
		catalogOperationId: value.catalogOperationId,
		auctionId: value.auctionId,
		fundingOperationId: value.fundingOperationId,
		bidderActor: value.bidderActor,
		bidAmount: value.bidAmount,
		replacesBidId: value.replacesBidId,
		stateHeight: value.stateHeight,
		appHash: value.appHash,
		selectedAt: value.selectedAt,
		selectedIndexes: value.selectedIndexes,
		outputs: value.outputs,
		recipientPublicKey: value.recipientPublicKey,
	}
	if (canonical(value.selectedIndexes) !== canonical(expectedCatalog.selectedIndexes)
		|| canonical(value.outputs) !== canonical(expectedCatalog.outputs)
		|| value.selectionDigest !== digest(base)) refuse('payout selection changed after deterministic derivation')
	return structuredClone(value)
}

export function verifyDemoFridayAuctionPayoutSelection(
	value: DemoFridayAuctionPayoutSelectionV1,
	options: Omit<Parameters<typeof selectDemoFridayAuctionPayout>[0], 'request'>,
): DemoFridayAuctionPayoutSelectionV1 {
	verifyDemoFridayAuctionPayoutSelectionStatic(value, {
		authorization: options.authorization,
		keyset: options.keyset,
		observedAt: options.nowSeconds,
	})
	const expected = selectDemoFridayAuctionPayout({
		...options,
		request: {
			auctionId: value.auctionId,
			fundingOperationId: value.fundingOperationId,
			bidderActor: value.bidderActor,
			bidAmount: value.bidAmount,
			replacesBidId: value.replacesBidId,
		},
	})
	if (canonical(value) !== canonical(expected)) refuse('payout selection changed after deterministic derivation')
	return expected
}
