import { NDKUser, type NDKSigner } from '@nostr-dev-kit/ndk'
import { finalizeEvent, getEventHash, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
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

export type CreateNip59GiftWrapWithSignerParams = {
	rumor: UnsignedRumor
	signer: NDKSigner | null | undefined
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

export type UnwrapNip59GiftWrapWithSignerParams = {
	giftWrap: Event
	signer: NDKSigner | null | undefined
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

export type Nip44SignerOperation = 'encrypt' | 'decrypt'

export function createNip59GiftWrap(params: CreateNip59GiftWrapParams): Nip59GiftWrap {
	const { rumor, senderPrivateKey, recipientPubkey, createdAt = unixNow() } = params
	assertHexPubkey(recipientPubkey, 'recipient pubkey')
	const normalizedRumor = normalizeUnsignedRumorId(rumor)

	const senderPubkey = getPublicKey(senderPrivateKey)
	if (normalizedRumor.pubkey !== senderPubkey) {
		throw new Error('NIP-59 rumor pubkey must match the sender key')
	}

	const seal = finalizeEvent(
		{
			kind: NIP59_SEAL_KIND,
			content: encryptForRecipient(JSON.stringify(normalizedRumor), senderPrivateKey, recipientPubkey),
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

	return { rumor: normalizedRumor, seal, giftWrap }
}

export async function createNip59GiftWrapWithSigner(params: CreateNip59GiftWrapWithSignerParams): Promise<Nip59GiftWrap> {
	const { rumor, recipientPubkey, createdAt = unixNow() } = params
	assertHexPubkey(recipientPubkey, 'recipient pubkey')
	const signer = await assertSignerSupportsNip44(params.signer, 'encrypt')
	const normalizedRumor = normalizeUnsignedRumorId(rumor)
	const signerPubkey = await signerPubkeyFor(signer)

	if (normalizedRumor.pubkey !== signerPubkey) {
		throw new Error('NIP-59 rumor pubkey must match the signer pubkey')
	}

	const sealContent = await encryptForRecipientWithSigner(JSON.stringify(normalizedRumor), signer, recipientPubkey, 'NIP-59 seal')
	const seal = await signEventWithSigner(
		{
			kind: NIP59_SEAL_KIND,
			content: sealContent,
			created_at: createdAt,
			tags: [],
			pubkey: signerPubkey,
		},
		signer,
		'NIP-59 seal',
	)
	assertSeal(seal)

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

	return { rumor: normalizedRumor, seal, giftWrap }
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

export async function unwrapNip59GiftWrapWithSigner(params: UnwrapNip59GiftWrapWithSignerParams): Promise<UnwrappedNip59GiftWrap> {
	const signer = await assertSignerSupportsNip44(params.signer, 'decrypt')
	const signerPubkey = await signerPubkeyFor(signer)
	const recipientPubkey = params.expectedRecipientPubkey ?? signerPubkey
	assertHexPubkey(recipientPubkey, 'recipient pubkey')
	if (signerPubkey !== recipientPubkey) throw new Error('NIP-59 recipient signer mismatch')
	if (params.expectedSenderPubkey) assertHexPubkey(params.expectedSenderPubkey, 'sender pubkey')

	assertGiftWrap(params.giftWrap, recipientPubkey)

	const seal = parseEventJson(
		await decryptFromSenderWithSigner(params.giftWrap.content, signer, params.giftWrap.pubkey, 'NIP-59 gift wrap'),
		'NIP-59 seal',
	)
	assertSeal(seal)

	if (params.expectedSenderPubkey && seal.pubkey !== params.expectedSenderPubkey) {
		throw new Error('NIP-59 seal sender mismatch')
	}

	const rumor = parseUnsignedRumorJson(await decryptFromSenderWithSigner(seal.content, signer, seal.pubkey, 'NIP-59 seal'), 'NIP-59 rumor')

	if (seal.pubkey !== rumor.pubkey) {
		throw new Error('NIP-59 seal pubkey does not match rumor pubkey')
	}

	return { seal, rumor }
}

export function normalizeUnsignedRumorId(rumor: unknown): UnsignedRumor {
	assertUnsignedRumor(rumor)
	const canonicalId = getEventHash({
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		kind: rumor.kind,
		tags: rumor.tags,
		content: rumor.content,
	})

	if (rumor.id && rumor.id !== canonicalId) {
		throw new Error('NIP-59 rumor id is invalid')
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

export async function signerSupportsNip44(signer: NDKSigner | null | undefined, operation: Nip44SignerOperation): Promise<boolean> {
	if (!signer) return false
	if (typeof signer.encryptionEnabled !== 'function') return false
	if (operation === 'encrypt' && typeof signer.encrypt !== 'function') return false
	if (operation === 'decrypt' && typeof signer.decrypt !== 'function') return false

	try {
		const enabled = await signer.encryptionEnabled('nip44')
		return enabled.includes('nip44')
	} catch {
		return false
	}
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

async function assertSignerSupportsNip44(signer: NDKSigner | null | undefined, operation: Nip44SignerOperation): Promise<NDKSigner> {
	if (!signer) {
		throw new Error(`Signer does not support NIP-44 ${operation}`)
	}
	if (!(await signerSupportsNip44(signer, operation))) {
		throw new Error(`Signer does not support NIP-44 ${operation}`)
	}
	return signer
}

async function signerPubkeyFor(signer: NDKSigner): Promise<string> {
	const user = await signer.user()
	const pubkey = user.pubkey
	assertHexPubkey(pubkey, 'signer pubkey')
	return pubkey
}

async function encryptForRecipientWithSigner(
	plaintext: string,
	signer: NDKSigner,
	recipientPubkey: string,
	label: string,
): Promise<string> {
	try {
		return await signer.encrypt(new NDKUser({ pubkey: recipientPubkey }), plaintext, 'nip44')
	} catch {
		throw new Error(`NIP-44 encryption failed for ${label}`)
	}
}

async function decryptFromSenderWithSigner(ciphertext: string, signer: NDKSigner, senderPubkey: string, label: string): Promise<string> {
	try {
		return await signer.decrypt(new NDKUser({ pubkey: senderPubkey }), ciphertext, 'nip44')
	} catch {
		throw new Error(`NIP-44 decryption failed for ${label}`)
	}
}

type SignableEvent = {
	kind: number
	content: string
	created_at: number
	tags: string[][]
	pubkey: string
}

async function signEventWithSigner(signableEvent: SignableEvent, signer: NDKSigner, label: string): Promise<Event> {
	if (typeof signer.sign !== 'function') {
		throw new Error(`Signer does not support signing ${label}`)
	}

	let sig: string
	try {
		sig = await signer.sign(signableEvent as Parameters<NDKSigner['sign']>[0])
	} catch {
		throw new Error(`Failed to sign ${label}`)
	}

	const event = {
		...signableEvent,
		id: getEventHash(signableEvent),
		sig,
	}
	assertEvent(event, label)
	if (!verifyEventSignature(event)) throw new Error(`Invalid ${label} signature`)
	return event
}

function parseEventJson(json: string, label: string): Event {
	const parsed = parseRecordJson(json, label)
	assertEvent(parsed, label)
	return parsed
}

function parseUnsignedRumorJson(json: string, label: string): UnsignedRumor {
	const parsed = parseRecordJson(json, label)
	return normalizeUnsignedRumorId(parsed)
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
