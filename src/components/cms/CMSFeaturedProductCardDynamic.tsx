import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import type { CMSProductGridItem } from './CMSProductGridItem'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { FeaturedProductCardBase } from './CMSFeaturedProductCardBase'

export interface FeaturedProductCardDynamicProps {
	filters?: {
		kind?: number
		authors?: string[]
		tags?: string[][]
		limit?: number
	}
	showPrice?: boolean
	showDimensions?: boolean
	showDescriptionSnippet?: boolean
}

export const FeaturedProductCardDynamic: React.FC<FeaturedProductCardDynamicProps> = ({
	filters,
	showPrice = true,
	showDimensions = true,
	showDescriptionSnippet = true,
}) => {
	const [items, setItems] = useState<CMSProductGridItem[] | undefined>()
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetch = async () => {
			const ndk = ndkActions.getNDK()!
			let events: NDKEvent[] = []

			if (filters) {
				const filter: any = { kinds: [filters.kind || 30402], limit: filters.limit || 1 }
				if (filters.authors) filter.authors = filters.authors
				if (filters.tags) {
					filters.tags.forEach((t) => {
						filter[`#${t[0]}`] = [t[1]]
					})
				}
				events = Array.from(await ndk.fetchEvents(filter))
			}

			if (events.length > 0) {
				setItems(
					events.map((e) => ({
						id: e.id,
						title: e.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled',
						image: e.tags.find((t) => t[0] === 'image')?.[1],
						price: e.tags.find((t) => t[0] === 'price')?.[1],
						currency: e.tags.find((t) => t[0] === 'price')?.[2],
						content: e.content,
						pubkey: e.pubkey,
						tags: e.tags,
					})),
				)
			}
			setLoading(false)
		}
		fetch()
	}, [filters])

	return <FeaturedProductCardBase items={items} loading={loading} showDescriptionSnippet={showDescriptionSnippet} showPrice={showPrice} />
}
