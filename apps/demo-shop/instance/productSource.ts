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
 *
 * ## The kind-30406 read is a **method on this port**, not a second port
 *
 * `listShippingRecords()` is the kind-30406 corpus **this same edge** read. It is a
 * method rather than a second port for one reason: the shipping corpus has to come from
 * the edge that answered the listings. A second port could be resolved from a different
 * edge, and a view would then join one edge's refs to another edge's records without
 * being able to say which edge it read. `null` is emitted only where a source performs
 * **no** shipping read at all; an empty array is a read that answered nothing. Those are
 * two different statements, and `instance/shippingSource.ts` is where the view says which
 * one it is.
 *
 * Neither adapter infers anything from a shipping ref's text: the corpus goes to
 * `sdk/commerce/shipping/shippingRead.ts`, which resolves a record into a service or
 * refuses it **by name** — a malformed kind-30406 event is never silently dropped
 * (AGENTS.md: "a silent disappearance is not an acceptable outcome").
 */

import { createNostrIo, type NostrIo, type NostrIoOptions } from '@sdk/core/nostr-io/ts/index'
import { getProductCoordinates, type ProductReadEvent } from '@sdk/commerce/discovery'
import type { ShippingOptionReadEvent } from '@sdk/commerce/shipping/shippingRead'
import { SHIPPING_OPTION_KIND } from '@sdk/commerce/shipping/shippingWorkflow'

import { admitProductListing } from './productAdmission'
import { buildShippingCatalogEvents } from './shippingSource'

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
	/**
	 * The kind-30406 records **this same edge** read, or `null` where the edge performed
	 * no shipping read at all.
	 *
	 * `null` and `[]` are different statements and both are kept: `null` is "this edge
	 * read no shipping corpus", `[]` is "it read, and the answer held no record". The
	 * shipping view names which one (`instance/shippingSource.ts`), so an edge that read
	 * nothing can never be reported as a seller who published nothing.
	 */
	listShippingRecords(): Promise<readonly ShippingOptionReadEvent[] | null>
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
 * Admission still applies: the same parser that guards the relay edge guards the
 * instance's own catalog, so there is exactly one definition of "a row" in this
 * app and no path that can render something the repository would reject (see
 * `instance/parserAgreement.test.ts` for what that costs today).
 *
 * The returned items are shallow copies, so a caller that mutates what it was
 * handed cannot corrupt the next read of the same source.
 */
export function createFixtureProductSource(
	events: readonly ProductReadEvent[],
	options: {
		admit?: ((event: unknown) => ProductReadEvent | null) | null
		/**
		 * The kind-30406 corpus this fixture edge read. Defaults to the demo's own record
		 * (`instance/shippingSource.ts`), so a fixture boot resolves the demo seller's
		 * published ref exactly as before. `null` states that this fixture edge reads no
		 * shipping corpus at all — the one case the shipping view reports as
		 * `not-read-on-this-edge`.
		 */
		shippingRecords?: readonly ShippingOptionReadEvent[] | null
	} = {},
): ProductSource {
	const admit = options.admit === undefined ? admitProductListing : options.admit
	const shippingRecords = options.shippingRecords === undefined ? buildShippingCatalogEvents() : options.shippingRecords

	return {
		kind: 'fixture',
		async listProducts() {
			const admitted: ProductReadEvent[] = []
			for (const event of events) {
				const copy = { ...event, tags: event.tags.map((tag) => [...tag]) }
				const item = admit ? admit(copy) : copy
				if (item) admitted.push(item)
			}
			return latestRevisionPerAddress(admitted)
		},
		async listShippingRecords() {
			if (shippingRecords === null) return null
			return shippingRecords.map((record) => ({ ...record, tags: record.tags.map((tag) => [...tag]) }))
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
	/** How many kind-30406 records to ask for in one read. Defaults to `limit`. */
	shippingLimit?: number
	/** Wall-clock budget on the shipping read. Defaults to `deadlineMs`. */
	shippingDeadlineMs?: number
}

/**
 * A source that reads listings from relays through the SDK's I/O seam.
 *
 * A relay that refuses mid-read is a value on `WireResult.failures`, not a
 * thrown error (`nostr-io.md`), so the events that did arrive are still rendered
 * and the count of refusals is reported rather than swallowed.
 *
 * The same seam, over the same injected transport, reads the second kind this app
 * needs: kind-30406 shipping records (`listShippingRecords`). That is the read that makes
 * a **live** listing's shipping ref resolvable; before it, `servicesByShippingRef` was
 * empty by construction on this edge and no chosen ref could resolve.
 */
export function createRelayProductSource(options: RelayProductSourceOptions): ProductSource {
	const limit = options.limit ?? 200
	const deadlineMs = options.deadlineMs ?? 5_000
	const admit = options.admit ?? admitProductListing
	const shippingLimit = options.shippingLimit ?? limit
	const shippingDeadlineMs = options.shippingDeadlineMs ?? deadlineMs

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
		async listShippingRecords() {
			// Read, not guessed, and not admitted here: the admission for kind 30406 is
			// `readShippingOptions` itself, which partitions the corpus into resolved records
			// and **named refusals** rather than dropping a malformed event
			// (`sdk/commerce/shipping/shippingRead.ts`, "A malformed event is REFUSED, never
			// dropped"). An answer with no event is an empty corpus, not `null`: this edge
			// performed the read, and the shipping view says exactly that.
			const wire = await options.io.query(
				{ kinds: [SHIPPING_OPTION_KIND], limit: shippingLimit },
				{ deadlineMs: shippingDeadlineMs },
			)
			return wire.events
		},
	}
}
