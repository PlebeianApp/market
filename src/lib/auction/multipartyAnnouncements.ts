/**
 * Project raw multiparty announcements into the two pickable lists the auction
 * form needs: validators (with their fee and rules) and plain V4V recipients.
 *
 * An announcement is a kind-1027 payout capability (who can receive, and where)
 * plus, for a validator, a kind-1028 offer (what share it expects) and optionally a
 * kind-30441 policy document (the rules it will validate under). A profile supplies
 * the name and picture.
 *
 * Pure: the caller fetches, this decides. Three rules it enforces rather than
 * passing on:
 *
 * - an offer without a matching capability is not pickable (nothing says where the
 *   share would go);
 * - an expired capability or offer is not pickable;
 * - one pubkey appears once, as a validator when it offers and as a recipient
 *   otherwise — never both, because the form adds exactly one line per pubkey.
 */

import type { ParsedMultipartyPayoutCapability, ParsedMultipartyValidatorOffer } from './multipartyAuthorization'

export interface MultipartyAnnouncementProfile {
	readonly pubkey: string
	readonly name?: string
	readonly picture?: string
	readonly about?: string
}

export interface MultipartyAnnouncementPolicy {
	readonly validatorPubkey: string
	readonly minValidators?: number
	readonly minQuorumPercent?: number
	readonly notes?: string
}

export interface MultipartyPickableValidator {
	readonly pubkey: string
	readonly name?: string
	readonly picture?: string
	readonly about?: string
	/** The share this validator asks for, in basis points. */
	readonly feeBps: number
	readonly capabilityEventId: string
	readonly offerEventId: string
	readonly capabilityExpiresAt: number
	readonly minValidators?: number
	readonly minQuorumPercent?: number
}

export interface MultipartyPickableRecipient {
	readonly pubkey: string
	readonly name?: string
	readonly picture?: string
	readonly about?: string
	readonly capabilityEventId: string
	readonly capabilityExpiresAt: number
}

export interface MultipartyAnnouncementInput {
	readonly capabilities: readonly ParsedMultipartyPayoutCapability[]
	readonly offers: readonly ParsedMultipartyValidatorOffer[]
	readonly profiles: readonly MultipartyAnnouncementProfile[]
	readonly policies?: readonly MultipartyAnnouncementPolicy[]
	readonly nowUnixSeconds?: number
}

export interface MultipartyAnnouncements {
	readonly validators: readonly MultipartyPickableValidator[]
	readonly recipients: readonly MultipartyPickableRecipient[]
}

const toProfile = (profiles: readonly MultipartyAnnouncementProfile[]): Map<string, MultipartyAnnouncementProfile> =>
	new Map(profiles.map((profile) => [profile.pubkey, profile]))

const identityOf = (profile: MultipartyAnnouncementProfile | undefined) =>
	profile === undefined
		? {}
		: {
				...(profile.name ? { name: profile.name } : {}),
				...(profile.picture ? { picture: profile.picture } : {}),
				...(profile.about ? { about: profile.about } : {}),
			}

/** Deterministic order: named entries first, then by name, then by pubkey. */
const byName = <T extends { name?: string; pubkey: string }>(left: T, right: T): number => {
	const leftName = left.name ?? ''
	const rightName = right.name ?? ''
	if (leftName !== rightName) {
		if (leftName.length === 0) return 1
		if (rightName.length === 0) return -1
		return leftName < rightName ? -1 : 1
	}
	return left.pubkey < right.pubkey ? -1 : left.pubkey === right.pubkey ? 0 : 1
}

export const projectMultipartyAnnouncements = (input: MultipartyAnnouncementInput): MultipartyAnnouncements => {
	const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000)
	const profiles = toProfile(input.profiles)
	const policies = new Map((input.policies ?? []).map((policy) => [policy.validatorPubkey, policy]))

	// Live capabilities only, and never two for one pubkey: the newest wins, so a
	// re-announcement replaces the old one rather than appearing twice.
	const liveCapabilities = new Map<string, ParsedMultipartyPayoutCapability>()
	for (const capability of input.capabilities) {
		if (capability.expires_at <= now) continue
		const existing = liveCapabilities.get(capability.recipient_pubkey)
		if (existing === undefined || existing.expires_at < capability.expires_at) {
			liveCapabilities.set(capability.recipient_pubkey, capability)
		}
	}

	const validators: MultipartyPickableValidator[] = []
	const recipients: MultipartyPickableRecipient[] = []

	for (const offer of input.offers) {
		if (offer.expires_at <= now) continue
		const capability = liveCapabilities.get(offer.validator_pubkey)
		// An offer that names a capability we cannot see is not pickable: nothing
		// here says where the share would be paid.
		if (capability === undefined || capability.id !== offer.payout_capability_event_id) continue
		const policy = policies.get(offer.validator_pubkey)

		validators.push(
			Object.freeze({
				pubkey: offer.validator_pubkey,
				...identityOf(profiles.get(offer.validator_pubkey)),
				feeBps: offer.allocation_bps,
				capabilityEventId: capability.id,
				offerEventId: offer.id,
				capabilityExpiresAt: capability.expires_at,
				...(policy?.minValidators !== undefined ? { minValidators: policy.minValidators } : {}),
				...(policy?.minQuorumPercent !== undefined ? { minQuorumPercent: policy.minQuorumPercent } : {}),
			}),
		)
	}

	const validatorPubkeys = new Set(validators.map((validator) => validator.pubkey))

	for (const capability of Array.from(liveCapabilities.values())) {
		if (validatorPubkeys.has(capability.recipient_pubkey)) continue
		recipients.push(
			Object.freeze({
				pubkey: capability.recipient_pubkey,
				...identityOf(profiles.get(capability.recipient_pubkey)),
				capabilityEventId: capability.id,
				capabilityExpiresAt: capability.expires_at,
			}),
		)
	}

	return Object.freeze({
		validators: Object.freeze([...validators].sort(byName)),
		recipients: Object.freeze([...recipients].sort(byName)),
	})
}

/** The recipient line the form expects, for one pickable validator. */
export const validatorRecipientLine = (validator: MultipartyPickableValidator, allocationBps?: number): string =>
	`validator, ${validator.pubkey}, ${allocationBps ?? validator.feeBps}, ${validator.capabilityEventId}, ${validator.offerEventId}`

/** The recipient line the form expects, for one pickable plain recipient. */
export const recipientLine = (recipient: MultipartyPickableRecipient, allocationBps = 100): string =>
	`v4v, ${recipient.pubkey}, ${allocationBps}, ${recipient.capabilityEventId}`

/** One sentence describing what a validator asks for, for the picker. */
export const describeValidatorTerms = (validator: MultipartyPickableValidator): string => {
	const fee = `${(validator.feeBps / 100).toFixed(2)}% of the settlement`
	const pool = validator.minValidators === undefined ? null : `needs at least ${validator.minValidators} validators`
	const quorum = validator.minQuorumPercent === undefined ? null : `quorum at least ${validator.minQuorumPercent}% of the pool`
	const terms = [fee, pool, quorum].filter((part): part is string => part !== null)
	return terms.join(' · ')
}
