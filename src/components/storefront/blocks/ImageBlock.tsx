import { Media } from '@/components/Media'
import { isSafeMediaSrc } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontLink } from '../StorefrontLink'
import { StorefrontEditorHint, StorefrontSection, type StorefrontWidth } from './shared'

export interface ImageBlockProps {
	url: string
	alt: string
	width: StorefrontWidth
	rounded: boolean
	href: string
}

/**
 * A standalone image, optionally linked.
 *
 * Renders through the shared `Media` component so a broken or hostile URL
 * degrades to the same placeholder used everywhere else in the app instead of
 * a browser-default broken-image icon.
 */
export function ImageBlock({ url, alt, width, rounded, href }: ImageBlockProps) {
	const { isEditing } = useStorefrontContext()

	if (!isSafeMediaSrc(url) || url.length === 0) {
		return isEditing ? (
			<StorefrontSection className="py-6">
				<StorefrontEditorHint>Add an image URL. It must start with https:// or /.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	const image = (
		<Media
			src={url}
			// An empty alt is the correct markup for decoration; a missing one is
			// not. Authors who leave it blank get a decorative image, and screen
			// readers skip it rather than reading out a URL.
			alt={alt}
			className={cn('h-auto w-full object-cover', rounded && 'rounded-xl')}
			video={false}
		/>
	)

	return (
		<StorefrontSection width={width} className="py-8">
			{href.trim().length > 0 ? (
				<StorefrontLink href={href} className="block">
					{image}
				</StorefrontLink>
			) : (
				image
			)}
		</StorefrontSection>
	)
}
