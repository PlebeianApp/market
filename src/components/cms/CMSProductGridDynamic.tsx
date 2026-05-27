import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { ProductGridBase } from './CMSProductGridBase'
import { CMSProductGridItem } from './CMSProductGridOld'

// Define the simplified props for the dynamic grid
export interface ProductGridDynamicProps {
	kind?: number
	limit?: number
	author?: string
	tags?: string[][] // Nostr filter tags: [['t', 'electronics']]
	relayUrl?: string
	columnsDesktop?: number
	columnsTablet?: number
	columnsMobile?: number
	showQuickAdd?: boolean
	showVendor?: boolean
}

export const ProductGridDynamic: React.FC<ProductGridDynamicProps> = ({
	kind = 30402,
	limit = 12,
	author,
	tags = [],
	relayUrl,
	columnsDesktop = 3,
	columnsTablet = 2,
	columnsMobile = 1,
	showQuickAdd = true,
	showVendor = true,
}) => {
	const [items, setItems] = useState<CMSProductGridItem[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetchEvents = async () => {
			setLoading(true)
			try {
				const ndk = ndkActions.getNDK()!

				const filter: any = {
					kinds: [kind],
					limit,
				}

				if (author) {
					// Resolve npub/nsec to hex if necessary (NDK handles this usually, but good to be safe)
					filter.authors = [author]
				}

				// Apply tag filters
				tags.forEach((tag) => {
					const tagName = tag[0]
					const tagValue = tag[1]
					if (tagName && tagValue) {
						filter[`#${tagName}`] = [tagValue]
					}
				})

				const events = await ndk.fetchEvents(filter)

				setItems(CMSProductGridItem.fromEvents(Array.from(events)))
			} catch (error) {
				console.error('Failed to fetch events for ProductGridDynamic:', error)
			} finally {
				setLoading(false)
			}
		}

		fetchEvents()
	}, [kind, limit, author, JSON.stringify(tags), relayUrl])

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
