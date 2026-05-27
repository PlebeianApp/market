import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { CMSProductGridItem } from './CMSProductGridOld'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { FeaturedProductCardBase } from './CMSFeaturedProductCardBase'

export interface FeaturedProductCardStaticProps {
	productIds?: string[]
	showPrice?: boolean
	showDimensions?: boolean
	showDescriptionSnippet?: boolean
}

export const FeaturedProductCardStatic: React.FC<FeaturedProductCardStaticProps> = ({
	productIds,
	showPrice = true,
	showDescriptionSnippet = true,
}) => {
	const [items, setItems] = useState<CMSProductGridItem[] | undefined>()
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

	return <FeaturedProductCardBase items={items} loading={loading} showDescriptionSnippet={showDescriptionSnippet} showPrice={showPrice} />
}
