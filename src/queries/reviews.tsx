import { ndkActions } from '@/lib/stores/ndk'
import { reviewKeys } from './queryKeyFactory'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

// Kind 31555 - Product Reviews (gamma_spec.md)
const REVIEW_KIND = 31555

export interface CategoryRating {
	category: string
	score: number
}

export interface ProductReview {
	id: string
	content: string
	authorPubkey: string
	createdAt: number
	thumbRating: number // Primary rating (0-1)
	categoryRatings: CategoryRating[] // Additional ratings (value, quality, delivery, communication)
}

export interface AggregateRatings {
	overall: number
	value: number | null
	quality: number | null
	delivery: number | null
	communication: number | null
	totalReviews: number
}

const transformReviewEvent = (event: NDKEvent): ProductReview => {
	// Extract thumb rating (primary rating)
	const thumbTag = event.tags.find((t) => t[0] === 'rating' && t[2] === 'thumb')
	const thumbRating = thumbTag ? parseFloat(thumbTag[1]) : 0

	// Extract category ratings
	const categoryRatings: CategoryRating[] = event.tags
		.filter((t) => t[0] === 'rating' && t[2] && t[2] !== 'thumb')
		.map((t) => ({
			category: t[2],
			score: parseFloat(t[1]),
		}))

	return {
		id: event.id,
		content: event.content,
		authorPubkey: event.pubkey,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		thumbRating,
		categoryRatings,
	}
}

const calculateAggregateRatings = (reviews: ProductReview[]): AggregateRatings => {
	if (reviews.length === 0) {
		return {
			overall: 0,
			value: null,
			quality: null,
			delivery: null,
			communication: null,
			totalReviews: 0,
		}
	}

	// Calculate overall rating (average of thumb ratings)
	const overallSum = reviews.reduce((sum, r) => sum + r.thumbRating, 0)
	const overall = overallSum / reviews.length

	// Calculate category averages
	const categoryAverages: Record<string, { sum: number; count: number }> = {}

	reviews.forEach((review) => {
		review.categoryRatings.forEach((cr) => {
			if (!categoryAverages[cr.category]) {
				categoryAverages[cr.category] = { sum: 0, count: 0 }
			}
			categoryAverages[cr.category].sum += cr.score
			categoryAverages[cr.category].count += 1
		})
	})

	const getAverage = (category: string): number | null => {
		const data = categoryAverages[category]
		return data && data.count > 0 ? data.sum / data.count : null
	}

	return {
		overall,
		value: getAverage('value'),
		quality: getAverage('quality'),
		delivery: getAverage('delivery'),
		communication: getAverage('communication'),
		totalReviews: reviews.length,
	}
}

/**
 * Fetches Kind 31555 reviews for a product
 * @param productCoordinates - The product coordinates in format "30402:<pubkey>:<d-tag>"
 */
export const fetchProductReviews = async (productCoordinates: string): Promise<ProductReview[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Reviews reference the product with a d tag in format "a:30402:<pubkey>:<d-tag>"
	const dTagValue = `a:${productCoordinates}`

	const filter: NDKFilter = {
		kinds: [REVIEW_KIND],
		'#d': [dTagValue],
	}

	const events = await ndk.fetchEvents(filter)
	const reviews = Array.from(events).map(transformReviewEvent)

	// Sort by newest first
	return reviews.sort((a, b) => b.createdAt - a.createdAt)
}

export const productReviewsQueryOptions = (productCoordinates: string) =>
	queryOptions({
		queryKey: reviewKeys.byProduct(productCoordinates),
		queryFn: () => fetchProductReviews(productCoordinates),
		enabled: !!productCoordinates,
	})

/**
 * Hook to fetch reviews for a product
 */
export const useProductReviews = (productCoordinates: string) => {
	return useQuery(productReviewsQueryOptions(productCoordinates))
}

/**
 * Hook to get aggregate ratings from reviews
 */
export const useAggregateRatings = (productCoordinates: string) => {
	const { data: reviews, ...rest } = useProductReviews(productCoordinates)
	const aggregateRatings = reviews ? calculateAggregateRatings(reviews) : null

	return {
		...rest,
		data: aggregateRatings,
	}
}
