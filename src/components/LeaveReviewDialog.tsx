import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { StarRatingInput } from './StarRating'
import { usePublishReviewMutation, type CategoryRating } from '@/publish/reviews'

interface LeaveReviewDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	productCoordinates: string
	merchantPubkey: string
}

export function LeaveReviewDialog({ open, onOpenChange, productCoordinates, merchantPubkey }: LeaveReviewDialogProps) {
	const [content, setContent] = useState('')
	const [valueRating, setValueRating] = useState(0)
	const [qualityRating, setQualityRating] = useState(0)
	const [deliveryRating, setDeliveryRating] = useState(0)
	const [communicationRating, setCommunicationRating] = useState(0)

	const publishMutation = usePublishReviewMutation()

	const resetForm = () => {
		setContent('')
		setValueRating(0)
		setQualityRating(0)
		setDeliveryRating(0)
		setCommunicationRating(0)
	}

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			resetForm()
		}
		onOpenChange(newOpen)
	}

	const handleSubmit = async () => {
		// At least one rating should be provided
		const hasRating = valueRating > 0 || qualityRating > 0 || deliveryRating > 0 || communicationRating > 0

		if (!hasRating) {
			return
		}

		// Calculate thumb rating as average of provided ratings
		const ratings = [valueRating, qualityRating, deliveryRating, communicationRating].filter((r) => r > 0)
		const thumbRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length

		// Build category ratings array
		const categoryRatings: CategoryRating[] = []
		if (valueRating > 0) categoryRatings.push({ category: 'value', score: valueRating })
		if (qualityRating > 0) categoryRatings.push({ category: 'quality', score: qualityRating })
		if (deliveryRating > 0) categoryRatings.push({ category: 'delivery', score: deliveryRating })
		if (communicationRating > 0) categoryRatings.push({ category: 'communication', score: communicationRating })

		try {
			await publishMutation.mutateAsync({
				content: content.trim(),
				productCoordinates,
				thumbRating,
				categoryRatings,
			})
			resetForm()
			onOpenChange(false)
		} catch {
			// Error handling (toasts) is done in the mutation hook; keep form content so user can retry
		}
	}

	const hasAnyRating = valueRating > 0 || qualityRating > 0 || deliveryRating > 0 || communicationRating > 0
	const canSubmit = hasAnyRating && !publishMutation.isPending

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Leave a Review</DialogTitle>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Rating Inputs */}
					<div className="grid grid-cols-2 gap-4">
						<StarRatingInput label="Value" value={valueRating} onChange={setValueRating} />
						<StarRatingInput label="Quality" value={qualityRating} onChange={setQualityRating} />
						<StarRatingInput label="Delivery" value={deliveryRating} onChange={setDeliveryRating} />
						<StarRatingInput label="Communication" value={communicationRating} onChange={setCommunicationRating} />
					</div>

					{/* Comment Textarea */}
					<div className="space-y-2">
						<label htmlFor="review-comment" className="text-sm font-medium text-gray-700">
							Comment
						</label>
						<Textarea
							id="review-comment"
							value={content}
							onChange={(e) => setContent(e.target.value)}
							placeholder="Leave a comment about your experience (optional)"
							rows={4}
							className="resize-none"
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={publishMutation.isPending}>
						Cancel
					</Button>
					<Button variant="secondary" onClick={handleSubmit} disabled={!canSubmit}>
						{publishMutation.isPending ? 'Submitting...' : 'Submit'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
