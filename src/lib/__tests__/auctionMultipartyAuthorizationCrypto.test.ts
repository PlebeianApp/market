import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlnopad } from '@scure/base'
import { HDKey } from '@scure/bip32'
import bs58check from 'bs58check'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	AUCTION_MULTIPARTY_ACTIVATION_KIND,
	AUCTION_MULTIPARTY_ENTITLEMENT_BASIS,
	AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND,
	AUCTION_MULTIPARTY_ROOT_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT,
} from '../auction/multipartyAuthorization'
import {
	AUCTION_MULTIPARTY_PAYOUT_XPUB_POP_DOMAIN,
	AuctionMultipartyAuthorizationCryptoError,
	assertCryptographicallyAuthenticatedMultipartySnapshot,
	authenticateMultipartyPayoutCapability,
	isCryptographicallyAuthenticatedMultipartySnapshot,
	authenticateMultipartyRoot,
	authenticateMultipartySellerActivation,
	authenticateMultipartyValidatorAcceptance,
	authenticateMultipartyValidatorOffer,
	buildPayoutXpubPopMessage,
} from '../auction/multipartyAuthorizationCrypto'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY, compileSourceSchedule } from '../auction/multipartySchedule'

const CREATED_AT = 1_800_000_000
const START_AT = CREATED_AT + 100
const MAX_END_AT = CREATED_AT + 3_600
const MINT = 'https://mint-a.example'

const fixedSecret = (lastByte: number): Uint8Array => {
	const secret = new Uint8Array(32)
	secret[31] = lastByte
	return secret
}

const SELLER_NOSTR_SK = fixedSecret(1)
const VALIDATOR_NOSTR_SK = fixedSecret(2)
const V4V_NOSTR_SK = fixedSecret(3)

const SELLER = getPublicKey(SELLER_NOSTR_SK)
const VALIDATOR = getPublicKey(VALIDATOR_NOSTR_SK)
const V4V = getPublicKey(V4V_NOSTR_SK)

const payoutNode = (fill: number): HDKey => HDKey.fromMasterSeed(new Uint8Array(32).fill(fill))

const SELLER_PAYOUT = payoutNode(0x11)
const VALIDATOR_PAYOUT = payoutNode(0x22)
const V4V_PAYOUT = payoutNode(0x33)
const WRONG_PAYOUT = payoutNode(0x44)

const requirePrivateKey = (node: HDKey): Uint8Array => {
	const privateKey = node.privateKey

	if (!privateKey) {
		throw new Error('test fixture unexpectedly lacks private key')
	}

	return privateKey
}

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const hexToBytes = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2)

	for (let index = 0; index < bytes.length; index++) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}

	return bytes
}

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))

	let offset = 0

	for (const part of parts) {
		result.set(part, offset)
		offset += part.length
	}

	return result
}

const independentPopPreimage = (recipientPubkey: string, xpub: string): Uint8Array =>
	concatBytes(
		new TextEncoder().encode('cashu_p2pk_bidder_path_multiparty_v1:payout_xpub_pop:v1'),
		new Uint8Array([0]),
		hexToBytes(recipientPubkey),
		bs58check.decode(xpub),
	)

const signEvent = (secretKey: Uint8Array, kind: number, tags: string[][], content = ''): NostrEventLike =>
	finalizeEvent(
		{
			kind,
			created_at: CREATED_AT,
			tags,
			content,
		},
		secretKey,
	)

const signPop = (recipientPubkey: string, xpub: string, privateKey: Uint8Array, options: { hashPreimage?: boolean } = {}): string => {
	const preimage = independentPopPreimage(recipientPubkey, xpub)
	const message = options.hashPreimage === false ? preimage : sha256(preimage)

	return bytesToHex(schnorr.sign(message, privateKey, new Uint8Array(32)))
}

const capabilityTags = (xpub: string, pop: string): string[][] => [
	['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
	['payout_xpub', xpub],
	['payout_xpub_pop', pop],
	['mint', MINT],
	['valid_from', String(START_AT - 10)],
	['expires_at', String(MAX_END_AT + 10)],
]

const makeCapability = (
	authorSecret: Uint8Array,
	node: HDKey,
	options: {
		xpub?: string
		pop?: string
		popPrivateKey?: Uint8Array
		popRecipientPubkey?: string
		hashPreimage?: boolean
	} = {},
): NostrEventLike => {
	const recipient = getPublicKey(authorSecret)
	const xpub = options.xpub ?? node.publicExtendedKey

	const pop =
		options.pop ??
		signPop(options.popRecipientPubkey ?? recipient, xpub, options.popPrivateKey ?? requirePrivateKey(node), {
			hashPreimage: options.hashPreimage,
		})

	return signEvent(authorSecret, AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND, capabilityTags(xpub, pop))
}

const buildSignedBundle = () => {
	const validatorCapability = makeCapability(VALIDATOR_NOSTR_SK, VALIDATOR_PAYOUT)

	const v4vCapability = makeCapability(V4V_NOSTR_SK, V4V_PAYOUT)

	const offer = signEvent(VALIDATOR_NOSTR_SK, AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND, [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_capability', validatorCapability.id],
		['allocation_bps', '625'],
		['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
		['service_contract', AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT],
		['mint', MINT],
		['valid_from', String(START_AT - 10)],
		['expires_at', String(MAX_END_AT + 10)],
	])

	const schedule = compileSourceSchedule([
		{
			role: 'validator',
			recipient_pubkey: VALIDATOR,
			payout_capability_event_id: validatorCapability.id,
			allocation_bps: 625,
			validator_offer_event_id: offer.id,
		},
		{
			role: 'v4v',
			recipient_pubkey: V4V,
			payout_capability_event_id: v4vCapability.id,
			allocation_bps: 313,
		},
	])

	const root = signEvent(
		SELLER_NOSTR_SK,
		AUCTION_MULTIPARTY_ROOT_KIND,
		[
			['d', 'c2-demo'],
			['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
			['payout_schedule_commitment', schedule.schedule_commitment],
			['payout_schedule', `b64u:${base64urlnopad.encode(schedule.canonical_bytes)}`],
			['start_at', String(START_AT)],
			['max_end_at', String(MAX_END_AT)],
			['p2pk_xpub', SELLER_PAYOUT.publicExtendedKey],
			['mint', MINT],
			['auditors', VALIDATOR],
			['auditor_quorum', '1'],
			['title', 'C2 cryptographic demo'],
		],
		'auction display content',
	)

	const coordinate = `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:c2-demo`

	const acceptance = signEvent(VALIDATOR_NOSTR_SK, AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND, [
		['e', root.id],
		['a', coordinate],
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_schedule_commitment', schedule.schedule_commitment],
		['schedule_index', '0'],
		['payout_capability', validatorCapability.id],
		['validator_offer', offer.id],
		['allocation_bps', '625'],
		['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
		['expires_at', String(MAX_END_AT + 10)],
	])

	const activation = signEvent(SELLER_NOSTR_SK, AUCTION_MULTIPARTY_ACTIVATION_KIND, [
		['e', root.id],
		['a', coordinate],
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_schedule_commitment', schedule.schedule_commitment],
		['mint', MINT],
		['acceptance', '0', acceptance.id],
	])

	return {
		validatorCapability,
		v4vCapability,
		offer,
		root,
		acceptance,
		activation,
	}
}

const expectCryptoError = (expectedCode: string, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyAuthorizationCryptoError)
		expect((error as AuctionMultipartyAuthorizationCryptoError).code).toBe(expectedCode)
	}
}

describe('Auction Multiparty Gate C2 cryptographic authentication', () => {
	test('matches fixed whole-xpub PoP message vector', () => {
		const bip32VectorXpub =
			'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'

		expect(AUCTION_MULTIPARTY_PAYOUT_XPUB_POP_DOMAIN).toBe('cashu_p2pk_bidder_path_multiparty_v1:payout_xpub_pop:v1')

		expect(bytesToHex(buildPayoutXpubPopMessage('11'.repeat(32), bip32VectorXpub))).toBe(
			'25a54217ddc0d0fb17484cbd550574947a8df0b7c64d47732b1adf0d564523a6',
		)
	})

	test('authenticates real NIP-01 root, offer, acceptance, and activation', () => {
		const bundle = buildSignedBundle()

		const root = authenticateMultipartyRoot(bundle.root)
		const offer = authenticateMultipartyValidatorOffer(bundle.offer)
		const acceptance = authenticateMultipartyValidatorAcceptance(bundle.acceptance)
		const activation = authenticateMultipartySellerActivation(bundle.activation)

		expect(root.event_id).toBe(bundle.root.id)
		expect(offer.event_id).toBe(bundle.offer.id)
		expect(acceptance.event_id).toBe(bundle.acceptance.id)
		expect(activation.event_id).toBe(bundle.activation.id)

		expect(Object.isFrozen(root)).toBe(true)
		expect(Object.isFrozen(activation)).toBe(true)
	})

	test('authenticated snapshot provenance cannot be forged or cloned', () => {
		const { root } = buildSignedBundle()
		const genuine = authenticateMultipartyRoot(root)

		expect(isCryptographicallyAuthenticatedMultipartySnapshot(genuine)).toBe(true)

		const forged = {
			event_id: genuine.event_id,
			value: genuine.value,
		}

		// Compile-time provenance: a structural lookalike is not a valid
		// authenticated snapshot because it lacks the private symbol brand.
		const requiresAuthenticated = (_snapshot: typeof genuine): void => {}

		// @ts-expect-error structural forgery lacks C2 provenance
		requiresAuthenticated(forged)

		expect(isCryptographicallyAuthenticatedMultipartySnapshot(forged)).toBe(false)

		expectCryptoError('crypto_authenticated_snapshot_provenance_invalid', () =>
			assertCryptographicallyAuthenticatedMultipartySnapshot(forged),
		)

		// A clone can copy enumerable symbol properties. WeakSet membership,
		// not object shape, is therefore the runtime provenance boundary.
		const cloned = { ...genuine }

		expect(isCryptographicallyAuthenticatedMultipartySnapshot(cloned)).toBe(false)

		expectCryptoError('crypto_authenticated_snapshot_provenance_invalid', () =>
			assertCryptographicallyAuthenticatedMultipartySnapshot(cloned),
		)
	})

	test('authenticates payout capability only when NIP-01 and whole-xpub PoP both verify', () => {
		const capability = makeCapability(VALIDATOR_NOSTR_SK, VALIDATOR_PAYOUT)

		const authenticated = authenticateMultipartyPayoutCapability(capability)

		expect(authenticated.event_id).toBe(capability.id)
		expect(authenticated.value.recipient_pubkey).toBe(VALIDATOR)
		expect(authenticated.value.payout_xpub).toBe(VALIDATOR_PAYOUT.publicExtendedKey)
	})

	test('rejects semantically valid root after post-signature tag mutation', () => {
		const { root } = buildSignedBundle()

		const tampered: NostrEventLike = {
			...root,
			tags: [...root.tags.map((tag) => [...tag]), ['display', 'post-signature mutation']],
		}

		expectCryptoError('crypto_nostr_event_invalid', () => authenticateMultipartyRoot(tampered))
	})

	test('rejects valid NIP-01 capability when PoP was signed by another payout key', () => {
		const capability = makeCapability(VALIDATOR_NOSTR_SK, VALIDATOR_PAYOUT, {
			popPrivateKey: requirePrivateKey(WRONG_PAYOUT),
		})

		expectCryptoError('crypto_payout_xpub_pop_invalid', () => authenticateMultipartyPayoutCapability(capability))
	})

	test('binds PoP to the recipient Nostr pubkey', () => {
		const original = makeCapability(VALIDATOR_NOSTR_SK, VALIDATOR_PAYOUT)

		const originalPop = original.tags.find((tag) => tag[0] === 'payout_xpub_pop')?.[1]

		if (!originalPop) {
			throw new Error('fixture missing payout_xpub_pop')
		}

		const rebound = makeCapability(V4V_NOSTR_SK, VALIDATOR_PAYOUT, {
			pop: originalPop,
		})

		expectCryptoError('crypto_payout_xpub_pop_invalid', () => authenticateMultipartyPayoutCapability(rebound))
	})

	test('binds PoP to all 78 xpub bytes including chain code', () => {
		const original = makeCapability(VALIDATOR_NOSTR_SK, VALIDATOR_PAYOUT)

		const originalPop = original.tags.find((tag) => tag[0] === 'payout_xpub_pop')?.[1]

		if (!originalPop) {
			throw new Error('fixture missing payout_xpub_pop')
		}

		const originalPayload = bs58check.decode(VALIDATOR_PAYOUT.publicExtendedKey)

		const mutatedPayload = originalPayload.slice()

		// BIP-32 bytes 13..44 are chain code. Keep the embedded
		// compressed public key identical while changing the xpub identity.
		mutatedPayload[13] ^= 0x01

		expect(bytesToHex(mutatedPayload.slice(45))).toBe(bytesToHex(originalPayload.slice(45)))

		const mutatedXpub = bs58check.encode(mutatedPayload)

		const rebound = makeCapability(VALIDATOR_NOSTR_SK, VALIDATOR_PAYOUT, {
			xpub: mutatedXpub,
			pop: originalPop,
		})

		expectCryptoError('crypto_payout_xpub_pop_invalid', () => authenticateMultipartyPayoutCapability(rebound))
	})

	test('requires SHA256(pop_preimage) as the BIP-340 message', () => {
		const capability = makeCapability(VALIDATOR_NOSTR_SK, VALIDATOR_PAYOUT, {
			hashPreimage: false,
		})

		expectCryptoError('crypto_payout_xpub_pop_invalid', () => authenticateMultipartyPayoutCapability(capability))
	})
})
