import { ZapDialog } from '@/components/ZapDialog'
import { ndkActions } from '@/lib/stores/ndk'
import { cn } from '@/lib/utils'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useZapCapability, zapCapabilityQueryOptions } from '@/queries/profiles'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'

interface ZapButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent | NDKUser
}

export function ZapButton({ event, className, ...props }: ZapButtonProps) {
	const [isZapping, setIsZapping] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)

	const { data: canAuthorReceiveZaps, isLoading: checkingZapCapability } = useZapCapability(event)

	const handleZapComplete = (zapEvent?: NDKEvent) => {
		setIsZapping(false)
		setDialogOpen(false)
	}

	const handleClick = async () => {
		setIsZapping(true)
		setDialogOpen(true)
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
					disabled={true}
					icon={<Spinner />}
					{...props}
				/>
			) : canAuthorReceiveZaps ? (
				<Button
					variant="focus"
					size="icon"
					className={cn('gap-2', isZapping && 'animate-pulse', className)}
					onClick={handleClick}
					disabled={isZapping || !canAuthorReceiveZaps}
					icon={<span className={cn('i-lightning w-6 h-6', isZapping && 'animate-bounce')} />}
					{...props}
				/>
			) : (
				<Button
					variant="focus"
					size="icon"
					className={cn('gap-2', isZapping && 'animate-pulse', className)}
					disabled={true}
					icon={<span className={cn('i-lightning w-6 h-6', isZapping && 'animate-bounce')} />}
					{...props}
				/>
			)}
			<ZapDialog isOpen={dialogOpen} onOpenChange={handleOpenChange} event={event} onZapComplete={handleZapComplete} />
		</>
	)
}
