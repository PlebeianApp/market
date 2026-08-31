import NDK, {
	NDKCashuMintList,
	NDKEvent,
	NDKKind,
	NDKUser,
	profileFromEvent,
	type NDKFilter,
	type NDKSigner,
	type NDKUserProfile,
	type NDKZapMethod,
	type NDKZapMethodInfo,
} from '@nostr-dev-kit/ndk'
import { NDKWoT } from '@nostr-dev-kit/wot'
import { nip19, verifyEvent, type Event } from 'nostr-tools'

import type { FetchOptions, NostrFilter, NostrIo } from './io'

export { NDKEvent, NDKKind, NDKUser }
export type { NDKFilter, NDKSigner, NDKUserProfile, NDKZapMethod, NDKZapMethodInfo }

const NIP33_A_REGEX = /^(\d+):([0-9A-Fa-f]+)(?::(.*))?$/
const BECH32_REGEX = /^n(event|ote|profile|pub|addr)1[\d\w]+$/

/**
 * Mirrors NDK's internal `filterFromId` so `ndk.fetchEvent(id)` call sites keep
 * identical filters when routed through the seam: `kind:pubkey[:d]` NIP-33
 * coordinates, bech32 entities (nevent/note/naddr), or a bare `{ ids: [id] }`.
 */
export function ndkFilterFromId(id: string): NDKFilter {
	if (NIP33_A_REGEX.test(id)) {
		const [kind, pubkey, identifier] = id.split(':')
		const filter: NDKFilter = { authors: [pubkey], kinds: [Number.parseInt(kind)] }
		if (identifier) filter['#d'] = [identifier]
		return filter
	}
	if (BECH32_REGEX.test(id)) {
		try {
			const decoded = nip19.decode(id)
			if (decoded.type === 'nevent') {
				const filter: NDKFilter = { ids: [decoded.data.id] }
				if (decoded.data.author) filter.authors = [decoded.data.author]
				if (decoded.data.kind) filter.kinds = [decoded.data.kind]
				return filter
			}
			if (decoded.type === 'note') return { ids: [decoded.data] }
			if (decoded.type === 'naddr') {
				const filter: NDKFilter = { authors: [decoded.data.pubkey], kinds: [decoded.data.kind] }
				if (decoded.data.identifier) filter['#d'] = [decoded.data.identifier]
				return filter
			}
		} catch {
			// Fall through to the bare-ids filter, exactly like NDK does.
		}
	}
	return { ids: [id] }
}

type NdkEventContext = ConstructorParameters<typeof NDKEvent>[0]

export function rehydrateVerifiedNdkEvent(ndk: NdkEventContext, event: Event): NDKEvent | null {
	try {
		if (!verifyEvent(event)) return null
		return new NDKEvent(ndk, event)
	} catch {
		return null
	}
}

export async function fetchNdkEventSet(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
	opts?: FetchOptions,
): Promise<Set<NDKEvent>> {
	const rawEvents = await nostrIo.fetchEvents(filter as NostrFilter | NostrFilter[], opts)
	const eventsById = new Map<string, NDKEvent>()
	for (const event of rawEvents) {
		const ndkEvent = rehydrateVerifiedNdkEvent(ndk, event)
		if (ndkEvent && !eventsById.has(ndkEvent.id)) eventsById.set(ndkEvent.id, ndkEvent)
	}
	return new Set(eventsById.values())
}

/** First matching event from a seam fetch, or null when nothing matched. */
export async function fetchNdkEvent(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
	opts?: FetchOptions,
): Promise<NDKEvent | null> {
	const events = await fetchNdkEventSet(nostrIo, ndk, filter, opts)
	return events.size > 0 ? Array.from(events)[0] : null
}

/**
 * Latest (highest created_at) event from a seam fetch, or null. The
 * relay-pinned replacement for `fetchLatestAppEvent` in flipped modules:
 * pass `relayUrls` to pin the read, and null `ndk` mirrors the original's
 * "NDK or app relay not ready -> null" behavior.
 */
export async function fetchLatestNdkEvent(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext | null,
	filter: NDKFilter | NDKFilter[],
	opts?: FetchOptions,
): Promise<NDKEvent | null> {
	if (!ndk) return null
	const events = Array.from(await fetchNdkEventSet(nostrIo, ndk, filter, opts))
	if (events.length === 0) return null
	return events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
}

export function mergeNdkEventSetsById(...eventSets: Set<NDKEvent>[]): Set<NDKEvent> {
	const eventsById = new Map<string, NDKEvent>()
	for (const eventSet of eventSets) {
		for (const event of eventSet) {
			if (!eventsById.has(event.id)) eventsById.set(event.id, event)
		}
	}
	return new Set(eventsById.values())
}

/**
 * Mirrors `ndk.fetchUser(identifier)` without relay I/O: decodes npub,
 * nprofile, and hex identifiers into an `NDKUser` attached to the ndk
 * instance, and resolves NIP-05 identifiers via the HTTP
 * `.well-known/nostr.json` lookup (`NDKUser.fromNip05` — identity
 * resolution, not relay I/O; it moves with the user/signer migration).
 *
 * Parity with NDK's fetchUser:
 * - throws `Invalid npub: <input>` / `Invalid nprofile: <input>` on
 *   malformed bech32 exactly as NDK does;
 * - NIP-05 dispatch matches NDK's `isValidNip05` (any string containing a
 *   dot); fromNip05 returns undefined (not null) on failed lookups.
 */
export async function fetchNdkUser(ndk: NDK, identifier: string): Promise<NDKUser | undefined> {
	// Matches NDK's isValidNip05: a dot anywhere means "try NIP-05".
	if (identifier.includes('.')) {
		return NDKUser.fromNip05(identifier, ndk)
	}
	if (identifier.startsWith('npub1') || identifier.startsWith('nprofile1')) {
		const { type, data } = nip19.decode(identifier)
		const user =
			type === 'npub'
				? new NDKUser({ pubkey: data as string })
				: type === 'nprofile'
					? new NDKUser({ pubkey: data.pubkey, relayUrls: data.relays })
					: null
		if (!user) throw new Error(`Invalid npub: ${identifier}`)
		user.ndk = ndk
		return user
	}
	// Hex pubkey (NDK's fall-through: no validation, NDKUser handles it).
	const user = new NDKUser({ pubkey: identifier })
	user.ndk = ndk
	return user
}

/**
 * `user.fetchProfile()` re-implemented on the seam: fetch the latest kind-0
 * metadata event through the applesauceIo port (verifying, deduping, and
 * rehydrating raw events), then parse it with NDK's `profileFromEvent` so
 * the returned `NDKUserProfile` is byte-identical to NDK's (including the
 * stringified `profileEvent` field and `created_at`).
 *
 * Behavior parity with NDK's fetchProfile:
 * - null when no kind-0 event exists (genuine absence);
 * - throws when the metadata event content fails JSON.parse, exactly as
 *   `profileFromEvent` does;
 * - NDK's cacheAdapter branch is unreachable in this app (no cache
 *   configured), so the relay fetch is the only live path.
 */
export async function fetchNdkUserProfile(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NDK,
	pubkey: string,
	opts?: FetchOptions,
): Promise<NDKUserProfile | null> {
	const metadataEvent = await fetchLatestNdkEvent(nostrIo, ndk, { kinds: [0], authors: [pubkey] }, opts)
	if (!metadataEvent) return null
	return profileFromEvent(metadataEvent)
}

/**
 * `user.getZapInfo()` re-implemented with the kind-0 profile read on the
 * seam. Parity notes:
 * - nip57 is set whenever a profile exists — even without lud06/lud16 —
 *   matching NDK exactly;
 * - the kind-10019 (CashuMintList) read stays on `ndk.fetchEvent` for now:
 *   it feeds NDKCashuMintList parsing, which moves with the nutzap batch,
 *   not this one;
 * - the `promiseWithTimeout` race keeps NDK's quirk: on timeout it falls
 *   back to awaiting the original promise, swallowing errors to undefined.
 */
export async function fetchNdkUserZapInfo(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NDK,
	pubkey: string,
	timeoutMs?: number,
): Promise<Map<NDKZapMethod, NDKZapMethodInfo>> {
	const promiseWithTimeout = async <T>(promise: Promise<T>): Promise<T | undefined> => {
		if (!timeoutMs) return promise

		let timeoutId: ReturnType<typeof setTimeout> | undefined
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => reject(new Error('Timeout')), timeoutMs)
		})

		try {
			const result = await Promise.race([promise, timeoutPromise])
			if (timeoutId) clearTimeout(timeoutId)
			return result
		} catch (e) {
			if (e instanceof Error && e.message === 'Timeout') {
				try {
					const result = await promise
					return result
				} catch (_originalError) {
					return undefined
				}
			}
			return undefined
		}
	}

	const [userProfile, mintListEvent] = await Promise.all([
		promiseWithTimeout(fetchNdkUserProfile(nostrIo, ndk, pubkey)),
		promiseWithTimeout(ndk.fetchEvent({ kinds: [10019], authors: [pubkey] })),
	])

	const res: Map<NDKZapMethod, NDKZapMethodInfo> = new Map()

	if (mintListEvent) {
		const mintList = NDKCashuMintList.from(mintListEvent)
		if (mintList.mints.length > 0) {
			res.set('nip61', {
				mints: mintList.mints,
				relays: mintList.relays,
				p2pk: mintList.p2pk,
			})
		}
	}

	if (userProfile) {
		const { lud06, lud16 } = userProfile
		res.set('nip57', { lud06, lud16 })
	}

	return res
}

/**
 * Compute the NDKWoT score for `pubkey`, rooting the follow graph at the
 * TARGET pubkey (`new NDKWoT(ndk, pubkey)`), exactly as the original
 * profiles.tsx `getWotScore` did. `ndk.activeUser` is only a caller-side
 * guard, not the graph root — see the wotScore query options. The kind-3
 * contact-list fetches NDKWoT performs internally stay on NDK for now:
 * they move with the WoT batch, not this one. Wrapping here moves the
 * `@nostr-dev-kit/wot` literal out of `src/queries/` (ADR-0002 footprint
 * ratchet: relay-adjacent NDK mechanics live behind lib files).
 *
 * Caller keeps the activeUser guard and try/catch→null: this helper returns
 * a number (0 when no score) and never null.
 */
export async function fetchNdkWoTScore(ndk: NDK, pubkey: string): Promise<number> {
	const wot = new NDKWoT(ndk, pubkey)
	await wot.load({
		depth: 2,
		maxFollows: 1000,
		timeout: 1000,
	})

	return wot.getScores([pubkey]).get(pubkey) || 0
}
