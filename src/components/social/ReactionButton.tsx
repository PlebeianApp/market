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
	// TODO: This should be changed for getting exclusively one's own reactions, and have them ordered by creation date descending.
	const { data: reactions } = useEventReactions(event)
	const { user, isAuthenticated } = useAuth()

	// Popover open status
	const [isOpen, setIsOpen] = useState(false)

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

	// Delete the reaction selected
	const handleDeleteReaction = async (emoji?: string) => {
		if (!isAuthenticated) return

		const reaction = emoji ?? currentReaction

		if (!reaction || !event.id || !event.pubkey) return

		setIsOpen(false)

		// TODO: Publish deletion request for reaction.
		// We need to actually use the latest reaction in event format and request deletion for it.
	}

	const commonEmojis = ['❤️', '😂', '🔥', '💰', '👀']

	const classNameButton = currentReaction
		? 'bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-white hover:text-light-gray'
		: 'border-secondary bg-transparent hover:bg-secondary active:bg-secondary/80 text-secondary hover:text-white'

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
							handleStopPropagation(e)

							if (!isAuthenticated) {
								toast.error('You must be logged in to react.')
								return
							}

							if (!currentReaction) {
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
					onMouseEnter={handlePopoverOpen}
					onMouseLeave={scheduleClose}
					style={{ width: 'auto' }}
					className="flex flex-wrap gap-0 p-2 bg-primary/60 border-tertiary-hover/60 rounded-xl"
				>
					{commonEmojis.map((emoji) => (
						<button
							key={emoji}
							className="text-3xl px-2 py-1 border-2 rounded border-transparent hover:border-light-gray/30 active:border-light-gray/40 active:bg-light-gray/20"
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
