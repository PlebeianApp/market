import { useProductData } from '@/hooks/useProductData'
import type { DataSource } from '@/components/editor/DataSourceField'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { CMSProductCard } from './CMSProductCard'
import React from 'react'

// Map numeric values to valid Tailwind class names
const COLUMN_MAP: Record<number, string> = {
	1: 'grid-cols-1',
	2: 'grid-cols-2',
	3: 'grid-cols-3',
	4: 'grid-cols-4',
	5: 'grid-cols-5',
	6: 'grid-cols-6',
}

export interface CMSProductGridProps {
	dataSource?: DataSource
	columnsDesktop?: number
	columnsTablet?: number
	columnsMobile?: number
	showVendor?: boolean
}

export const CMSProductGrid: React.FC<CMSProductGridProps> = ({
	dataSource,
	columnsDesktop = 3,
	columnsTablet = 2,
	columnsMobile = 1,
	showVendor = true,
}) => {
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

	// Safely resolve class names using the map
	// Fallback to 'grid-cols-1' if the number is outside our map (e.g., 7+)
	const mobileClass = COLUMN_MAP[columnsMobile] || 'grid-cols-1'
	const tabletClass = COLUMN_MAP[columnsTablet] || 'grid-cols-2'
	const desktopClass = COLUMN_MAP[columnsDesktop] || 'grid-cols-3'

	return (
		<div className="py-12 px-6 max-w-7xl mx-auto">
			<div className={`grid gap-8 ${mobileClass} md:${tabletClass} lg:${desktopClass}`}>
				{events.map((product) => (
					<CMSProductCard key={product.id} product={product} showVendor={showVendor} />
				))}
			</div>
		</div>
	)
}
