import { ValidationError } from '../../core/errors'
import { failure, success, type Result } from '../../core/result'

/** Capability a bound extension offers to draft a product listing from an image (ADR-0023 §3). */
export const PRODUCT_LISTING_DRAFT_CAPABILITY = 'product.listing.draft'

/** Marketplace product categories; a listing's main category is one of these (the last is the fallback). */
export const MARKETPLACE_PRODUCT_CATEGORIES = [
	'Bitcoin',
	'Art',
	'Clothing',
	'Food & Drink',
	'Home & Technology',
	'Health & Beauty',
	'Sports & Outside',
	'Services',
	'Other',
] as const

/**
 * A draft produced by an extension (e.g. an AI over ContextVM). It is untrusted plain text: the seller reviews it and
 * only the seller signs and publishes the listing. Price is never part of a draft.
 */
export interface ProductListingDraft {
	title: string
	summary: string
	description: string
	/** Lowercase tags, published as `t` tags after the main category. */
	tags: string[]
	/** One of the marketplace categories; unknown values fall back to the last category (e.g. "Other"). */
	category: string
	/** Model or provider label, shown to the seller so AI text is never mistaken for their own. */
	model?: string
}

export const LISTING_DRAFT_LIMITS = { title: 120, summary: 200, description: 2_000, tags: 8, tag: 40 } as const

const TAG = /^[a-z0-9][a-z0-9 -]*[a-z0-9]$|^[a-z0-9]$/

/** Strips control characters and trims; returns `undefined` for empty text. */
function cleanText(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') return undefined
	// eslint-disable-next-line no-control-regex
	const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
	return cleaned ? cleaned.slice(0, max) : undefined
}

/**
 * Parses an untrusted draft (e.g. the `data` of a remote action result). Title and description are required;
 * other fields are normalized and capped, and the category is mapped onto `categories`.
 */
export function parseProductListingDraft(input: unknown, categories: readonly string[]): Result<ProductListingDraft, ValidationError> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) return failure(new ValidationError('Draft must be an object'))
	const raw = input as Record<string, unknown>
	const title = cleanText(raw.title, LISTING_DRAFT_LIMITS.title)
	const description = cleanText(raw.description, LISTING_DRAFT_LIMITS.description)
	if (!title) return failure(new ValidationError('Draft has no title', ['title']))
	if (!description) return failure(new ValidationError('Draft has no description', ['description']))

	const tags = Array.isArray(raw.tags)
		? [
				...new Set(
					raw.tags
						.map((tag) => cleanText(tag, LISTING_DRAFT_LIMITS.tag)?.toLowerCase())
						.filter((tag): tag is string => Boolean(tag && TAG.test(tag))),
				),
			].slice(0, LISTING_DRAFT_LIMITS.tags)
		: []
	const requested = cleanText(raw.category, 60)
	const category =
		categories.find((option) => option.toLowerCase() === requested?.toLowerCase()) ?? categories[categories.length - 1] ?? 'Other'
	const model = cleanText(raw.model, 60)

	return success({
		title,
		summary: cleanText(raw.summary, LISTING_DRAFT_LIMITS.summary) ?? description.slice(0, LISTING_DRAFT_LIMITS.summary),
		description,
		tags,
		category,
		...(model ? { model } : {}),
	})
}
