import { useProfile, getProfileNip05 } from '@/queries/profiles'
import { AvatarUser } from './AvatarUser'
import { useState } from 'react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { Nip05Badge } from './Nip05Badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Link } from '@tanstack/react-router'
import { nip19 } from 'nostr-tools'
import { isValidHexKey, isValidNpub } from '@/lib/utils'

interface UserCardProps {
	pubkey?: string
	className?: string
	/** Small: , Medium: , Large: User Profile */
	size?: 'xs' | 'sm' | 'md' | 'lg'
	subtitle?: 'npub' | 'nip-05' | 'none'
	onPress?: 'profile' | 'copy-npub' | 'none'
}

function encodeIdentifierToNpub(identifier: string | undefined): string | null {
	const trimmedIdentifier = identifier?.trim()
	if (!trimmedIdentifier) return null

	if (isValidNpub(trimmedIdentifier)) {
		return trimmedIdentifier
	}

	if (!isValidHexKey(trimmedIdentifier)) {
		return null
	}

	return nip19.npubEncode(trimmedIdentifier)
}

function formatNpubForDisplay(npub: string): string {
	return `${npub.slice(0, 9)}..${npub.slice(-6)}`
}

export function UserCard({ pubkey, className, size = 'md', subtitle = 'nip-05', onPress = 'profile' }: UserCardProps) {
	const safePubkey = pubkey?.trim() || undefined
	const { data: profileData, isPending, isFetching } = useProfile(safePubkey)
	const { profile, user } = profileData || {}

	const breakpoint = useBreakpoint()
	const compact = breakpoint === 'md' || breakpoint === 'sm'

	const profileDisplayName = (profile?.displayName || profile?.name || '').trim() || null
	const profileNip05 = getProfileNip05({ profile: profile ?? null })?.trim() || null
	const userNpub = user?.npub?.trim()
	const npub = userNpub && isValidNpub(userNpub) ? userNpub : encodeIdentifierToNpub(safePubkey)
	const textDisplayNpub = npub ? formatNpubForDisplay(npub) : 'Unknown user'
	const isProfileLoading = isPending || isFetching
	const textTitle = isProfileLoading ? 'Loading...' : (profileDisplayName ?? textDisplayNpub)

	const showNip05AddressAfterBadge = !isProfileLoading && profileNip05 != null && !(subtitle === 'nip-05' || compact)
	const showNip05AsSubtitle = !isProfileLoading && profileNip05 != null && (subtitle === 'nip-05' || compact)
	const showNpubAsTitle = !isProfileLoading && profileDisplayName == null && npub != null
	const showNpubAsSubtitle = !showNpubAsTitle && !isProfileLoading && profileDisplayName != null && subtitle === 'npub' && npub != null
	const showSubtitle = size !== 'xs'

	// Avoid turning an already-compact card into a copy target when it only shows one text line.
	const onlyPrimaryTextShows = !showSubtitle || (!showNip05AsSubtitle && !showNpubAsSubtitle)
	const disableSmallPrimaryCopy = (size === 'xs' || size === 'sm') && onlyPrimaryTextShows
	const shouldCopyNpub = onPress !== 'none' && !isProfileLoading && npub != null && !disableSmallPrimaryCopy

	const classSizeAvatar = {
		xs: 'h-6 w-6',
		sm: 'h-10 w-10',
		md: 'h-12 w-12',
		lg: 'h-16 w-16',
	}[size]

	const classSizeName = {
		xs: 'text-xs',
		sm: 'text-sm',
		md: 'text-base',
		lg: 'text-xl sm:text-2xl font-bold',
	}[size]

	const classSizeNIP05 = {
		xs: 'text-xs',
		sm: 'text-xs',
		md: 'text-sm',
		lg: 'text-sm',
	}[size]

	const classSizeNpub = 'text-xs'

	/** Gap between avatar and text elements */
	const classGapHorizontal = {
		xs: 'gap-2',
		sm: 'gap-2',
		md: 'gap-4',
		lg: 'gap-6',
	}[size]

	/** Gap between text elements vertically */
	const classGapVertical = {
		xs: 'gap-0',
		sm: 'gap-0',
		md: 'gap-1',
		lg: 'gap-1',
	}[size]

	/** Only show mouse pointer on npub if can copy */
	const classNpub = shouldCopyNpub ? 'cursor-pointer' : ''

	// npub config

	const textTooltipDefault = 'Copy npub'
	const [textTooltip, setTextTooltip] = useState(textTooltipDefault)
	const [forceShowTooltip, setForceShowTooltip] = useState(false)

	const onClickNpub = shouldCopyNpub
		? (event: React.MouseEvent) => {
				event.preventDefault()

				if (npub == null) {
					return
				}

				// Copy npub to clipboard
				navigator.clipboard.writeText(npub)

				// Update tooltip to show copied state
				setTextTooltip('Copied!')
				setForceShowTooltip(true)

				// After delay, reset tooltip
				setTimeout(() => {
					setTextTooltip(textTooltipDefault)
					setForceShowTooltip(false)
				}, 2000)
			}
		: () => {}

	const copyNpubWrapper = (child: React.ReactNode) =>
		shouldCopyNpub ? (
			<Tooltip open={forceShowTooltip === true ? forceShowTooltip : undefined}>
				<TooltipTrigger asChild className={'w-min ' + className}>
					{child}
				</TooltipTrigger>

				<TooltipContent side="bottom" className="">
					{textTooltip}
				</TooltipContent>
			</Tooltip>
		) : (
			child
		)

	// Note: We pass in min-w-0 to ensure text (name, npub) truncates
	const content = (
		<div className={'flex flex-row items-center min-w-0 font-sans font-normal tracking-normal text-nowrap ' + classGapHorizontal}>
			<AvatarUser pubkey={safePubkey} className={classSizeAvatar + ' min-w-0 ' + className} />
			<div className={'flex flex-col min-w-0 ' + classGapVertical + ' ' + className}>
				<div className={'flex items-center gap-1 min-w-0 overflow-hidden ' + className}>
					{showNpubAsTitle ? (
						copyNpubWrapper(
							<h2 className={classSizeName + ' truncate lowercase min-w-0 ' + classNpub + ' ' + className} onClick={onClickNpub}>
								{textTitle}
							</h2>,
						)
					) : (
						<h2 className={classSizeName + ' truncate min-w-0 ' + className}>{textTitle}</h2>
					)}
					{safePubkey && profileNip05 && (
						<Nip05Badge pubkey={safePubkey} className={classSizeNIP05 + ' ' + className} showAddress={showNip05AddressAfterBadge} />
					)}
				</div>

				{showSubtitle &&
					(showNip05AsSubtitle ? (
						<p className={classSizeNIP05 + ' text-gray-400 truncate ' + className}>{profileNip05}</p>
					) : (
						showNpubAsSubtitle &&
						copyNpubWrapper(
							<p
								className={classSizeNpub + ' font-medium text-gray-400 truncate lowercase ' + classNpub + ' ' + className}
								onClick={onClickNpub}
							>
								{textDisplayNpub}
							</p>,
						)
					))}
			</div>
		</div>
	)

	if (onPress === 'profile' && safePubkey) {
		return (
			<Link to="/profile/$profileId" params={{ profileId: safePubkey }}>
				{content}
			</Link>
		)
	} else {
		return content
	}
}
