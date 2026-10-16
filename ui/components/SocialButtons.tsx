import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { MessageSquare } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { Spinner } from '../primitives/spinner'
import { cn } from '../utils/cn'
import type { ButtonProps } from './ButtonProps'
import { TooltipButton } from './TooltipButton'

const DEFAULT_REACTION_EMOJIS = ['❤️', '😂', '🔥', '💰', '👀']

/** Keeps clicks on the button from activating a parent card or link. */
function stopParent(event: MouseEvent<HTMLButtonElement>) {
	event.preventDefault()
	event.stopPropagation()
}

export interface ReactionButtonViewProps extends Omit<ButtonProps, 'onClick'> {
	/** Emoji of the viewer's latest reaction, or null when they have not reacted. */
	latestEmoji: string | null
	/** Opens the emoji picker on hover; false for signed-out viewers. */
	canPickEmoji: boolean
	emojis?: readonly string[]
	/** Main button press: the host toggles the default reaction or prompts sign-in. */
	onPress: () => void
	onSelectEmoji: (emoji: string) => void
	tooltip?: string
}

export function ReactionButtonView({
	latestEmoji,
	canPickEmoji,
	emojis = DEFAULT_REACTION_EMOJIS,
	onPress,
	onSelectEmoji,
	tooltip,
	className,
	variant,
	...props
}: ReactionButtonViewProps) {
	const [isOpen, setIsOpen] = useState(false)
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const clearCloseTimer = () => {
		if (closeTimerRef.current) {
			clearTimeout(closeTimerRef.current)
			closeTimerRef.current = null
		}
	}

	const scheduleClose = () => {
		clearCloseTimer()
		closeTimerRef.current = setTimeout(() => setIsOpen(false), 200)
	}

	const openPicker = () => {
		if (!canPickEmoji) return
		clearCloseTimer()
		setIsOpen(true)
	}

	useEffect(() => clearCloseTimer, [])

	const classNameButton = latestEmoji
		? 'border-neo-purple bg-neo-purple hover:bg-neo-purple/80 active:bg-neo-purple/70 text-white hover:text-light-gray'
		: 'border-neo-purple bg-transparent hover:bg-neo-purple active:bg-neo-purple/80 text-neo-purple hover:text-white'
	const classNameVariant =
		variant === 'ghost' ? 'bg-transparent text-neo-purple hover:bg-neo-purple/20 active:bg-neo-purple/30' : classNameButton

	return (
		<Popover open={isOpen}>
			<PopoverTrigger asChild>
				<TooltipButton
					variant={variant ?? 'outline'}
					size="icon"
					className={'border-2 rounded focus:outline-none ' + classNameVariant + ' ' + className}
					{...props}
					type="button"
					data-testid="reaction-button"
					onClick={(event) => {
						stopParent(event)
						setIsOpen(false)
						onPress()
					}}
					onPointerEnter={openPicker}
					onPointerLeave={scheduleClose}
					onPointerDown={stopParent}
					tooltip={tooltip}
				>
					{latestEmoji ? (
						latestEmoji === '❤️' ? (
							<span className="w-6 h-6 i-heart-fill" />
						) : (
							<span className="text-2xl">{latestEmoji}</span>
						)
					) : (
						<span className="w-6 h-6 i-heart" />
					)}
				</TooltipButton>
			</PopoverTrigger>
			<PopoverContent
				onMouseEnter={openPicker}
				onMouseLeave={scheduleClose}
				style={{ width: 'auto' }}
				className="flex flex-wrap gap-0 bg-primary/60 p-2 border-tertiary-hover/60 rounded-xl"
			>
				{emojis.map((emoji) => (
					<button
						key={emoji}
						className="active:bg-light-gray/20 px-2 py-1 border-2 border-transparent hover:border-light-gray/30 active:border-light-gray/40 rounded text-3xl"
						onClick={() => {
							setIsOpen(false)
							onSelectEmoji(emoji)
						}}
					>
						{emoji}
					</button>
				))}
			</PopoverContent>
		</Popover>
	)
}

export interface ZapButtonViewProps extends Omit<ButtonProps, 'onClick'> {
	isCheckingCapability: boolean
	canReceiveZaps: boolean
	isZapping: boolean
	onPress: () => void
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

export function ZapButtonView({
	isCheckingCapability,
	canReceiveZaps,
	isZapping,
	onPress,
	onClick,
	onPointerDown,
	className,
	type,
	variant,
	...props
}: ZapButtonViewProps) {
	const isDisabled = isCheckingCapability || !canReceiveZaps || isZapping

	return (
		<TooltipButton
			variant={variant ?? 'default'}
			size="icon"
			className={cn(
				'group gap-2 bg-transparent hover:bg-focus border-2 border-focus rounded text-focus hover:text-black hover:animate-pulse',
				className,
			)}
			{...props}
			type={type ?? 'button'}
			tooltip="Zap"
			disabledTooltip={!canReceiveZaps ? 'This user has not configured their zap address.' : undefined}
			data-testid="zap-button"
			onClick={(event) => {
				stopParent(event)
				onClick?.(event)
				if (!isDisabled) onPress()
			}}
			onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
				event.stopPropagation()
				onPointerDown?.(event)
			}}
			disabled={isDisabled}
		>
			{isCheckingCapability ? <Spinner /> : <span className="w-6 h-6 group-hover:animate-bounce i-lightning" />}
		</TooltipButton>
	)
}

export interface ShareButtonViewProps extends Omit<ButtonProps, 'onClick'> {
	onPress: () => void
}

export function ShareButtonView({ onPress, className, variant, ...props }: ShareButtonViewProps) {
	return (
		<TooltipButton
			variant={variant ?? 'outline'}
			size="icon"
			className={'border-foreground rounded border-2 bg-transparent hover:bg-foreground hover:text-background ' + className}
			tooltip="Share"
			{...props}
			onClick={onPress}
			data-testid="share-button"
		>
			<span className="w-6 h-6 i-sharing" />
		</TooltipButton>
	)
}

export interface CommentButtonViewProps extends Omit<ButtonProps, 'onClick'> {
	icon?: ReactNode
	tooltip?: string
	onPress: (event: MouseEvent<HTMLButtonElement>) => void
}

export function CommentButtonView({ icon, tooltip, onPress, onPointerDown, className, variant, ...props }: CommentButtonViewProps) {
	return (
		<TooltipButton
			variant={variant ?? 'outline'}
			size="icon"
			className={'border-foreground rounded border-2 bg-transparent hover:bg-foreground hover:text-background ' + className}
			type="button"
			{...props}
			tooltip={tooltip ?? 'Comment'}
			data-testid="comment-button"
			onClick={(event) => {
				stopParent(event)
				onPress(event)
			}}
			onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
				event.stopPropagation()
				onPointerDown?.(event)
			}}
		>
			{icon ?? <MessageSquare className="size-6" strokeWidth={2} />}
		</TooltipButton>
	)
}
