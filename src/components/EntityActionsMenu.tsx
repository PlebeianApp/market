import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { EntityPermissions } from '@/hooks/useEntityPermissions'
import { Ban, Edit, MoreVertical, Star, StarOff } from 'lucide-react'

export interface EntityActionsMenuProps {
	permissions: EntityPermissions
	entityType: 'product' | 'collection' | 'profile'
	entityId: string
	entityCoords?: string // For blacklisting products/collections
	isBlacklisted?: boolean
	isFeatured?: boolean
	onEdit?: () => void
	onBlacklist?: () => void
	onUnblacklist?: () => void
	onSetFeatured?: () => void
	onUnsetFeatured?: () => void
}

/**
 * EntityActionsMenu - A dropdown menu that shows context-appropriate actions
 * based on user permissions for products, collections, and profiles
 */
export function EntityActionsMenu({
	permissions,
	entityType,
	entityId,
	entityCoords,
	isBlacklisted = false,
	isFeatured = false,
	onEdit,
	onBlacklist,
	onUnblacklist,
	onSetFeatured,
	onUnsetFeatured,
}: EntityActionsMenuProps) {
	const { canEdit, canBlacklist, canSetFeatured } = permissions

	// Don't show menu if user has no actions available
	const hasAnyAction = canEdit || canBlacklist || canSetFeatured
	if (!hasAnyAction) {
		return null
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="h-8 w-8">
					<MoreVertical className="h-4 w-4" />
					<span className="sr-only">Open menu</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				{/* Owner actions */}
				{canEdit && onEdit && (
					<DropdownMenuItem onClick={onEdit}>
						<Edit className="mr-2 h-4 w-4" />
						<span>Edit {entityType}</span>
					</DropdownMenuItem>
				)}

				{/* Separator between owner and admin/editor actions */}
				{canEdit && (canBlacklist || canSetFeatured) && <DropdownMenuSeparator />}

				{/* Admin/Editor actions */}
				{canSetFeatured && (
					<>
						{!isFeatured && onSetFeatured && (
							<DropdownMenuItem onClick={onSetFeatured}>
								<Star className="mr-2 h-4 w-4" />
								<span>Set as featured</span>
							</DropdownMenuItem>
						)}
						{isFeatured && onUnsetFeatured && (
							<DropdownMenuItem onClick={onUnsetFeatured}>
								<StarOff className="mr-2 h-4 w-4" />
								<span>Remove from featured</span>
							</DropdownMenuItem>
						)}
					</>
				)}

				{canBlacklist && entityType !== 'profile' && (
					<>
						{!isBlacklisted && onBlacklist && (
							<DropdownMenuItem onClick={onBlacklist} className="text-destructive focus:text-destructive">
								<Ban className="mr-2 h-4 w-4" />
								<span>Blacklist {entityType}</span>
							</DropdownMenuItem>
						)}
						{isBlacklisted && onUnblacklist && (
							<DropdownMenuItem onClick={onUnblacklist}>
								<Ban className="mr-2 h-4 w-4" />
								<span>Remove from blacklist</span>
							</DropdownMenuItem>
						)}
					</>
				)}

				{canBlacklist && entityType === 'profile' && (
					<>
						{!isBlacklisted && onBlacklist && (
							<DropdownMenuItem onClick={onBlacklist} className="text-destructive focus:text-destructive">
								<Ban className="mr-2 h-4 w-4" />
								<span>Blacklist user</span>
							</DropdownMenuItem>
						)}
						{isBlacklisted && onUnblacklist && (
							<DropdownMenuItem onClick={onUnblacklist}>
								<Ban className="mr-2 h-4 w-4" />
								<span>Remove user from blacklist</span>
							</DropdownMenuItem>
						)}
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
