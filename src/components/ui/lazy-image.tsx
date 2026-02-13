import { cn } from '@/lib/utils'
import { useResponsiveImageUrl } from '@/queries/responsive-image'
import { useState, useEffect, useRef, type ImgHTMLAttributes } from 'react'
import { Skeleton } from './skeleton'

interface LazyImageProps extends ImgHTMLAttributes<HTMLImageElement> {
	/** The image source URL */
	src: string
	/** Alt text for the image */
	alt: string
	/** Additional class names for the image */
	className?: string
	/** Additional class names for the container */
	containerClassName?: string
	/** Additional class names for the skeleton */
	skeletonClassName?: string
	/** Whether to use intersection observer for lazy loading (default: true) */
	lazy?: boolean
	/** Threshold for intersection observer (0-1, default: 0.1) */
	threshold?: number
	/** Root margin for intersection observer (default: '50px') */
	rootMargin?: string
	/** Callback when image finishes loading */
	onLoad?: () => void
	/** Callback when image fails to load */
	onError?: () => void
	/** Fallback content to show when image fails to load */
	fallback?: React.ReactNode
	/** Whether to show a frame/border around the image (default: false) */
	showFrame?: boolean
	/** Aspect ratio for the container (e.g., 'aspect-square', 'aspect-video') */
	aspectRatio?: string
}

export function LazyImage({
	src,
	alt,
	className,
	containerClassName,
	skeletonClassName,
	lazy = true,
	threshold = 0.1,
	rootMargin = '50px',
	onLoad,
	onError,
	fallback,
	showFrame = false,
	aspectRatio = 'aspect-square',
	...imgProps
}: LazyImageProps) {
	const [isLoaded, setIsLoaded] = useState(false)
	const [isInView, setIsInView] = useState(!lazy)
	const [hasError, setHasError] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Resolve responsive variant URL (queries kind 1063 binding events)
	const resolvedSrc = useResponsiveImageUrl(src, containerRef)

	// Intersection Observer for lazy loading
	useEffect(() => {
		if (!lazy) return

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setIsInView(true)
					observer.disconnect()
				}
			},
			{
				threshold,
				rootMargin,
			},
		)

		if (containerRef.current) {
			observer.observe(containerRef.current)
		}

		return () => observer.disconnect()
	}, [lazy, threshold, rootMargin])

	// Reset state when resolved src changes
	useEffect(() => {
		setIsLoaded(false)
		setHasError(false)
	}, [resolvedSrc])

	const handleLoad = () => {
		setIsLoaded(true)
		onLoad?.()
	}

	const handleError = () => {
		setHasError(true)
		setIsLoaded(true)
		onError?.()
	}

	return (
		<div
			ref={containerRef}
			className={cn(
				'relative overflow-hidden',
				aspectRatio,
				showFrame && 'border border-zinc-200 dark:border-zinc-800 rounded-lg',
				containerClassName,
			)}
		>
			{/* Skeleton placeholder with shimmer */}
			{!isLoaded && (
				<div className="absolute inset-0 w-full h-full">
					<Skeleton
						className={cn(
							'absolute inset-0 w-full h-full',
							showFrame && 'rounded-lg',
							skeletonClassName,
						)}
					/>
					{/* Shimmer overlay */}
					<div
						className={cn(
							'absolute inset-0 w-full h-full overflow-hidden',
							showFrame && 'rounded-lg',
						)}
					>
						<div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
					</div>
				</div>
			)}

			{/* Error fallback */}
			{hasError && isLoaded && (
				<div className="absolute inset-0 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
					{fallback || (
						<div className="text-zinc-400 dark:text-zinc-600 text-sm text-center p-4">
							Failed to load image
						</div>
					)}
				</div>
			)}

			{/* Actual image - only rendered when in view */}
			{isInView && !hasError && (
				<img
					src={resolvedSrc}
					alt={alt}
					onLoad={handleLoad}
					onError={handleError}
					className={cn(
						'w-full h-full object-cover transition-opacity duration-300',
						isLoaded ? 'opacity-100' : 'opacity-0',
						showFrame && 'rounded-lg',
						className,
					)}
					{...imgProps}
				/>
			)}
		</div>
	)
}

export { LazyImage as default }
