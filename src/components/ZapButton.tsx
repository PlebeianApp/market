import { ZapDialog } from '@/components/ZapDialog'
import { cn } from '@/lib/utils'
import { useZapCapability } from '@/queries/profiles'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useState } from 'react'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'

interface ZapButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent | NDKUser
}

export function ZapButton({ event, className, onClick, onPointerDown, type, ...props }: ZapButtonProps) {
	const [isZapping, setIsZapping] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)

	const { data: canAuthorReceiveZaps, isLoading: checkingZapCapability } = useZapCapability(event)

	const handleZapComplete = () => {
		setIsZapping(false)
		setDialogOpen(false)
	}

	const handleClick = async () => {
		setIsZapping(true)
		setDialogOpen(true)
	}

	const handleButtonInteraction = (e: React.MouseEvent<HTMLButtonElement>) => {
		// Prevent parent links/cards from handling zap button clicks.
		e.preventDefault()
		e.stopPropagation()
		onClick?.(e)
	}

	const handleButtonPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
		// Also block pointer-down bubbling to parent clickable containers.
		e.stopPropagation()
		onPointerDown?.(e)
	}

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setIsZapping(false)
		}
		setDialogOpen(open)
	}

	return (
		<>
			{checkingZapCapability ? (
				<Button
					variant="focus"
					size="icon"
					className={cn('gap-2', isZapping && 'animate-pulse', className)}
					{...props}
					type={type ?? 'button'}
					onClick={handleButtonInteraction}
					onPointerDown={handleButtonPointerDown}
					disabled={true}
					icon={<Spinner />}
				/>
			) : canAuthorReceiveZaps ? (
				<Button
					variant="focus"
					size="icon"
					className={cn('gap-2', isZapping && 'animate-pulse', className)}
					{...props}
					type={type ?? 'button'}
					onClick={(e) => {
						handleButtonInteraction(e)
						void handleClick()
					}}
					onPointerDown={handleButtonPointerDown}
					disabled={isZapping || !canAuthorReceiveZaps}
					icon={<span className={cn('i-lightning w-6 h-6', isZapping && 'animate-bounce')} />}
				/>
			) : (
				<Button
					variant="focus"
					size="icon"
					className={cn('gap-2', isZapping && 'animate-pulse', className)}
					{...props}
					type={type ?? 'button'}
					onClick={handleButtonInteraction}
					onPointerDown={handleButtonPointerDown}
					disabled={true}
					icon={<span className={cn('i-lightning w-6 h-6', isZapping && 'animate-bounce')} />}
				/>
			)}
			<ZapDialog isOpen={dialogOpen} onOpenChange={handleOpenChange} event={event} onZapComplete={handleZapComplete} />
		</>
	)
}
