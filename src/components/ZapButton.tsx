import * as React from 'react'
import { Zap } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

interface ZapButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	recipientId: string
}

export function ZapButton({ recipientId, className, ...props }: ZapButtonProps) {
	const [isZapping, setIsZapping] = React.useState(false)

	const handleZap = async () => {
		setIsZapping(true)
		try {
			// Here you would implement the actual zap functionality
			// using your Nostr client/library
			console.log(`Zapping 1000 sats to ${recipientId}`)
			await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulated delay
		} catch (error) {
			console.error('Failed to zap:', error)
		} finally {
			setIsZapping(false)
		}
	}

	return (
		<Button
			variant="focus"
			size="icon"
			className={cn('gap-2', isZapping && 'animate-pulse', className)}
			onClick={handleZap}
			disabled={isZapping}
			{...props}
		>
			<Zap className={cn('h-4 w-4', isZapping && 'animate-bounce text-yellow-400')} />
		</Button>
	)
}
