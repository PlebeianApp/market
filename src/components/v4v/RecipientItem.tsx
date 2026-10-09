import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, Lock, Wallet, Zap } from 'lucide-react'
import { useState, useEffect } from 'react'
import { getHexColorFingerprintFromHexPubkey } from '@/lib/utils'
import { useZapCapabilityInfo } from '@/queries/profiles'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { clampAllocation, type AllocationUnit } from '@/lib/v4v/allocations'
import { pubkeyForms, type V4VShare } from '@/lib/v4v/share'
import { UserCard } from '../UserCard'

interface RecipientItemProps {
	share: V4VShare
	/** The unit `share.bps` is expressed in — the row formats through it, never itself. */
	unit: AllocationUnit
	onRemove: (id: string) => void
	onAllocationChange?: (id: string, allocation: number) => void
	color?: string
	/** Badge text for a fixed participant (e.g. "Validator"). */
	lockedLabel: string
	/** Heading of the collapsed adjuster. */
	adjustHint: string
	/** Show zap-capability badges (sales-only; an auction pays by mint payout path). */
	showZapBadges?: boolean
}

/**
 * Zap-capability badges. Rendered only when a call site asks for them, so the
 * capability query does not run on surfaces where zaps are not how recipients
 * are paid (the auction editor).
 */
function ZapBadges({ npub }: { npub: string }) {
	const { data: zapInfo, isLoading: isLoadingZapInfo } = useZapCapabilityInfo(npub)

	return (
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
	)
}

export function RecipientItem({
	share,
	unit,
	onRemove,
	onAllocationChange,
	color: providedColor,
	lockedLabel,
	adjustHint,
	showZapBadges = false,
}: RecipientItemProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [allocation, setAllocation] = useState(clampAllocation(share.bps, unit.total))
	const [color, setColor] = useState(providedColor || getHexColorFingerprintFromHexPubkey(share.pubkey))

	// Update the local value when the parent updates the share
	useEffect(() => {
		setAllocation(clampAllocation(share.bps, unit.total))
	}, [share.bps, unit.total])

	const { pubkey, npub } = pubkeyForms(share.pubkey)
	const locked = share.locked === true

	const handleSliderChange = (value: number[]) => {
		const next = clampAllocation(value[0], unit.total)
		setAllocation(next)
		onAllocationChange?.(share.id, next)
	}

	// A fixed participant is not editable at all: no remove, no slider. Rendering a
	// control that silently does nothing is worse than not rendering it.
	if (locked) {
		return (
			<div
				className="border rounded-md overflow-hidden bg-muted/40"
				style={{ borderLeftWidth: '4px', borderLeftColor: color }}
				data-testid="v4v-locked-recipient"
			>
				<div className="flex items-center gap-2 p-3">
					<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
					<UserCard pubkey={pubkey} size="xs" />
					<Tooltip>
						<TooltipTrigger>
							<Badge variant="outline" className="h-6 px-1.5 text-muted-foreground">
								<span className="text-xs">{lockedLabel}</span>
							</Badge>
						</TooltipTrigger>
						<TooltipContent>
							<p>{share.lockedReason ?? 'This participant is fixed and cannot be removed.'}</p>
						</TooltipContent>
					</Tooltip>
					<div className="flex-grow" />
					<div className="font-semibold">{unit.format(allocation)}</div>
				</div>
			</div>
		)
	}

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="border rounded-md overflow-hidden"
			style={{ borderLeftWidth: '4px', borderLeftColor: color }}
		>
			<div className="flex items-center gap-2 p-3">
				<UserCard pubkey={pubkey} size="xs" />

				{showZapBadges && <ZapBadges npub={npub} />}

				<div className="flex-grow" />
				<div className="font-semibold">{unit.format(allocation)}</div>
				<CollapsibleTrigger asChild>
					<Button variant="ghost" size="sm">
						<ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} />
					</Button>
				</CollapsibleTrigger>
				<Button variant="ghost" size="sm" onClick={() => onRemove(share.id)} data-testid="v4v-remove-recipient">
					<span className="i-delete w-5 h-5"></span>
				</Button>
			</div>
			<CollapsibleContent>
				<div className="px-3 pb-4">
					<div className="text-sm text-muted-foreground mb-2">{adjustHint}</div>
					<Slider value={[allocation]} min={unit.step} max={unit.total} step={unit.step} onValueChange={handleSliderChange} />
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}
