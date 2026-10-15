import { finalizeEvent, getEventHash, getPublicKey, nip44 } from 'nostr-tools'
import type { Event, UnsignedEvent } from 'nostr-tools'
import { giftWrapSeal, unwrapDm, wrapDm } from '../../core/dm/ts/index.ts'
import type { DmSigner } from '../../core/dm/ts/index.ts'
import type { EncryptingSigner } from '../../core/ports/encryptingSigner'

const GAMMA_ORDER_KIND = 16
const GAMMA_ORDER_CREATION_TYPE = '1'
const GAMMA_ORDER_SUBJECT = 'order-info'
const PRODUCT_REF_KIND = '30402'
const SHIPPING_REF_KIND = '30406'
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

/** The unsigned NIP-59 rumor shape this module builds and reads (its `id` is canonical). */
type UnsignedRumor = {
	kind: number
	pubkey: string
	created_at: number
	tags: string[][]
	content: string
	id?: string
}

export type PrivateOrderAddress = {
	firstLineOfAddress?: string
	additionalInformation?: string
	city?: string
	zipPostcode?: string
	country?: string
}

export type PrivateOrderDeliveryDetails = {
	orderId: string
	buyerPubkey: string
	sellerPubkey: string
	totalAmountSats: number
	shippingRef?: string
	items: Array<{ productRef: string; quantity: number }>
	delivery: {
		name?: string
		email?: string
		phone?: string
		address?: PrivateOrderAddress
	}
	orderNotes?: string
}

export type CreatePrivateOrderDetailsRumorParams = {
	details: PrivateOrderDeliveryDetails
	createdAt?: number
}

export type CreateEncryptedPrivateOrderMessageParams = CreatePrivateOrderDetailsRumorParams & {
	buyerPrivateKey: Uint8Array
	wrapperPrivateKey?: Uint8Array
}

export type CreateEncryptedPrivateOrderMessageWithSignerParams = CreatePrivateOrderDetailsRumorParams & {
	signer: EncryptingSigner | null | undefined
	wrapperPrivateKey?: Uint8Array
}

export type DecryptPrivateOrderMessageParams = {
	giftWrap: Event
	sellerPrivateKey: Uint8Array
	expectedSellerPubkey?: string
	expectedBuyerPubkey?: string
}

export type DecryptPrivateOrderMessageWithSignerParams = {
	giftWrap: Event
	signer: EncryptingSigner | null | undefined
	expectedSellerPubkey?: string
	expectedBuyerPubkey?: string
}

export type DecryptedPrivateOrderMessage = {
	seal: Event
	rumor: UnsignedRumor
	details: PrivateOrderDeliveryDetails
}

export function createPrivateOrderDetailsRumor(params: CreatePrivateOrderDetailsRumorParams): UnsignedRumor & { id: string } {
	const { details, createdAt = unixNow() } = params
	validatePrivateOrderDetails(details)

	const tags: string[][] = [
		['p', details.sellerPubkey],
		['subject', GAMMA_ORDER_SUBJECT],
		['type', GAMMA_ORDER_CREATION_TYPE],
		['order', details.orderId],
		['amount', String(details.totalAmountSats)],
	]

	for (const item of details.items) {
		tags.push(['item', item.productRef, String(item.quantity)])
	}

	if (details.shippingRef) tags.push(['shipping', details.shippingRef])

	const buyerName = normalizeOptionalText(details.delivery.name)
	if (buyerName) tags.push(['name', buyerName])

	const addressString = serializeBuyerAddress(details.delivery.address)
	if (addressString) tags.push(['address', addressString])

	const buyerEmail = normalizeOptionalText(details.delivery.email)
	if (buyerEmail) tags.push(['email', buyerEmail])

	const buyerPhone = normalizeOptionalText(details.delivery.phone)
	if (buyerPhone) tags.push(['phone', buyerPhone])

	return normalizeUnsignedRumorId({
		kind: GAMMA_ORDER_KIND,
		pubkey: details.buyerPubkey,
		created_at: createdAt,
		tags,
		content: details.orderNotes ?? '',
	})
}

export async function createEncryptedPrivateOrderMessage(
	params: CreateEncryptedPrivateOrderMessageParams,
): Promise<DecryptedPrivateOrderMessage & { giftWrap: Event }> {
	const buyerPubkey = getPublicKey(params.buyerPrivateKey)
	if (buyerPubkey !== params.details.buyerPubkey) {
		throw new Error('Private order buyer key does not match buyer pubkey')
	}

	const rumor = createPrivateOrderDetailsRumor({ details: params.details, createdAt: params.createdAt })
	// The gift wrap is the dm component's — the library's `sealRumor` + `wrapSeal` over a private-key signer.
	const wraps = await wrapDm({ rumor, recipientPubkey: params.details.sellerPubkey, signer: signerFromPrivateKey(params.buyerPrivateKey) })
	const seal = giftWrapSeal(wraps.recipient)
	if (!seal) throw new Error('Private order gift wrap has no seal')

	return {
		rumor: wraps.rumor,
		seal,
		giftWrap: wraps.recipient,
		details: params.details,
	}
}

export async function createEncryptedPrivateOrderMessageWithSigner(
	params: CreateEncryptedPrivateOrderMessageWithSignerParams,
): Promise<DecryptedPrivateOrderMessage & { giftWrap: Event }> {
	const rumor = createPrivateOrderDetailsRumor({ details: params.details, createdAt: params.createdAt })
	const signer = params.signer
	if (!signer) throw new Error('Signer pubkey unavailable')
	const wraps = await wrapDm({ rumor, recipientPubkey: params.details.sellerPubkey, signer })
	const seal = giftWrapSeal(wraps.recipient)
	if (!seal) throw new Error('Private order gift wrap has no seal')

	return {
		rumor: wraps.rumor,
		seal,
		giftWrap: wraps.recipient,
		details: params.details,
	}
}

export async function decryptPrivateOrderMessage(params: DecryptPrivateOrderMessageParams): Promise<DecryptedPrivateOrderMessage> {
	const sellerPubkey = params.expectedSellerPubkey ?? getPublicKey(params.sellerPrivateKey)
	// The NIP-59 unwrap is the dm component's — the library's `unlockGiftWrap` over a private-key signer.
	const { seal, rumor } = await unwrapDm({ giftWrap: params.giftWrap, signer: signerFromPrivateKey(params.sellerPrivateKey) })

	const details = parsePrivateOrderDetailsRumor(rumor, {
		expectedSellerPubkey: sellerPubkey,
		expectedBuyerPubkey: params.expectedBuyerPubkey,
	})

	return { seal, rumor, details }
}

export async function decryptPrivateOrderMessageWithSigner(
	params: DecryptPrivateOrderMessageWithSignerParams,
): Promise<DecryptedPrivateOrderMessage> {
	const signer = params.signer
	if (!signer) throw new Error('Signer pubkey unavailable')
	const { seal, rumor } = await unwrapDm({ giftWrap: params.giftWrap, signer })

	const details = parsePrivateOrderDetailsRumor(rumor, {
		expectedSellerPubkey: params.expectedSellerPubkey,
		expectedBuyerPubkey: params.expectedBuyerPubkey,
	})

	return { seal, rumor, details }
}

export function parsePrivateOrderDetailsRumor(
	rumor: UnsignedRumor,
	expected?: { expectedSellerPubkey?: string; expectedBuyerPubkey?: string },
): PrivateOrderDeliveryDetails {
	assertUnsignedPrivateOrderRumor(rumor)
	const normalizedRumor = normalizeUnsignedRumorId(rumor)
	assertUnsignedPrivateOrderRumor(normalizedRumor)
	const buyerPubkey = normalizedRumor.pubkey
	if (expected?.expectedBuyerPubkey && buyerPubkey !== expected.expectedBuyerPubkey) {
		throw new Error('Private order buyer pubkey mismatch')
	}

	const sellerPubkey = getSingleTagValue(normalizedRumor.tags, 'p')
	if (!sellerPubkey || !isHexPubkey(sellerPubkey)) throw new Error('Private order seller pubkey is invalid')
	if (expected?.expectedSellerPubkey && sellerPubkey !== expected.expectedSellerPubkey) {
		throw new Error('Private order seller pubkey mismatch')
	}

	if (getSingleTagValue(normalizedRumor.tags, 'subject') !== GAMMA_ORDER_SUBJECT) throw new Error('Private order subject is invalid')
	if (getSingleTagValue(normalizedRumor.tags, 'type') !== GAMMA_ORDER_CREATION_TYPE) throw new Error('Private order type is invalid')

	const orderId = getSingleTagValue(normalizedRumor.tags, 'order')
	if (!orderId) throw new Error('Private order id is required')

	const amount = getSingleTagValue(normalizedRumor.tags, 'amount')
	if (!amount || !/^\d+$/.test(amount)) throw new Error('Private order amount is invalid')
	const totalAmountSats = Number(amount)
	if (!Number.isSafeInteger(totalAmountSats) || totalAmountSats <= 0) throw new Error('Private order amount is invalid')

	const itemTags = normalizedRumor.tags.filter((tag) => tag[0] === 'item')
	if (itemTags.length === 0) throw new Error('Private order item is required')
	const items = itemTags.map((tag) => {
		const productRef = tag[1]
		const quantityText = tag[2]
		if (!productRef || !isAddressableRef(productRef, PRODUCT_REF_KIND, sellerPubkey)) throw new Error('Private order item ref is invalid')
		if (!quantityText || !/^\d+$/.test(quantityText)) throw new Error('Private order item quantity is invalid')
		const quantity = Number(quantityText)
		if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Private order item quantity is invalid')
		return { productRef, quantity }
	})

	const shippingRef = getSingleTagValue(normalizedRumor.tags, 'shipping')
	if (shippingRef && !isAddressableRef(shippingRef, SHIPPING_REF_KIND, sellerPubkey)) {
		throw new Error('Private order shipping ref is invalid')
	}

	const delivery = {
		name: getSingleTagValue(normalizedRumor.tags, 'name'),
		address: parseBuyerAddress(getSingleTagValue(normalizedRumor.tags, 'address')),
		email: getSingleTagValue(normalizedRumor.tags, 'email'),
		phone: getSingleTagValue(normalizedRumor.tags, 'phone'),
	}

	return {
		orderId,
		buyerPubkey,
		sellerPubkey,
		totalAmountSats,
		shippingRef,
		items,
		delivery,
		orderNotes: normalizedRumor.content,
	}
}

export function serializeBuyerAddress(address: PrivateOrderAddress | undefined): string | undefined {
	if (!address) return undefined
	const fields = [address.firstLineOfAddress, address.additionalInformation, address.city, address.zipPostcode, address.country].map(
		(value) => normalizeOptionalText(value) ?? '',
	)

	if (fields.every((value) => value === '')) return undefined
	return fields.join('\n')
}

function parseBuyerAddress(addressString: string | undefined): PrivateOrderAddress | undefined {
	if (!addressString) return undefined
	const [firstLineOfAddress, additionalInformation, city, zipPostcode, country] = addressString.split('\n')
	return {
		firstLineOfAddress,
		additionalInformation,
		city,
		zipPostcode,
		country,
	}
}

function validatePrivateOrderDetails(details: PrivateOrderDeliveryDetails): void {
	if (!details.orderId.trim()) throw new Error('Private order id is required')
	if (!isHexPubkey(details.buyerPubkey)) throw new Error('Private order buyer pubkey is invalid')
	if (!isHexPubkey(details.sellerPubkey)) throw new Error('Private order seller pubkey is invalid')
	if (!Number.isSafeInteger(details.totalAmountSats) || details.totalAmountSats <= 0) throw new Error('Private order amount is invalid')
	if (details.items.length === 0) throw new Error('Private order item is required')

	for (const item of details.items) {
		if (!isAddressableRef(item.productRef, PRODUCT_REF_KIND, details.sellerPubkey)) throw new Error('Private order item ref is invalid')
		if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('Private order item quantity is invalid')
	}

	if (details.shippingRef && !isAddressableRef(details.shippingRef, SHIPPING_REF_KIND, details.sellerPubkey)) {
		throw new Error('Private order shipping ref is invalid')
	}
}

/**
 * The canonical rumor id. This is the library's own rule (`toRumor` stamps `getEventHash` and strips the
 * signature); it is computed locally so the private-key convenience path does not need a signer to build a rumor.
 */
function normalizeUnsignedRumorId(rumor: UnsignedRumor): UnsignedRumor & { id: string } {
	const canonicalId = getEventHash({
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		kind: rumor.kind,
		tags: rumor.tags,
		content: rumor.content,
	})

	if (rumor.id && rumor.id !== canonicalId) {
		throw new Error('Private order rumor id is invalid')
	}

	return {
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		kind: rumor.kind,
		tags: rumor.tags.map((tag) => [...tag]),
		content: rumor.content,
		id: canonicalId,
	}
}

/**
 * A `DmSigner` over a raw private key — the host seam for the convenience path. It is a port adapter (a bare
 * signature out, NIP-44 through), not NIP-59 logic: the seal, the wrap and the unwrap stay in the dm component.
 */
function signerFromPrivateKey(privateKey: Uint8Array): DmSigner {
	return {
		getPublicKey: async () => getPublicKey(privateKey),
		signEvent: async (event) =>
			finalizeEvent(
				{
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags,
					content: event.content,
					pubkey: event.pubkey,
				} as UnsignedEvent,
				privateKey,
			).sig,
		encrypt: async (recipient, plaintext) => nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(privateKey, recipient)),
		decrypt: async (sender, ciphertext) => nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(privateKey, sender)),
		supportsNip44: async () => true,
	}
}

function assertUnsignedPrivateOrderRumor(rumor: UnsignedRumor): void {
	if ('sig' in rumor) throw new Error('Private order rumor must be unsigned')
	if (rumor.kind !== GAMMA_ORDER_KIND) throw new Error('Private order kind is invalid')
	if (!isHexPubkey(rumor.pubkey)) throw new Error('Private order buyer pubkey is invalid')
}

function getSingleTagValue(tags: string[][], tagName: string): string | undefined {
	const matches = tags.filter((tag) => tag[0] === tagName)
	if (matches.length > 1) throw new Error(`Private order ${tagName} tag is duplicated`)
	return matches[0]?.[1]
}

function isAddressableRef(value: string, expectedKind: string, expectedPubkey: string): boolean {
	if (value.includes('\n') || value.includes('\r')) return false
	const [kind, pubkey, ...dTagParts] = value.split(':')
	const dTag = dTagParts.join(':')
	return kind === expectedKind && pubkey === expectedPubkey && dTag.length > 0
}

function isHexPubkey(value: string): boolean {
	return HEX_PUBKEY_RE.test(value)
}

function normalizeOptionalText(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed : undefined
}

function unixNow(): number {
	return Math.floor(Date.now() / 1000)
}
