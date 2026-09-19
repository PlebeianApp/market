import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { base64urlnopad } from '@scure/base'
import { HDKey } from '@scure/bip32'
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
import { buildPayoutXpubPopMessage } from '../auction/multipartyAuthorizationCrypto'
import {
	AUCTION_MULTIPARTY_AUTHORIZATION_BUNDLE_MAX_EVENTS_PER_CLASS,
	AuctionMultipartyAuthorizationBundleError,
	assertMultipartyAuthorizationReadyBundle,
	buildMultipartyAuthorizationReadyBundle,
	isMultipartyAuthorizationReadyBundle,
} from '../auction/multipartyAuthorizationBundle'
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

const makeCapability = (authorSecret: Uint8Array, node: HDKey): NostrEventLike => {
	const recipient = getPublicKey(authorSecret)
	const xpub = node.publicExtendedKey

	const pop = bytesToHex(schnorr.sign(buildPayoutXpubPopMessage(recipient, xpub), requirePrivateKey(node), new Uint8Array(32)))

	return signEvent(authorSecret, AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND, [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_xpub', xpub],
		['payout_xpub_pop', pop],
		['mint', MINT],
		['valid_from', String(START_AT - 10)],
		['expires_at', String(MAX_END_AT + 10)],
	])
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
			['d', 'c3-demo'],
			['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
			['payout_schedule_commitment', schedule.schedule_commitment],
			['payout_schedule', `b64u:${base64urlnopad.encode(schedule.canonical_bytes)}`],
			['start_at', String(START_AT)],
			['max_end_at', String(MAX_END_AT)],
			['p2pk_xpub', SELLER_PAYOUT.publicExtendedKey],
			['mint', MINT],
			['auditors', VALIDATOR],
			['auditor_quorum', '1'],
			['title', 'C3 authorization composition'],
		],
		'auction display content',
	)

	const coordinate = `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:c3-demo`

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
		root,
		capabilities: [validatorCapability, v4vCapability] as readonly NostrEventLike[],
		offers: [offer] as readonly NostrEventLike[],
		acceptances: [acceptance] as readonly NostrEventLike[],
		activation,
		validatorCapability,
		offer,
		schedule,
		coordinate,
	}
}

const expectCode = (expectedCode: string, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect((error as { code?: string }).code).toBe(expectedCode)
	}
}

describe('Auction Multiparty Gate C3 authorization-ready bundle', () => {
	test('composes C2 authentication with exact C1 relations', () => {
		const bundle = buildSignedBundle()

		const ready = buildMultipartyAuthorizationReadyBundle(bundle)

		expect(ready.status).toBe('authorization_ready')
		expect(ready.relations.root_event_id).toBe(bundle.root.id)
		expect(ready.relations.activation_event_id).toBe(bundle.activation.id)
		expect(ready.relations.payout_schedule_commitment).toBe(bundle.schedule.schedule_commitment)

		expect(ready.relations.mints).toEqual([MINT])
		expect(ready.relations.bindings).toHaveLength(2)

		expect(ready.relations.bindings[0]).toMatchObject({
			schedule_index: 0,
			role: 'validator',
			recipient_pubkey: VALIDATOR,
			payout_capability_event_id: bundle.validatorCapability.id,
			validator_offer_event_id: bundle.offer.id,
			allocation_bps: 625,
		})

		expect(ready.relations.bindings[1]).toMatchObject({
			schedule_index: 1,
			role: 'v4v',
			recipient_pubkey: V4V,
			allocation_bps: 313,
		})

		expect(isMultipartyAuthorizationReadyBundle(ready)).toBe(true)
		expect(Object.isFrozen(ready)).toBe(true)
		expect(Object.isFrozen(ready.relations)).toBe(true)
		expect(Object.isFrozen(ready.relations.mints)).toBe(true)
		expect(Object.isFrozen(ready.relations.bindings)).toBe(true)
		expect(ready.relations.bindings.every((binding) => Object.isFrozen(binding))).toBe(true)
	})

	test('authorization-ready provenance cannot be forged or cloned', () => {
		const ready = buildMultipartyAuthorizationReadyBundle(buildSignedBundle())

		const forged = {
			status: 'authorization_ready' as const,
			relations: ready.relations,
		}

		const requiresReady = (_bundle: typeof ready): void => {}

		// @ts-expect-error structural lookalike lacks C3 provenance
		requiresReady(forged)

		expect(isMultipartyAuthorizationReadyBundle(forged)).toBe(false)

		expectCode('auth_bundle_provenance_invalid', () => assertMultipartyAuthorizationReadyBundle(forged))

		const cloned = { ...ready }

		expect(isMultipartyAuthorizationReadyBundle(cloned)).toBe(false)

		expectCode('auth_bundle_provenance_invalid', () => assertMultipartyAuthorizationReadyBundle(cloned))
	})

	test('rejects post-signature root mutation before authorization-ready state', () => {
		const bundle = buildSignedBundle()

		const tamperedRoot: NostrEventLike = {
			...bundle.root,
			tags: [...bundle.root.tags.map((tag) => [...tag]), ['display', 'post-signature mutation']],
		}

		expectCode('crypto_nostr_event_invalid', () =>
			buildMultipartyAuthorizationReadyBundle({
				...bundle,
				root: tamperedRoot,
			}),
		)
	})

	test('rejects cryptographically valid bundle with invalid exact relationships', () => {
		const bundle = buildSignedBundle()

		const wrongAcceptance = signEvent(VALIDATOR_NOSTR_SK, AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND, [
			['e', bundle.root.id],
			['a', bundle.coordinate],
			['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
			['payout_schedule_commitment', bundle.schedule.schedule_commitment],
			// Valid wire value, wrong exact schedule binding.
			['schedule_index', '1'],
			['payout_capability', bundle.validatorCapability.id],
			['validator_offer', bundle.offer.id],
			['allocation_bps', '625'],
			['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
			['expires_at', String(MAX_END_AT + 10)],
		])

		const wrongActivation = signEvent(SELLER_NOSTR_SK, AUCTION_MULTIPARTY_ACTIVATION_KIND, [
			['e', bundle.root.id],
			['a', bundle.coordinate],
			['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
			['payout_schedule_commitment', bundle.schedule.schedule_commitment],
			['mint', MINT],
			['acceptance', '0', wrongAcceptance.id],
		])

		expectCode('auth_acceptance_schedule_index_mismatch', () =>
			buildMultipartyAuthorizationReadyBundle({
				...bundle,
				acceptances: [wrongAcceptance],
				activation: wrongActivation,
			}),
		)
	})

	test('bounds exact candidate lists before bundle authentication', () => {
		const bundle = buildSignedBundle()

		expect(AUCTION_MULTIPARTY_AUTHORIZATION_BUNDLE_MAX_EVENTS_PER_CLASS).toBe(16)

		expectCode('auth_bundle_capabilities_exceed_limit', () =>
			buildMultipartyAuthorizationReadyBundle({
				...bundle,
				capabilities: Array.from({ length: 17 }, () => bundle.validatorCapability),
			}),
		)
	})
})
