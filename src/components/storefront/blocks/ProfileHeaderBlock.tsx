import { AvatarUser } from '@/components/AvatarUser'
import { Media } from '@/components/Media'
import { Nip05Badge } from '@/components/Nip05Badge'
import { isSafeMediaSrc } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { getNormalizedProfileDisplayName, useProfile } from '@/queries/profiles'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, alignClass, type StorefrontAlign } from './shared'

export interface ProfileHeaderBlockProps {
	showBanner: boolean
	showAbout: boolean
	showNip05: boolean
	align: StorefrontAlign
}

/**
 * The author's kind 0 identity, rendered as a page header.
 *
 * Nothing here is copied into the page document — name, picture, banner and
 * about are read live from the profile event at render time. That is the repo
 * rule about preferring pubkeys over display text applied to layout: the author
 * updates their profile once and every page they have published follows, and a
 * stale page can never misrepresent who they are now.
 */
export function ProfileHeaderBlock({ showBanner, showAbout, showNip05, align }: ProfileHeaderBlockProps) {
	const { pubkey, isEditing } = useStorefrontContext()
	const { data: profileData, isLoading } = useProfile(pubkey)
	const profile = profileData?.profile

	if (!pubkey) {
		return isEditing ? (
			<StorefrontSection>
				<StorefrontEditorHint>Your profile appears here once the page is opened by an author.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	const displayName = getNormalizedProfileDisplayName(profile)
	const about = typeof profile?.about === 'string' ? profile.about.trim() : ''
	const banner = typeof profile?.banner === 'string' && isSafeMediaSrc(profile.banner) ? profile.banner : null

	return (
		<div className="w-full">
			{showBanner && banner && (
				<div className="h-40 w-full overflow-hidden bg-muted sm:h-56">
					<Media src={banner} alt="" className="h-full w-full object-cover" video={false} />
				</div>
			)}

			<StorefrontSection className={cn('flex flex-col gap-3 py-8', alignClass[align], showBanner && banner && '-mt-12 sm:-mt-16')}>
				<AvatarUser pubkey={pubkey} className="size-24 border-4 border-background shadow-sm sm:size-28" />

				<h1 className="font-heading text-3xl font-bold text-foreground sm:text-4xl">
					{isLoading && !displayName ? 'Loading…' : displayName}
				</h1>

				{showNip05 && <Nip05Badge pubkey={pubkey} className="text-muted-foreground" />}

				{showAbout && about.length > 0 && (
					<p className={cn('max-w-2xl whitespace-pre-line leading-relaxed text-muted-foreground', align === 'center' && 'mx-auto')}>
						{about}
					</p>
				)}
			</StorefrontSection>
		</div>
	)
}
