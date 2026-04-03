import { ZapDialog } from '../dialogs/ZapDialog'
import { cn } from '@/lib/utils'
import { useZapCapability } from '@/queries/profiles'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useState } from 'react'
import { Button, type ButtonVariant } from '../ui/button'
import { Spinner } from '../ui/spinner'

interface ZapButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent | NDKUser
	variant?: ButtonVariant
}

export function ZapButton({ event, className, onClick, onPointerDown, type, variant, ...props }: ZapButtonProps) {
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

	const isDisabled = checkingZapCapability || !canAuthorReceiveZaps || isZapping
	const icon = checkingZapCapability ? <Spinner /> : <span className={cn('i-lightning w-6 h-6 group-hover:animate-bounce')} />

	return (
		<>
			<Button
				variant={variant ?? 'focus'}
				size="icon"
				className={cn('group border-focus bg-transparent text-focus hover:bg-focus hover:text-black hover:animate-pulse gap-2', className)}
				{...props}
				type={type ?? 'button'}
				tooltip="Zap"
				data-testid="zap-button"
				onClick={(e) => {
					handleButtonInteraction(e)
					if (!isDisabled) {
						void handleClick()
					}
				}}
				onPointerDown={handleButtonPointerDown}
				disabled={isDisabled}
				icon={icon}
			/>
			<ZapDialog isOpen={dialogOpen} onOpenChange={handleOpenChange} event={event} onZapComplete={handleZapComplete} />
		</>
	)
}
