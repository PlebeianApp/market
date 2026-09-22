import { Button } from '@/components/ui/button'
import { TestLabelDialog } from '@/components/dashboard/TestLabelDialog'
import { TEST_LABEL_PRODUCT_KIND } from '@/lib/constants/testLabels'
import { getATagFromCoords } from '@/lib/utils/coords'
import { useUserRole } from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { useTestLabelForCoordinate } from '@/queries/testLabels'
import { FlaskConical } from 'lucide-react'
import { useState } from 'react'

interface TestLabelButtonProps {
	/** Item event kind: 30402 (product) or 30408 (auction) */
	kind: number
	/** Author pubkey of the item */
	pubkey: string
	/** Item d-tag identifier */
	dTag: string
	/** Noun used in button labels and copy ('Product' | 'Auction') */
	itemLabel?: string
	/** Optional wrapper className */
	className?: string
}

/**
 * Dashboard action for authorized labelers (ADR-0009): mark / unmark an item
 * as a "test" listing via NIP-32 label events (kind 1985) and NIP-09
 * deletion events (kind 5).
 *
 * - Visible only to authorized labelers — the curation role set is editors
 *   UNION admins (plus the app owner), matching
 *   `useEntityPermissions().canManageTestLabel`.
 * - Opens the shared `TestLabelDialog` for both mark and unmark, so the same
 *   flow is reachable from the public product page's `EntityActionsMenu`.
 */
export function TestLabelButton({ kind, pubkey, dTag, itemLabel = 'Product', className }: TestLabelButtonProps) {
	const { data: config } = useConfigQuery()
	const { userRole, currentUserPubkey } = useUserRole(config?.appPublicKey)

	const [dialogMode, setDialogMode] = useState<'mark' | 'unmark' | null>(null)

	const isProduct = kind === TEST_LABEL_PRODUCT_KIND
	const kindSlug = isProduct ? 'product' : 'auction'

	const coordinate = pubkey && dTag ? getATagFromCoords({ kind, pubkey, identifier: dTag }) : ''
	const { isLabeled } = useTestLabelForCoordinate(coordinate || undefined)

	// Authorized labelers only (editors ∪ admins ∪ owner) — never regular users.
	const isAuthorizedLabeler = userRole === 'owner' || userRole === 'admin' || userRole === 'editor'
	if (!isAuthorizedLabeler || !currentUserPubkey || !coordinate) return null

	return (
		<>
			{isLabeled ? (
				<Button
					variant="outline"
					size="sm"
					className={className}
					data-testid={`unmark-test-label-${kindSlug}-button`}
					onClick={() => setDialogMode('unmark')}
				>
					<FlaskConical className="h-3.5 w-3.5" />
					Unmark as Test {itemLabel}
				</Button>
			) : (
				<Button
					variant="outline"
					size="sm"
					className={className}
					data-testid={`mark-test-label-${kindSlug}-button`}
					onClick={() => setDialogMode('mark')}
				>
					<FlaskConical className="h-3.5 w-3.5" />
					Mark as Test {itemLabel}
				</Button>
			)}

			{dialogMode && (
				<TestLabelDialog
					kind={kind}
					pubkey={pubkey}
					dTag={dTag}
					itemLabel={itemLabel}
					open={true}
					onOpenChange={(next) => {
						if (!next) setDialogMode(null)
					}}
					mode={dialogMode}
					contactPubkey={currentUserPubkey}
				/>
			)}
		</>
	)
}
