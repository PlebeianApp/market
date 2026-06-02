import { useProductData } from '@/hooks/useProductData'
import type { DataSource } from '@/components/editor/DataSourceField'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { CMSProductCard } from './CMSProductCard'
import React from 'react'

export interface CMSFeaturedProductCardProps {
	dataSource?: DataSource
	showPrice?: boolean
	showDescriptionSnippet?: boolean
}

export const CMSFeaturedProductCard: React.FC<CMSFeaturedProductCardProps> = ({
	dataSource,
	showPrice = true,
	showDescriptionSnippet = true,
}) => {
	const { events, loading, error } = useProductData(dataSource)

	if (loading) return <div>Loading...</div>
	if (error) return <div>{error}</div>
	if (!events || events.length === 0) return <div>No products found.</div>

	const product = events[0]

	return <CMSProductCard product={product} showPrice={showPrice} showDescriptionSnippet={showDescriptionSnippet} />
}
