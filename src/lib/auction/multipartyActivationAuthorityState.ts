export const AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_RECORD_VERSION = 1
export const AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_MAX_EVENT_IDS = 2

const LOWER_HEX_64 = /^[0-9a-f]{64}$/

export class AuctionMultipartyActivationAuthorityStateError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyActivationAuthorityStateError'
		this.code = code
	}
}

const fail = (code: string): never => {
	throw new AuctionMultipartyActivationAuthorityStateError(code)
}

export interface MultipartyActivationAuthorityRecordV1 {
	readonly version: 1
	readonly root_event_id: string
	readonly activation_event_ids: readonly [string] | readonly [string, string]
}

export type MultipartyActivationAuthorityStatus = 'single_activation' | 'activation_conflict'

export interface MultipartyActivationAuthorityReconciliation {
	readonly status: MultipartyActivationAuthorityStatus
	readonly changed: boolean
	readonly record: MultipartyActivationAuthorityRecordV1
}

const requireCanonicalEventId = (value: unknown, code: string): string =>
	typeof value === 'string' && LOWER_HEX_64.test(value) ? value : fail(code)

const freezeRecord = (rootEventId: string, activationEventIds: readonly string[]): MultipartyActivationAuthorityRecordV1 => {
	const ids =
		activationEventIds.length === 1
			? (Object.freeze([activationEventIds[0]]) as readonly [string])
			: (Object.freeze([activationEventIds[0], activationEventIds[1]]) as readonly [string, string])

	return Object.freeze({
		version: AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_RECORD_VERSION,
		root_event_id: rootEventId,
		activation_event_ids: ids,
	})
}

export const parseMultipartyActivationAuthorityRecord = (value: unknown): MultipartyActivationAuthorityRecordV1 => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail('activation_authority_record_invalid')
	}

	const object = value as Record<string, unknown>
	const keys = Object.keys(object).sort()

	if (keys.length !== 3 || keys[0] !== 'activation_event_ids' || keys[1] !== 'root_event_id' || keys[2] !== 'version') {
		fail('activation_authority_record_shape_invalid')
	}

	if (object.version !== AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_RECORD_VERSION) {
		fail('activation_authority_record_version_invalid')
	}

	const rootEventId = requireCanonicalEventId(object.root_event_id, 'activation_authority_root_event_id_invalid')

	const rawIds: unknown[] = Array.isArray(object.activation_event_ids)
		? object.activation_event_ids
		: fail('activation_authority_event_ids_invalid')

	if (rawIds.length !== 1 && rawIds.length !== AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_MAX_EVENT_IDS) {
		fail('activation_authority_event_ids_invalid')
	}

	const ids = rawIds.map((id: unknown) => requireCanonicalEventId(id, 'activation_authority_activation_event_id_invalid'))

	if (ids.length === 2) {
		if (ids[0] === ids[1]) {
			fail('activation_authority_duplicate_activation_event_id')
		}

		if (ids[0] > ids[1]) {
			fail('activation_authority_event_ids_noncanonical')
		}
	}

	return freezeRecord(rootEventId, ids)
}

const makeReconciliation = (record: MultipartyActivationAuthorityRecordV1, changed: boolean): MultipartyActivationAuthorityReconciliation =>
	Object.freeze({
		status: record.activation_event_ids.length === 2 ? 'activation_conflict' : 'single_activation',
		changed,
		record,
	})

/**
 * Pure monotonic reconciliation for the durable activation-authority ledger.
 *
 * A caller MUST persist a changed record and wait for transaction completion
 * before treating the resulting observation as durable authority state.
 *
 * Once two distinct qualifying activation event ids have been observed for
 * one exact root event id, the record is permanently conflict-shaped.
 * Later observations cannot clear or replace that evidence pair.
 */
export const reconcileMultipartyActivationAuthorityRecord = (input: {
	readonly current: unknown | null
	readonly root_event_id: string
	readonly activation_event_id: string
}): MultipartyActivationAuthorityReconciliation => {
	const rootEventId = requireCanonicalEventId(input.root_event_id, 'activation_authority_root_event_id_invalid')

	const activationEventId = requireCanonicalEventId(input.activation_event_id, 'activation_authority_activation_event_id_invalid')

	if (input.current === null) {
		return makeReconciliation(freezeRecord(rootEventId, [activationEventId]), true)
	}

	const current = parseMultipartyActivationAuthorityRecord(input.current)

	if (current.root_event_id !== rootEventId) {
		fail('activation_authority_root_mismatch')
	}

	if (current.activation_event_ids.includes(activationEventId)) {
		return makeReconciliation(current, false)
	}

	// Conflict is sticky and bounded. Once established, later observations
	// cannot replace either piece of durable conflict evidence.
	if (current.activation_event_ids.length === 2) {
		return makeReconciliation(current, false)
	}

	const conflictIds = [current.activation_event_ids[0], activationEventId].sort()

	return makeReconciliation(freezeRecord(rootEventId, conflictIds), true)
}
