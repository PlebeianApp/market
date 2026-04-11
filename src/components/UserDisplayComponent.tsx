import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AvatarUser } from '@/components/AvatarUser'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { profileQueryOptions } from '@/queries/profiles'
import { nip19 } from 'nostr-tools'
import type { ReactNode } from 'react'
import { UserCard } from './UserCard'

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

	return (
		<Card className="p-4">
			<div className="flex items-center gap-4 justify-between">
				<UserCard pubkey={userPubkey} size="md" subtitle="npub" onPress="none" />

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
