import { ZapDialog } from '../dialogs/ZapDialog'
import { cn } from '@/lib/utils'
import { useZapCapability } from '@/queries/profiles'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useState } from 'react'
import { Spinner } from '../ui/spinner'
import { TooltipButton } from '../shared/TooltipButton'
import type { ButtonProps } from '../shared/ButtonProps'

interface ZapButtonProps extends ButtonProps {
	event: NDKEvent | NDKUser
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
	const icon = checkingZapCapability ? <Spinner /> : <span className={cn('w-6 h-6 group-hover:animate-bounce i-lightning')} />

	return (
		<>
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
				disabledTooltip={!canAuthorReceiveZaps ? 'This user has not configured their zap address.' : undefined}
				data-testid="zap-button"
				onClick={(e) => {
					handleButtonInteraction(e)
					if (!isDisabled) {
						void handleClick()
					}
				}}
				onPointerDown={handleButtonPointerDown}
				disabled={isDisabled}
			>
				{icon}
			</TooltipButton>
			<ZapDialog isOpen={dialogOpen} onOpenChange={handleOpenChange} event={event} onZapComplete={handleZapComplete} />
		</>
	)
}
