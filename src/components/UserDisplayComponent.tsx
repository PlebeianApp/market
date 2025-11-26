import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { profileQueryOptions } from '@/queries/profiles'
import { nip19 } from 'nostr-tools'
import type { ReactNode } from 'react'

interface UserDisplayComponentProps {
	userPubkey: string
	index: number
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove?: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving?: boolean
	customActions?: ReactNode
}

export function UserDisplayComponent({
	userPubkey,
	index,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
	customActions,
}: UserDisplayComponentProps) {
	// Convert pubkey to npub for profile query
	const npub = nip19.npubEncode(userPubkey)

	// Fetch user profile data
	const { data: profile } = useQuery({
		...profileQueryOptions(npub),
		enabled: !!userPubkey,
	})

	// Get user info
	const name = profile?.name || profile?.displayName || 'Unknown User'
	const description = profile?.about || 'No description available'
	const avatarUrl = profile?.picture || profile?.image
	const displayPubkey = userPubkey.slice(0, 8) + '...' + userPubkey.slice(-8)

	return (
		<Card className="p-4">
			<div className="flex items-center gap-4">
				{/* User Avatar */}
				<div className="flex-shrink-0">
					<Avatar className="w-16 h-16">
						<AvatarImage src={avatarUrl} alt={name} />
						<AvatarFallback className="bg-gray-300 text-gray-600">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
					</Avatar>
				</div>

				{/* User Info */}
				<div className="flex-1 min-w-0">
					<h3 className="font-semibold text-sm truncate">{name}</h3>
					<p className="text-xs text-gray-600 mt-1 line-clamp-2">{description}</p>
					<p className="text-xs text-gray-400 mt-1">Pubkey: {displayPubkey}</p>
				</div>

				{/* Action Buttons */}
				{customActions ? (
					<div className="flex flex-col gap-1">{customActions}</div>
				) : (
					<div className="flex flex-col gap-1">
						{onMoveUp && (
							<Button variant="outline" size="sm" onClick={onMoveUp} disabled={!canMoveUp || isReordering} className="h-8 w-8 p-0">
								<ChevronUp className="h-4 w-4" />
							</Button>
						)}
						{onMoveDown && (
							<Button variant="outline" size="sm" onClick={onMoveDown} disabled={!canMoveDown || isReordering} className="h-8 w-8 p-0">
								<ChevronDown className="h-4 w-4" />
							</Button>
						)}
						{onRemove && (
							<Button variant="destructive" size="sm" onClick={onRemove} disabled={isRemoving} className="h-8 w-8 p-0">
								<Trash2 className="h-4 w-4" />
							</Button>
						)}
					</div>
				)}
			</div>
		</Card>
	)
}
