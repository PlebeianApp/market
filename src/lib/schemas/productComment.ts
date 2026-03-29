import type { NDKEvent, NDKTag } from '@nostr-dev-kit/ndk'

export const MAX_COMMENT_LENGTH = 1000
export const PRODUCT_COMMENT_KIND = 1111

const REQUIRED_TAG_KEYS = ['A', 'K', 'P', 'a', 'k', 'p'] as const

type ProductCommentEventLike = Pick<NDKEvent, 'kind' | 'content' | 'pubkey' | 'tags'>

const getSingleTagValue = (tags: NDKTag[], key: (typeof REQUIRED_TAG_KEYS)[number]): string | null => {
	const matches = tags.filter((tag) => tag[0] === key)
	if (matches.length !== 1) return null
	return matches[0]?.[1] ?? null
}

export const isValidTopLevelComment = (event: ProductCommentEventLike, productCoords: string, merchantPubkey: string): boolean => {
	if (event.kind !== PRODUCT_COMMENT_KIND) return false

	const trimmedContent = event.content.trim()
	if (!trimmedContent) return false
	if (trimmedContent.length > MAX_COMMENT_LENGTH) return false

	if (event.tags.length !== REQUIRED_TAG_KEYS.length) return false

	for (const key of REQUIRED_TAG_KEYS) {
		if (event.tags.filter((tag) => tag[0] === key).length !== 1) {
			return false
		}
	}

	const rootCoordsUpper = getSingleTagValue(event.tags, 'A')
	const rootKindUpper = getSingleTagValue(event.tags, 'K')
	const rootPubkeyUpper = getSingleTagValue(event.tags, 'P')
	const rootCoordsLower = getSingleTagValue(event.tags, 'a')
	const rootKindLower = getSingleTagValue(event.tags, 'k')
	const rootPubkeyLower = getSingleTagValue(event.tags, 'p')

	return (
		rootCoordsUpper === productCoords &&
		rootCoordsLower === productCoords &&
		rootKindUpper === '30402' &&
		rootKindLower === '30402' &&
		rootPubkeyUpper === merchantPubkey &&
		rootPubkeyLower === merchantPubkey
	)
}
