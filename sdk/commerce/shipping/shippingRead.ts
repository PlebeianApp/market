/**
 * shippingRead.ts — **the typed read for kind 30406**: one untrusted event in, one shipping service
 * out, carrying the UNIT of the amount it charges — or a refusal that names the constraint that failed.
 *
 * ## Why this file exists
 *
 * `shippingWorkflow.ts` is the module's **write** side: it builds the kind-30406 tags a seller
 * publishes. Nothing in `sdk/` read a 30406 event back, so the checkout's
 * `servicesByShippingRef` map could only ever be empty and a chosen shipping ref always resolved as
 * unresolved, and a surface could print a shipping amount **with no unit** because no read carried
 * one. This is that read.
 *
 * ## The definition this read conforms to (it is not a second one)
 *
 * The repository's single definition of a valid kind-30406 item is
 * `src/lib/schemas/shippingOption.ts#ShippingOptionSchema` — the parser
 * `sdk/commerce/shipping/validationDeclaration.ts` already **cites** (never imports: `src/` is outside
 * `sdk/` and `sdk/boundary.test.ts` forbids an import that escapes `sdk/`). This read does not restate
 * that parser's validity in a new grammar; it reads **the same tag grammar** the parser declares, and
 * refuses on exactly the same required set:
 *
 * - required tags, the parser's `refine`: `d`, `title`, `price`, `country`, `service`;
 * - the `price` tag's shape, the parser's `ShippingPriceTagSchema`:
 *   `['price', <decimal>, <ISO 4217 currency>]` — **the unit is the tag's third element**;
 * - the `service` domain, the parser's `ShippingServiceTagSchema`:
 *   `['standard', 'express', 'overnight', 'pickup', 'digital']`.
 *
 * What this read adds to the citation is the **value**: the resolved service, and — the fix — a
 * `price` whose `unit` is a required field rather than an element a caller may forget to look at. A
 * `ShippingOptionPrice` cannot be constructed without its unit, so the defect ("an amount printed with
 * no unit") is unrepresentable in the type, not merely absent from one call site.
 *
 * ## A malformed event is REFUSED, never dropped
 *
 * `AGENTS.md`'s rule is explicit: *"a silent disappearance … is not an acceptable outcome."* So this
 * read is **total over the corpus**: `readShippingOptions` partitions every input event into a resolved
 * service or a `ShippingOptionRefusal`, and `services + refusals` always equals the input count. Each
 * refusal names the **constraint that failed** in the engine's own refusal style
 * (`sdk/core/composition/ts/notice.ts`'s `check`/`requirement`/`tag` shape): the closed constraint id,
 * the **tag the publisher wrote**, and the ref when one could be built.
 *
 * ## ASSUMPTIONS
 *
 * Stated **as assumptions**, each with what would falsify it (`SHIPPING_READ_ASSUMPTIONS`, a value a
 * test — and an app's on-screen assumption register — can read). They are not findings; they are the
 * judgements this read makes so that it can answer at all.
 */

import { SHIPPING_OPTION_KIND, type ShippingService } from './shippingWorkflow'

/**
 * The prefix a shipping **ref** carries — the kind, spelled as the ref spells it (`30406:…`). Derived
 * from the module's own kind constant rather than re-typed, so the two cannot drift.
 */
export const SHIPPING_REF_KIND = String(SHIPPING_OPTION_KIND)

/**
 * The ref grammar the rest of the repository already enforces — `sdk/commerce/cart/cartIntent.ts`'s
 * `SHIPPING_REF_REGEX`, `/^30406:[a-f0-9]{64}:[^\s]+$/i`. A 30406 event can only be *the* event a
 * chosen ref names if its envelope `pubkey` and its `d` build a ref in this shape.
 */
const SHIPPING_REF_REGEX = /^[0-9a-f]{64}$/i

/** The parser's own `iso4217Currency` rule (`src/lib/schemas/common.ts`): three upper-case letters. */
const ISO_4217_CURRENCY = /^[A-Z]{3}$/

/** The parser's own decimal rule for the amount element (`ShippingPriceTagSchema`). */
const DECIMAL_AMOUNT = /^\d+(\.\d+)?$/

/**
 * **The parser's closed service domain**, transcribed as the parser's own values
 * (`ShippingServiceTagSchema`) — the five-member enum, not re-derived from the write side's union.
 */
export const SHIPPING_SERVICE_DOMAIN: readonly ShippingService[] = Object.freeze([
	'standard',
	'express',
	'overnight',
	'pickup',
	'digital',
])

/**
 * **The closed constraint vocabulary this read refuses with.** `'missing-tag'` is the engine's own
 * `ValidationRequirement` name, reused because it means exactly the same thing here. The other five are
 * constraints the landed data-only engine **cannot express** (`design.md` §4.2b): it reads tag presence
 * and tag value domains, never a tag's *elements*, so "the `price` tag has no third element" and
 * "the seller cannot name a ref" have no check to live in. They are named here as a **declared gap**,
 * never silently passed over.
 */
export type ShippingOptionConstraint =
	| 'not-a-shipping-option'
	| 'missing-seller'
	| 'missing-tag'
	| 'missing-price-unit'
	| 'bad-price-unit'
	| 'bad-price-amount'
	| 'unknown-service'

/** The closed list, as a value a test reads (`design.md` §4.6: a fact, never a silence). */
export const SHIPPING_OPTION_CONSTRAINTS: readonly ShippingOptionConstraint[] = Object.freeze([
	'not-a-shipping-option',
	'missing-seller',
	'missing-tag',
	'missing-price-unit',
	'bad-price-unit',
	'bad-price-amount',
	'unknown-service',
])

/**
 * The event view this read consumes — the SDK's own read-model shape (the same fields
 * `sdk/commerce/discovery` reads), never a wrapper and never the raw signed event. `created_at` and
 * `content` are carried because they are the envelope's, but neither is required to resolve a service.
 */
export interface ShippingOptionReadEvent {
	readonly kind?: number
	readonly pubkey?: string
	readonly created_at?: number
	readonly content?: string
	readonly tags: readonly (readonly string[])[]
}

/**
 * **An amount bound to its unit.** The unit is the `price` tag's third element — an ISO 4217 code —
 * and it is **not optional**: a caller cannot hold an amount that has no unit, which is the defect
 * this read exists to make unrepresentable.
 */
export interface ShippingOptionPrice {
	readonly amount: string
	readonly unit: string
}

/** One resolved kind-30406 shipping service, with the fields a checkout resolves a ref against. */
export interface ShippingOptionRecord {
	/** `30406:<seller pubkey>:<d>` — the string a listing's `shipping_option` tag carries. */
	readonly ref: string
	readonly sellerPubkey: string
	readonly id: string
	readonly title: string
	readonly description: string
	readonly service: ShippingService
	/** The published amount **and its unit**. */
	readonly price: ShippingOptionPrice
	readonly countries: readonly string[]
	readonly carrier?: string
	readonly duration?: { readonly min: string; readonly max: string; readonly unit: string }
}

/** A refusal: the constraint that failed, the ref when one could be built, and the tag that failed. */
export interface ShippingOptionRefusal {
	readonly constraint: ShippingOptionConstraint
	/** The ref the event names, when the envelope and `d` let one be built; `null` otherwise. */
	readonly ref: string | null
	/**
	 * The tag the publisher wrote, scoped to the failure — the engine's own `ValidationRefusal.tag`
	 * shape (`notice.ts`), so a notice can name the tag **from the refusal** and never re-derive it.
	 * Absent for the two envelope-level constraints (`not-a-shipping-option`, `missing-seller`).
	 */
	readonly tag?: string
	/** The constraint's own words: which rule failed and why. */
	readonly message: string
}

/** The read's answer: a resolved service, or a refusal that names the constraint. */
export type ShippingOptionRead =
	| { readonly outcome: 'read'; readonly service: ShippingOptionRecord }
	| { readonly outcome: 'refused'; readonly refusal: ShippingOptionRefusal }

/** The partition of a corpus: what resolved, and every refusal — never a silent drop. */
export interface ShippingOptionReadResult {
	readonly services: readonly ShippingOptionRecord[]
	readonly refusals: readonly ShippingOptionRefusal[]
}

/**
 * **The domain assumptions this read makes**, stated as assumptions with their falsifiers. A value a
 * test reads and an app's on-screen assumption register can render (`design.md` §4.6: named, never a
 * silence). Each `falsifiedBy` is the observation that would show the assumption false.
 */
export const SHIPPING_READ_ASSUMPTIONS: readonly { readonly assumption: string; readonly falsifiedBy: string }[] =
	Object.freeze([
		{
			assumption: "a kind-30406 `price` tag carries its unit as the tag's third element (`['price', <decimal>, <ISO 4217>]`), which is the cited parser's own shape.",
			falsifiedBy: 'a 30406 event in the wild whose amount is denominated by a separate tag, or one that legitimately ships a price with no denomination at all.',
		},
		{
			assumption: 'a chosen shipping ref is `30406:<seller pubkey>:<d>` (the grammar `cartIntent.ts` already enforces), so the event envelope pubkey is required for the event to be the one a ref names.',
			falsifiedBy: "a chosen ref whose middle segment is not the resolved event's own `pubkey` — e.g. a ref minted against a mirror or rebroadcast address.",
		},
		{
			assumption: "the service is drawn from the cited parser's closed five-member domain, so an unknown service is refused rather than defaulted to `standard`.",
			falsifiedBy: "a real 30406 event whose `service` is a value outside the parser's enum (e.g. `freight`) that the app must still render.",
		},
		{
			assumption: "this read refuses on the cited parser's full required set (`d`, `title`, `price`, `country`, `service`) even though checkout alone needs only the service and the price — so it cannot admit an item the repository's parser would reject.",
			falsifiedBy: 'a legitimate 30406 event that resolves in checkout yet fails the repository parser on one of those tags.',
		},
		{
			assumption: "only the `price` tag's unit is asserted here; the other unit-carrying tags (`weight-min`, `dim-max`, `price-weight`, …) are not read by this increment.",
			falsifiedBy: 'a surface or checkout step that needs one of those units — that is, an amount taken from such a tag and printed without its unit.',
		},
	])

/** The first tag named `name`, or `undefined`. The read never walks beyond the first occurrence. */
function firstTag(tags: readonly (readonly string[])[], name: string): readonly string[] | undefined {
	return tags.find((tag) => tag[0] === name)
}

/** The non-empty element at `index` of the first `name` tag, or `undefined`. */
function element(tags: readonly (readonly string[])[], name: string, index: number): string | undefined {
	const value = firstTag(tags, name)?.[index]
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function refused(
	constraint: ShippingOptionConstraint,
	message: string,
	options: { ref?: string | null; tag?: string } = {},
): ShippingOptionRead {
	return {
		outcome: 'refused',
		refusal: {
			constraint,
			ref: options.ref ?? null,
			...(options.tag === undefined ? {} : { tag: options.tag }),
			message,
		},
	}
}

/**
 * **Read one kind-30406 event into a shipping service, or refuse it naming the constraint.**
 *
 * The constraints are checked in a fixed order — the envelope's kind and seller, then the parser's
 * required tags — and the first failure is the refusal. The read **never repairs** the event: no missing
 * unit is defaulted, no unknown service is coerced, no absent tag is synthed (`#0df9fb`).
 */
export function readShippingOption(event: ShippingOptionReadEvent | null | undefined): ShippingOptionRead {
	if (!event || event.kind !== SHIPPING_OPTION_KIND) {
		return refused(
			'not-a-shipping-option',
			`not a kind-${SHIPPING_OPTION_KIND} shipping option: the event carries kind ${event?.kind ?? 'nothing'}`,
		)
	}

	const tags = event.tags ?? []

	// The ref is built FIRST when it can be, so every later refusal can name the ref it belongs to.
	const seller = typeof event.pubkey === 'string' ? event.pubkey : ''
	const id = element(tags, 'd', 1)
	if (!SHIPPING_REF_REGEX.test(seller)) {
		return refused(
			'missing-seller',
			`the event cannot be the one a shipping ref names: its envelope pubkey is not a 64-hex seller (it is ${seller ? `'${seller}'` : 'absent'})`,
			{ ref: id ? `${SHIPPING_REF_KIND}:${seller}:${id}` : null },
		)
	}
	const ref = id ? `${SHIPPING_REF_KIND}:${seller}:${id}` : null

	if (!id) {
		return refused('missing-tag', 'the required `d` tag is missing or empty — a shipping option has no id', { ref: null, tag: 'd' })
	}
	if (element(tags, 'title', 1) === undefined) {
		return refused('missing-tag', 'the required `title` tag is missing or empty', { ref, tag: 'title' })
	}

	const price = firstTag(tags, 'price')
	if (price === undefined) {
		return refused('missing-tag', 'the required `price` tag is missing', { ref, tag: 'price' })
	}
	const amount = price[1]
	if (typeof amount !== 'string' || !DECIMAL_AMOUNT.test(amount)) {
		return refused('bad-price-amount', `the \`price\` tag's amount ${amount === undefined ? 'is absent' : `'${amount}'`} is not a decimal number`, {
			ref,
			tag: 'price',
		})
	}
	// **The defect, refused by name.** An amount with no third element has no unit — the read will not
	// invent one, and it will not hand back an amount whose unit is a mystery.
	const unit = price[2]
	if (typeof unit !== 'string' || unit.length === 0) {
		return refused(
			'missing-price-unit',
			`the \`price\` tag's amount '${amount}' carries no unit: the tag has no third element, so the amount is denominated in nothing`,
			{ ref, tag: 'price' },
		)
	}
	if (!ISO_4217_CURRENCY.test(unit)) {
		return refused('bad-price-unit', `the \`price\` tag's unit '${unit}' is not an ISO 4217 currency code (three upper-case letters)`, {
			ref,
			tag: 'price',
		})
	}

	if (element(tags, 'country', 1) === undefined) {
		return refused('missing-tag', 'the required `country` tag is missing or empty', { ref, tag: 'country' })
	}

	const service = element(tags, 'service', 1)
	if (service === undefined) {
		return refused('missing-tag', 'the required `service` tag is missing or empty', { ref, tag: 'service' })
	}
	if (!(SHIPPING_SERVICE_DOMAIN as readonly string[]).includes(service)) {
		return refused('unknown-service', `the \`service\` value '${service}' is outside the declared domain (${SHIPPING_SERVICE_DOMAIN.join(', ')})`, {
			ref,
			tag: 'service',
		})
	}

	const countries = tags
		.filter((tag) => tag[0] === 'country')
		.flatMap((tag) => tag.slice(1).filter((value): value is string => typeof value === 'string' && value.length > 0))

	const carrier = element(tags, 'carrier', 1)
	const durationMin = element(tags, 'duration', 1)
	const durationMax = element(tags, 'duration', 2)
	const durationUnit = element(tags, 'duration', 3)

	return {
		outcome: 'read',
		service: {
			ref,
			sellerPubkey: seller,
			id,
			title: element(tags, 'title', 1) as string,
			description: typeof event.content === 'string' ? event.content : '',
			service: service as ShippingService,
			price: { amount, unit },
			countries,
			...(carrier === undefined ? {} : { carrier }),
			...(durationMin !== undefined && durationMax !== undefined && durationUnit !== undefined
				? { duration: { min: durationMin, max: durationMax, unit: durationUnit } }
				: {}),
		},
	}
}

/**
 * **Read a corpus.** Every event becomes a resolved service or a named refusal, and nothing is dropped:
 * `services.length + refusals.length` is always the input count. A caller that ignores `refusals` has
 * chosen to, and the doctrine's "no silent disappearance" is honoured by the value being there.
 */
export function readShippingOptions(events: readonly ShippingOptionReadEvent[]): ShippingOptionReadResult {
	const services: ShippingOptionRecord[] = []
	const refusals: ShippingOptionRefusal[] = []
	for (const event of events) {
		const read = readShippingOption(event)
		if (read.outcome === 'read') services.push(read.service)
		else refusals.push(read.refusal)
	}
	return { services, refusals }
}

/**
 * **The map the checkout resolves a chosen ref against.** `resolveCheckoutDeliveryRequirements` takes
 * `servicesByShippingRef: Record<string, string | null | undefined>`; this is that map, built from the
 * read's resolved services. Only a ref that **resolved** appears — an unresolved ref is left out, which
 * is exactly how the checkout's own rule reports it as unresolved (never inferred from the ref's text).
 */
export function servicesByShippingRef(services: readonly ShippingOptionRecord[]): Record<string, ShippingService> {
	const byRef: Record<string, ShippingService> = {}
	for (const service of services) byRef[service.ref] = service.service
	return byRef
}

/**
 * The one call a host makes: a corpus of kind-30406 events in, the checkout's
 * `servicesByShippingRef` map out, **and** every refusal beside it. The refusals are returned, not
 * swallowed, so a surface can name what it could not resolve.
 */
export function resolveShippingServicesByRef(events: readonly ShippingOptionReadEvent[]): {
	readonly servicesByShippingRef: Record<string, ShippingService>
	readonly refusals: readonly ShippingOptionRefusal[]
} {
	const { services, refusals } = readShippingOptions(events)
	return { servicesByShippingRef: servicesByShippingRef(services), refusals }
}
