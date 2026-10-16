/**
 * The validated view — the only shape a UI component ever sees.
 *
 * Design decision D1 (recorded 2026-09-22): a component receives a **validated value**, never a raw
 * event. This is the correction to the earlier drafts of `browsing-implementation.md` §2, which had
 * `product: NostrEvent`. The reasons:
 *
 *   - a raw event lets a malformed listing reach a card and render;
 *   - it forces every component to re-validate on every render;
 *   - it makes the component's contract depend on the relay's data rather than on the spec.
 *
 * Consequence: the `getProduct*` helper family is gone. Once a listing is validated, its fields are
 * plain fields, not accessor functions that cast. The ~250 lines of casting getters collapse into
 * one parser plus this type.
 *
 * Design decision D2: `ParseResult.ok === true` may still carry `problems`. A malformed *optional*
 * tag is recorded and the field dropped, so a listing with a bad `weight` still resolves and the
 * surface can name what it could not read (browsing spec §3.4, "valid but unresolvable"). A
 * malformed *required* tag (`d`, `title`, `price`) is a rejection instead.
 */

/** NIP-36 warning values we recognise. Anything else is recorded as unrecognised. */
export const NSFW_WARNING_VALUES = ['nsfw'] as const

/** Gamma: no frequency means one-off; the vocabulary is ISO 8601 duration units. */
export type Frequency = 'H' | 'D' | 'W' | 'M' | 'Y'

export type ProductType = 'simple' | 'variable' | 'variation'
export type ProductFormat = 'digital' | 'physical'
export type ProductVisibility = 'hidden' | 'on-sale' | 'pre-order'

export interface ProductPrice {
	/** As published: a decimal string. Never coerced to a number — that is a display decision. */
	amount: string
	currency: string
	frequency?: Frequency
}

export interface ProductImage {
	url: string
	dimensions?: string
	/** Normalised sort position; absent order sorts last. */
	order?: number
}

export interface ProductSpec {
	key: string
	value: string
}

export interface ProductWeight {
	value: string
	unit: string
}

export interface ProductDimensions {
	/** `LxWxH`, as published. */
	dimensions: string
	unit: string
}

export interface ShippingOptionRef {
	reference: string
	extraCost?: string
}

export interface ProductReferences {
	/** The `variable` parent, when this listing is a variation (Gamma: MUST appear only once). */
	parent?: string
	/** Collections this listing claims membership of, via `a` → `30405:`. */
	collections: string[]
}

export interface ProductListing {
	// Identity — always available, never derived from display text.
	kind: 30402
	id: string
	pubkey: string
	createdAt: number
	/** `30402:<pubkey>:<d>` — the addressable identity (NIP-01). */
	coordinate: string
	dTag: string

	// Required by the spec (NIP-99 + Gamma).
	/** Markdown description (NIP-99). */
	content: string
	title: string
	/**
	 * Absent when the publisher stated no price. NIP-99 lists `price` as SHOULD while Gamma lists it as
	 * required, and live data shows a missing price is common — so the listing resolves and the absence
	 * is recorded as a problem rather than a rejection (decision D8 in `parse.ts`). A price that is
	 * present but unreadable is still a rejection, so this being `undefined` always means "omitted".
	 */
	price?: ProductPrice

	// Optional, with spec-defined defaults applied.
	summary?: string
	type: ProductType
	format: ProductFormat
	/** Gamma's default is `on-sale`; absent must not be read as "not for sale". */
	visibility: ProductVisibility
	stock?: number
	/** Derived at parse time from `stock` + `visibility` (see `deriveInStock`). */
	inStock: boolean
	images: ProductImage[]
	specs: ProductSpec[]
	categories: string[]
	location?: string
	geohash?: string
	weight?: ProductWeight
	dimensions?: ProductDimensions
	references: ProductReferences
	shippingOptions: ShippingOptionRef[]
	nsfw: boolean
}

/**
 * Reason codes are the fact; messages are presentation. Defined here so that every surface, button
 * and error component renders from the same vocabulary (architecture overview §4).
 */
export type ParseProblemCode =
	| 'not-an-event'
	| 'wrong-kind'
	| 'missing-identity'
	| 'malformed-identity'
	| 'missing-required-tag'
	| 'malformed-required-tag'
	| 'malformed-optional-tag'
	| 'unrecognised-warning-value'
	| 'duplicate-tag'

export interface ParseProblem {
	code: ParseProblemCode
	/** Human-readable, and deliberately not the thing callers branch on. */
	message: string
	/** The tag involved, when there is one. */
	tag?: string
	/** The view field affected, when there is one. */
	field?: string
}

export type ParseResult<T> = { ok: true; value: T; problems: readonly ParseProblem[] } | { ok: false; problems: readonly ParseProblem[] }
