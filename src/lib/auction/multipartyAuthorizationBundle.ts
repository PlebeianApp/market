import type { NostrEventLike } from '../nostr/eventLike'
import { validateMultipartyAuthorizationSnapshotRelations, type MultipartyAuthorizationSnapshotRelations } from './multipartyAuthorization'
import {
	authenticateMultipartyPayoutCapability,
	authenticateMultipartyRoot,
	authenticateMultipartySellerActivation,
	authenticateMultipartyValidatorAcceptance,
	authenticateMultipartyValidatorOffer,
} from './multipartyAuthorizationCrypto'

/**
 * C3 consumes an already-selected exact candidate bundle, not an arbitrary
 * relay result set. Gate A limits a schedule to 16 entries, so no exact
 * authorization bundle needs more than 16 candidates of any event class.
 */
export const AUCTION_MULTIPARTY_AUTHORIZATION_BUNDLE_MAX_EVENTS_PER_CLASS = 16

export class AuctionMultipartyAuthorizationBundleError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyAuthorizationBundleError'
		this.code = code
	}
}

const fail = (code: string): never => {
	throw new AuctionMultipartyAuthorizationBundleError(code)
}

export interface RawMultipartyAuthorizationBundle {
	readonly root: NostrEventLike
	readonly capabilities: readonly NostrEventLike[]
	readonly offers: readonly NostrEventLike[]
	readonly acceptances: readonly NostrEventLike[]
	readonly activation: NostrEventLike
}

const assertCandidateListBound = (value: readonly NostrEventLike[], code: string): void => {
	if (!Array.isArray(value) || value.length > AUCTION_MULTIPARTY_AUTHORIZATION_BUNDLE_MAX_EVENTS_PER_CLASS) {
		fail(code)
	}
}

const AUTHORIZATION_READY_MULTIPARTY_BUNDLE: unique symbol = Symbol('auction-multiparty-authorization-ready-bundle')

const authorizationReadyBundles = new WeakSet<object>()

/**
 * Cryptographically authenticated + exact C1 authorization relationships.
 *
 * SECURITY BOUNDARY:
 * `authorization_ready` is deliberately narrower than `fundable`.
 *
 * This result does NOT prove:
 * - the complete Auction-V1 business/listing schema;
 * - absence of a sticky activation conflict;
 * - selected-mint NUT support/current availability;
 * - Cashu construction validity or authority-domain isolation;
 * - wallet input ownership/current proof state; or
 * - successful/settled payment.
 *
 * It is intentionally non-persistent provenance. A serialized/cloned result
 * must be rebuilt from the original signed events after restart.
 */
export interface MultipartyAuthorizationReadyBundle {
	readonly [AUTHORIZATION_READY_MULTIPARTY_BUNDLE]: true
	readonly status: 'authorization_ready'
	readonly relations: MultipartyAuthorizationSnapshotRelations
}

const makeAuthorizationReady = (relations: MultipartyAuthorizationSnapshotRelations): MultipartyAuthorizationReadyBundle => {
	const immutableRelations: MultipartyAuthorizationSnapshotRelations = Object.freeze({
		root_event_id: relations.root_event_id,
		activation_event_id: relations.activation_event_id,
		payout_schedule_commitment: relations.payout_schedule_commitment,
		mints: Object.freeze([...relations.mints]),
		bindings: Object.freeze(relations.bindings.map((binding) => Object.freeze({ ...binding }))),
	})

	const result: MultipartyAuthorizationReadyBundle = {
		[AUTHORIZATION_READY_MULTIPARTY_BUNDLE]: true,
		status: 'authorization_ready',
		relations: immutableRelations,
	}

	authorizationReadyBundles.add(result)

	return Object.freeze(result)
}

export const isMultipartyAuthorizationReadyBundle = (value: unknown): value is MultipartyAuthorizationReadyBundle =>
	typeof value === 'object' && value !== null && authorizationReadyBundles.has(value)

export const assertMultipartyAuthorizationReadyBundle = (value: unknown): asserts value is MultipartyAuthorizationReadyBundle => {
	if (!isMultipartyAuthorizationReadyBundle(value)) {
		fail('auth_bundle_provenance_invalid')
	}
}

export const buildMultipartyAuthorizationReadyBundle = (input: RawMultipartyAuthorizationBundle): MultipartyAuthorizationReadyBundle => {
	// Resource ceilings precede cryptographic work and Map construction.
	assertCandidateListBound(input.capabilities, 'auth_bundle_capabilities_exceed_limit')
	assertCandidateListBound(input.offers, 'auth_bundle_offers_exceed_limit')
	assertCandidateListBound(input.acceptances, 'auth_bundle_acceptances_exceed_limit')

	const root = authenticateMultipartyRoot(input.root)
	const activation = authenticateMultipartySellerActivation(input.activation)

	const capabilities = input.capabilities.map((event) => authenticateMultipartyPayoutCapability(event))

	const offers = input.offers.map((event) => authenticateMultipartyValidatorOffer(event))

	const acceptances = input.acceptances.map((event) => authenticateMultipartyValidatorAcceptance(event))

	const relations = validateMultipartyAuthorizationSnapshotRelations({
		root: root.value,
		capabilities: capabilities.map((snapshot) => snapshot.value),
		offers: offers.map((snapshot) => snapshot.value),
		acceptances: acceptances.map((snapshot) => snapshot.value),
		activation: activation.value,
	})

	return makeAuthorizationReady(relations)
}
