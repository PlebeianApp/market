/**
 * Per-tag schemas for kind 30402.
 *
 * Extracted from `src/lib/schemas/productListing.ts`. The difference from the original is
 * structural, not semantic: the original wrapped all seventeen tag schemas in a single
 * `z.union` and validated the whole `tags` array through it. That means **any tag we do not know
 * causes the entire listing to fail**, which contradicts the spec's rule that unknown tags are
 * tolerated (browsing spec §3.2; NIP-99: "Other tags may be added as necessary").
 *
 * So the schemas live here individually and `parse.ts` looks each known tag up by name, validating
 * only what we claim to understand. Unknown tags pass through untouched.
 */
import { z } from 'zod'

import { addressableFormat, decimalNumber, dimensions, geohash, integerString, iso4217Currency, iso8601Duration } from './primitives'

// Required tags
export const ProductIdTagSchema = z.tuple([z.literal('d'), z.string()])
export const ProductTitleTagSchema = z.tuple([z.literal('title'), z.string()])

/**
 * `price` is `["price", "<amount>", "<currency>", "<frequency>?"]`.
 *
 * Expressed as a single tuple with an optional fourth element rather than a union of two tuples:
 * the union was redundant (the three-element form is the four-element form with the optional
 * element absent) and made `z.infer` resolve to a union that callers then had to narrow.
 */
export const ProductPriceTagSchema = z.tuple([z.literal('price'), decimalNumber, iso4217Currency, iso8601Duration.optional()])

// Optional tags
export const ProductTypeTagSchema = z.tuple([
	z.literal('type'),
	z.enum(['simple', 'variable', 'variation']),
	z.enum(['digital', 'physical']),
])

export const ProductVisibilityTagSchema = z.tuple([z.literal('visibility'), z.enum(['hidden', 'on-sale', 'pre-order'])])

export const ProductStockTagSchema = z.tuple([z.literal('stock'), integerString])

export const ProductSummaryTagSchema = z.tuple([z.literal('summary'), z.string()])

export const ProductSpecTagSchema = z.tuple([z.literal('spec'), z.string(), z.string()])

export const ProductImageTagSchema = z.tuple([
	z.literal('image'),
	z.string().url(),
	/** Dimensions are a placeholder empty string when unknown (Gamma). */
	z.string().optional(),
	/** Sorting order, "lowest to highest, independent of starting value" (Gamma). */
	integerString.optional(),
])

export const ProductWeightTagSchema = z.tuple([z.literal('weight'), decimalNumber, z.string()])

export const ProductDimensionsTagSchema = z.tuple([z.literal('dim'), dimensions, z.string()])

export const ProductLocationTagSchema = z.tuple([z.literal('location'), z.string()])

export const ProductGeohashTagSchema = z.tuple([z.literal('g'), geohash])

export const ProductCategoryTagSchema = z.tuple([z.literal('t'), z.string()])

/** `a` → a parent listing (`30402:`) or a collection (`30405:`). Gamma defines both. */
export const ProductReferenceTagSchema = z.tuple([
	z.literal('a'),
	addressableFormat.refine((val) => val.startsWith('30402:') || val.startsWith('30405:'), {
		message: 'Product reference must start with 30402: or 30405:',
	}),
])

/** `shipping_option` → a `30406:` option or a `30405:` collection, with an optional extra cost. */
export const ProductShippingOptionTagSchema = z.tuple([
	z.literal('shipping_option'),
	addressableFormat.refine((val) => val.startsWith('30406:') || val.startsWith('30405:'), {
		message: 'Shipping option reference must start with 30406: or 30405:',
	}),
	decimalNumber.optional(),
])

/**
 * NIP-36 content warning. The published value space is open (`nsfw`, `sensitive`, `spoiler`, …), so
 * this accepts any non-empty value and `parse.ts` decides how to read it — the original literal
 * `'nsfw'` schema silently rejected every other warning while the runtime compared `=== 'nsfw'`.
 */
export const ProductContentWarningTagSchema = z.tuple([z.literal('content-warning'), z.string().min(1)])
