import { hashInputSchema } from '../../core/extensions'

/** Canned listings the dummy "AI" picks from; obviously fake on purpose. */
const LISTINGS = [
	{
		title: 'Hand-thrown Ceramic Mug',
		category: 'Home & Technology',
		tags: ['ceramic', 'mug', 'handmade', 'kitchen'],
		body: 'a hand-thrown stoneware mug with a satin glaze and a comfortable, wide handle. It holds about 350 ml and is dishwasher safe.',
	},
	{
		title: 'Vintage Bitcoin Art Print',
		category: 'Art',
		tags: ['bitcoin', 'art', 'print', 'poster'],
		body: 'an A3 giclée print on heavyweight matte paper, inspired by early bitcoin culture. Ships rolled in a protective tube.',
	},
	{
		title: 'Organic Cotton Hoodie',
		category: 'Clothing',
		tags: ['hoodie', 'cotton', 'organic', 'apparel'],
		body: 'a midweight hoodie made from organic cotton, with a brushed interior, ribbed cuffs, and a kangaroo pocket.',
	},
	{
		title: 'Single-origin Coffee Beans',
		category: 'Food & Drink',
		tags: ['coffee', 'beans', 'single origin', 'roasted'],
		body: 'freshly roasted whole beans from a single farm, with notes of cocoa, red fruit, and caramel. 250 g bag.',
	},
	{
		title: 'Walnut Cutting Board',
		category: 'Home & Technology',
		tags: ['walnut', 'wood', 'cutting board', 'kitchen'],
		body: 'a solid walnut end-grain cutting board, finished with food-safe oil and beeswax. Gentle on knives and built to last.',
	},
] as const

export interface MockListingDraft {
	title: string
	summary: string
	description: string
	tags: string[]
	category: string
	model: string
}

/**
 * Deterministic stand-in for an AI vision model: picks a canned listing from the image URL and weaves in seller notes.
 * It never fetches or analyses the image.
 */
export function mockListingDraft(input: { imageUrl: string; notes?: string }): MockListingDraft {
	const index = parseInt(hashInputSchema({ imageUrl: input.imageUrl }).slice(0, 8), 16) % LISTINGS.length
	const listing = LISTINGS[index]
	const notes = input.notes?.trim()
	const description = [`This listing features ${listing.body}`, notes ? `Seller notes: ${notes}` : '', 'Photos show the actual item.']
		.filter(Boolean)
		.join(' ')
	return {
		title: listing.title,
		summary: `${listing.title} — ${listing.body.split('.')[0].replace(/^an? /, '')}.`,
		description,
		tags: [...listing.tags],
		category: listing.category,
		model: 'dummy-vision-1 (mock AI)',
	}
}
