import { useQuery } from '@tanstack/react-query'
import { applesauceIo } from '@/lib/nostr/io'
import { toRawEvent, type NostrEventLike } from '@/lib/nostr/eventLike'
import {
	AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND,
	type ParsedMultipartyPayoutCapability,
	type ParsedMultipartyValidatorOffer,
	parseMultipartyPayoutCapability,
	parseMultipartyValidatorOffer,
} from '@/lib/auction/multipartyAuthorization'
import {
	type MultipartyAnnouncementPolicy,
	type MultipartyAnnouncementProfile,
	type MultipartyAnnouncements,
	projectMultipartyAnnouncements,
} from '@/lib/auction/multipartyAnnouncements'

/** Kind-30441 validator policy declarations. */
const VALIDATOR_POLICY_KIND = 30441
const POLICY_D_PREFIX = 'policy:auction'
/** Guard: a picker should not pull a firehose of announcements into memory. */
const ANNOUNCEMENT_LIMIT = 200

export const multipartyKeys = {
	announcements: ['multiparty', 'announcements'] as const,
}

/**
 * Parse defensively: a malformed or hostile announcement is dropped, never thrown.
 * One bad event must not empty the picker.
 */
const parseAll = <T>(events: NostrEventLike[], parse: (event: NostrEventLike) => T): T[] => {
	const parsed: T[] = []
	for (const event of events) {
		try {
			parsed.push(parse(event))
		} catch {
			// ignore: an unreadable announcement is simply not offered
		}
	}
	return parsed
}

const parseProfile = (event: NostrEventLike): MultipartyAnnouncementProfile | null => {
	try {
		const content = JSON.parse(event.content) as { name?: unknown; display_name?: unknown; picture?: unknown; about?: unknown }
		const name = typeof content.name === 'string' && content.name.trim() ? content.name.trim() : undefined
		const displayName =
			typeof content.display_name === 'string' && content.display_name.trim() ? content.display_name.trim() : undefined
		const picture = typeof content.picture === 'string' && content.picture.trim() ? content.picture.trim() : undefined
		const about = typeof content.about === 'string' && content.about.trim() ? content.about.trim() : undefined
		const resolvedName = displayName ?? name
		if (resolvedName === undefined && picture === undefined && about === undefined) return null
		return {
			pubkey: event.pubkey,
			...(resolvedName === undefined ? {} : { name: resolvedName }),
			...(picture === undefined ? {} : { picture }),
			...(about === undefined ? {} : { about }),
		}
	} catch {
		return null
	}
}

const parsePolicy = (event: NostrEventLike): MultipartyAnnouncementPolicy | null => {
	const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
	if (!dTag.startsWith(POLICY_D_PREFIX)) return null
	try {
		const content = JSON.parse(event.content) as { minValidators?: unknown; minQuorumPercent?: unknown; notes?: unknown }
		const minValidators =
			typeof content.minValidators === 'number' && Number.isSafeInteger(content.minValidators)
				? content.minValidators
				: undefined
		const minQuorumPercent =
			typeof content.minQuorumPercent === 'number' && Number.isSafeInteger(content.minQuorumPercent)
				? content.minQuorumPercent
				: undefined
		const notes = typeof content.notes === 'string' && content.notes.trim() ? content.notes.trim() : undefined
		return {
			validatorPubkey: event.pubkey,
			...(minValidators === undefined ? {} : { minValidators }),
			...(minQuorumPercent === undefined ? {} : { minQuorumPercent }),
			...(notes === undefined ? {} : { notes }),
		}
	} catch {
		return null
	}
}

/**
 * Fetch the multiparty announcements worth offering to a seller.
 *
 * Two round trips, by necessity: the capabilities and offers name the identities,
 * and only then can their profiles be fetched by author. Everything is parsed with
 * the same validators the protocol uses, so the picker can never offer an
 * announcement a compliant recipient would reject.
 */
export const fetchMultipartyAnnouncements = async (): Promise<MultipartyAnnouncements> => {
	const [capabilityEvents, offerEvents, policyEvents] = await Promise.all([
		applesauceIo.fetchEvents({ kinds: [AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND], limit: ANNOUNCEMENT_LIMIT }),
		applesauceIo.fetchEvents({ kinds: [AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND], limit: ANNOUNCEMENT_LIMIT }),
		applesauceIo.fetchEvents({ kinds: [VALIDATOR_POLICY_KIND], limit: ANNOUNCEMENT_LIMIT }),
	])

	const capabilities: ParsedMultipartyPayoutCapability[] = parseAll(
		capabilityEvents.map(toRawEvent),
		parseMultipartyPayoutCapability,
	)
	const offers: ParsedMultipartyValidatorOffer[] = parseAll(offerEvents.map(toRawEvent), parseMultipartyValidatorOffer)
	const policies = policyEvents
		.map(toRawEvent)
		.map(parsePolicy)
		.filter((policy): policy is MultipartyAnnouncementPolicy => policy !== null)

	const authors = Array.from(
		new Set([...capabilities.map((entry) => entry.recipient_pubkey), ...offers.map((entry) => entry.validator_pubkey)]),
	)

	const profiles: MultipartyAnnouncementProfile[] =
		authors.length === 0
			? []
			: (
					await applesauceIo.fetchEvents({ kinds: [0], authors, limit: ANNOUNCEMENT_LIMIT })
				)
					.map(toRawEvent)
					.map(parseProfile)
					.filter((profile): profile is MultipartyAnnouncementProfile => profile !== null)

	return projectMultipartyAnnouncements({
		capabilities,
		offers,
		profiles,
		policies,
		nowUnixSeconds: Math.floor(Date.now() / 1000),
	})
}

/**
 * Announcements to pick a validator or recipient from. Cached for a minute: the
 * announcements change on the order of days, and the picker is not a live feed.
 */
export const useMultipartyAnnouncements = () =>
	useQuery({
		queryKey: multipartyKeys.announcements,
		queryFn: fetchMultipartyAnnouncements,
		staleTime: 60_000,
		refetchOnWindowFocus: false,
	})