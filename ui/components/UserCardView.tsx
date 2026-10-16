import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { UiLink } from '../provider/UiProvider'
import { cn } from '../utils/cn'

export type UserCardSize = 'xs' | 'sm' | 'md' | 'lg'

export interface UserCardViewProps {
	renderAvatar: (className: string) => ReactNode
	isLoading: boolean
	displayName: string | null
	nip05: string | null
	npub: string | null
	/** Rendered next to the title when `nip05` is set; `showAddress` mirrors the layout decision. */
	renderNip05Badge?: (options: { className: string; showAddress: boolean }) => ReactNode
	/** When set, the whole card links here. */
	profileHref?: string
	/** Narrow viewports always show NIP-05 as the subtitle. */
	compact?: boolean
	className?: string
	size?: UserCardSize
	subtitle?: 'npub' | 'nip-05' | 'none'
	copyNpub?: boolean
}

export function formatNpubForDisplay(npub: string): string {
	return `${npub.slice(0, 9)}..${npub.slice(-6)}`
}

export function getUserCardTitle({
	isProfileLoading,
	profileDisplayName,
	textDisplayNpub,
}: {
	isProfileLoading: boolean
	profileDisplayName: string | null
	textDisplayNpub: string
}): string {
	if (isProfileLoading) return 'Loading...'
	return profileDisplayName ?? textDisplayNpub
}

export function isKeyboardCopyActivationKey(event: KeyboardEvent): boolean {
	return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar'
}

const classSizeAvatar = { xs: 'h-6 w-6', sm: 'h-10 w-10', md: 'h-12 w-12', lg: 'h-16 w-16' }
const classSizeName = { xs: 'text-xs', sm: 'text-sm', md: 'text-base', lg: 'text-xl sm:text-2xl font-bold' }
const classSizeNIP05 = { xs: 'text-xs', sm: 'text-xs', md: 'text-sm', lg: 'text-sm' }
const classGapHorizontal = { xs: 'gap-2', sm: 'gap-2', md: 'gap-4', lg: 'gap-6' }
const classGapVertical = { xs: 'gap-0', sm: 'gap-0', md: 'gap-1', lg: 'gap-1' }
const TOOLTIP_DEFAULT = 'Copy npub'

export function UserCardView({
	renderAvatar,
	isLoading,
	displayName,
	nip05,
	npub,
	renderNip05Badge,
	profileHref,
	compact = false,
	className = '',
	size = 'md',
	subtitle = 'nip-05',
	copyNpub = true,
}: UserCardViewProps) {
	const [textTooltip, setTextTooltip] = useState(TOOLTIP_DEFAULT)
	const [forceShowTooltip, setForceShowTooltip] = useState(false)

	const textDisplayNpub = npub ? formatNpubForDisplay(npub) : 'Unknown user'
	const textTitle = getUserCardTitle({ isProfileLoading: isLoading, profileDisplayName: displayName, textDisplayNpub })

	const showNip05AddressAfterBadge = !isLoading && nip05 != null && !(subtitle === 'nip-05' || compact)
	const showNip05AsSubtitle = !isLoading && nip05 != null && (subtitle === 'nip-05' || compact)
	const showNpubAsTitle = !isLoading && displayName == null && npub != null
	const showNpubAsSubtitle = !showNpubAsTitle && !isLoading && displayName != null && subtitle === 'npub' && npub != null
	const showSubtitle = size !== 'xs'

	// Avoid turning an already-compact card into a copy target when it only shows one text line.
	const onlyPrimaryTextShows = !showSubtitle || (!showNip05AsSubtitle && !showNpubAsSubtitle)
	const disableSmallPrimaryCopy = (size === 'xs' || size === 'sm') && onlyPrimaryTextShows
	const shouldCopyNpub = copyNpub && !isLoading && npub != null && !disableSmallPrimaryCopy
	const classNpub = shouldCopyNpub ? 'cursor-pointer' : ''

	const handleCopyNpub = (event: SyntheticEvent) => {
		event.preventDefault()
		if (npub == null) return

		navigator.clipboard.writeText(npub)
		setTextTooltip('Copied!')
		setForceShowTooltip(true)
		setTimeout(() => {
			setTextTooltip(TOOLTIP_DEFAULT)
			setForceShowTooltip(false)
		}, 2000)
	}

	const copyNpubWrapper = (child: ReactNode) =>
		shouldCopyNpub ? (
			<Tooltip open={forceShowTooltip ? true : undefined}>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label={TOOLTIP_DEFAULT}
						className={cn('w-min min-w-0 border-0 bg-transparent p-0 text-left', classNpub)}
						onClick={handleCopyNpub}
						onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
							if (isKeyboardCopyActivationKey(event.nativeEvent)) handleCopyNpub(event)
						}}
					>
						{child}
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom">{textTooltip}</TooltipContent>
			</Tooltip>
		) : (
			child
		)

	// min-w-0 lets the name and npub truncate.
	const content = (
		<div className={cn('flex flex-row items-center min-w-0 font-sans font-normal tracking-normal text-nowrap', classGapHorizontal[size])}>
			{renderAvatar(cn(classSizeAvatar[size], 'min-w-0', className))}
			<div className={cn('flex flex-col min-w-0', classGapVertical[size], className)}>
				<div className={cn('flex items-center gap-1 min-w-0 overflow-hidden', className)}>
					{showNpubAsTitle ? (
						copyNpubWrapper(
							<span className={cn(classSizeName[size], 'truncate lowercase min-w-0', classNpub, className)}>{textTitle}</span>,
						)
					) : (
						<h2 className={cn(classSizeName[size], 'truncate min-w-0', className)}>{textTitle}</h2>
					)}
					{nip05 && renderNip05Badge?.({ className: cn(classSizeNIP05[size], className), showAddress: showNip05AddressAfterBadge })}
				</div>

				{showSubtitle &&
					(showNip05AsSubtitle ? (
						<p className={cn(classSizeNIP05[size], 'text-gray-400 truncate', className)}>{nip05}</p>
					) : (
						showNpubAsSubtitle &&
						copyNpubWrapper(
							<span className={cn('text-xs font-medium text-gray-400 truncate lowercase', classNpub, className)}>{textDisplayNpub}</span>,
						)
					))}
			</div>
		</div>
	)

	return profileHref ? <UiLink href={profileHref}>{content}</UiLink> : content
}
