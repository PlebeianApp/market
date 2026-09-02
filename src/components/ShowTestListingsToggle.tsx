import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { testLabelActions, testLabelStore } from '@/lib/stores/testLabels'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { auctionKeys, productKeys } from '@/queries/queryKeyFactory'

/**
 * Browsing-surface toggle (ADR-0009 rev 3): reveals test-labeled items in
 * feeds. Visible to all users; defaults to hidden. Changing it invalidates
 * the product/auction browsing query keys so feeds refetch with the new flag.
 */
export function ShowTestListingsToggle() {
	const queryClient = useQueryClient()
	const showTestListings = useStore(testLabelStore, (state) => state.showTestListings)

	const handleChange = (checked: boolean) => {
		testLabelActions.setShowTestListings(checked)
		// Browsing-only read paths must refetch with the new flag. `productKeys.all`
		// and `auctionKeys.all` are prefixes, so paginated/search/collection keys
		// are matched as well.
		void queryClient.invalidateQueries({ queryKey: productKeys.all })
		void queryClient.invalidateQueries({ queryKey: auctionKeys.all })
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
