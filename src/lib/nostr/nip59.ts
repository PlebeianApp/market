import { finalizeEvent, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import type { Event } from 'nostr-tools'

export const NIP59_SEAL_KIND = 13
export const NIP59_GIFT_WRAP_KIND = 1059

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

export type UnsignedRumor = {
	kind: number
	pubkey: string
	created_at: number
	tags: string[][]
	content: string
	id?: string
}

export type CreateNip59GiftWrapParams = {
	rumor: UnsignedRumor
	senderPrivateKey: Uint8Array
	recipientPubkey: string
	wrapperPrivateKey?: Uint8Array
	createdAt?: number
}

export type UnwrapNip59GiftWrapParams = {
	giftWrap: Event
	recipientPrivateKey: Uint8Array
	expectedRecipientPubkey?: string
	expectedSenderPubkey?: string
}

export type Nip59GiftWrap = {
	rumor: UnsignedRumor
	seal: Event
	giftWrap: Event
}

export type UnwrappedNip59GiftWrap = {
	seal: Event
	rumor: UnsignedRumor
}

export function createNip59GiftWrap(params: CreateNip59GiftWrapParams): Nip59GiftWrap {
	const { rumor, senderPrivateKey, recipientPubkey, createdAt = unixNow() } = params
	assertHexPubkey(recipientPubkey, 'recipient pubkey')
	assertUnsignedRumor(rumor)

	const senderPubkey = getPublicKey(senderPrivateKey)
	if (rumor.pubkey !== senderPubkey) {
		throw new Error('NIP-59 rumor pubkey must match the sender key')
	}

	const seal = finalizeEvent(
		{
			kind: NIP59_SEAL_KIND,
			content: encryptForRecipient(JSON.stringify(rumor), senderPrivateKey, recipientPubkey),
			created_at: createdAt,
			tags: [],
		},
		senderPrivateKey,
	)

	const wrapperPrivateKey = params.wrapperPrivateKey ?? randomPrivateKey()
	const giftWrap = finalizeEvent(
		{
			kind: NIP59_GIFT_WRAP_KIND,
			content: encryptForRecipient(JSON.stringify(seal), wrapperPrivateKey, recipientPubkey),
			created_at: createdAt,
			tags: [['p', recipientPubkey]],
		},
		wrapperPrivateKey,
	)

	return { rumor, seal, giftWrap }
}

export function unwrapNip59GiftWrap(params: UnwrapNip59GiftWrapParams): UnwrappedNip59GiftWrap {
	const recipientPubkey = params.expectedRecipientPubkey ?? getPublicKey(params.recipientPrivateKey)
	assertHexPubkey(recipientPubkey, 'recipient pubkey')
	if (params.expectedSenderPubkey) assertHexPubkey(params.expectedSenderPubkey, 'sender pubkey')

	assertGiftWrap(params.giftWrap, recipientPubkey)

	const seal = parseEventJson(
		decryptFromSender(params.giftWrap.content, params.recipientPrivateKey, params.giftWrap.pubkey, 'NIP-59 gift wrap'),
		'NIP-59 seal',
	)
	assertSeal(seal)

	if (params.expectedSenderPubkey && seal.pubkey !== params.expectedSenderPubkey) {
		throw new Error('NIP-59 seal sender mismatch')
	}

	const rumor = parseUnsignedRumorJson(
		decryptFromSender(seal.content, params.recipientPrivateKey, seal.pubkey, 'NIP-59 seal'),
		'NIP-59 rumor',
	)

	if (seal.pubkey !== rumor.pubkey) {
		throw new Error('NIP-59 seal pubkey does not match rumor pubkey')
	}

	return { seal, rumor }
}

function unixNow(): number {
	return Math.floor(Date.now() / 1000)
}

function randomPrivateKey(): Uint8Array {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return bytes
}

function encryptForRecipient(plaintext: string, senderPrivateKey: Uint8Array, recipientPubkey: string): string {
	const conversationKey = nip44.v2.utils.getConversationKey(senderPrivateKey, recipientPubkey)
	return nip44.v2.encrypt(plaintext, conversationKey)
}

function decryptFromSender(ciphertext: string, recipientPrivateKey: Uint8Array, senderPubkey: string, label: string): string {
	try {
		const conversationKey = nip44.v2.utils.getConversationKey(recipientPrivateKey, senderPubkey)
		return nip44.v2.decrypt(ciphertext, conversationKey)
	} catch {
		throw new Error(`Malformed ${label}`)
	}
}

function parseEventJson(json: string, label: string): Event {
	const parsed = parseRecordJson(json, label)
	assertEvent(parsed, label)
	return parsed
}

function parseUnsignedRumorJson(json: string, label: string): UnsignedRumor {
	const parsed = parseRecordJson(json, label)
	assertUnsignedRumor(parsed)
	return parsed
}

function parseRecordJson(json: string, label: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(json)
		if (!isRecord(parsed)) throw new Error('not an object')
		return parsed
	} catch {
		throw new Error(`Malformed ${label}`)
	}
}

function assertGiftWrap(event: Event, expectedRecipientPubkey: string): void {
	assertEvent(event, 'NIP-59 gift wrap')
	if (event.kind !== NIP59_GIFT_WRAP_KIND) throw new Error('Invalid NIP-59 gift wrap kind')
	if (!verifyEventSignature(event)) throw new Error('Invalid NIP-59 gift wrap signature')
	const recipientTag = event.tags[0]
	if (event.tags.length !== 1 || recipientTag?.[0] !== 'p' || recipientTag[1] !== expectedRecipientPubkey || recipientTag.length !== 2) {
		throw new Error('NIP-59 gift wrap recipient mismatch')
	}
}

function assertSeal(event: Event): void {
	assertEvent(event, 'NIP-59 seal')
	if (event.kind !== NIP59_SEAL_KIND) throw new Error('Invalid NIP-59 seal kind')
	if (event.tags.length !== 0) throw new Error('NIP-59 seal tags must be empty')
	if (!verifyEventSignature(event)) throw new Error('Invalid NIP-59 seal signature')
}

function verifyEventSignature(event: Event): boolean {
	const plainEvent = {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags,
		content: event.content,
		sig: event.sig,
	}
	return verifyEvent(plainEvent)
}

function assertEvent(value: unknown, label: string): asserts value is Event {
	if (!isRecord(value)) throw new Error(`Malformed ${label}`)
	if (typeof value.kind !== 'number') throw new Error(`Malformed ${label}`)
	if (typeof value.content !== 'string') throw new Error(`Malformed ${label}`)
	if (typeof value.created_at !== 'number') throw new Error(`Malformed ${label}`)
	if (typeof value.pubkey !== 'string' || !HEX_PUBKEY_RE.test(value.pubkey)) throw new Error(`Malformed ${label}`)
	if (typeof value.id !== 'string') throw new Error(`Malformed ${label}`)
	if (typeof value.sig !== 'string') throw new Error(`Malformed ${label}`)
	if (!Array.isArray(value.tags) || !value.tags.every(isStringTag)) throw new Error(`Malformed ${label}`)
}

function assertUnsignedRumor(value: unknown): asserts value is UnsignedRumor {
	if (!isRecord(value)) throw new Error('Malformed NIP-59 rumor')
	if ('sig' in value) throw new Error('NIP-59 rumor must be unsigned')
	if (typeof value.kind !== 'number') throw new Error('Malformed NIP-59 rumor')
	if (typeof value.content !== 'string') throw new Error('Malformed NIP-59 rumor')
	if (typeof value.created_at !== 'number') throw new Error('Malformed NIP-59 rumor')
	if (typeof value.pubkey !== 'string' || !HEX_PUBKEY_RE.test(value.pubkey)) throw new Error('Malformed NIP-59 rumor')
	if (!Array.isArray(value.tags) || !value.tags.every(isStringTag)) throw new Error('Malformed NIP-59 rumor')
	if ('id' in value && typeof value.id !== 'string') throw new Error('Malformed NIP-59 rumor')
}

function assertHexPubkey(value: string, label: string): void {
	if (!HEX_PUBKEY_RE.test(value)) throw new Error(`Invalid ${label}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringTag(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
