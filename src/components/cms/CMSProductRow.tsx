import { useProductData } from '@/hooks/useProductData'
import type { DataSource } from '@/components/editor/DataSourceField'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { CMSProductCard } from './CMSProductCard'
import React from 'react'

export interface CMSProductRowProps {
	dataSource?: DataSource
	title?: string
	showVendor?: boolean
}

export const CMSProductRow: React.FC<CMSProductRowProps> = ({ dataSource, title = '', showVendor = true }) => {
	const { events, loading, error } = useProductData(dataSource)

	if (loading) {
		return <div className="py-12 text-center">Loading products...</div>
	}

	if (error) {
		return <div className="py-12 text-center">{error}</div>
	}

	if (events.length === 0) {
		return <div className="py-12 text-center text-muted-foreground">No products found matching your criteria.</div>
	}

	return (
		<div className="py-12 px-6 max-w-7xl mx-auto">
			{/* Title Header */}
			{title && (
				<div className="mb-8">
					<h2 className="text-2xl font-heading tracking-wider">{title}</h2>
				</div>
			)}

			{/* Horizontal Scrollable Row */}
			<div className="overflow-x-auto">
				<div className="flex space-x-6 pb-4" style={{ minWidth: 'max-content' }}>
					{events.map((product) => (
						<div key={product.id} className="flex-shrink-0" style={{ width: '320px' }}>
							<CMSProductCard product={product} showVendor={showVendor} />
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
