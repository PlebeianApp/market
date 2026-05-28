import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { ProductGridBase } from './CMSProductGridBase'
import { CMSProductGridItem } from './CMSProductGridItem'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

// Define the simplified props for the dynamic grid
export interface ProductGridStaticProps {
	productIds: string[]
	columnsDesktop?: number
	columnsTablet?: number
	columnsMobile?: number
	showQuickAdd?: boolean
	showVendor?: boolean
}

export const ProductGridStatic: React.FC<ProductGridStaticProps> = ({
	productIds,
	columnsDesktop = 3,
	columnsTablet = 2,
	columnsMobile = 1,
	showQuickAdd = true,
	showVendor = true,
}) => {
	const [items, setItems] = useState<CMSProductGridItem[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetch = async () => {
			const ndk = ndkActions.getNDK()!
			let events: NDKEvent[] = []

			if (productIds && productIds.length > 0) {
				events = Array.from(await ndk.fetchEvents({ ids: productIds.slice(0, 1) }))
			}

			setItems(CMSProductGridItem.fromEvents(Array.from(events)))
			setLoading(false)
		}
		fetch()
	}, [productIds])

	// Pass the fetched IDs to the static renderer
	return (
		<ProductGridBase
			items={items}
			loading={loading}
			columnsDesktop={columnsDesktop}
			columnsTablet={columnsTablet}
			columnsMobile={columnsMobile}
			showQuickAdd={showQuickAdd}
			showVendor={showVendor}
		/>
	)
}
