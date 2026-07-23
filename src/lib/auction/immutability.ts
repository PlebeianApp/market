import type { NostrEventLike } from '../nostr/eventLike'
import { AUCTION_IMMUTABLE_MULTI_TAGS, AUCTION_IMMUTABLE_SINGLE_TAGS } from './constants'

const getAuctionTagValue = (event: NostrEventLike, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''

const getAuctionTagValues = (event: NostrEventLike, tagName: string): string[] =>
	event.tags.filter((tag) => tag[0] === tagName && !!tag[1]).map((tag) => tag[1] || '')

const normalizeComparableValueList = (values: string[]): string[] =>
	Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right))

export const auctionImmutableFieldsMatch = (rootEvent: NostrEventLike, candidateEvent: NostrEventLike): boolean => {
	for (const tagName of AUCTION_IMMUTABLE_SINGLE_TAGS) {
		if (getAuctionTagValue(rootEvent, tagName) !== getAuctionTagValue(candidateEvent, tagName)) return false
	}

	for (const tagName of AUCTION_IMMUTABLE_MULTI_TAGS) {
		const rootValues = normalizeComparableValueList(getAuctionTagValues(rootEvent, tagName))
		const candidateValues = normalizeComparableValueList(getAuctionTagValues(candidateEvent, tagName))
		if (rootValues.length !== candidateValues.length) return false
		if (rootValues.some((value, index) => value !== candidateValues[index])) return false
	}

	return true
}
