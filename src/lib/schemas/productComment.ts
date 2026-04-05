import { z } from 'zod'

export const COMMENT_KIND = 1111 as const
export const PRODUCT_KIND = 30402 as const

const PubkeySchema = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a valid 64-character hex pubkey')
const EventIdSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a valid 64-character hex event ID')
const AddressableFormatSchema = z.string().regex(/^\d+:[0-9a-f]{64}:[a-zA-Z0-9_-]+$/, 'Must be in format kind:pubkey:d-identifier')

export const CommentRootTagSchema = z.tuple([
	z.literal('A'),
	AddressableFormatSchema,
	z.string().optional(), // relay hint
	z.string().optional(), // root event pubkey (if E tag used)
])

export const CommentKindTagSchema = z.tuple([z.literal('K'), z.string()])

export const CommentPubkeyTagSchema = z.tuple([z.literal('p'), PubkeySchema, z.string().optional()]) // pubkey, relay hint

export const CommentParentEventTagSchema = z.tuple([
	z.literal('e'),
	EventIdSchema,
	z.string().optional(), // relay hint
	z.string().optional(), // pubkey
])

export const CommentParentKindTagSchema = z.tuple([z.literal('k'), z.string()])

export const CommentParentPubkeyTagSchema = z.tuple([z.literal('p'), PubkeySchema, z.string().optional()])

export const CommentSubjectTagSchema = z.tuple([z.literal('subject'), z.string()])

export const CommentRootETagSchema = z.tuple([
	z.literal('E'),
	EventIdSchema,
	z.string().optional(), // relay hint
	z.string().optional(), // root event pubkey
])

export const CommentRootITagSchema = z.tuple([z.literal('I'), z.string(), z.string().optional()])

export const ProductCommentSchema = z.object({
	kind: z.literal(COMMENT_KIND),
	created_at: z.number().int().positive(),
	tags: z
		.array(
			z.union([
				CommentRootTagSchema,
				CommentRootETagSchema,
				CommentRootITagSchema,
				CommentKindTagSchema,
				CommentPubkeyTagSchema,
				CommentParentEventTagSchema,
				CommentParentKindTagSchema,
				CommentParentPubkeyTagSchema,
				CommentSubjectTagSchema,
				z.tuple([z.literal('q'), z.string()]),
				z.tuple([z.literal('t'), z.string()]),
			]),
		)
		.refine(
			(tags) => {
				const hasK = tags.some((tag) => tag[0] === 'K')
				const hasRoot = tags.some((tag) => tag[0] === 'A' || tag[0] === 'E' || tag[0] === 'I')
				const hasP = tags.some((tag) => tag[0] === 'p')
				return hasK && hasRoot && hasP
			},
			{
				message: 'Missing required tags: K (root kind), A/E/I (root scope), and p (author pubkey)',
			},
		),
	content: z.string(),
})

export type ProductComment = z.infer<typeof ProductCommentSchema>

export const getCommentRootKind = (event: { tags: string[][] }): string | undefined => {
	return event.tags.find((t) => t[0] === 'K')?.[1]
}

export const getCommentRootAddress = (event: { tags: string[][] }): string | undefined => {
	const tag = event.tags.find((t) => t[0] === 'A')
	return tag?.[1]
}

export const getCommentAuthor = (event: { tags: string[][] }): string | undefined => {
	const uppercasePTags = event.tags.filter((t) => t[0] === 'P')
	const mainAuthor = event.tags.find((t) => t[0] === 'p')
	return mainAuthor?.[1] ?? uppercasePTags[0]?.[1]
}

export const getCommentParentId = (event: { tags: string[][] }): string | undefined => {
	const hasParentKind = event.tags.some((t) => t[0] === 'k')
	if (!hasParentKind) return undefined
	const parentEventTag = event.tags.find((t) => t[0] === 'e')
	return parentEventTag?.[1]
}

export const getCommentSubject = (event: { tags: string[][] }): string | undefined => {
	return event.tags.find((t) => t[0] === 'subject')?.[1]
}
