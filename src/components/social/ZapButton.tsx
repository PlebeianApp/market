import { ZapDialog } from '../dialogs/ZapDialog'
import { useZapCapability } from '@/queries/profiles'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useState } from 'react'
import type { ButtonProps } from '@ui/components/ButtonProps'
import { ZapButtonView } from '@ui/components/SocialButtons'

interface ZapButtonProps extends ButtonProps {
	event: NDKEvent | NDKUser
}

export function ZapButton({ event, ...props }: ZapButtonProps) {
	const [isZapping, setIsZapping] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)

	const { data: canAuthorReceiveZaps, isLoading: checkingZapCapability } = useZapCapability(event)

	const handleZapComplete = () => {
		setIsZapping(false)
		setDialogOpen(false)
	}

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setIsZapping(false)
		}
		setDialogOpen(open)
	}

	return (
		<>
			<ZapButtonView
				{...props}
				isCheckingCapability={checkingZapCapability}
				canReceiveZaps={!!canAuthorReceiveZaps}
				isZapping={isZapping}
				onPress={() => {
					setIsZapping(true)
					setDialogOpen(true)
				}}
			/>
			<ZapDialog isOpen={dialogOpen} onOpenChange={handleOpenChange} event={event} onZapComplete={handleZapComplete} />
		</>
	)
}
