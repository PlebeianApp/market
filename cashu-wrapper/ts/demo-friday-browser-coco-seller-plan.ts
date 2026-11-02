/**
 * Seller-online winner plan for the fake-money Friday browser flow.
 *
 * Coco v2 exposes durable P2PK keypairs, not a BIP32 xpub. The seller therefore
 * prepares one exact blinded-output plan for one pending funding operation and
 * keeps every opening in the browser-private recipient journal. Only the
 * public outputs, capability, recipient key, and seller Nostr authorization
 * leave the browser.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { DemoFridayUnsignedNostrBidV1, DemoFridaySignedNostrBidV1 } from './demo-friday-browser-payment-state'
import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientCoordinatorRequest,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
} from './demo-sigall-recipient'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { blindMessage, randomSecretHex } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
export const DEMO_FRIDAY_SELLER_WINNER_PLAN_KIND = 28_648 as const

export interface DemoFridaySellerWinnerPlanChallengeV1 {
	schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1'
	authNetworkId: string
	chainId: string
	auctionId: string
	fundingOperationId: string
	sellerActor: string
	sellerPaymentPublicKey: string
	bidderActor: string
	bidAmount: number
	canonicalMintUrl: string
	activeSatKeysetId: string
	denominationKeyDigest: string
	expiresAt: number
}

export interface DemoFridaySellerWinnerPlanPublicV1 {
	schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_V1'
	authNetworkId: string
	chainId: string
	auctionId: string
	fundingOperationId: string
	sellerActor: string
	bidderActor: string
	bidAmount: number
	canonicalMintUrl: string
	activeSatKeysetId: string
	denominationKeyDigest: string
	recipientPublicKey: string
	recipientPlan: DemoRecipientCoordinatorRequest
	expiresAt: number
}

export interface DemoFridaySellerWinnerPlanEnvelopeV1 {
	schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_ENVELOPE_V1'
	planDigest: string
	plan: DemoFridaySellerWinnerPlanPublicV1
	sellerAuthorization: DemoFridaySignedNostrBidV1
}

export interface DemoFridaySellerRecipientKeyPort {
	/** A Coco-keyring-originated, auction-stable P2PK public key. */
	getPublicKey(): Promise<string>
	/** Narrow capability only; this port never accepts an arbitrary digest. */
	signRecipientCapability(value: {
		digest: string
		recipientPublicKey: string
		operationId: string
		role: 'winner_settlement'
	}): Promise<string>
}

export interface DemoFridaySellerNostrPort {
	getPublicKey(): Promise<string>
	signEvent(event: DemoFridayUnsignedNostrBidV1): Promise<DemoFridaySignedNostrBidV1>
}

export interface DemoFridaySellerOpeningRefV1 { secret: string; r: string; B_: string }

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_SELLER_PLAN: ${message}`) }

function exactOrigin(value: string): string {
	let url: URL
	try { url = new URL(value) } catch { return refuse('mint identity is invalid') }
	if (url.protocol !== 'https:' || value !== url.origin || url.username !== '' || url.password !== ''
		|| url.pathname !== '/' || url.search !== '' || url.hash !== '') refuse('mint identity must be one public HTTPS origin')
	return url.origin
}

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical plan contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical plan contains an unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function exactChallenge(
	value: DemoFridaySellerWinnerPlanChallengeV1,
	keyset: DemoRecipientKeyset,
	nowSeconds: number,
): DemoFridaySellerWinnerPlanChallengeV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1'
		|| !ID.test(value.authNetworkId) || !ID.test(value.chainId) || !ID.test(value.auctionId)
		|| !ID.test(value.fundingOperationId)
		|| !HEX_32.test(value.sellerActor) || !COMPRESSED_KEY.test(value.sellerPaymentPublicKey)
		|| value.sellerPaymentPublicKey.slice(2) === value.sellerActor
		|| !HEX_32.test(value.bidderActor) || value.sellerActor === value.bidderActor
		|| !Number.isSafeInteger(value.bidAmount) || value.bidAmount < 1 || value.bidAmount > 50_000
		|| keyset.unit !== 'sat' || keyset.id !== value.activeSatKeysetId
		|| demoDenominationKeyDigest(keyset.keys) !== value.denominationKeyDigest
		|| !Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(value.expiresAt)
		|| value.expiresAt < nowSeconds || value.expiresAt - nowSeconds > 300) refuse('seller challenge is malformed, expired, or differs from the pinned keyset')
	return { ...structuredClone(value), canonicalMintUrl: exactOrigin(value.canonicalMintUrl) }
}

function signedExact(value: DemoFridaySignedNostrBidV1, unsigned: DemoFridayUnsignedNostrBidV1): DemoFridaySignedNostrBidV1 {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	if (value.id !== id || !HEX_64.test(value.sig) || value.pubkey !== unsigned.pubkey
		|| value.created_at !== unsigned.created_at || value.kind !== unsigned.kind
		|| JSON.stringify(value.tags) !== JSON.stringify(unsigned.tags) || value.content !== unsigned.content
		|| !schnorr.verify(hexToBytes(value.sig), hexToBytes(id), hexToBytes(unsigned.pubkey))) {
		refuse('NIP-07 changed or invalidly signed the exact seller plan')
	}
	return structuredClone(value)
}

// An extension prompt cannot be withdrawn by the page. Cancellation only
// releases local maintenance and discards any signature that arrives later.
export async function awaitDemoFridaySellerApproval<T>(signal: AbortSignal | undefined, sign: () => Promise<T>): Promise<T> {
	if (signal?.aborted) refuse('seller approval cancelled')
	if (signal === undefined) return sign()
	let onAbort: () => void = () => {}
	const cancelled = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(new Error('DEMO_FRIDAY_SELLER_PLAN: seller approval cancelled'))
		signal.addEventListener('abort', onAbort, { once: true })
	})
	try { return await Promise.race([sign(), cancelled]) }
	finally { signal.removeEventListener('abort', onAbort) }
}

export async function prepareDemoFridaySellerWinnerPlan(options: {
	challenge: DemoFridaySellerWinnerPlanChallengeV1
	keyset: DemoRecipientKeyset
	journal: DemoRecipientPrivateJournalPort<DemoFridaySellerOpeningRefV1>
	recipientKey: DemoFridaySellerRecipientKeyPort
	nostr: DemoFridaySellerNostrPort
	nowSeconds: number
	assertSigningScope?: () => Promise<void>
	signal?: AbortSignal
}): Promise<DemoFridaySellerWinnerPlanEnvelopeV1> {
	const challenge = structuredClone(exactChallenge(options.challenge, options.keyset, options.nowSeconds))
	const assertScope = async () => {
		if (options.signal?.aborted) refuse('seller approval cancelled')
		await awaitDemoFridaySellerApproval(options.signal, async () => options.assertSigningScope?.())
		if (await awaitDemoFridaySellerApproval(options.signal, () => options.nostr.getPublicKey()) !== challenge.sellerActor
			|| await awaitDemoFridaySellerApproval(options.signal, () => options.recipientKey.getPublicKey()) !== challenge.sellerPaymentPublicKey) refuse('seller Nostr or Coco recipient identity differs from the challenge')
		if (options.signal?.aborted) refuse('seller approval cancelled')
	}
	await assertScope()
	const sellerActor = await awaitDemoFridaySellerApproval(options.signal, () => options.nostr.getPublicKey())
	const recipientPublicKey = await awaitDemoFridaySellerApproval(options.signal, () => options.recipientKey.getPublicKey())
	if (sellerActor !== challenge.sellerActor || !COMPRESSED_KEY.test(recipientPublicKey)
		|| recipientPublicKey !== challenge.sellerPaymentPublicKey) {
		refuse('seller Nostr or Coco recipient identity differs from the challenge')
	}
	const intent = {
		schema: 'COCO_DEMO_RECIPIENT_INTENT_V1' as const, network: challenge.authNetworkId,
		chainId: challenge.chainId, auctionId: challenge.auctionId, operationId: challenge.fundingOperationId,
		role: 'winner_settlement' as const, mintUrl: challenge.canonicalMintUrl, unit: 'sat' as const,
		recipientPublicKey, amounts: split(challenge.bidAmount),
	}
	const recipientPlan = await prepareDemoSigAllRecipientOutputs({
		intent, keyset: options.keyset, journal: options.journal,
		roleBinding: {
			async assertWinnerRecipient(binding) {
				if (binding.operationId !== challenge.fundingOperationId || binding.recipientPublicKey !== recipientPublicKey) {
					refuse('winner role binding changed')
				}
			},
			async assertRefundRecipient() { refuse('seller winner plan changed into a refund') },
		},
		signer: { async signCapability(value) {
			await assertScope()
			const signature = await awaitDemoFridaySellerApproval(options.signal, () => options.recipientKey.signRecipientCapability({ ...value, role: 'winner_settlement' }))
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
	const plan: DemoFridaySellerWinnerPlanPublicV1 = {
		schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_V1', authNetworkId: challenge.authNetworkId,
		chainId: challenge.chainId, auctionId: challenge.auctionId, fundingOperationId: challenge.fundingOperationId,
		sellerActor, bidderActor: challenge.bidderActor,
		bidAmount: challenge.bidAmount, canonicalMintUrl: challenge.canonicalMintUrl,
		activeSatKeysetId: challenge.activeSatKeysetId, denominationKeyDigest: challenge.denominationKeyDigest,
		recipientPublicKey, recipientPlan, expiresAt: challenge.expiresAt,
	}
	const planDigest = bytesToHex(sha256(utf8ToBytes(canonical(plan))))
	const unsigned: DemoFridayUnsignedNostrBidV1 = {
		pubkey: sellerActor, created_at: options.nowSeconds, kind: DEMO_FRIDAY_SELLER_WINNER_PLAN_KIND,
		tags: [['t', 'plebeian-friday-seller-plan-v1'], ['a', challenge.auctionId],
			['operation', challenge.fundingOperationId]],
		content: canonical({ schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_AUTHORIZATION_V1', planDigest, plan }),
	}
	await assertScope()
	const signed = await awaitDemoFridaySellerApproval(options.signal, () => options.nostr.signEvent(structuredClone(unsigned)))
	await assertScope()
	return { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_ENVELOPE_V1', planDigest, plan,
		sellerAuthorization: signedExact(signed, unsigned) }
}

function split(amount: number): number[] {
	const values: number[] = []
	for (let bit = 1; bit <= amount; bit *= 2) if ((amount & bit) !== 0) values.push(bit)
	if (values.reduce((sum, value) => sum + value, 0) !== amount) refuse('winner amount cannot be represented safely')
	return values.sort((left, right) => right - left)
}
