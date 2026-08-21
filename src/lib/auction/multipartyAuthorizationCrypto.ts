import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import bs58check from 'bs58check'
import { verifyNostrEventSignature } from '../nostr/event-signature'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	parseMultipartyPayoutCapability,
	parseMultipartyRoot,
	parseMultipartySellerActivation,
	parseMultipartyValidatorAcceptance,
	parseMultipartyValidatorOffer,
	type ParsedMultipartyPayoutCapability,
	type ParsedMultipartyRoot,
	type ParsedMultipartySellerActivation,
	type ParsedMultipartyValidatorAcceptance,
	type ParsedMultipartyValidatorOffer,
} from './multipartyAuthorization'

export const AUCTION_MULTIPARTY_PAYOUT_XPUB_POP_DOMAIN = 'cashu_p2pk_bidder_path_multiparty_v1:payout_xpub_pop:v1'

const MAINNET_XPUB_VERSION = new Uint8Array([0x04, 0x88, 0xb2, 0x1e])
const XPUB_PAYLOAD_BYTES = 78
const XPUB_KEY_DATA_OFFSET = 45
const XPUB_X_ONLY_OFFSET = XPUB_KEY_DATA_OFFSET + 1

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

const utf8Encoder = new TextEncoder()

export class AuctionMultipartyAuthorizationCryptoError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyAuthorizationCryptoError'
		this.code = code
	}
}

const fail = (code: string): never => {
	throw new AuctionMultipartyAuthorizationCryptoError(code)
}

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	const length = parts.reduce((sum, part) => sum + part.length, 0)
	const result = new Uint8Array(length)

	let offset = 0
	for (const part of parts) {
		result.set(part, offset)
		offset += part.length
	}

	return result
}

const hexToBytes = (hex: string, code: string): Uint8Array => {
	if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) {
		fail(code)
	}

	const result = new Uint8Array(hex.length / 2)

	for (let index = 0; index < result.length; index++) {
		result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}

	return result
}

const decodeCanonicalMainnetXpubPayload = (xpub: string): Uint8Array => {
	let payload: Uint8Array

	try {
		payload = bs58check.decode(xpub)
	} catch {
		return fail('crypto_payout_xpub_payload_invalid')
	}

	if (payload.length !== XPUB_PAYLOAD_BYTES) {
		fail('crypto_payout_xpub_payload_invalid')
	}

	if (bs58check.encode(payload) !== xpub) {
		fail('crypto_payout_xpub_payload_noncanonical')
	}

	for (let index = 0; index < MAINNET_XPUB_VERSION.length; index++) {
		if (payload[index] !== MAINNET_XPUB_VERSION[index]) {
			fail('crypto_payout_xpub_version_invalid')
		}
	}

	const keyPrefix = payload[XPUB_KEY_DATA_OFFSET]

	if (keyPrefix !== 0x02 && keyPrefix !== 0x03) {
		fail('crypto_payout_xpub_key_data_invalid')
	}

	return payload
}

const buildPayoutXpubPopParts = (
	recipientPubkey: string,
	payoutXpub: string,
): {
	payload: Uint8Array
	preimage: Uint8Array
	message: Uint8Array
} => {
	if (!HEX64.test(recipientPubkey)) {
		fail('crypto_recipient_pubkey_noncanonical')
	}

	const recipientBytes = hexToBytes(recipientPubkey, 'crypto_recipient_pubkey_noncanonical')

	const payload = decodeCanonicalMainnetXpubPayload(payoutXpub)

	const preimage = concatBytes(utf8Encoder.encode(AUCTION_MULTIPARTY_PAYOUT_XPUB_POP_DOMAIN), new Uint8Array([0]), recipientBytes, payload)

	return {
		payload,
		preimage,
		message: sha256(preimage),
	}
}

export const buildPayoutXpubPopMessage = (recipientPubkey: string, payoutXpub: string): Uint8Array =>
	buildPayoutXpubPopParts(recipientPubkey, payoutXpub).message.slice()

export const verifyPayoutXpubProofOfPossession = (capability: ParsedMultipartyPayoutCapability): void => {
	if (!HEX128.test(capability.payout_xpub_pop)) {
		fail('crypto_payout_xpub_pop_noncanonical')
	}

	const { payload, message } = buildPayoutXpubPopParts(capability.recipient_pubkey, capability.payout_xpub)

	const signature = hexToBytes(capability.payout_xpub_pop, 'crypto_payout_xpub_pop_noncanonical')

	const xOnlyPublicKey = payload.slice(XPUB_X_ONLY_OFFSET, XPUB_PAYLOAD_BYTES)

	let verified = false

	try {
		verified = schnorr.verify(signature, message, xOnlyPublicKey)
	} catch {
		verified = false
	}

	if (!verified) {
		fail('crypto_payout_xpub_pop_invalid')
	}
}

const verifyExactNostrEvent = (event: NostrEventLike): void => {
	const createdAt =
		typeof event.created_at === 'number' && Number.isSafeInteger(event.created_at) && event.created_at >= 0
			? event.created_at
			: fail('crypto_nostr_event_shape_invalid')

	const signature = typeof event.sig === 'string' ? event.sig : fail('crypto_nostr_event_shape_invalid')

	const exactEvent: Parameters<typeof verifyNostrEventSignature>[0] = {
		id: event.id,
		pubkey: event.pubkey,
		kind: event.kind,
		created_at: createdAt,
		content: event.content,
		tags: event.tags,
		sig: signature,
	}

	let verified = false

	try {
		verified = verifyNostrEventSignature(exactEvent)
	} catch {
		verified = false
	}

	if (!verified) {
		fail('crypto_nostr_event_invalid')
	}
}

const AUTHENTICATED_MULTIPARTY_SNAPSHOT: unique symbol = Symbol('auction-multiparty-authenticated-snapshot')

const authenticatedMultipartySnapshots = new WeakSet<object>()

export interface CryptographicallyAuthenticatedMultipartySnapshot<T> {
	readonly [AUTHENTICATED_MULTIPARTY_SNAPSHOT]: true
	readonly event_id: string
	readonly value: T
}

const authenticated = <T>(eventId: string, value: T): CryptographicallyAuthenticatedMultipartySnapshot<T> => {
	const snapshot: CryptographicallyAuthenticatedMultipartySnapshot<T> = {
		[AUTHENTICATED_MULTIPARTY_SNAPSHOT]: true,
		event_id: eventId,
		value,
	}

	authenticatedMultipartySnapshots.add(snapshot)

	return Object.freeze(snapshot)
}

export const isCryptographicallyAuthenticatedMultipartySnapshot = (
	value: unknown,
): value is CryptographicallyAuthenticatedMultipartySnapshot<unknown> =>
	typeof value === 'object' && value !== null && authenticatedMultipartySnapshots.has(value)

export const assertCryptographicallyAuthenticatedMultipartySnapshot = (
	value: unknown,
): asserts value is CryptographicallyAuthenticatedMultipartySnapshot<unknown> => {
	if (!isCryptographicallyAuthenticatedMultipartySnapshot(value)) {
		fail('crypto_authenticated_snapshot_provenance_invalid')
	}
}

export const authenticateMultipartyRoot = (
	event: NostrEventLike,
): CryptographicallyAuthenticatedMultipartySnapshot<ParsedMultipartyRoot> => {
	const parsed = parseMultipartyRoot(event)

	verifyExactNostrEvent(event)

	return authenticated(event.id, parsed)
}

export const authenticateMultipartyPayoutCapability = (
	event: NostrEventLike,
): CryptographicallyAuthenticatedMultipartySnapshot<ParsedMultipartyPayoutCapability> => {
	const parsed = parseMultipartyPayoutCapability(event)

	verifyExactNostrEvent(event)
	verifyPayoutXpubProofOfPossession(parsed)

	return authenticated(event.id, parsed)
}

export const authenticateMultipartyValidatorOffer = (
	event: NostrEventLike,
): CryptographicallyAuthenticatedMultipartySnapshot<ParsedMultipartyValidatorOffer> => {
	const parsed = parseMultipartyValidatorOffer(event)

	verifyExactNostrEvent(event)

	return authenticated(event.id, parsed)
}

export const authenticateMultipartyValidatorAcceptance = (
	event: NostrEventLike,
): CryptographicallyAuthenticatedMultipartySnapshot<ParsedMultipartyValidatorAcceptance> => {
	const parsed = parseMultipartyValidatorAcceptance(event)

	verifyExactNostrEvent(event)

	return authenticated(event.id, parsed)
}

export const authenticateMultipartySellerActivation = (
	event: NostrEventLike,
): CryptographicallyAuthenticatedMultipartySnapshot<ParsedMultipartySellerActivation> => {
	const parsed = parseMultipartySellerActivation(event)

	verifyExactNostrEvent(event)

	return authenticated(event.id, parsed)
}
