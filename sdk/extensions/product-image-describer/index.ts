import { z } from 'zod'
import { defineActionFor, defineExtension, type ExtensionManifest } from '../../core/extensions'
import { success } from '../../core/result'

export const PRODUCT_IMAGE_DESCRIBE_CAPABILITY = 'product.image.describe'
export const MOCK_PROVIDER = 'mock'

const PublicConfigSchema = z.object({
	maxChars: z.coerce.number().int().min(100).max(2000).default(600),
})

const ImageUrlSchema = z
	.string()
	.trim()
	.max(2048)
	.refine((value) => {
		try {
			const url = new URL(value)
			return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
		} catch {
			return false
		}
	}, 'Image URL must be an http(s) URL')

export const DescribeImageInputSchema = z.object({
	imageUrl: ImageUrlSchema,
	title: z.string().trim().max(200).optional(),
	category: z.string().trim().max(80).optional(),
	notes: z.string().trim().max(500).optional(),
})

export const DescribeImageOutputSchema = z.object({
	description: z.string().min(1),
	provider: z.string(),
	/** True when no image analysis took place; UI must label the text as a mock-up. */
	mock: z.boolean(),
	/** Which inputs the text was derived from. */
	basis: z.array(z.enum(['title', 'category', 'notes', 'filename'])),
})

export type DescribeImageInput = z.infer<typeof DescribeImageInputSchema>
export type DescribeImageOutput = z.infer<typeof DescribeImageOutputSchema>

export const productImageDescriberManifest = {
	id: 'product-image-describer',
	version: '0.1.0',
	displayName: 'Product image describer',
	icon: '/images/extension-product-image-describer.svg',
	capabilities: [PRODUCT_IMAGE_DESCRIBE_CAPABILITY],
	runtimes: ['server'],
	publicConfig: PublicConfigSchema,
} satisfies ExtensionManifest<z.infer<typeof PublicConfigSchema>>

const action = defineActionFor(productImageDescriberManifest)

/**
 * Drafts a product description for an image. This version is a deterministic mock-up: it never fetches
 * the image or calls a model (no host ports, no egress), and derives text from the URL filename and the
 * seller's own fields. The output is a draft for the seller to edit; nothing is published.
 */
export const productImageDescriber = defineExtension({
	manifest: productImageDescriberManifest,
	actions: {
		'describe-image': action({
			description: 'Draft a product description for an image (mock-up, no image analysis)',
			input: DescribeImageInputSchema,
			output: DescribeImageOutputSchema,
			auth: 'user',
			rateLimit: { perPubkey: 30, windowSeconds: 3600 },
			async handler(context, input) {
				return success(mockDescribeImage(input, context.publicConfig.maxChars))
			},
		}),
	},
})

const OPENERS = ['Shown here is', 'This listing features', 'Pictured is', 'Take a closer look at'] as const

const DETAILS = [
	'The photo shows the item clearly against a simple background, so its shape and finish are easy to see.',
	'The image highlights the overall form and the details buyers will notice first.',
	'The picture presents the item in good light, making colour and texture easy to judge.',
] as const

const CLOSERS = [
	'Check the specifications for exact dimensions and materials.',
	'Message the seller with any questions about condition or sizing.',
	'See the other photos for more angles before you buy.',
] as const

/** Pure and deterministic: the same input always yields the same text. */
export function mockDescribeImage(input: DescribeImageInput, maxChars: number): DescribeImageOutput {
	const basis: DescribeImageOutput['basis'] = []
	const fromFilename = filenameWords(input.imageUrl)
	const subject = input.title || fromFilename || 'this product'
	if (input.title) basis.push('title')
	else if (fromFilename) basis.push('filename')

	const seed = hash([input.imageUrl, input.title ?? '', input.category ?? '', input.notes ?? ''].join('\u0000'))
	const parts = [
		`${pick(OPENERS, seed)} ${withArticle(subject)}${input.category ? ` from our ${input.category.toLowerCase()} range` : ''}.`,
	]
	if (input.category) basis.push('category')
	parts.push(pick(DETAILS, seed >>> 3))
	if (input.notes) {
		parts.push(sentence(input.notes))
		basis.push('notes')
	}
	parts.push(pick(CLOSERS, seed >>> 7))

	return { description: truncate(parts.join(' '), maxChars), provider: MOCK_PROVIDER, mock: true, basis }
}

const NOISE_WORDS = /^(img|image|photo|pic|dsc|final|copy|edit|thumb)$/i

function filenameWords(imageUrl: string): string | undefined {
	let name: string
	try {
		name = new URL(imageUrl).pathname.split('/').filter(Boolean).pop() ?? ''
	} catch {
		return undefined
	}
	try {
		name = decodeURIComponent(name)
	} catch {
		// Keep the raw segment when it is not valid percent-encoding.
	}
	// Only alphabetic words survive, so hex hashes (common in Blossom URLs) and counters are ignored.
	const words = name
		.replace(/\.[a-z0-9]{2,5}$/i, '')
		.split(/[\s_\-.+]+/)
		.filter((word) => /^[a-z]{2,}$/i.test(word) && !NOISE_WORDS.test(word))
	return words.length > 0 ? words.slice(0, 6).join(' ').toLowerCase() : undefined
}

function withArticle(subject: string): string {
	if (/^(a|an|the|this|these|our)\s/i.test(subject)) return subject
	return /^[aeiou]/i.test(subject) ? `an ${subject}` : `a ${subject}`
}

function sentence(text: string): string {
	const trimmed = text.trim().replace(/\s+/g, ' ')
	const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
	return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`
}

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	const cut = text.slice(0, maxChars - 1)
	const lastSpace = cut.lastIndexOf(' ')
	return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function pick<T>(items: readonly T[], seed: number): T {
	return items[seed % items.length]
}

/** FNV-1a; only used to vary wording deterministically. */
function hash(text: string): number {
	let value = 2166136261
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index)
		value = Math.imul(value, 16777619)
	}
	return value >>> 0
}
