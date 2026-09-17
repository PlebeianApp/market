import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { testLabelActions, testLabelStore } from '@/lib/stores/testLabels'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'

/**
 * Browsing-surface toggle (ADR-0009 rev 3): reveals test-labeled items in
 * feeds. Visible to all users; defaults to hidden. Changing it invalidates
 * the product and auction browsing query keys so both feeds refetch with the
 * new flag — the auctions feed keys under `auctionKeys.all` (['auctions']) and
 * is gated by the same `excludeTestLabeledEvents` call.
 */
export function ShowTestListingsToggle() {
	const queryClient = useQueryClient()
	const showTestListings = useStore(testLabelStore, (state) => state.showTestListings)

	const handleChange = (checked: boolean) => {
		testLabelActions.setShowTestListings(checked)
		// Prefix invalidation matches paginated/search/collection keys too.
		void queryClient.invalidateQueries({ queryKey: ['products'] })
		void queryClient.invalidateQueries({ queryKey: ['auctions'] })
	}

	return (
		<div className="flex items-center space-x-2">
			<Checkbox id="show-test-listings" checked={showTestListings} onCheckedChange={handleChange} />
			<Label htmlFor="show-test-listings" className="text-sm font-normal cursor-pointer">
				Show test listings
			</Label>
		</div>
	)
}
