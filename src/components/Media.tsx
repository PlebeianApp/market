import { useState, type CSSProperties } from 'react'
import { isVideoUrl } from '@/lib/media'
import { cn } from '@/lib/utils'
import { ImageOff } from 'lucide-react'

export interface MediaProps {
	/** Media URL. Null/undefined or an errored image renders the fallback. */
	src?: string | null
	alt: string
	/** Classes applied to the `<img>` / `<video>` element. */
	className?: string
	/** Inline styles applied to the `<img>` / `<video>` element. */
	style?: CSSProperties
	/** Extra classes for the fallback placeholder (defaults to full-size centered). */
	fallbackClassName?: string
	/** Render a `<video>` (with controls) when `src` is a video URL. Default true. */
	video?: boolean
	controls?: boolean
	autoPlay?: boolean
	muted?: boolean
	loop?: boolean
	playsInline?: boolean
	onClick?: () => void
}

/**
 * Shared media element: renders a `<video>` for video URLs and `<img>`
 * otherwise, with an `onError` fallback. Centralising display lets one
 * component change shape consistently everywhere (vs scattered `<img>` /
 * `<video>` sites drifting apart).
 */
export function Media({
	src,
	alt,
	className,
	style,
	fallbackClassName,
	video = true,
	controls = false,
	autoPlay = false,
	muted = true,
	loop = true,
	playsInline = true,
	onClick,
}: MediaProps) {
	// Track which `src` errored (not just a boolean) so a recycled component
	// (keyed list rows, carousel items, MigrationForm index) resets to the
	// media element when its `src` changes instead of staying on the fallback.
	const [failedSrc, setFailedSrc] = useState<string | null>(null)
	const failed = !!src && failedSrc === src
	const handleError = () => setFailedSrc(src ?? null)

	if (!src || failed) {
		return (
			<div
				role="img"
				aria-label={alt}
				className={cn('flex h-full w-full items-center justify-center bg-zinc-800 text-zinc-500', fallbackClassName)}
			>
				<ImageOff className="h-8 w-8" />
			</div>
		)
	}

	if (video && isVideoUrl(src)) {
		return (
			<video
				src={src}
				aria-label={alt}
				className={className}
				style={style}
				controls={controls}
				autoPlay={autoPlay}
				muted={muted}
				loop={loop}
				playsInline={playsInline}
				onError={handleError}
				onClick={onClick}
			/>
		)
	}

	return <img src={src} alt={alt} className={className} style={style} onError={handleError} onClick={onClick} />
}
