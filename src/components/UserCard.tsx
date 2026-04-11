import { useProfile } from '@/queries/profiles'
import { AvatarUser } from './AvatarUser'
import { useState } from 'react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { Nip05Badge } from './Nip05Badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Link } from '@tanstack/react-router'

interface UserCardProps {
	pubkey: string
	className?: string
	/** Small: , Medium: , Large: User Profile */
	size?: 'xs' | 'sm' | 'md' | 'lg'
	subtitle?: 'npub' | 'nip-05' | 'none'
	onPress?: 'profile' | 'copy-npub' | 'none'
}

export function UserCard({ pubkey, className = '', size = 'md', subtitle = 'nip-05', onPress = 'profile' }: UserCardProps) {
	const { data: profileData } = useProfile(pubkey)
	const { user } = profileData || {}

	const breakpoint = useBreakpoint()
	const compact = breakpoint === 'md' || breakpoint === 'sm'

	const textDisplayNpub = user?.npub.slice(0, 9) + '..' + user?.npub.slice(-6)
	const textTitle = user?.profile?.displayName ?? user?.profile?.name ?? textDisplayNpub

	const showNip05AddressAfterBadge = user?.profile?.nip05 != null && !(subtitle === 'nip-05' || compact)
	const showNip05AsSubtitle = user?.profile?.nip05 != null && (subtitle === 'nip-05' || compact)
	const showNpubAsTitle = textTitle == textDisplayNpub
	const showNpubAsSubtitle = !showNpubAsTitle && subtitle === 'npub'
	const showSubtitle = size !== 'xs'

	const shouldCopyNpub = onPress !== 'none'

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
				//event.stopPropagation()
				event.preventDefault()

				if (user?.npub == null) {
					return
				}

				// Copy npub to clipboard
				navigator.clipboard.writeText(user?.npub)

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
			<Tooltip open={forceShowTooltip == true ? forceShowTooltip : undefined}>
				<TooltipTrigger className={'w-min ' + className}>{child}</TooltipTrigger>

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
			<AvatarUser pubkey={user?.pubkey} className={classSizeAvatar + ' min-w-0 ' + className} />
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
					{user?.pubkey && (
						<Nip05Badge pubkey={user.pubkey} className={classSizeNIP05 + ' ' + className} showAddress={showNip05AddressAfterBadge} />
					)}
				</div>

				{showSubtitle &&
					(showNip05AsSubtitle ? (
						<p className={classSizeNIP05 + ' text-gray-400 truncate ' + className}>{user?.profile?.nip05}</p>
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

	if (onPress === 'profile') {
		return <Link to={`/profile/${pubkey}`}>{content}</Link>
	} else {
		return content
	}
}
