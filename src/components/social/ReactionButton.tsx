import { NDKEvent } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { usePublishReactionMutation } from '@/publish/reactions'
import { useEventReactions } from '@/queries/reactions'
import { useAuth } from '@/lib/stores/auth'
import { usePublishDeletionMutation } from '@/publish/reactions'
import { toast } from 'sonner'
import type { ButtonProps } from '../shared/ButtonProps'
import { TooltipButton } from '../shared/TooltipButton'

interface ReactionButtonProps extends ButtonProps {
	event: NDKEvent
}

export function ReactionButton({ event, className, variant, ...props }: ReactionButtonProps) {
	const { user, isAuthenticated } = useAuth()
	const { data: reactionsAll, error } = useEventReactions(event)
	const mutationPublish = usePublishReactionMutation()
	const mutationDelete = usePublishDeletionMutation()

	// Popover open status
	const [isOpen, setIsOpen] = useState(false)
	const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

	// Filter reactions for own user
	const reactions = reactionsAll?.filter((reaction) => reaction.authorPubkey == user?.pubkey)
	const latestReaction = reactions?.[0]

	const clearCloseTimer = () => {
		if (closeTimerRef.current) {
			clearTimeout(closeTimerRef.current)
			closeTimerRef.current = null
		}
	}

	const scheduleClose = () => {
		clearCloseTimer()
		closeTimerRef.current = setTimeout(() => {
			setIsOpen(false)
		}, 200) // Adjust delay as needed
	}

	const handlePopoverOpen = () => {
		if (!isAuthenticated) return

		clearCloseTimer()
		setIsOpen(true)
	}

	const handleStopPropagation = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault()
		e.stopPropagation()
	}

	useEffect(() => {
		return () => {
			clearCloseTimer() // Cleanup on unmount
		}
	}, [])

	// Publish reaction when button is clicked
	const handlePublishReaction = async (emoji: string) => {
		if (!isAuthenticated) return

		if (!emoji || !event.id || !event.pubkey) return

		setIsOpen(false)

		// Pass the event object directly to the mutation
		await mutationPublish.mutateAsync({
			emoji,
			event,
		})
	}

	// Delete the reaction selected
	const handleDeleteReaction = async () => {
		if (!isAuthenticated) return

		if (!latestReaction || !latestReaction.id || !latestReaction.authorPubkey) return

		setIsOpen(false)

		// Pass the event object directly to the mutation
		await mutationDelete.mutateAsync({
			reactionEvent: latestReaction,
		})
	}

	const commonEmojis = ['❤️', '😂', '🔥', '💰', '👀']

	const classNameButton = latestReaction
		? 'border-neo-purple bg-neo-purple hover:bg-neo-purple/80 active:bg-neo-purple/70 text-white hover:text-light-gray'
		: 'border-neo-purple bg-transparent hover:bg-neo-purple active:bg-neo-purple/80 text-neo-purple hover:text-white'

	// Override appearance for "ghost" variant for existing reaction. Ideally this should be done with better theme variables & variants
	const classNameButtonGhost =
		variant === 'ghost' ? 'bg-transparent text-neo-purple hover:bg-neo-purple/20 active:bg-neo-purple/30' : classNameButton

	return (
		<>
			<Popover open={isOpen}>
				<PopoverTrigger asChild>
					<TooltipButton
						variant={variant ?? 'outline'}
						size="icon"
						className={'border-2 rounded focus:outline-none ' + classNameButtonGhost + ' ' + className}
						{...props}
						type="button"
						data-testid="reaction-button"
						onClick={(e) => {
							// TODO: Handle mobile - open dialog using handlePopoverOpen (don't select reaction yet)
							handleStopPropagation(e)

							if (!isAuthenticated) {
								toast.error('You must be logged in to react.')
								return
							}

							if (!latestReaction) {
								handlePublishReaction('❤️')
							} else {
								handleDeleteReaction()
							}
						}}
						onPointerEnter={handlePopoverOpen}
						onPointerLeave={scheduleClose}
						onPointerDown={handleStopPropagation}
						disabled={!event.ndk}
						/** Only show tooltip when not conflicting with popover */
						tooltip={isAuthenticated ? undefined : 'React'}
					>
						{latestReaction ? (
							latestReaction.emoji === '❤️' ? (
								<span className="w-6 h-6 i-heart-fill" />
							) : (
								<span className="text-2xl">{latestReaction.emoji}</span>
							)
						) : (
							<span className="w-6 h-6 i-heart" />
						)}
					</TooltipButton>
				</PopoverTrigger>
				<PopoverContent
					onMouseEnter={handlePopoverOpen}
					onMouseLeave={scheduleClose}
					style={{ width: 'auto' }}
					className="flex flex-wrap gap-0 bg-primary/60 p-2 border-tertiary-hover/60 rounded-xl"
				>
					{commonEmojis.map((emoji) => (
						<button
							key={emoji}
							className="active:bg-light-gray/20 px-2 py-1 border-2 border-transparent hover:border-light-gray/30 active:border-light-gray/40 rounded text-3xl"
							onClick={() => {
								handlePublishReaction(emoji)
							}}
						>
							{emoji}
						</button>
					))}
				</PopoverContent>
			</Popover>
		</>
	)
}
