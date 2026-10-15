/**
 * view.ts — §4.8, the event view: pure functions over one already-obtained
 * event. They never touch the store and never touch the network.
 *
 * The identity and provenance helpers are the library's, **re-exported
 * verbatim** — E4's addressing vocabulary is NIP-19 and NIP-01 `kind`/`pubkey`/
 * `#d`, and re-spelling `kind:pubkey[:d]` by hand is how the market came to build
 * it in two places already.
 *
 * The pair that is **not** re-exported is the classification. The library ships a
 * same-named `isReplaceable(kind)` whose own doc returns true for `30000 <= n <
 * 40000` as well as 0/3/10000–19999 — it conflates *addressable* with
 * *replaceable*, and M3 needs them apart (one head per **address**). §4.8's pair
 * is `nostr-tools`' `isReplaceableKind` and `isAddressableKind`; neither implies
 * the other here.
 */
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds'

import type { Event } from './types'

/**
 * #a6d035 — createReplaceableAddress: the library's `kind:pubkey[:d]` coordinate, re-exported verbatim.
 * #76a7a3 — getEventUID: the address one head is resolved under.
 * #a6d035 — getReplaceableIdentifier: the `d` of an addressable event.
 * #e472d3 — tagValue: the first value of a named tag.
 * #004d63 — isFromCache: whether an event was answered from the local store.
 * #004d63 — markFromCache: mark an event as answered from the local store.
 */
export {
	createReplaceableAddress,
	getEventUID,
	getReplaceableIdentifier,
	getTagValue as tagValue,
	isFromCache,
	markFromCache,
} from 'applesauce-core/helpers'

/**
 * #e472d3 — getMatchingTags: every tag whose name is `tag`, in order.
 *
 * Every tag whose name is `tag`, in order. The library ships no equivalent; its
 * `getTagValue` is the first-match half and is re-exported above as `tagValue`,
 * so there is exactly one implementation of each.
 */
export function getMatchingTags(event: Event, tag: string): string[][] {
	return event.tags.filter((candidate) => candidate[0] === tag)
}

/** #76a7a3 — isReplaceable: `0`, `3` and `10000–19999`, the contract's own replaceable class. */
export function isReplaceable(kindOrEvent: number | Event): boolean {
	return isReplaceableKind(typeof kindOrEvent === 'number' ? kindOrEvent : kindOrEvent.kind)
}

/** #76a7a3 — isAddressable: `30000–39999`, addressable and never implied by `isReplaceable`. */
export function isAddressable(kindOrEvent: number | Event): boolean {
	return isAddressableKind(typeof kindOrEvent === 'number' ? kindOrEvent : kindOrEvent.kind)
}
