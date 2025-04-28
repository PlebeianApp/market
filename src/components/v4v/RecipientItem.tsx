import { Button } from '@/components/ui/button'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import type { V4VDTO } from '@/lib/stores/cart'
import { nip19 } from 'nostr-tools'
import { Slider } from '@/components/ui/slider'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'
import { useState, useEffect } from 'react'
import { getColorFromNpub, getHexColorFingerprintFromHexPubkey } from '@/lib/utils'

interface RecipientItemProps {
	share: V4VDTO
	onRemove: (id: string) => void
	onPercentageChange?: (id: string, percentage: number) => void
}

export function RecipientItem({ share, onRemove, onPercentageChange }: RecipientItemProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [percentage, setPercentage] = useState(share.percentage * 100)
	const [color, setColor] = useState(getHexColorFingerprintFromHexPubkey(share.pubkey))

	// Update local percentage when parent component updates the share
	useEffect(() => {
		setPercentage(share.percentage * 100)
	}, [share.percentage])

	// Convert npub to hex pubkey if the pubkey is in npub format
	let pubkey = share.pubkey
	if (pubkey.startsWith('npub')) {
		try {
			const { data } = nip19.decode(pubkey)
			if (typeof data === 'string') {
				pubkey = data
			}
		} catch (error) {
			console.error('Error decoding npub:', error)
		}
	}

	const handleSliderChange = (value: number[]) => {
		const newPercentage = value[0] / 100
		setPercentage(value[0])
		if (onPercentageChange) {
			onPercentageChange(share.id, newPercentage)
		}
	}

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="border rounded-md overflow-hidden"
			style={{ borderLeftWidth: '4px', borderLeftColor: color }}
		>
			<div className="flex items-center gap-2 p-3">
				<UserWithAvatar pubkey={pubkey} size="sm" showBadge={false} />
				<div className="flex-grow" />
				<div className="font-semibold">{(share.percentage * 100).toFixed(0)}%</div>
				<CollapsibleTrigger asChild>
					<Button variant="ghost" size="sm">
						<ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} />
					</Button>
				</CollapsibleTrigger>
				<Button variant="ghost" size="sm" onClick={() => onRemove(share.id)}>
					<span className="i-delete w-5 h-5"></span>
				</Button>
			</div>
			<CollapsibleContent>
				<div className="px-3 pb-4">
					<div className="text-sm text-muted-foreground mb-2">Adjust percentage</div>
					<Slider value={[percentage]} min={1} max={100} step={1} onValueChange={handleSliderChange} />
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}
