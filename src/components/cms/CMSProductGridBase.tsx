import React from 'react'
import type { CMSProductGridItem } from './CMSProductGridItem'

// Map numeric values to valid Tailwind class names
const COLUMN_MAP: Record<number, string> = {
	1: 'grid-cols-1',
	2: 'grid-cols-2',
	3: 'grid-cols-3',
	4: 'grid-cols-4',
	5: 'grid-cols-5',
	6: 'grid-cols-6',
}

export interface ProductGridBaseProps {
	items: CMSProductGridItem[]
	loading: boolean
	error?: string
	columnsDesktop?: number
	columnsTablet?: number
	columnsMobile?: number
	showQuickAdd?: boolean
	showVendor?: boolean
}

export const ProductGridBase: React.FC<ProductGridBaseProps> = ({
	items,
	loading = false,
	error = undefined,
	columnsDesktop = 3,
	columnsTablet = 2,
	columnsMobile = 1,
	showQuickAdd = true,
	showVendor = true,
}) => {
	if (loading) {
		return <div className="py-12 text-center">Loading products...</div>
	}

	if (error) {
		return <div className="py-12 text-center">{error}</div>
	}

	if (items.length === 0) {
		return <div className="py-12 text-center text-gray-500">No products found matching your criteria.</div>
	}

	// Safely resolve class names using the map
	// Fallback to 'grid-cols-1' if the number is outside our map (e.g., 7+)
	const mobileClass = COLUMN_MAP[columnsMobile] || 'grid-cols-1'
	const tabletClass = COLUMN_MAP[columnsTablet] || 'grid-cols-2'
	const desktopClass = COLUMN_MAP[columnsDesktop] || 'grid-cols-3'

	return (
		<div className="py-12 px-6 max-w-7xl mx-auto">
			{/* 
			 Tailwind classes are now static strings derived from the map.
			 This ensures the compiler generates the correct CSS.
			*/}
			<div className={`grid gap-8 ${mobileClass} md:${tabletClass} lg:${desktopClass}`}>
				{items.map((product) => (
					<div
						key={product.id}
						className="group relative bg-white rounded-lg shadow-sm hover:shadow-lg transition-shadow duration-300 overflow-hidden border border-gray-100 flex flex-col"
					>
						{/* Image Container */}
						<div className="relative aspect-square overflow-hidden bg-gray-100">
							{product.image ? (
								<img
									src={product.image}
									alt={product.title}
									className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
								/>
							) : (
								<div className="w-full h-full flex items-center justify-center text-gray-400">No Image</div>
							)}

							{/* Quick Add Button */}
							{showQuickAdd && (
								<button className="absolute bottom-4 left-1/2 -translate-x-1/2 translate-y-12 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-white text-gray-900 px-4 py-2 rounded-md font-medium shadow-md hover:bg-gray-50 whitespace-nowrap">
									Quick Add
								</button>
							)}
						</div>

						{/* Content */}
						<div className="p-4 flex flex-col flex-1">
							{showVendor && product.pubkey && (
								<p className="text-xs text-gray-500 uppercase tracking-wide mb-1 truncate">
									{product.pubkey.slice(0, 6)}...{product.pubkey.slice(-4)}
								</p>
							)}
							<h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
								<a href={`/product/${product.id}`} className="hover:text-orange-600 transition-colors">
									{product.title}
								</a>
							</h3>

							<div className="mt-auto">
								<p className="text-lg font-bold text-gray-900">
									{product.currency || 'SATS'} {product.price}
								</p>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
