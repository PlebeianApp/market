import { UserWithAvatar } from '@/components/UserWithAvatar'
import { nip19 } from 'nostr-tools'
import { Card } from '@/components/ui/card'

interface RecipientPreviewProps {
	npub: string
	percentage: number
	canReceiveZaps: boolean | undefined
	isLoading: boolean
}

export function RecipientPreview({ npub, percentage, canReceiveZaps, isLoading }: RecipientPreviewProps) {
	if (!npub) return null

	let pubkey: string = npub

	// Convert npub to hex pubkey if needed
	if (npub.startsWith('npub')) {
		try {
			const { data } = nip19.decode(npub)
			if (typeof data === 'string') {
				pubkey = data
			}
		} catch (error) {
			// Invalid npub, but still show something
			return (
				<Card className="p-3 border-dashed border-orange-300 bg-orange-50 mt-2">
					<div className="text-sm text-orange-700">Invalid npub format</div>
				</Card>
			)
		}
	}

	if (isLoading) {
		return (
			<Card className="p-3 border-dashed mt-2">
				<div className="flex items-center gap-2">
					<div className="h-6 w-6 rounded-full bg-gray-200 animate-pulse"></div>
					<div className="flex-1 h-4 bg-gray-200 animate-pulse rounded"></div>
					<div className="text-sm text-gray-500">Checking zap capability...</div>
				</div>
			</Card>
		)
	}

	return (
		<Card className={`p-3 border-dashed ${canReceiveZaps ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'} mt-2`}>
			<div className="flex items-center gap-2">
				<UserWithAvatar pubkey={pubkey} size="sm" showBadge={false} />
				<div className="flex-grow"></div>
				<div className="font-semibold">{percentage}%</div>
				{canReceiveZaps === false && <div className="text-sm text-red-600">Cannot receive zaps</div>}
			</div>
		</Card>
	)
}
