import { z } from 'zod'

const safeLink = z
	.string()
	.max(2048)
	.refine((value) => {
		if (value.startsWith('/')) return !value.startsWith('//')
		try {
			return new URL(value).protocol === 'https:'
		} catch {
			return false
		}
	}, 'Only in-app paths and https URLs are allowed')

const productCoordinate = z.string().regex(/^30402:[0-9a-f]{64}:.+$/, 'Invalid product coordinate')
const safeText = (max: number) =>
	z
		.string()
		.trim()
		.min(1)
		.max(max)
		.refine((value) => !/<[a-z!/]/i.test(value), 'Raw HTML is not allowed')

const heroBlock = z.object({
	type: z.literal('hero'),
	title: z.string().trim().min(1).max(160),
	text: safeText(500).optional(),
	image: safeLink.optional(),
	link: safeLink.optional(),
})

const textBlock = z.object({
	type: z.literal('text'),
	text: safeText(5000),
})

const productGridBlock = z.object({
	type: z.literal('productGrid'),
	products: z.array(productCoordinate).min(1).max(24),
})

const collectionRowBlock = z.object({
	type: z.literal('collectionRow'),
	collection: z.string().regex(/^30405:[0-9a-f]{64}:.+$/, 'Invalid collection coordinate'),
})

const linkListBlock = z.object({
	type: z.literal('linkList'),
	links: z
		.array(
			z.object({
				label: z.string().trim().min(1).max(80),
				url: safeLink,
			}),
		)
		.min(1)
		.max(12),
})

const contactBlock = z.object({
	type: z.literal('contact'),
	label: z.string().trim().min(1).max(80),
	text: safeText(500),
})

export const StorefrontBlockSchema = z.discriminatedUnion('type', [
	heroBlock,
	textBlock,
	productGridBlock,
	collectionRowBlock,
	linkListBlock,
	contactBlock,
])

export const StorefrontPageSchema = z.object({
	version: z.literal(1),
	blocks: z.array(StorefrontBlockSchema).max(40),
})

export type StorefrontBlock = z.infer<typeof StorefrontBlockSchema>
export type StorefrontPage = z.infer<typeof StorefrontPageSchema>

/** Parse a page defensively: malformed individual blocks do not take down the page. */
export function parseStorefrontPage(content: string): StorefrontPage | null {
	try {
		const raw = JSON.parse(content) as { version?: unknown; blocks?: unknown }
		if (raw.version !== 1 || !Array.isArray(raw.blocks)) return null

		const blocks = raw.blocks.flatMap((block) => {
			const parsed = StorefrontBlockSchema.safeParse(block)
			return parsed.success ? [parsed.data] : []
		})

		return StorefrontPageSchema.parse({ version: 1, blocks })
	} catch {
		return null
	}
}
