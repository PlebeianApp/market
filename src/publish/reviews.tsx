import { ndkActions } from '@/lib/stores/ndk'
import { reviewKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// Kind 31555 - Product Reviews (gamma_spec.md)
const REVIEW_KIND = 31555

export interface CategoryRating {
	category: 'value' | 'quality' | 'delivery' | 'communication'
	score: number // 0-1
}

export interface PublishReviewParams {
	content: string
	productCoordinates: string // Format: "30402:<pubkey>:<d-tag>"
	thumbRating: number // Primary rating 0-1
	categoryRatings: CategoryRating[] // Additional category ratings
}

/**
 * Publishes a Kind 31555 product review
 */
export const publishReview = async ({
	content,
	productCoordinates,
	thumbRating,
	categoryRatings,
}: PublishReviewParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const user = await ndk.signer.user()
	if (!user) throw new Error('No active user')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays. Please check your relay connections and try again.')
	}

	// Validate ratings are between 0-1
	if (thumbRating < 0 || thumbRating > 1) {
		throw new Error('Thumb rating must be between 0 and 1')
	}
	for (const cr of categoryRatings) {
		if (cr.score < 0 || cr.score > 1) {
			throw new Error(`${cr.category} rating must be between 0 and 1`)
		}
	}

	// Create Kind 31555 review event
	const reviewEvent = new NDKEvent(ndk)
	reviewEvent.kind = REVIEW_KIND
	reviewEvent.content = content
	reviewEvent.created_at = Math.floor(Date.now() / 1000)
	reviewEvent.pubkey = user.pubkey

	// Build tags according to gamma_spec.md
	const tags: string[][] = []

	// Required: d tag referencing the product (format: "a:30402:<pubkey>:<d-tag>")
	tags.push(['d', `a:${productCoordinates}`])

	// Required: primary thumb rating
	tags.push(['rating', thumbRating.toString(), 'thumb'])

	// Optional: category ratings
	for (const cr of categoryRatings) {
		tags.push(['rating', cr.score.toString(), cr.category])
	}

	reviewEvent.tags = tags

	try {
		await reviewEvent.sign(ndk.signer)
		const publishedRelays = await reviewEvent.publish()

		if (publishedRelays.size === 0) {
			throw new Error('Review was not published to any relays.')
		}

		return reviewEvent
	} catch (error) {
		console.error('Error publishing review:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a product review
 */
export const usePublishReviewMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishReview,
		onSuccess: async (_, variables) => {
			// Invalidate reviews query to refetch
			await queryClient.invalidateQueries({
				queryKey: reviewKeys.byProduct(variables.productCoordinates),
			})
			toast.success('Review submitted!')
		},
		onError: (error) => {
			console.error('Failed to publish review:', error)
			toast.error('Failed to submit review')
		},
	})
}
