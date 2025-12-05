import { Button } from '@/components/ui/button'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import type { V4VDTO } from '@/lib/stores/cart'
import { nip19 } from 'nostr-tools'
import { Slider } from '@/components/ui/slider'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, Zap, Wallet } from 'lucide-react'
import { useState, useEffect } from 'react'
import { getHexColorFingerprintFromHexPubkey } from '@/lib/utils'
import { useZapCapabilityInfo } from '@/queries/profiles'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'

interface RecipientItemProps {
	share: V4VDTO
	onRemove: (id: string) => void
	onPercentageChange?: (id: string, percentage: number) => void
	color?: string
}

export function RecipientItem({ share, onRemove, onPercentageChange, color: providedColor }: RecipientItemProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [percentage, setPercentage] = useState(share.percentage * 100)
	const [color, setColor] = useState(providedColor || getHexColorFingerprintFromHexPubkey(share.pubkey))

	// Update local percentage when parent component updates the share
	useEffect(() => {
		setPercentage(share.percentage * 100)
	}, [share.percentage])

	// Convert npub to hex pubkey if the pubkey is in npub format
	let pubkey = share.pubkey
	let npub = share.pubkey
	if (pubkey.startsWith('npub')) {
		try {
			const { data } = nip19.decode(pubkey)
			if (typeof data === 'string') {
				pubkey = data
			}
		} catch (error) {
			console.error('Error decoding npub:', error)
		}
	} else {
		// Convert hex to npub for the query
		npub = nip19.npubEncode(pubkey)
	}

	// Fetch zap capability info
	const { data: zapInfo, isLoading: isLoadingZapInfo } = useZapCapabilityInfo(npub)

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

				{/* Zap capability badges */}
				<div className="flex items-center gap-1">
					{isLoadingZapInfo ? (
						<Spinner className="h-4 w-4" />
					) : zapInfo?.canReceiveZaps ? (
						<>
							{zapInfo.hasLightning && (
								<Tooltip>
									<TooltipTrigger>
										<Badge variant="outline" className="h-6 px-1.5 gap-1 text-yellow-600 border-yellow-300 bg-yellow-50">
											<Zap className="h-3 w-3" />
											<span className="text-xs">LN</span>
										</Badge>
									</TooltipTrigger>
									<TooltipContent>
										<p>Lightning Zaps (NIP-57)</p>
									</TooltipContent>
								</Tooltip>
							)}
							{zapInfo.hasCashu && (
								<Tooltip>
									<TooltipTrigger>
										<Badge variant="outline" className="h-6 px-1.5 gap-1 text-green-600 border-green-300 bg-green-50">
											<Wallet className="h-3 w-3" />
											<span className="text-xs">Cashu</span>
										</Badge>
									</TooltipTrigger>
									<TooltipContent>
										<p>Nutzaps (NIP-61)</p>
									</TooltipContent>
								</Tooltip>
							)}
						</>
					) : (
						<Tooltip>
							<TooltipTrigger>
								<Badge variant="outline" className="h-6 px-1.5 text-muted-foreground border-muted">
									<span className="text-xs">No zaps</span>
								</Badge>
							</TooltipTrigger>
							<TooltipContent>
								<p>This user cannot receive zaps</p>
							</TooltipContent>
						</Tooltip>
					)}
				</div>

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
