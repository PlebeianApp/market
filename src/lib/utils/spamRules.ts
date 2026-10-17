import type { NDKEvent } from '@/lib/nostr/ndk-events'

/**
 * A hardcoded spam rule matching a product listing by its raw `title` and
 * `price` tag values. Values are compared exactly, with no normalization.
 */
export interface SpamRule {
	title: string
	priceAmount: string
	priceCurrency: string
}

/**
 * Observed spam templates that are hidden client-side regardless of the app
 * blacklist. Keep this list small and specific to avoid false positives.
 */
export const SPAM_RULES: readonly SpamRule[] = [{ title: 'journey widget', priceAmount: '700', priceCurrency: 'SAT' }]

/**
 * Returns true only for kind 30402 product events matching a spam rule.
 * Events missing a `title` or `price` tag, and all non-product kinds, return false.
 */
export const isSpamProduct = (event: NDKEvent): boolean => {
	if (event?.kind !== 30402) return false

	const title = event.tags.find((tag) => tag[0] === 'title')?.[1]
	const price = event.tags.find((tag) => tag[0] === 'price')
	if (title === undefined || price === undefined) return false

	return SPAM_RULES.some((rule) => rule.title === title && rule.priceAmount === price[1] && rule.priceCurrency === price[2])
}
