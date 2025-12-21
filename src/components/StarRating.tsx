import { cn } from '@/lib/utils'
import { Star } from 'lucide-react'
import { useState } from 'react'

interface StarRatingProps {
	rating: number // 0-1 scale (will be converted to 0-5 for display)
	maxStars?: number
	size?: 'sm' | 'md' | 'lg'
	interactive?: boolean
	onChange?: (rating: number) => void
	className?: string
}

const sizeClasses = {
	sm: 'w-4 h-4',
	md: 'w-5 h-5',
	lg: 'w-6 h-6',
}

/**
 * StarRating component for displaying and inputting star ratings.
 * Accepts ratings on a 0-1 scale (converts to 0-5 for display).
 */
export function StarRating({ rating, maxStars = 5, size = 'md', interactive = false, onChange, className }: StarRatingProps) {
	const [hoverRating, setHoverRating] = useState<number | null>(null)

	// Convert 0-1 scale to 0-5 scale for display
	const displayRating = (hoverRating ?? rating) * maxStars

	const handleClick = (starIndex: number) => {
		if (interactive && onChange) {
			// Convert star index (1-5) back to 0-1 scale
			const newRating = starIndex / maxStars
			onChange(newRating)
		}
	}

	const handleMouseEnter = (starIndex: number) => {
		if (interactive) {
			setHoverRating(starIndex / maxStars)
		}
	}

	const handleMouseLeave = () => {
		if (interactive) {
			setHoverRating(null)
		}
	}

	return (
		<div className={cn('flex items-center gap-0.5', className)}>
			{Array.from({ length: maxStars }, (_, index) => {
				const starIndex = index + 1
				const fillPercentage = Math.min(Math.max(displayRating - index, 0), 1) * 100

				return (
					<button
						key={index}
						type="button"
						onClick={() => handleClick(starIndex)}
						onMouseEnter={() => handleMouseEnter(starIndex)}
						onMouseLeave={handleMouseLeave}
						disabled={!interactive}
						className={cn(
							'relative',
							interactive && 'cursor-pointer hover:scale-110 transition-transform',
							!interactive && 'cursor-default',
						)}
						aria-label={interactive ? `Rate ${starIndex} out of ${maxStars} stars` : undefined}
					>
						{/* Background star (empty) */}
						<Star className={cn(sizeClasses[size], 'text-gray-300')} strokeWidth={1.5} />
						{/* Foreground star (filled) with clip for partial fill */}
						<div className="absolute inset-0 overflow-hidden" style={{ width: `${fillPercentage}%` }}>
							<Star className={cn(sizeClasses[size], 'text-yellow-400 fill-yellow-400')} strokeWidth={1.5} />
						</div>
					</button>
				)
			})}
		</div>
	)
}

interface StarRatingDisplayProps {
	label: string
	rating: number | null // 0-1 scale, null if no ratings
	size?: 'sm' | 'md' | 'lg'
	className?: string
}

/**
 * Display component for showing a labeled star rating.
 * Used in aggregate ratings display.
 */
export function StarRatingDisplay({ label, rating, size = 'sm', className }: StarRatingDisplayProps) {
	return (
		<div className={cn('flex flex-col gap-1', className)}>
			<span className="text-sm font-medium text-gray-700">{label}</span>
			{rating !== null ? <StarRating rating={rating} size={size} /> : <span className="text-xs text-gray-400">No ratings</span>}
		</div>
	)
}

interface StarRatingInputProps {
	label: string
	value: number
	onChange: (value: number) => void
	size?: 'sm' | 'md' | 'lg'
	className?: string
}

/**
 * Input component for selecting a star rating.
 * Used in the review form.
 */
export function StarRatingInput({ label, value, onChange, size = 'md', className }: StarRatingInputProps) {
	return (
		<div className={cn('flex flex-col gap-1', className)}>
			<span className="text-sm font-medium text-gray-700">{label}</span>
			<StarRating rating={value} size={size} interactive onChange={onChange} />
		</div>
	)
}
