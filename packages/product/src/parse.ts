/**
 * `parseListing` — the single judgement point for kind 30402.
 *
 * Everything that decides whether a relay event is a usable product listing happens here, once, at
 * the boundary. Nothing downstream re-validates and nothing downstream casts.
 *
 * The order below is the order the browsing spec requires (§3.2): shape → kind → identity →
 * required tags → optional tags → derivation. It stops at the first *required* failure; optional
 * failures are recorded and the field dropped.
 */
import { hexString } from './primitives'
import {
	ProductCategoryTagSchema,
	ProductContentWarningTagSchema,
	ProductDimensionsTagSchema,
	ProductGeohashTagSchema,
	ProductIdTagSchema,
	ProductImageTagSchema,
	ProductLocationTagSchema,
	ProductPriceTagSchema,
	ProductReferenceTagSchema,
	ProductShippingOptionTagSchema,
	ProductSpecTagSchema,
	ProductStockTagSchema,
	ProductSummaryTagSchema,
	ProductTitleTagSchema,
	ProductTypeTagSchema,
	ProductVisibilityTagSchema,
	ProductWeightTagSchema,
} from './tagSchemas'
import type {
	ParseProblem,
	ParseResult,
	ProductDimensions,
	ProductImage,
	ProductListing,
	ProductPrice,
	ProductReferences,
	ProductSpec,
	ProductType,
	ProductFormat,
	ProductVisibility,
	ProductWeight,
	ShippingOptionRef,
} from './types'
import { NSFW_WARNING_VALUES } from './types'

/** The NIP-99 kind this contract covers. */
export const PRODUCT_KIND = 30402 as const

/** A tag is `[name, ...values]`; the arrays are untrusted. */
type RawTag = unknown[]

interface RawEventLike {
	kind: number
	id: string
	pubkey: string
	created_at: number
	content: string
	tags: RawTag[]
}

const problem = (code: ParseProblem['code'], message: string, extra?: { tag?: string; field?: string }): ParseProblem => ({
	code,
	message,
	...extra,
})

/** Strict-ish shape check: we only require what we actually read. */
const asEventLike = (raw: unknown): RawEventLike | null => {
	if (typeof raw !== 'object' || raw === null) return null
	const e = raw as Record<string, unknown>
	if (!Array.isArray(e.tags)) return null
	return {
		kind: typeof e.kind === 'number' ? e.kind : NaN,
		id: typeof e.id === 'string' ? e.id : '',
		pubkey: typeof e.pubkey === 'string' ? e.pubkey : '',
		created_at: typeof e.created_at === 'number' ? e.created_at : NaN,
		content: typeof e.content === 'string' ? e.content : '',
		tags: e.tags as RawTag[],
	}
}

/** Tag names are compared exactly; a tag with no name is ignored. */
const tagsNamed = (tags: RawTag[], name: string): RawTag[] => tags.filter((t) => Array.isArray(t) && t[0] === name)

/**
 * Gamma: "no automatic cascading", and pre-order items are displayable before stock exists. This
 * preserves the application's existing rule exactly (`src/queries/products.tsx:109-123`) rather
 * than inventing one: pre-order is in stock, no `stock` tag is out of stock, `stock > 0` is in stock.
 */
export const deriveInStock = (stock: number | undefined, visibility: ProductVisibility): boolean => {
	if (visibility === 'pre-order') return true
	if (stock === undefined) return false
	return stock > 0
}

/**
 * Image order: "lowest to highest, independent of starting value" (Gamma). A non-transitive
 * comparator in the original getter (`if (a[3] && b[3]) … else return 0`) is replaced by an
 * explicit order with unordered images last, so the sort is total and stable.
 */
const sortImages = (images: ProductImage[]): ProductImage[] =>
	images
		.map((image, index) => ({ image, index }))
		.sort((a, b) => {
			const ao = a.image.order
			const bo = b.image.order
			if (ao === undefined && bo === undefined) return a.index - b.index
			if (ao === undefined) return 1
			if (bo === undefined) return -1
			return ao - bo
		})
		.map((entry) => entry.image)

/**
 * Validate the event and build the typed view.
 *
 * @param raw an untrusted value — typically straight from a relay.
 */
export const parseListing = (raw: unknown): ParseResult<ProductListing> => {
	const problems: ParseProblem[] = []

	const event = asEventLike(raw)
	if (!event) {
		return { ok: false, problems: [problem('not-an-event', 'Not an event-shaped object.')] }
	}
	if (event.kind !== PRODUCT_KIND) {
		return {
			ok: false,
			problems: [problem('wrong-kind', `Expected kind ${PRODUCT_KIND}, received ${String(event.kind)}.`)],
		}
	}

	// --- identity -----------------------------------------------------------------------------
	if (!event.id || !event.pubkey || !Number.isInteger(event.created_at) || event.created_at <= 0) {
		return { ok: false, problems: [problem('missing-identity', 'Event is missing id, pubkey or a positive created_at.')] }
	}
	if (!hexString.safeParse(event.id).success || !hexString.safeParse(event.pubkey).success) {
		return { ok: false, problems: [problem('malformed-identity', 'Event id or pubkey is not 64-character lowercase hex.')] }
	}

	// --- required tags ------------------------------------------------------------------------
	/**
	 * `d` and `title` are hard requirements: without them the listing has no addressable identity or
	 * nothing to display, so there is no useful view to build.
	 *
	 * `price` is deliberately different — see decision D8 below.
	 */
	const dTags = tagsNamed(event.tags, 'd')
	const titleTags = tagsNamed(event.tags, 'title')
	const priceTags = tagsNamed(event.tags, 'price')

	for (const [name, found] of [
		['d', dTags],
		['title', titleTags],
	] as const) {
		if (found.length === 0) {
			return {
				ok: false,
				problems: [problem('missing-required-tag', `Missing required tag: ${name}.`, { tag: name })],
			}
		}
		if (found.length > 1) {
			problems.push(problem('duplicate-tag', `Tag appears ${found.length} times; using the first.`, { tag: name, field: name }))
		}
	}
	if (priceTags.length > 1) {
		problems.push(problem('duplicate-tag', `Tag appears ${priceTags.length} times; using the first.`, { tag: 'price', field: 'price' }))
	}

	const dTagResult = ProductIdTagSchema.safeParse(dTags[0])
	if (!dTagResult.success) {
		return { ok: false, problems: [problem('malformed-required-tag', 'Tag `d` is malformed.', { tag: 'd', field: 'dTag' })] }
	}
	const titleResult = ProductTitleTagSchema.safeParse(titleTags[0])
	if (!titleResult.success) {
		return { ok: false, problems: [problem('malformed-required-tag', 'Tag `title` is malformed.', { tag: 'title', field: 'title' })] }
	}

	const dTag = dTagResult.data[1]

	/**
	 * Decision D8 (2026-09-22): an **absent** `price` is tolerated and named; a **malformed** one is
	 * refused.
	 *
	 * The asymmetry is the point, and it comes from the specs disagreeing plus live evidence. Gamma
	 * lists `price` as required; NIP-99 lists it as SHOULD. Measured against 40 live kind-30402 events,
	 * a missing price was the single largest cause of rejection (~17 of 40) — so requiring it would
	 * silently drop a fifth of the market, including listings a buyer can still usefully look at.
	 *
	 * But a price the publisher *did* state and we cannot read is a different case: dropping it to
	 * "no price" would misrepresent a listing that claims one, and a buyer could act on the omission.
	 * So: omission is tolerated and named; an unreadable assertion is refused.
	 */
	let price: ProductPrice | undefined
	if (priceTags.length === 0) {
		problems.push(
			problem('missing-required-tag', 'Tag `price` is absent; the listing resolves without a price.', {
				tag: 'price',
				field: 'price',
			}),
		)
	} else {
		const priceResult = ProductPriceTagSchema.safeParse(priceTags[0])
		if (!priceResult.success) {
			/** Also covers the frequency-vocabulary divergence: judged here, once. */
			return {
				ok: false,
				problems: [
					problem('malformed-required-tag', 'Tag `price` is malformed or uses an unrecognised frequency.', {
						tag: 'price',
						field: 'price',
					}),
				],
			}
		}
		price = {
			amount: priceResult.data[1],
			currency: priceResult.data[2],
			...(priceResult.data[3] ? { frequency: priceResult.data[3] } : {}),
		}
	}

	// --- optional tags: validate each, record what we cannot read, drop the field --------------
	const firstOf = <T>(
		name: string,
		schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
		field: string,
	): T | undefined => {
		const found = tagsNamed(event.tags, name)
		if (found.length === 0) return undefined
		const parsed = schema.safeParse(found[0])
		if (!parsed.success) {
			problems.push(problem('malformed-optional-tag', `Tag \`${name}\` is malformed and was ignored.`, { tag: name, field }))
			return undefined
		}
		return parsed.data
	}

	const typeTag = firstOf<[string, ProductType, ProductFormat]>('type', ProductTypeTagSchema, 'type')
	const visibilityTag = firstOf<[string, ProductVisibility]>('visibility', ProductVisibilityTagSchema, 'visibility')
	const stockTag = firstOf<[string, string]>('stock', ProductStockTagSchema, 'stock')
	const summaryTag = firstOf<[string, string]>('summary', ProductSummaryTagSchema, 'summary')
	const locationTag = firstOf<[string, string]>('location', ProductLocationTagSchema, 'location')
	const geohashTag = firstOf<[string, string]>('g', ProductGeohashTagSchema, 'geohash')
	const weightTag = firstOf<[string, string, string]>('weight', ProductWeightTagSchema, 'weight')
	const dimensionsTag = firstOf<[string, string, string]>('dim', ProductDimensionsTagSchema, 'dimensions')

	const stock = stockTag ? Number.parseInt(stockTag[1], 10) : undefined
	const visibility: ProductVisibility = visibilityTag?.[1] ?? 'on-sale'

	const images: ProductImage[] = []
	for (const tag of tagsNamed(event.tags, 'image')) {
		const parsed = ProductImageTagSchema.safeParse(tag)
		if (!parsed.success) {
			problems.push(problem('malformed-optional-tag', 'Tag `image` is malformed and was ignored.', { tag: 'image', field: 'images' }))
			continue
		}
		images.push({
			url: parsed.data[1],
			...(parsed.data[2] ? { dimensions: parsed.data[2] } : {}),
			...(parsed.data[3] !== undefined ? { order: Number.parseInt(parsed.data[3], 10) } : {}),
		})
	}

	const specs: ProductSpec[] = []
	for (const tag of tagsNamed(event.tags, 'spec')) {
		const parsed = ProductSpecTagSchema.safeParse(tag)
		if (!parsed.success) {
			problems.push(problem('malformed-optional-tag', 'Tag `spec` is malformed and was ignored.', { tag: 'spec', field: 'specs' }))
			continue
		}
		specs.push({ key: parsed.data[1], value: parsed.data[2] })
	}

	const categories: string[] = []
	for (const tag of tagsNamed(event.tags, 't')) {
		const parsed = ProductCategoryTagSchema.safeParse(tag)
		if (parsed.success) categories.push(parsed.data[1])
	}

	const references: ProductReferences = { collections: [] }
	for (const tag of tagsNamed(event.tags, 'a')) {
		const parsed = ProductReferenceTagSchema.safeParse(tag)
		if (!parsed.success) {
			problems.push(problem('malformed-optional-tag', 'Tag `a` is malformed and was ignored.', { tag: 'a', field: 'references' }))
			continue
		}
		const reference = parsed.data[1]
		if (reference.startsWith('30405:')) references.collections.push(reference)
		else if (references.parent === undefined) references.parent = reference
		else
			problems.push(
				problem('duplicate-tag', 'More than one `30402:` parent reference; using the first.', { tag: 'a', field: 'references' }),
			)
	}

	const shippingOptions: ShippingOptionRef[] = []
	for (const tag of tagsNamed(event.tags, 'shipping_option')) {
		const parsed = ProductShippingOptionTagSchema.safeParse(tag)
		if (!parsed.success) {
			problems.push(
				problem('malformed-optional-tag', 'Tag `shipping_option` is malformed and was ignored.', {
					tag: 'shipping_option',
					field: 'shippingOptions',
				}),
			)
			continue
		}
		shippingOptions.push({
			reference: parsed.data[1],
			...(parsed.data[2] !== undefined ? { extraCost: parsed.data[2] } : {}),
		})
	}

	/**
	 * Content warning. The value space is open (NIP-36), so we read a recognised value as NSFW and
	 * record anything else rather than silently treating it as safe — the original compared
	 * `=== 'nsfw'` at runtime while its schema rejected every other value.
	 */
	let nsfw = false
	for (const tag of tagsNamed(event.tags, 'content-warning')) {
		const parsed = ProductContentWarningTagSchema.safeParse(tag)
		if (!parsed.success) {
			problems.push(
				problem('malformed-optional-tag', 'Tag `content-warning` is malformed and was ignored.', {
					tag: 'content-warning',
					field: 'nsfw',
				}),
			)
			continue
		}
		const value = parsed.data[1]
		if ((NSFW_WARNING_VALUES as readonly string[]).includes(value)) nsfw = true
		else
			problems.push(
				problem('unrecognised-warning-value', `Unrecognised content-warning value "${value}"; not treated as NSFW.`, {
					tag: 'content-warning',
					field: 'nsfw',
				}),
			)
	}

	const weight: ProductWeight | undefined = weightTag ? { value: weightTag[1], unit: weightTag[2] } : undefined
	const dimensionsValue: ProductDimensions | undefined = dimensionsTag
		? { dimensions: dimensionsTag[1], unit: dimensionsTag[2] }
		: undefined

	const value: ProductListing = {
		kind: PRODUCT_KIND,
		id: event.id,
		pubkey: event.pubkey,
		createdAt: event.created_at,
		coordinate: `${PRODUCT_KIND}:${event.pubkey}:${dTag}`,
		dTag,
		content: event.content,
		title: titleResult.data[1],
		price,
		type: typeTag?.[1] ?? 'simple',
		format: typeTag?.[2] ?? 'digital',
		visibility,
		...(stock !== undefined && !Number.isNaN(stock) ? { stock } : {}),
		inStock: deriveInStock(stock !== undefined && !Number.isNaN(stock) ? stock : undefined, visibility),
		images: sortImages(images),
		specs,
		categories,
		...(summaryTag ? { summary: summaryTag[1] } : {}),
		...(locationTag ? { location: locationTag[1] } : {}),
		...(geohashTag ? { geohash: geohashTag[1] } : {}),
		...(weight ? { weight } : {}),
		...(dimensionsValue ? { dimensions: dimensionsValue } : {}),
		references,
		shippingOptions,
		nsfw,
	}

	return { ok: true, value, problems }
}

/** Convenience for callers that only need the predicate. */
export const isProductListing = (raw: unknown): boolean => parseListing(raw).ok
