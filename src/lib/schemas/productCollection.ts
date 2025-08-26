import { z } from 'zod'
import { addressableFormat, geohash } from './common'

// ===============================
// Product Collection (Kind: 30405)
// ===============================

// Required Tags
const CollectionIdTagSchema = z.tuple([z.literal('d'), z.string()])
export const CollectionTitleTagSchema = z.tuple([z.literal('title'), z.string()])
const CollectionProductReferenceTagSchema = z.tuple([
	z.literal('a'),
	addressableFormat.refine((val) => val.startsWith('30402:'), {
		message: 'Product reference must start with 30402:',
	}),
])

// Optional Tags
export const CollectionImageTagSchema = z.tuple([z.literal('image'), z.string().url()])

export const CollectionSummaryTagSchema = z.tuple([z.literal('summary'), z.string()])

const CollectionLocationTagSchema = z.tuple([z.literal('location'), z.string()])

const CollectionGeohashTagSchema = z.tuple([z.literal('g'), geohash])

const CollectionShippingOptionTagSchema = z.tuple([
	z.literal('shipping_option'),
	addressableFormat.refine((val) => val.startsWith('30406:'), {
		message: 'Shipping option reference must start with 30406:',
	}),
])

// Complete Product Collection Schema
export const ProductCollectionSchema = z.object({
	kind: z.literal(30405),
	created_at: z.number().int().positive(),
	content: z.string(),
	tags: z
		.array(
			z.union([
				// Required tags
				CollectionIdTagSchema,
				CollectionTitleTagSchema,
				CollectionProductReferenceTagSchema,

				// Optional tags
				CollectionImageTagSchema,
				CollectionSummaryTagSchema,
				CollectionLocationTagSchema,
				CollectionGeohashTagSchema,
				CollectionShippingOptionTagSchema,
			]),
		)
		.refine(
			(tags) => {
				// Verify required tags are present
				return (
					tags.some((tag) => tag[0] === 'd') &&
					tags.some((tag) => tag[0] === 'title') &&
					tags.some((tag) => tag[0] === 'a' && (tag[1] as string).startsWith('30402:'))
				)
			},
			{
				message: 'Missing required tags: d, title, and product reference (a)',
			},
		),
})
