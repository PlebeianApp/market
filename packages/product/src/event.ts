/**
 * `@plebeian/product` — the contract package for NIP-99 product listings (kind 30402).
 *
 * What this package is: pure code that decides whether an untrusted relay event is a usable
 * product listing, and turns it into a typed view. No UI, no framework, no network, no relay
 * client, no application imports.
 *
 * What it is not: it does not fetch. Fetching is the environment's job (architecture overview §3).
 */
export { PRODUCT_KIND, parseListing, isProductListing, deriveInStock } from './parse'

export {
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

export {
	addressableFormat,
	decimalNumber,
	dimensions,
	geohash,
	hexString,
	integerString,
	iso3166Country,
	iso3166Region,
	iso4217Currency,
	iso8601Duration,
} from './primitives'

export { NSFW_WARNING_VALUES } from './types'

export type {
	Frequency,
	ParseProblem,
	ParseProblemCode,
	ParseResult,
	ProductDimensions,
	ProductFormat,
	ProductImage,
	ProductListing,
	ProductPrice,
	ProductReferences,
	ProductSpec,
	ProductType,
	ProductVisibility,
	ProductWeight,
	ShippingOptionRef,
} from './types'
