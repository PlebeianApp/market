import { useProductData } from '@/hooks/useProductData'
import type { DataSource } from '@/components/editor/DataSourceField'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { CMSProductCard } from './CMSProductCard'
import React from 'react'

export interface CMSFeaturedProductCardProps {
	dataSource?: DataSource
	title?: string
	showPrice?: boolean
	showDescriptionSnippet?: boolean
}

export const CMSFeaturedProductCard: React.FC<CMSFeaturedProductCardProps> = ({
	dataSource,
	title = '',
	showPrice = true,
	showDescriptionSnippet = true,
}) => {
	const { events, loading, error } = useProductData(dataSource)

	if (loading) return <div className="text-center">Loading...</div>
	if (error) return <div className="text-center text-destructive">{error}</div>
	if (!events || events.length === 0) return <div className="text-center text-muted-foreground">No products found.</div>

	const product = events[0]

	return (
		<div className="py-12 px-6">
			{/* Title Header */}
			{title && (
				<div className="mb-8">
					<h2 className="text-2xl font-heading tracking-wider">{title}</h2>
				</div>
			)}

			<div className="max-w-md mx-auto">
				<CMSProductCard product={product} showPrice={showPrice} showDescriptionSnippet={showDescriptionSnippet} />
			</div>
		</div>
	)
}
