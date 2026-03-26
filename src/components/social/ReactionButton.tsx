import { Button } from '@/components/ui/button'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { usePublishReactionMutation } from '@/publish/reactions'
import { useEventReactions } from '@/queries/reactions'
import { useAuth } from '@/lib/stores/auth'
import { toast } from 'sonner'

interface ReactionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent
}

export function ReactionButton({ event, className, ...props }: ReactionButtonProps) {
	const mutation = usePublishReactionMutation()
	const { data: reactions } = useEventReactions(event)
	const { user, isAuthenticated } = useAuth()

	const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

	const currentReaction = reactions
		? Array.from(reactions)?.find(([emoji, list]) => list.some((r) => r.authorPubkey === user?.pubkey))?.[0]
		: undefined

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

	const handleTriggerEnter = () => {
		if (!isAuthenticated) return

		clearCloseTimer()
		setIsOpen(true)
	}

	const handleTriggerLeave = () => {
		scheduleClose()
	}

	const handlePopoverEnter = () => {
		clearCloseTimer()
		setIsOpen(true)
	}

	const handlePopoverLeave = () => {
		scheduleClose()
	}

	const handleReaction = (emoji: string) => {
		if (!isAuthenticated) return

		setIsOpen(false)

		handlePublishReaction(emoji)
	}

	const handleButtonInteraction = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault()
		e.stopPropagation()

		if (!isAuthenticated) {
			toast.error('You must be logged in to react.')
		}
	}

	const handleButtonPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
		e.stopPropagation()

		if (!isAuthenticated) {
			toast.error('You must be logged in to react.')
		}
	}

	useEffect(() => {
		return () => {
			clearCloseTimer() // Cleanup on unmount
		}
	}, [])

	const [isOpen, setIsOpen] = useState(false)

	const commonEmojis = ['❤️', '😂', '🔥', '💰', '👀']

	const classNameButton = currentReaction
		? 'bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-white hover:text-light-gray'
		: 'border-secondary bg-transparent hover:bg-secondary active:bg-secondary/80 text-secondary hover:text-white'

	// Publish reaction when button is clicked
	const handlePublishReaction = async (emoji: string) => {
		if (!emoji || !event.id || !event.pubkey) return

		try {
			// Pass the event object directly to the mutation
			await mutation.mutateAsync({
				emoji,
				event,
			})
		} catch (error) {
			console.error('Failed to publish reaction:', error)
		}
	}

	// Check if user has already reacted with this emoji
	const hasReacted = (emoji: string) => {
		if (!reactions) return false
		const reactionList = reactions.get(emoji)
		return reactionList?.some((r) => r.authorPubkey === user?.pubkey && r.emoji === emoji) ?? false
	}

	return (
		<>
			<Popover open={isOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="icon"
						className={'border-2 focus:outline-none ' + classNameButton + ' ' + className}
						{...props}
						type="button"
						onClick={(e) => {
							handleButtonInteraction(e)
							if (!currentReaction) {
								handleReaction('❤️')
							} else {
								// TODO: Delete reaction
								// setReaction('')
							}
						}}
						onPointerEnter={handleTriggerEnter}
						onPointerLeave={handleTriggerLeave}
						onPointerDown={handleButtonPointerDown}
						disabled={!event.ndk}
						/** Only show tooltip when not conflicting with popover */
						tooltip={isAuthenticated ? undefined : 'React'}
						icon={
							currentReaction ? (
								currentReaction === '❤️' ? (
									<span className="i-heart-fill w-6 h-6" />
								) : (
									<span className="text-2xl">{currentReaction}</span>
								)
							) : (
								<span className="i-heart w-6 h-6" />
							)
						}
					/>
				</PopoverTrigger>
				<PopoverContent
					onMouseEnter={handlePopoverEnter}
					onMouseLeave={handlePopoverLeave}
					style={{ width: 'auto' }}
					className="flex flex-wrap gap-0 p-2 bg-primary/60 border-tertiary-hover/60 rounded-xl"
				>
					{commonEmojis.map((emoji) => (
						<button
							key={emoji}
							className="text-3xl px-2 py-1 border-2 rounded border-transparent hover:border-light-gray/30 active:border-light-gray/40 active:bg-light-gray/20"
							onClick={() => {
								handleReaction(emoji)
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
