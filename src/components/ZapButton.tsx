import { ZapDialog } from '@/components/ZapDialog'
import { ndkActions } from '@/lib/stores/ndk'
import { cn } from '@/lib/utils'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'

interface ZapButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent | NDKUser
}

export function ZapButton({ event, className, ...props }: ZapButtonProps) {
	const [isZapping, setIsZapping] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [checkingZapCapability, setCheckingZapCapability] = useState(false)
	const [canAuthorReceiveZaps, setCanAuthorReceiveZaps] = useState(false)
	useEffect(() => {
		const checkZapCapability = async () => {
			if (!event?.pubkey) return

			try {
				setCheckingZapCapability(true)
				const ndk = ndkActions.getNDK()
				if (!ndk) throw new Error('NDK not available')

				if (event instanceof NDKUser) {
					const zapInfo = await event.getZapInfo()
					setCanAuthorReceiveZaps(zapInfo.size > 0)
				} else {
					const userToZap = ndk.getUser({ pubkey: event.pubkey })
					const zapInfo = await userToZap.getZapInfo()
					setCanAuthorReceiveZaps(zapInfo.size > 0)
				}
			} catch (error) {
				console.error('Failed to check zap capability:', error)
				setCanAuthorReceiveZaps(false)
			} finally {
				setCheckingZapCapability(false)
			}
		}

		checkZapCapability()
	}, [event?.pubkey])

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
