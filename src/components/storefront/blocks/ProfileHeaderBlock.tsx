import { AvatarUser } from '@/components/AvatarUser'
import { Media } from '@/components/Media'
import { Nip05Badge } from '@/components/Nip05Badge'
import { isSafeHref, isSafeMediaSrc } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { getNormalizedProfileDisplayName, useProfile } from '@/queries/profiles'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, alignClass, type StorefrontAlign } from './shared'
import { StorefrontLink } from '../StorefrontLink'
import { cartStore } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import { ShoppingBag } from 'lucide-react'

export interface ProfileHeaderBlockProps {
	showBanner: boolean
	fullScreen: boolean
	showAbout: boolean
	showNip05: boolean
	align: StorefrontAlign
	layout?: 'banner' | 'compact'
	navigation?: { label: string; href: string }[]
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
export function ProfileHeaderBlock({
	showBanner,
	fullScreen,
	showAbout,
	showNip05,
	align,
	layout,
	navigation = [],
}: ProfileHeaderBlockProps) {
	const { pubkey, isEditing } = useStorefrontContext()
	const { data: profileData, isLoading } = useProfile(pubkey)
	const { cart } = useStore(cartStore)
	const totalItems = Object.values(cart.products).reduce((total, product) => total + product.amount, 0)
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
	const hasBanner = showBanner && !!banner
	const safeNavigation = navigation.filter((link) => isSafeHref(link.href) && link.label.trim().length > 0)

	if (layout === 'compact') {
		return (
			<div data-testid="storefront-profile-header" data-layout="compact" className="border-b border-border bg-background">
				<StorefrontSection width="wide" className="flex flex-wrap items-center justify-between gap-5 py-5 sm:py-6">
					<div className="flex min-w-0 items-center gap-3">
						<AvatarUser pubkey={pubkey} className="size-10 shrink-0" />
						<div className="min-w-0">
							<p className="break-words font-heading text-xl font-semibold">{isLoading && !displayName ? 'Loading…' : displayName}</p>
							{showNip05 && <Nip05Badge pubkey={pubkey} className="text-xs text-muted-foreground" />}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-6">
						{safeNavigation.length > 0 && (
							<nav aria-label="Store navigation" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium">
								{safeNavigation.map((link, index) => (
									<StorefrontLink
										key={`${link.href}-${index}`}
										href={link.href}
										className="transition-colors hover:text-primary hover:underline"
									>
										{link.label}
									</StorefrontLink>
								))}
							</nav>
						)}
						<button
							type="button"
							aria-label={`View cart (${totalItems} items)`}
							disabled={isEditing}
							onClick={() => uiActions.openDrawer('cart')}
							className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition-colors hover:bg-muted disabled:opacity-50"
						>
							<ShoppingBag className="size-4" aria-hidden />
							<span>{totalItems}</span>
						</button>
					</div>
				</StorefrontSection>
			</div>
		)
	}

	return (
		<div
			data-testid="storefront-profile-header"
			data-full-screen={fullScreen}
			className={cn(
				'relative isolate flex min-h-[24rem] w-full flex-col justify-center overflow-hidden bg-gradient-to-br from-primary/10 via-background to-muted',
				fullScreen && 'min-h-[100svh]',
			)}
		>
			{hasBanner ? (
				<div className="absolute inset-0 -z-10" aria-hidden="true">
					<Media src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" video={false} />
					<div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/35 to-black/75" />
				</div>
			) : (
				<div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
					<div className="absolute -top-32 left-1/4 size-96 rounded-full bg-primary/15 blur-3xl" />
					<div className="absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-secondary/15 blur-3xl" />
				</div>
			)}

			<StorefrontSection
				className={cn(
					'relative flex flex-1 flex-col justify-center gap-5 py-16 sm:py-20',
					alignClass[align],
					fullScreen && 'py-24 sm:py-28',
				)}
			>
				<AvatarUser
					pubkey={pubkey}
					className={cn('size-28 border-4 shadow-2xl ring-4 ring-white/10 sm:size-36', hasBanner ? 'border-white/80' : 'border-background')}
				/>

				<h1
					className={cn(
						'font-heading text-4xl font-bold tracking-tight sm:text-6xl',
						hasBanner ? 'text-white drop-shadow-lg' : 'text-foreground',
					)}
				>
					{isLoading && !displayName ? 'Loading…' : displayName}
				</h1>

				{showNip05 && <Nip05Badge pubkey={pubkey} className={hasBanner ? 'text-white/85' : 'text-muted-foreground'} />}

				{showAbout && about.length > 0 && (
					<p
						className={cn(
							'max-w-2xl whitespace-pre-line text-base leading-relaxed sm:text-lg',
							hasBanner ? 'text-white/85' : 'text-muted-foreground',
							align === 'center' && 'mx-auto',
						)}
					>
						{about}
					</p>
				)}
			</StorefrontSection>
		</div>
	)
}
