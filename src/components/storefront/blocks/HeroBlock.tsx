import { Button } from '@/components/ui/button'
import { isSafeMediaSrc } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, alignClass, type StorefrontAlign } from './shared'
import { StorefrontLink } from '../StorefrontLink'

export interface HeroBlockProps {
	title: string
	subtitle: string
	imageUrl: string
	ctaLabel: string
	ctaHref: string
	align: StorefrontAlign
	minHeight: number
	layout?: 'banner' | 'split'
	eyebrow?: string
}

/**
 * Full-width banner with an optional background image and call to action.
 *
 * The background is applied as a CSS `background-image` on a URL the schema has
 * already gated to `https:` or an in-app path, and re-gated here. A
 * `background-image` is the one place a bad URL would be the most tempting to
 * wave through, since it cannot execute script on its own — but it can still
 * beacon the visitor's IP to an arbitrary host, which is exactly what a
 * marketplace visitor did not consent to.
 */
export function HeroBlock({ title, subtitle, imageUrl, ctaLabel, ctaHref, align, minHeight, layout, eyebrow }: HeroBlockProps) {
	const { isEditing } = useStorefrontContext()
	const image = isSafeMediaSrc(imageUrl) && imageUrl.length > 0 ? imageUrl : null
	const hasCta = ctaLabel.trim().length > 0 && ctaHref.trim().length > 0
	const isEmpty = title.trim().length === 0 && subtitle.trim().length === 0 && !image && !hasCta

	if (isEmpty) {
		return isEditing ? (
			<StorefrontSection className="py-4">
				<StorefrontEditorHint>Give this hero a title, a background image, or a button.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	if (layout === 'split') {
		return (
			<div className="bg-muted/40" data-testid="storefront-split-hero">
				<StorefrontSection
					width="wide"
					className="grid items-center gap-8 py-10 sm:py-16 lg:grid-cols-2 lg:gap-16"
					style={{ minHeight: `${minHeight}px` }}
				>
					<div className={cn('flex flex-col gap-6', alignClass[align])}>
						{eyebrow?.trim() && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>}
						{title.trim() && <h1 className="max-w-xl font-heading text-5xl leading-[1.05] font-bold sm:text-6xl lg:text-7xl">{title}</h1>}
						{subtitle.trim() && <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">{subtitle}</p>}
						{hasCta && (
							<StorefrontLink
								href={ctaHref}
								className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
							>
								{ctaLabel}
							</StorefrontLink>
						)}
					</div>
					{image ? (
						<img src={image} alt="" className="aspect-[4/3] w-full rounded-[2rem] object-cover lg:aspect-square" />
					) : (
						isEditing && <StorefrontEditorHint>Add a farm photograph or illustration to complete this split hero.</StorefrontEditorHint>
					)}
				</StorefrontSection>
			</div>
		)
	}

	return (
		<div
			className={cn('relative flex w-full items-center overflow-hidden', image ? 'bg-black text-white' : 'bg-muted text-foreground')}
			style={{
				minHeight: `${minHeight}px`,
				backgroundImage: image ? `url("${encodeURI(image)}")` : undefined,
				backgroundSize: 'cover',
				backgroundPosition: 'center',
			}}
		>
			{/* Scrim: keeps text legible over an arbitrary photograph without
			    asking the author to think about contrast. */}
			{image && <div className="absolute inset-0 bg-black/45" aria-hidden />}

			<StorefrontSection className={cn('relative flex flex-col gap-4 py-16', alignClass[align])}>
				{title.trim().length > 0 && <h1 className="font-heading text-4xl font-bold sm:text-5xl">{title}</h1>}
				{subtitle.trim().length > 0 && (
					<p className={cn('max-w-2xl text-lg', image ? 'text-white/85' : 'text-muted-foreground')}>{subtitle}</p>
				)}
				{hasCta && (
					<StorefrontLink href={ctaHref}>
						<Button size="lg" className="mt-2">
							{ctaLabel}
						</Button>
					</StorefrontLink>
				)}
			</StorefrontSection>
		</div>
	)
}
