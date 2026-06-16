import type { NDKSigner } from '@nostr-dev-kit/ndk'
import type { Event } from 'nostr-tools'
import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import {
	createNip59GiftWrap,
	createNip59GiftWrapWithSigner,
	unwrapNip59GiftWrap,
	unwrapNip59GiftWrapWithSigner,
	type Nip59GiftWrap,
	type UnsignedRumor,
	type UnwrappedNip59GiftWrap,
} from '@/lib/nostr/nip59'

export const AUCTION_CLAIM_SUBJECT = 'auction-claim'
export const AUCTION_EVENT_KIND = 30408

const HEX_32_BYTES_RE = /^[0-9a-f]{64}$/i

export type AuctionClaimDeliveryDetails = {
	name: string
	firstLineOfAddress: string
	city: string
	zipPostcode: string
	country: string
	additionalInformation?: string
}

export type PrivateAuctionClaimPayload = {
	type: typeof AUCTION_CLAIM_SUBJECT
	orderId: string
	auctionCoordinates: string
	auctionEventId: string
	settlementEventId: string
	buyerPubkey: string
	sellerPubkey: string
	totalAmountSats: number
	shippingAddress: AuctionClaimDeliveryDetails
	email?: string
	phone?: string
	notes?: string
}

export type AuctionClaimMessageFields = {
	orderId: string
	auctionCoordinates: string
	auctionEventId: string
	settlementEventId: string
	buyerPubkey: string
	sellerPubkey: string
	totalAmountSats: number
	shippingAddress: AuctionClaimDeliveryDetails
	email?: string
	phone?: string
	notes?: string
	createdAt?: number
}

export type CreatePrivateAuctionClaimMessageParams = AuctionClaimMessageFields & {
	senderPrivateKey: Uint8Array
	wrapperPrivateKey?: Uint8Array
}

export type CreatePrivateAuctionClaimMessageWithSignerParams = AuctionClaimMessageFields & {
	signer: NDKSigner | null | undefined
	wrapperPrivateKey?: Uint8Array
}

export type PrivateAuctionClaimGiftWrap = Nip59GiftWrap & {
	payload: PrivateAuctionClaimPayload
}

export type PrivateAuctionClaimMessage = {
	payload: PrivateAuctionClaimPayload
	rumor: UnsignedRumor
}

export type ParsePrivateAuctionClaimRumorOptions = {
	expectedBuyerPubkey?: string
	expectedSellerPubkey?: string
	expectedOrderId?: string
}

export type DecryptPrivateAuctionClaimMessageParams = ParsePrivateAuctionClaimRumorOptions & {
	giftWrap: Event
	recipientPrivateKey: Uint8Array
}

export type DecryptPrivateAuctionClaimMessageWithSignerParams = ParsePrivateAuctionClaimRumorOptions & {
	giftWrap: Event
	signer: NDKSigner | null | undefined
}

export function createPrivateAuctionClaimMessage(params: CreatePrivateAuctionClaimMessageParams): PrivateAuctionClaimGiftWrap {
	const payload = buildPrivateAuctionClaimPayload(params)
	const rumor = buildPrivateAuctionClaimRumor(payload, params.createdAt)

	return {
		...createNip59GiftWrap({
			rumor,
			senderPrivateKey: params.senderPrivateKey,
			recipientPubkey: payload.sellerPubkey,
			wrapperPrivateKey: params.wrapperPrivateKey,
			createdAt: params.createdAt,
		}),
		payload,
	}
}

export async function createPrivateAuctionClaimMessageWithSigner(
	params: CreatePrivateAuctionClaimMessageWithSignerParams,
): Promise<PrivateAuctionClaimGiftWrap> {
	const payload = buildPrivateAuctionClaimPayload(params)
	const rumor = buildPrivateAuctionClaimRumor(payload, params.createdAt)

	return {
		...(await createNip59GiftWrapWithSigner({
			rumor,
			signer: params.signer,
			recipientPubkey: payload.sellerPubkey,
			wrapperPrivateKey: params.wrapperPrivateKey,
			createdAt: params.createdAt,
		})),
		payload,
	}
}

export function decryptPrivateAuctionClaimMessage(params: DecryptPrivateAuctionClaimMessageParams): PrivateAuctionClaimMessage {
	const unwrapped = unwrapNip59GiftWrap({
		giftWrap: params.giftWrap,
		recipientPrivateKey: params.recipientPrivateKey,
		expectedRecipientPubkey: params.expectedSellerPubkey,
		expectedSenderPubkey: params.expectedBuyerPubkey,
	})

	return parseUnwrappedAuctionClaim(unwrapped, params)
}

export async function decryptPrivateAuctionClaimMessageWithSigner(
	params: DecryptPrivateAuctionClaimMessageWithSignerParams,
): Promise<PrivateAuctionClaimMessage> {
	const unwrapped = await unwrapNip59GiftWrapWithSigner({
		giftWrap: params.giftWrap,
		signer: params.signer,
		expectedRecipientPubkey: params.expectedSellerPubkey,
		expectedSenderPubkey: params.expectedBuyerPubkey,
	})

	return parseUnwrappedAuctionClaim(unwrapped, params)
}

export function parsePrivateAuctionClaimRumor(
	rumor: UnsignedRumor,
	options: ParsePrivateAuctionClaimRumorOptions = {},
): PrivateAuctionClaimMessage {
	if (rumor.kind !== ORDER_PROCESS_KIND) throw new Error('Invalid auction claim rumor kind')
	const payload = parsePrivateAuctionClaimPayload(rumor.content)
	assertExpectedValue(payload.buyerPubkey, options.expectedBuyerPubkey, 'buyer pubkey')
	assertExpectedValue(payload.sellerPubkey, options.expectedSellerPubkey, 'seller pubkey')
	assertExpectedValue(payload.orderId, options.expectedOrderId, 'order id')

	if (rumor.pubkey !== payload.buyerPubkey) {
		throw new Error('Auction claim rumor pubkey does not match buyer pubkey')
	}

	const expectedTags = buildAuctionClaimPublicMarkerTags(payload)
	for (const expectedTag of expectedTags) {
		if (!rumor.tags.some((tag) => tagsEqual(tag, expectedTag))) {
			throw new Error(`Auction claim rumor missing ${expectedTag[0]} tag`)
		}
	}

	return { payload, rumor }
}

export function buildAuctionClaimPublicMarkerTags(fields: AuctionClaimMessageFields): string[][] {
	const payload = buildPrivateAuctionClaimPayload(fields)
	return [
		['p', payload.sellerPubkey],
		['subject', AUCTION_CLAIM_SUBJECT],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', payload.orderId],
		['amount', String(payload.totalAmountSats)],
		['a', payload.auctionCoordinates],
		['e', payload.auctionEventId],
		['e', payload.settlementEventId, '', 'settlement'],
	]
}

export function buildPrivateAuctionClaimPayload(fields: AuctionClaimMessageFields): PrivateAuctionClaimPayload {
	assertNonEmptyString(fields.orderId, 'order id')
	assertHex32Bytes(fields.buyerPubkey, 'buyer pubkey')
	assertHex32Bytes(fields.sellerPubkey, 'seller pubkey')
	assertHex32Bytes(fields.auctionEventId, 'auction event id')
	assertHex32Bytes(fields.settlementEventId, 'settlement event id')
	assertPositiveSafeInteger(fields.totalAmountSats, 'total amount sats')

	const coordinate = parseAuctionCoordinate(fields.auctionCoordinates)
	if (coordinate.sellerPubkey !== fields.sellerPubkey) {
		throw new Error('Auction coordinate seller pubkey does not match seller pubkey')
	}

	return {
		type: AUCTION_CLAIM_SUBJECT,
		orderId: fields.orderId,
		auctionCoordinates: fields.auctionCoordinates,
		auctionEventId: fields.auctionEventId,
		settlementEventId: fields.settlementEventId,
		buyerPubkey: fields.buyerPubkey,
		sellerPubkey: fields.sellerPubkey,
		totalAmountSats: fields.totalAmountSats,
		shippingAddress: normalizeShippingAddress(fields.shippingAddress),
		...optionalStringField('email', fields.email),
		...optionalStringField('phone', fields.phone),
		...optionalStringField('notes', fields.notes),
	}
}

export function parseAuctionCoordinate(coordinate: string): { kind: typeof AUCTION_EVENT_KIND; sellerPubkey: string; dTag: string } {
	assertNonEmptyString(coordinate, 'auction coordinate')
	const parts = coordinate.split(':')
	if (parts.length < 3 || parts[0] !== String(AUCTION_EVENT_KIND)) {
		throw new Error('Invalid auction coordinate')
	}

	const sellerPubkey = parts[1]
	assertHex32Bytes(sellerPubkey, 'auction coordinate seller pubkey')
	const dTag = parts.slice(2).join(':')
	assertNonEmptyString(dTag, 'auction coordinate d tag')

	return { kind: AUCTION_EVENT_KIND, sellerPubkey, dTag }
}

function buildPrivateAuctionClaimRumor(payload: PrivateAuctionClaimPayload, createdAt = unixNow()): UnsignedRumor {
	return {
		kind: ORDER_PROCESS_KIND,
		pubkey: payload.buyerPubkey,
		created_at: createdAt,
		tags: buildAuctionClaimPublicMarkerTags(payload),
		content: JSON.stringify(payload),
	}
}

function parseUnwrappedAuctionClaim(
	unwrapped: UnwrappedNip59GiftWrap,
	options: ParsePrivateAuctionClaimRumorOptions,
): PrivateAuctionClaimMessage {
	return parsePrivateAuctionClaimRumor(unwrapped.rumor, options)
}

function parsePrivateAuctionClaimPayload(content: string): PrivateAuctionClaimPayload {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		throw new Error('Malformed auction claim payload')
	}
	if (!isRecord(parsed)) throw new Error('Malformed auction claim payload')
	if (parsed.type !== AUCTION_CLAIM_SUBJECT) throw new Error('Invalid auction claim payload type')

	const payload = buildPrivateAuctionClaimPayload({
		orderId: stringValue(parsed.orderId, 'order id'),
		auctionCoordinates: stringValue(parsed.auctionCoordinates, 'auction coordinate'),
		auctionEventId: stringValue(parsed.auctionEventId, 'auction event id'),
		settlementEventId: stringValue(parsed.settlementEventId, 'settlement event id'),
		buyerPubkey: stringValue(parsed.buyerPubkey, 'buyer pubkey'),
		sellerPubkey: stringValue(parsed.sellerPubkey, 'seller pubkey'),
		totalAmountSats: numberValue(parsed.totalAmountSats, 'total amount sats'),
		shippingAddress: shippingAddressValue(parsed.shippingAddress),
		email: optionalStringValue(parsed.email, 'email'),
		phone: optionalStringValue(parsed.phone, 'phone'),
		notes: optionalStringValue(parsed.notes, 'notes'),
	})

	return payload
}

function normalizeShippingAddress(value: AuctionClaimDeliveryDetails): AuctionClaimDeliveryDetails {
	if (!isRecord(value)) throw new Error('Malformed shipping address')
	return {
		name: stringValue(value.name, 'shipping name'),
		firstLineOfAddress: stringValue(value.firstLineOfAddress, 'shipping address'),
		city: stringValue(value.city, 'shipping city'),
		zipPostcode: stringValue(value.zipPostcode, 'shipping postcode'),
		country: stringValue(value.country, 'shipping country'),
		...optionalStringField('additionalInformation', optionalStringValue(value.additionalInformation, 'shipping additional information')),
	}
}

function shippingAddressValue(value: unknown): AuctionClaimDeliveryDetails {
	if (!isRecord(value)) throw new Error('Malformed shipping address')
	return normalizeShippingAddress(value as AuctionClaimDeliveryDetails)
}

function optionalStringField<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
	return value === undefined ? {} : ({ [key]: value } as { [P in K]?: string })
}

function optionalStringValue(value: unknown, label: string): string | undefined {
	if (value === undefined) return undefined
	if (typeof value !== 'string') throw new Error(`Invalid ${label}`)
	return value
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new Error(`Invalid ${label}`)
	return value
}

function numberValue(value: unknown, label: string): number {
	if (typeof value !== 'number') throw new Error(`Invalid ${label}`)
	return value
}

function assertNonEmptyString(value: string, label: string): void {
	if (!value.trim()) throw new Error(`Invalid ${label}`)
}

function assertHex32Bytes(value: string, label: string): void {
	if (!HEX_32_BYTES_RE.test(value)) throw new Error(`Invalid ${label}`)
}

function assertPositiveSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`)
}

function assertExpectedValue(actual: string, expected: string | undefined, label: string): void {
	if (expected !== undefined && actual !== expected) throw new Error(`Auction claim ${label} mismatch`)
}

function tagsEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index])
}

function unixNow(): number {
	return Math.floor(Date.now() / 1000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
