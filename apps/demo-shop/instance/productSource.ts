/**
 * instance/productSource.ts — **the injected edge**.
 *
 * Everything above this file works on product items. This file is the one place
 * that decides where items come from, and it is written so that the decision is
 * always supplied by the caller rather than reached for:
 *
 * - `createFixtureProductSource(events)` — offline. No socket, no fetch, no
 *   clock. This is what the demo instance serves and what tests use, so the
 *   whole app can be exercised with nothing on the wire (ADR-0005).
 * - `createRelayProductSource({ io, ... })` — reads kind-30402 listings through
 *   the SDK's own Nostr I/O seam (`sdk/core/nostr-io`). The seam takes its
 *   transport as an injected `PoolPort`, so a test supplies a hand-written pool
 *   and no socket is opened: the injection is the seam's, not this file's.
 *
 * Both adapters end at the same two rules, which is the point of a port:
 * **admit before rendering** (AGENTS.md, "Event Validation Before Surfacing") and
 * **one head per addressable address** (a kind-30402 event is addressable, so a
 * stale revision must never be listed beside its own replacement).
 */

import { createNostrIo, type NostrIo, type NostrIoOptions } from '@sdk/core/nostr-io/ts/index'
import { getProductCoordinates, type ProductReadEvent } from '@sdk/commerce/discovery'

import { admitProductListing } from './productAdmission'

/**
 * The transport type as the contract entry exposes it. `nostr-io`'s entry declares
 * `NostrIoOptions` but deliberately not the internal `PoolPort`, so the pool is
 * named through the option it fills rather than by reaching into the module's
 * implementation files.
 */
export type InjectedPool = NonNullable<NostrIoOptions['pool']>

/** The NIP-99 listing kind (`sdk/commerce/products/validationDeclaration.ts`). */
export const PRODUCT_LISTING_KIND = 30402

/** What the rest of the app depends on. Note what is absent: no relay, no fetch, no store. */
export interface ProductSource {
	/** Which edge answered, for the page's own honesty about its data. */
	readonly kind: 'fixture' | 'relay'
	listProducts(): Promise<ProductReadEvent[]>
}

/**
 * Keep one revision per addressable address — the greatest `created_at`, arrival
 * order never deciding.
 *
 * The SDK owns this rule once, in `sdk/core/event-store`'s `collapseToHeads`,
 * but that function takes full `Event`s (`kind`, `id`, `created_at`) while the
 * discovery read model hands back a `ProductReadEvent` projection with no `id`
 * and no `kind`. So the app re-states the rule over the projection rather than
 * importing it. That duplicate is a named need, not a preference.
 */
export function latestRevisionPerAddress(events: readonly ProductReadEvent[]): ProductReadEvent[] {
	const heads = new Map<string, ProductReadEvent>()
	for (const event of events) {
		const address = getProductCoordinates(event)
		const incumbent = heads.get(address)
		if (!incumbent || (event.created_at ?? 0) > (incumbent.created_at ?? 0)) heads.set(address, event)
	}
	return [...heads.values()]
}

/**
 * An offline source over an already-known set of events.
 *
 * The returned items are shallow copies, so a caller that mutates what it was
 * handed cannot corrupt the next read of the same source.
 */
export function createFixtureProductSource(events: readonly ProductReadEvent[]): ProductSource {
	return {
		kind: 'fixture',
		async listProducts() {
			return latestRevisionPerAddress(events.map((event) => ({ ...event, tags: event.tags.map((tag) => [...tag]) })))
		},
	}
}

/** The Norse I/O seam this instance composes. `pool` present means a caller-supplied transport. */
export function createInstanceNostrIo(options: { relayUrls: readonly string[]; pool?: InjectedPool }): NostrIo {
	return createNostrIo({
		// ARD-0021, "relay policy is injected, never owned": the relay set is the
		// instance config's answer, read on every call.
		policy: () => [...options.relayUrls],
		...(options.pool ? { pool: options.pool } : {}),
	})
}

export interface RelayProductSourceOptions {
	/** The composed seam. Its transport is already the caller's choice. */
	io: NostrIo
	/** How many listings to ask for in one read. */
	limit?: number
	/** Wall-clock budget on the read, so a silent relay cannot hold the page open. */
	deadlineMs?: number
	/** Admission predicate, injected so a test can drive the drop path. */
	admit?: (event: unknown) => ProductReadEvent | null
}

/**
 * A source that reads listings from relays through the SDK's I/O seam.
 *
 * A relay that refuses mid-read is a value on `WireResult.failures`, not a
 * thrown error (`nostr-io.md`), so the events that did arrive are still rendered
 * and the count of refusals is reported rather than swallowed.
 */
export function createRelayProductSource(options: RelayProductSourceOptions): ProductSource {
	const limit = options.limit ?? 200
	const deadlineMs = options.deadlineMs ?? 5_000
	const admit = options.admit ?? admitProductListing

	return {
		kind: 'relay',
		async listProducts() {
			const wire = await options.io.query({ kinds: [PRODUCT_LISTING_KIND], limit }, { deadlineMs })

			const admitted: ProductReadEvent[] = []
			for (const event of wire.events) {
				const item = admit(event)
				if (item) admitted.push(item)
			}

			return latestRevisionPerAddress(admitted)
		},
	}
}