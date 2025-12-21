import { useProductReviews, useAggregateRatings, type ProductReview } from '@/queries/reviews'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { Button } from './ui/button'
import { UserNameWithBadge } from './UserNameWithBadge'
import { StarRating, StarRatingDisplay } from './StarRating'
import { LeaveReviewDialog } from './LeaveReviewDialog'
import { Star } from 'lucide-react'

interface ProductReviewsProps {
	productCoordinates: string
	merchantPubkey: string
}

function formatDate(timestamp: number): string {
	const date = new Date(timestamp * 1000)
	return date.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	})
}

function ReviewItem({ review }: { review: ProductReview }) {
	// Get the average of category ratings for display, or use thumb rating
	const categoryAvg =
		review.categoryRatings.length > 0
			? review.categoryRatings.reduce((sum, cr) => sum + cr.score, 0) / review.categoryRatings.length
			: review.thumbRating

	return (
		<div className="border-b border-gray-200 py-4 last:border-b-0">
			<div className="flex items-center justify-between mb-2">
				<UserNameWithBadge pubkey={review.authorPubkey} />
				<span className="text-sm text-gray-500">{formatDate(review.createdAt)}</span>
			</div>
			<div className="mb-2">
				<StarRating rating={categoryAvg} size="sm" />
			</div>
			{review.content && <p className="text-gray-700 whitespace-pre-wrap">{review.content}</p>}
		</div>
	)
}

function AggregateRatingsDisplay({ productCoordinates }: { productCoordinates: string }) {
	const { data: aggregateRatings } = useAggregateRatings(productCoordinates)

	if (!aggregateRatings || aggregateRatings.totalReviews === 0) {
		return null
	}

	return (
		<div className="flex flex-wrap gap-6 mb-6 pb-6 border-b border-gray-200">
			<StarRatingDisplay label="Value" rating={aggregateRatings.value} />
			<StarRatingDisplay label="Quality" rating={aggregateRatings.quality} />
			<StarRatingDisplay label="Delivery" rating={aggregateRatings.delivery} />
			<StarRatingDisplay label="Communication" rating={aggregateRatings.communication} />
		</div>
	)
}

export function ProductReviews({ productCoordinates, merchantPubkey }: ProductReviewsProps) {
	const { isAuthenticated } = useStore(authStore)
	const { data: reviews, isLoading, error } = useProductReviews(productCoordinates)
	const [showAll, setShowAll] = useState(false)
	const [isDialogOpen, setIsDialogOpen] = useState(false)

	const displayedReviews = showAll ? reviews : reviews?.slice(0, 5)
	const hasMoreReviews = reviews && reviews.length > 5

	return (
		<div className="space-y-6">
			{/* Aggregate Ratings */}
			<AggregateRatingsDisplay productCoordinates={productCoordinates} />

			{/* Leave a Review Button */}
			<div className="flex justify-end">
				{isAuthenticated ? (
					<Button variant="outline" onClick={() => setIsDialogOpen(true)}>
						Leave a review
					</Button>
				) : (
					<div className="bg-gray-50 p-4 rounded-lg text-center w-full">
						<p className="text-gray-600">Please log in to leave a review.</p>
					</div>
				)}
			</div>

			{/* Reviews List */}
			<div>
				{isLoading && <p className="text-gray-500 text-center py-4">Loading reviews...</p>}

				{error && <p className="text-red-600 text-center py-4">Failed to load reviews</p>}

				{!isLoading && !error && reviews && reviews.length === 0 && (
					<div className="text-center py-8">
						<Star className="w-12 h-12 text-gray-300 mx-auto mb-3" />
						<p className="text-gray-500">No reviews yet. Be the first to review!</p>
					</div>
				)}

				{displayedReviews && displayedReviews.length > 0 && (
					<div>
						{displayedReviews.map((review) => (
							<ReviewItem key={review.id} review={review} />
						))}

						{hasMoreReviews && !showAll && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => setShowAll(true)}
								className="w-full text-center py-3 text-secondary hover:text-secondary/80 font-medium"
							>
								Show More
							</Button>
						)}
					</div>
				)}
			</div>

			{/* Leave Review Dialog */}
			<LeaveReviewDialog
				open={isDialogOpen}
				onOpenChange={setIsDialogOpen}
				productCoordinates={productCoordinates}
				merchantPubkey={merchantPubkey}
			/>
		</div>
	)
}
