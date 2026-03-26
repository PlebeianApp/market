import { Button } from '@/components/ui/button'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

interface ReactionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent
}

export function ReactionButton({ event, className, onClick, onPointerDown, ...props }: ReactionButtonProps) {
	const [reaction, setReaction] = useState<string>('')

	const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

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
		setReaction(emoji)
		setIsOpen(false)
	}

	const handleButtonInteraction = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault()
		e.stopPropagation()
		onClick?.(e)
	}

	const handleButtonPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
		e.stopPropagation()
		onPointerDown?.(e)
	}

	useEffect(() => {
		return () => {
			clearCloseTimer() // Cleanup on unmount
		}
	}, [])

	const [isOpen, setIsOpen] = useState(false)

	const commonEmojis = ['❤️', '🔥', '👀', '😂', '😱']
	const classNameButton =
		reaction === ''
			? 'border-secondary bg-transparent hover:bg-secondary active:bg-secondary/80 text-secondary hover:text-white'
			: 'bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-white hover:text-light-gray'

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
							if (!reaction) {
								setReaction('❤️')
							} else {
								setReaction('')
							}
						}}
						onPointerEnter={handleTriggerEnter}
						onPointerLeave={handleTriggerLeave}
						onPointerDown={handleButtonPointerDown}
						disabled={!event.ndk}
						icon={
							reaction === '' ? (
								<span className="i-heart w-6 h-6" />
							) : reaction === '❤️' ? (
								<span className="i-heart-fill w-6 h-6" />
							) : (
								<span className="text-2xl">{reaction}</span>
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
							className="text-3xl px-2 py-1 border-transparent hover:border-light-gray/30 active:border-light-gray/40 active:bg-light-gray/20 border-2 rounded"
							onClick={() => handleReaction(emoji)}
						>
							{emoji}
						</button>
					))}
				</PopoverContent>
			</Popover>
		</>
	)
}
